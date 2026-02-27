/**
 * Blackbeard 🏴‍☠️ — Comedy Show Scanner
 * Monitors comedian announcements on Twitter, Eventbrite, and venue sites
 * Alerts when small-venue (<500 cap) shows are announced
 */

const https = require('https');
const http = require('http');
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
} catch (e) { /* ignore */ }

// --- Comedians to Track ---
const COMEDIANS = [
  { name: 'Shane Gillis', twitter: 'shaaborern', handles: ['shanemgillis'] },
  { name: 'Theo Von', twitter: 'TheoVon', handles: ['theovon'] },
  { name: 'Mark Normand', twitter: 'maraborern', handles: ['marknormand'] },
  { name: 'Sam Morril', twitter: 'sammorril', handles: ['sammorril'] },
  { name: 'Stavros Halkias', twitter: 'stavvybaby2', handles: ['stavvybaby'] },
  { name: 'Taylor Tomlinson', twitter: 'taylortomlinson', handles: ['taylortomlinson'] },
  { name: 'Matt Rife', twitter: 'mattrife', handles: ['mattrife'] },
  { name: 'Nate Bargatze', twitter: 'naborgargatze', handles: ['natebargatze'] },
  { name: 'Andrew Schulz', twitter: 'andrewschulz', handles: ['andrewschulz'] },
  { name: 'Donnell Rawlings', twitter: 'donnellrawlings', handles: ['donnellrawlings'] },
  { name: 'Joe List', twitter: 'JoeListComedy', handles: ['joelistcomedy'] },
  { name: 'Ari Shaffir', twitter: 'AriShaffir', handles: ['arishaffir'] },
  { name: 'Tim Dillon', twitter: 'TimJDillon', handles: ['timdilloncomedy'] },
  { name: 'Whitney Cummings', twitter: 'WhitneyCummings', handles: ['whitneycummings'] },
  { name: 'Bert Kreischer', twitter: 'bertkreischer', handles: ['bertkreischer'] },
  { name: 'Tom Segura', twitter: 'tomsegura', handles: ['tomsegura'] },
  { name: 'Christina P', twitter: 'christinapazsitzky', handles: ['christinapcomedy'] },
  { name: 'Nikki Glaser', twitter: 'NikkiGlaser', handles: ['nikkiglaser'] },
  { name: 'Dan Soder', twitter: 'DanSoder', handles: ['dansoder'] },
  { name: 'Luis J Gomez', twitter: 'LuisJGomez', handles: ['luisjgomez'] },
  { name: 'Big Jay Oakerson', twitter: 'BigJayOakerson', handles: ['bigjayoakerson'] },
  { name: 'Yannis Pappas', twitter: 'yaborannispappas', handles: ['yannispappas'] },
  { name: 'Bobby Lee', twitter: 'bobby', handles: ['bobbyleelive'] },
  { name: 'Neal Brennan', twitter: 'neaboralbrennan', handles: ['nealbrennan'] },
  { name: 'Rachel Feinstein', twitter: 'rachelfeinstein', handles: ['rachelfeinstein'] },
];

// Small comedy venues to monitor (< 500 cap)
const COMEDY_VENUES = [
  { name: 'Comedy Cellar', city: 'New York', cap: 115, site: 'comedycellar.com' },
  { name: 'The Stand', city: 'New York', cap: 200, site: 'thestandnyc.com' },
  { name: 'Comedy Store', city: 'Los Angeles', cap: 450, site: 'thecomedystore.com' },
  { name: 'The Laugh Factory', city: 'Los Angeles', cap: 300, site: 'laughfactory.com' },
  { name: 'Zanies', city: 'Nashville', cap: 300, site: 'nashville.zanies.com' },
  { name: 'Zanies', city: 'Chicago', cap: 250, site: 'chicago.zanies.com' },
  { name: 'Helium Comedy', city: 'Philadelphia', cap: 325, site: 'heliumcomedy.com' },
  { name: 'Helium Comedy', city: 'Portland', cap: 200, site: 'heliumcomedy.com' },
  { name: 'The Improv', city: 'Various', cap: 400, site: 'improv.com' },
  { name: 'Gotham Comedy Club', city: 'New York', cap: 300, site: 'gothamcomedyclub.com' },
  { name: 'Punchline', city: 'San Francisco', cap: 250, site: 'punchlinecomedyclub.com' },
  { name: 'Comedy Works', city: 'Denver', cap: 320, site: 'comedyworks.com' },
  { name: 'Acme Comedy', city: 'Minneapolis', cap: 250, site: 'acmecomedycompany.com' },
  { name: 'The Stress Factory', city: 'New Brunswick', cap: 300, site: 'stressfactory.com' },
  { name: 'Skankfest', city: 'Various', cap: 500, site: 'skankfest.com' },
  { name: 'Wiseguys', city: 'Salt Lake City', cap: 200, site: 'wiseguyscomedy.com' },
  { name: 'The Comedy Mothership', city: 'Austin', cap: 400, site: 'comedymothership.com' },
  { name: 'Cap City Comedy', city: 'Austin', cap: 330, site: 'capcitycomedy.com' },
  { name: 'The Ice House', city: 'Pasadena', cap: 200, site: 'icehousecomedy.com' },
  { name: 'Funny Bone', city: 'Various', cap: 350, site: 'funnybone.com' },
];

