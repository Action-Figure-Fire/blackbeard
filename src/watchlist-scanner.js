/**
 * Blackbeard 🏴‍☠️ — Artist Watchlist Scanner
 * Monitors watchlisted artists for new tour dates and ticket announcements
 * Checks SeatGeek API + Brave search for new shows
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

// Load .env
try {
  const envPath = path.join(__dirname, '..', '.env');
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf8').split('\n');
    for (const line of lines) {
      const [key, ...val] = line.split('=');
      if (key && val.length) process.env[key.trim()] = val.join('=').trim();
    }
  }
} catch (e) {}

function fetch(url, options = {}) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : require('http');
    const req = mod.get(url, {
      headers: { 'User-Agent': 'Blackbeard-Watchlist/1.0', ...options.headers },
      timeout: 15000
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, data }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

function loadWatchlist() {
  const p = path.join(__dirname, '..', 'data', 'watchlist.json');
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function loadPreviousEvents() {
  const p = path.join(__dirname, '..', 'reports', 'watchlist-prev.json');
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return { events: {} }; }
}

function savePreviousEvents(data) {
  const dir = path.join(__dirname, '..', 'reports');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'watchlist-prev.json'), JSON.stringify(data, null, 2));
}

async function checkSeatGeek(artistName) {
  const sgId = process.env.SEATGEEK_CLIENT_ID;
  if (!sgId) return [];
  
  try {
    const q = encodeURIComponent(artistName);
    const url = `https://api.seatgeek.com/2/events?q=${q}&client_id=${sgId}&per_page=10&sort=datetime_utc.asc`;
    const res = await fetch(url);
    if (res.status !== 200) return [];
    const data = JSON.parse(res.data);
    
    return (data.events || []).map(e => ({
      title: e.title,
      venue: e.venue?.name || 'Unknown',
      city: e.venue?.city || '',
      state: e.venue?.state || '',
      capacity: e.venue?.capacity || 0,
      date: e.datetime_local,
      url: e.url,
      source: 'seatgeek'
    })).filter(e => e.capacity <= 10000 || e.capacity === 0); // Only small venues
  } catch (e) { return []; }
}

async function checkBrave(artistName) {
  const key = process.env.BRAVE_API_KEY;
  if (!key) return [];
  
  try {
    const q = encodeURIComponent(`"${artistName}" tickets 2026 tour "on sale" OR "just announced"`);
    const url = `https://api.search.brave.com/res/v1/web/search?q=${q}&count=5&freshness=pw`;
    const res = await fetch(url, { headers: { 'X-Subscription-Token': key } });
    if (res.status !== 200) return [];
    const data = JSON.parse(res.data);
    
    return (data.web?.results || []).map(r => ({
      title: r.title || '',
      text: r.description || '',
      url: r.url,
      source: 'brave'
    }));
  } catch (e) { return []; }
}

// --- Twitter/X Scanner for watchlist artists ---
async function checkTwitter(artists) {
  const token = process.env.TWITTER_BEARER_TOKEN;
  if (!token) { console.log('  Twitter/X: skipped (no bearer token)'); return []; }

  const results = [];
  
  // Batch artists into groups of 4-5 per query (Twitter query length limits)
  // Focus on tour/ticket announcements
  const tierA = artists.filter(a => a.tier === 'A');
  const tierB = artists.filter(a => a.tier === 'B');
  
  // Build queries — prioritize Tier A, sample Tier B
  const queryArtists = [...tierA, ...tierB.slice(0, 15)]; // Cap at ~35 to save API calls
  const batches = [];
  for (let i = 0; i < queryArtists.length; i += 4) {
    batches.push(queryArtists.slice(i, i + 4));
  }

  // Limit to 8 queries max (Twitter rate limits)
  for (const batch of batches.slice(0, 8)) {
    try {
      const names = batch.map(a => `"${a.name}"`).join(' OR ');
      const query = `(${names}) (tickets OR "on sale" OR "tour" OR "just announced" OR "presale" OR "sold out") -is:retweet lang:en`;
      const url = `https://api.twitter.com/2/tweets/search/recent?query=${encodeURIComponent(query)}&max_results=20&tweet.fields=created_at,public_metrics,author_id`;
      
      const res = await fetch(url, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      if (res.status === 200) {
        const json = JSON.parse(res.data);
        if (json?.data) {
          for (const tweet of json.data) {
            // Match which artist this tweet is about
            let matchedArtist = null;
            const tweetLower = tweet.text.toLowerCase();
            for (const a of batch) {
              if (tweetLower.includes(a.name.toLowerCase())) {
                matchedArtist = a;
                break;
              }
            }
            
            if (matchedArtist) {
              const metrics = tweet.public_metrics || {};
              results.push({
                artist: matchedArtist.name,
                category: matchedArtist.category,
                tier: matchedArtist.tier,
                text: tweet.text.substring(0, 200),
                url: `https://x.com/i/status/${tweet.id}`,
                likes: metrics.like_count || 0,
                retweets: metrics.retweet_count || 0,
                source: 'twitter',
                created: tweet.created_at,
                redRocks: matchedArtist.redRocks
              });
            }
          }
        }
      } else if (res.status === 429) {
        console.log('  Twitter/X: rate limited, stopping');
        break;
      }
      await new Promise(r => setTimeout(r, 1500));
    } catch (e) {
      // continue on error
    }
  }
  
  return results;
}

async function runWatchlistScan() {
  console.log('👀 Blackbeard Watchlist Scanner running...');
  
  const watchlist = loadWatchlist();
  const prev = loadPreviousEvents();
  const newFinds = [];
  
  // --- Twitter/X scan ---
  console.log('  🐦 Checking Twitter/X...');
  const twitterFinds = await checkTwitter(watchlist.artists);
  for (const tw of twitterFinds) {
    const key = `twitter-${tw.artist}-${tw.url}`;
    if (!prev.events[key]) {
      prev.events[key] = { firstSeen: new Date().toISOString() };
      // Only include high-engagement tweets or clear announcements
      const text = tw.text.toLowerCase();
      if (tw.likes > 50 || tw.retweets > 10 || /just announced|on sale|presale|new tour|sold out|new date|added show/.test(text)) {
        newFinds.push(tw);
      }
    }
  }
  console.log(`  Twitter/X: ${twitterFinds.length} mentions, ${newFinds.length} new alerts`);

  for (const artist of watchlist.artists) {
    console.log(`  Checking: ${artist.name}...`);
    
    // Check SeatGeek for upcoming events
    const sgEvents = await checkSeatGeek(artist.name);
    await new Promise(r => setTimeout(r, 400));
    
    for (const event of sgEvents) {
      const key = `${artist.name}-${event.date}-${event.venue}`;
      if (!prev.events[key]) {
        prev.events[key] = { firstSeen: new Date().toISOString() };
        newFinds.push({
          artist: artist.name,
          category: artist.category,
          tier: artist.tier,
          ...event,
          redRocks: artist.redRocks
        });
      }
    }
    
    // Check Brave for recent announcements (only for tier A artists to save API calls)
    if (artist.tier === 'A') {
      const braveResults = await checkBrave(artist.name);
      await new Promise(r => setTimeout(r, 500));
      
      for (const result of braveResults) {
        const key = `brave-${artist.name}-${result.url}`;
        if (!prev.events[key]) {
          prev.events[key] = { firstSeen: new Date().toISOString() };
          // Only include if it looks like a new tour/show announcement
          const text = `${result.title} ${result.text}`.toLowerCase();
          if (/just announced|new.*tour|on sale|presale|added show|new date/.test(text)) {
            newFinds.push({
              artist: artist.name,
              category: artist.category,
              tier: artist.tier,
              title: result.title,
              url: result.url,
              source: 'brave',
              redRocks: artist.redRocks
            });
          }
        }
      }
    }
  }
  
  savePreviousEvents(prev);
  
  // Format alert
  let alert = null;
  if (newFinds.length > 0) {
    alert = '👀 **WATCHLIST ALERT** 🏴‍☠️\n\n';
    
    const sgFinds = newFinds.filter(f => f.source === 'seatgeek');
    const braveFinds = newFinds.filter(f => f.source === 'brave');
    
    if (sgFinds.length > 0) {
      alert += '**🎟️ NEW TOUR DATES:**\n';
      for (const f of sgFinds.slice(0, 15)) {
        const capStr = f.capacity ? ` (${f.capacity.toLocaleString()} cap)` : '';
        const rrStr = f.redRocks ? ` | RR get-in: ${typeof f.redRocks === 'object' ? f.redRocks.getIn : f.redRocks}` : '';
        alert += `- **${f.artist}** [${f.tier}] — ${f.venue}${capStr}, ${f.city} ${f.state}\n`;
        alert += `  📅 ${f.date}${rrStr}\n`;
        if (f.url) alert += `  <${f.url}>\n`;
      }
      alert += '\n';
    }
    
    if (braveFinds.length > 0) {
      alert += '**📢 ANNOUNCEMENTS:**\n';
      for (const f of braveFinds.slice(0, 10)) {
        alert += `- **${f.artist}** [${f.tier}] — ${f.title}\n`;
        if (f.url) alert += `  <${f.url}>\n`;
      }
      alert += '\n';
    }
    
    const twitterAlerts = newFinds.filter(f => f.source === 'twitter');
    if (twitterAlerts.length > 0) {
      alert += '**🐦 TWITTER BUZZ:**\n';
      for (const f of twitterAlerts.slice(0, 10)) {
        alert += `- **${f.artist}** [${f.tier}] — ${f.text.substring(0, 120)}...\n`;
        alert += `  ❤️ ${f.likes} | 🔄 ${f.retweets}`;
        if (f.url) alert += ` | <${f.url}>`;
        alert += '\n';
      }
    }
  }
  
  console.log(`  Found ${newFinds.length} new events/announcements`);
  
  // Save report
  const reportDir = path.join(__dirname, '..', 'reports');
  if (!fs.existsSync(reportDir)) fs.mkdirSync(reportDir, { recursive: true });
  fs.writeFileSync(
    path.join(reportDir, 'watchlist-latest.json'),
    JSON.stringify({ timestamp: new Date().toISOString(), newFinds, totalWatched: watchlist.artists.length }, null, 2)
  );
  
  return { newFinds, alert };
}

module.exports = { runWatchlistScan, loadWatchlist };

if (require.main === module) {
  runWatchlistScan().then(({ newFinds, alert }) => {
    if (alert) console.log('\n' + alert);
    else console.log('No new events for watchlisted artists.');
    process.exit(0);
  }).catch(e => { console.error(e); process.exit(1); });
}