// HTTP fetch helper
function fetch(url, options = {}) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, {
      headers: {
        'User-Agent': 'Blackbeard-Comedy-Scanner/1.0',
        ...options.headers
      },
      timeout: 15000
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ status: res.statusCode, data });
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${url}`));
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout: ' + url)); });
  });
}

// --- Twitter Comedy Scanner ---
async function scanComedyTwitter() {
  const token = process.env.TWITTER_BEARER_TOKEN;
  if (!token) { console.log('  Twitter: skipped (no bearer token)'); return []; }

  const results = [];

  // Search for comedian show announcements
  const queries = [
    // Comedian names + ticket/show keywords
    '"just added" comedy show tickets -is:retweet lang:en',
    '"surprise show" comedy OR comedian -is:retweet lang:en',
    '"secret show" comedy OR standup -is:retweet lang:en',
    '"pop up show" comedy -is:retweet lang:en',
    '"late show" comedy club tickets -is:retweet lang:en',
    '"just announced" standup OR comedy tickets -is:retweet lang:en',
    '"on sale now" comedy OR comedian OR standup -is:retweet lang:en',
    // Specific comedian announcements
    '(Shane Gillis OR "Theo Von" OR "Mark Normand" OR "Sam Morril") (tickets OR show OR announced) -is:retweet lang:en',
    '("Matt Rife" OR "Nate Bargatze" OR "Andrew Schulz" OR "Taylor Tomlinson") (tickets OR show OR announced) -is:retweet lang:en',
    '("Stavros" OR "Tim Dillon" OR "Nikki Glaser" OR "Bert Kreischer") (tickets OR show OR announced) -is:retweet lang:en',
  ];

  for (const query of queries) {
    try {
      const url = `https://api.twitter.com/2/tweets/search/recent?query=${encodeURIComponent(query)}&max_results=20&tweet.fields=created_at,public_metrics,author_id`;
      const res = await fetch(url, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const json = JSON.parse(res.data);
      if (json?.data) {
        for (const tweet of json.data) {
          const metrics = tweet.public_metrics || {};
          results.push({
            source: 'twitter',
            text: tweet.text,
            url: `https://x.com/i/status/${tweet.id}`,
            likes: metrics.like_count || 0,
            retweets: metrics.retweet_count || 0,
            replies: metrics.reply_count || 0,
            created: tweet.created_at,
            author: tweet.author_id || ''
          });
        }
      }
      await new Promise(r => setTimeout(r, 1500));
    } catch (e) {
      // Twitter rate limits — continue
    }
  }

  return results;
}

// --- Brave Comedy Scanner ---
async function scanComedyBrave() {
  const key = process.env.BRAVE_API_KEY;
  if (!key) { console.log('  Brave: skipped (no API key)'); return []; }

  const results = [];

  const queries = [
    // Eventbrite comedy searches
    'site:eventbrite.com comedy show 2026 tickets',
    'site:eventbrite.com standup comedy tickets "just announced"',
    // Comedian tour announcements
    '"Shane Gillis" OR "Theo Von" OR "Mark Normand" tickets 2026 show',
    '"Matt Rife" OR "Nate Bargatze" OR "Andrew Schulz" tickets 2026 show',
    '"Sam Morril" OR "Stavros Halkias" OR "Taylor Tomlinson" tickets 2026',
    '"Tim Dillon" OR "Nikki Glaser" OR "Bert Kreischer" tickets 2026 show',
    // Small venue announcements
    '"comedy cellar" OR "comedy store" OR "zanies" OR "helium comedy" tickets 2026',
    '"comedy mothership" OR "the stand" OR "stress factory" tickets 2026',
    '"just added" OR "just announced" comedy show tickets',
    // Reddit comedy ticket discussions
    'site:reddit.com comedy show tickets sold out 2026',
    'site:reddit.com standup tickets "sold out" OR "can\'t get"',
  ];

  for (const query of queries) {
    try {
      const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=10&freshness=pw`;
      const res = await fetch(url, {
        headers: { 'X-Subscription-Token': key }
      });
      const json = JSON.parse(res.data);
      if (json?.web?.results) {
        for (const r of json.web.results) {
          results.push({
            source: 'brave',
            title: r.title || '',
            text: r.description || '',
            url: r.url,
            published: r.page_age || r.published || null
          });
        }
      }
      await new Promise(r => setTimeout(r, 500));
    } catch (e) {
      // continue
    }
  }

  return results;
}

// --- Process & Score Results ---
function processComedyResults(twitterResults, braveResults) {
  const shows = [];
  const allResults = [...twitterResults, ...braveResults];

  for (const r of allResults) {
    const text = `${r.title || ''} ${r.text || ''}`.toLowerCase();

    // Must mention a tracked comedian
    let comedian = null;
    for (const c of COMEDIANS) {
      if (text.includes(c.name.toLowerCase())) {
        comedian = c.name;
        break;
      }
    }

    // Check for small venue mention
    let venue = null;
    for (const v of COMEDY_VENUES) {
      if (text.includes(v.name.toLowerCase()) || text.includes(v.site.toLowerCase())) {
        venue = v;
        break;
      }
    }

    // Must have ticket/show language
    const hasTicketLanguage = /ticket|on sale|just added|just announced|surprise show|secret show|pop.?up|new show|added show|extra show/.test(text);

    if ((comedian || venue) && hasTicketLanguage) {
      shows.push({
        comedian: comedian || 'Unknown',
        venue: venue ? `${venue.name} (${venue.city}, cap: ${venue.cap})` : 'Unknown venue',
        venueCapacity: venue ? venue.cap : null,
        source: r.source,
        text: (r.text || r.title || '').substring(0, 200),
        url: r.url,
        ticketUrl: extractTicketUrl(r.text || r.title || ''),
        engagement: (r.likes || 0) + (r.retweets || 0) * 3,
        created: r.created || r.published || null,
        isSmallVenue: venue ? venue.cap <= 500 : null,
        isNewAnnouncement: /just (added|announced)|new show|surprise|secret|pop.?up|extra show/.test(text)
      });
    }
  }

  // Deduplicate by comedian + venue combo
  const seen = new Set();
  const unique = shows.filter(s => {
    const key = `${s.comedian}-${s.venue}`.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Sort: new announcements first, then by engagement
  unique.sort((a, b) => {
    if (a.isNewAnnouncement && !b.isNewAnnouncement) return -1;
    if (!a.isNewAnnouncement && b.isNewAnnouncement) return 1;
    return (b.engagement || 0) - (a.engagement || 0);
  });

  return unique;
}

function extractTicketUrl(text) {
  const urlMatch = text.match(/https?:\/\/[^\s<>"]+/);
  return urlMatch ? urlMatch[0] : null;
}

// --- Format Discord Alert ---
function formatComedyAlert(shows) {
  if (shows.length === 0) return null;

  let msg = '🎤 **COMEDY SHOW ALERT** 🏴‍☠️\n\n';

  const newShows = shows.filter(s => s.isNewAnnouncement);
  const otherShows = shows.filter(s => !s.isNewAnnouncement);

  if (newShows.length > 0) {
    msg += '**🚨 NEW ANNOUNCEMENTS:**\n';
    for (const s of newShows.slice(0, 10)) {
      msg += `- **${s.comedian}** @ ${s.venue}\n`;
      msg += `  ${s.text.substring(0, 150)}\n`;
      if (s.ticketUrl) msg += `  🎟️ <${s.ticketUrl}>\n`;
      if (s.url) msg += `  📎 <${s.url}>\n`;
      msg += '\n';
    }
  }

  if (otherShows.length > 0) {
    msg += '**📋 TICKET CHATTER:**\n';
    for (const s of otherShows.slice(0, 10)) {
      msg += `- **${s.comedian}** — ${s.text.substring(0, 100)}\n`;
      if (s.url) msg += `  <${s.url}>\n`;
    }
  }

  return msg;
}

// --- Main Scan ---
async function runComedyScan() {
  console.log('🎤 Blackbeard Comedy Scanner running...');

  const twitterResults = await scanComedyTwitter();
  console.log(`  Twitter: ${twitterResults.length} comedy mentions`);

  const braveResults = await scanComedyBrave();
  console.log(`  Brave: ${braveResults.length} comedy mentions`);

  const shows = processComedyResults(twitterResults, braveResults);
  console.log(`  Processed: ${shows.length} unique comedy shows`);

  const alert = formatComedyAlert(shows);

  // Save results
  const reportDir = path.join(__dirname, '..', 'reports');
  if (!fs.existsSync(reportDir)) fs.mkdirSync(reportDir, { recursive: true });
  fs.writeFileSync(
    path.join(reportDir, 'comedy-latest.json'),
    JSON.stringify({ timestamp: new Date().toISOString(), shows }, null, 2)
  );

  return { shows, alert };
}

module.exports = { runComedyScan, COMEDIANS, COMEDY_VENUES };

// Run directly
if (require.main === module) {
  runComedyScan().then(({ shows, alert }) => {
    if (alert) console.log('\n' + alert);
    else console.log('No comedy shows found this scan.');
    process.exit(0);
  }).catch(e => { console.error(e); process.exit(1); });
}
