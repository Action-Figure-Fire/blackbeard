/**
 * Blackbeard 🏴‍☠️ — Underground Scanner
 * Finds events that only fans know about — sources brokers don't monitor
 * 
 * Sources:
 * 1. Eventbrite (small venue comedy, EDM, indie shows)
 * 2. DICE.fm via Brave (electronic/indie shows)
 * 3. Resident Advisor via Brave (electronic events)
 * 4. Genre subreddits via Brave (fan chatter about selling out)
 * 5. Local city music calendars (Do303, OhMyRockness, etc.)
 * 6. College event boards via Brave
 * 7. Jambase (jam bands, niche music)
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
      headers: { 'User-Agent': 'Blackbeard-Underground/1.0', ...options.headers },
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

// --- US cities to monitor ---
const TARGET_CITIES = [
  'New York', 'Los Angeles', 'Chicago', 'Nashville', 'Austin',
  'Denver', 'Atlanta', 'Philadelphia', 'Portland', 'Seattle',
  'San Francisco', 'Miami', 'Dallas', 'Houston', 'Minneapolis',
  'Detroit', 'New Orleans', 'Brooklyn', 'Washington DC', 'Boston'
];

// --- Genre subreddits where fans discuss sellouts ---
const FAN_SUBREDDITS = [
  // EDM/Electronic
  'aves', 'EDM', 'dubstep', 'DnB', 'techno', 'house',
  'trap', 'bassnectar', 'Wakaan', 'deadmau5',
  // Jam/Indie
  'jambands', 'phish', 'gratefuldead', 'GooseTheBand', 'indieheads',
  'indie_rock', 'LetsTalkMusic', 'listentothis',
  // Comedy
  'StandUpComedy', 'comedy', 'Killtony',
  // Country/Americana
  'CountryMusic', 'AltCountry', 'RedDirtMusic',
  // Punk/Hardcore
  'punk', 'hardcore', 'poppunkers', 'Metalcore', 'PostHardcore',
  // Latin
  'LatinMusic', 'reggaeton',
  // Hip-hop (underground)
  'hiphopheads', 'undergroundhiphop'
];

// --- Brave searches for underground events ---
async function searchBrave(query) {
  const key = process.env.BRAVE_API_KEY;
  if (!key) return [];
  
  try {
    const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=10&freshness=pw`;
    const res = await fetch(url, { headers: { 'X-Subscription-Token': key } });
    if (res.status !== 200) return [];
    const data = JSON.parse(res.data);
    return (data.web?.results || []).map(r => ({
      title: r.title || '',
      text: r.description || '',
      url: r.url,
      published: r.page_age || null
    }));
  } catch (e) { return []; }
}

// --- 1. Eventbrite scanner ---
async function scanEventbrite() {
  console.log('  📋 Scanning Eventbrite...');
  const results = [];
  
  const queries = [
    // Eventbrite events in specific cities
    'eventbrite.com concert "sold out" New York OR Brooklyn OR Los Angeles 2026',
    'eventbrite.com comedy show "sold out" OR "selling fast" 2026',
    'eventbrite.com DJ rave warehouse party "sold out" OR "limited" 2026',
    'eventbrite.com indie music live "sold out" OR "last chance" 2026',
    'eventbrite.com secret show OR pop-up OR surprise concert 2026',
    'eventbrite.com Nashville OR Austin OR Denver concert tickets March April 2026',
  ];
  
  for (const q of queries) {
    const res = await searchBrave(q);
    results.push(...res);
    await new Promise(r => setTimeout(r, 500));
  }
  
  return results;
}

// --- 2. DICE.fm scanner ---
async function scanDice() {
  console.log('  🎲 Scanning DICE.fm...');
  const results = [];
  
  const queries = [
    'dice.fm "sold out" concert 2026 New York OR Los Angeles OR Chicago',
    'dice.fm event tickets 2026 "sold out" OR "selling fast"',
    'dice.fm DJ electronic rave club 2026',
  ];
  
  for (const q of queries) {
    const res = await searchBrave(q);
    results.push(...res);
    await new Promise(r => setTimeout(r, 500));
  }
  
  return results;
}

// --- 3. Resident Advisor scanner ---
async function scanResidentAdvisor() {
  console.log('  🎧 Scanning Resident Advisor...');
  const results = [];
  
  const queries = [
    'residentadvisor.net "sold out" event 2026 New York OR Brooklyn OR Los Angeles',
    'residentadvisor.net Detroit OR Chicago club event 2026',
    'ra.co event "sold out" warehouse rave 2026 United States',
  ];
  
  for (const q of queries) {
    const res = await searchBrave(q);
    results.push(...res);
    await new Promise(r => setTimeout(r, 500));
  }
  
  return results;
}

// --- 4. Fan subreddit scanner ---
async function scanFanSubreddits() {
  console.log('  💬 Scanning fan subreddits...');
  const results = [];
  
  // Search for sellout chatter across fan communities
  const queries = [
    // EDM/Electronic fan communities
    'site:reddit.com r/aves "sold out" OR "selling out" OR "tickets gone" 2026',
    'site:reddit.com r/EDM "sold out" tour OR show OR concert 2026',
    'site:reddit.com r/dubstep OR r/Wakaan "sold out" OR "can\'t get tickets" 2026',
    // Indie/Rock
    'site:reddit.com r/indieheads "sold out" OR "impossible to get tickets" 2026',
    'site:reddit.com r/poppunkers OR r/Metalcore "sold out" tour 2026',
    // Jam bands
    'site:reddit.com r/jambands OR r/GooseTheBand "sold out" 2026',
    // Comedy
    'site:reddit.com r/StandUpComedy "sold out" OR "secret show" 2026',
    'site:reddit.com r/Killtony "sold out" OR "tickets" 2026',
    // Country
    'site:reddit.com r/CountryMusic OR r/RedDirtMusic "sold out" 2026',
    // Hip-hop
    'site:reddit.com r/hiphopheads "sold out" small venue OR club 2026',
    // General ticket scarcity across all communities
    '"sold out in minutes" concert OR show OR tour 2026 reddit',
    '"couldn\'t get tickets" concert OR show 2026 reddit',
  ];
  
  for (const q of queries) {
    const res = await searchBrave(q);
    results.push(...res);
    await new Promise(r => setTimeout(r, 500));
  }
  
  return results;
}

// --- 5. Local city calendars ---
async function scanLocalCalendars() {
  console.log('  🏙️ Scanning local music calendars...');
  const results = [];
  
  const queries = [
    // City-specific music calendars
    'do303.com OR ohmyrockness.com "sold out" 2026',
    'jambase.com "sold out" OR "selling fast" 2026',
    // Concert sellouts in real-time
    '"sold out" concert March 2026 club OR theater OR venue tickets',
    '"sold out" comedy show March 2026 tickets',
    '"sold out" DJ show OR rave March 2026 tickets',
    // College shows
    'university OR college concert 2026 "sold out" campus',
    // Secret/surprise shows
    '"secret show" OR "pop up show" OR "surprise show" concert 2026',
    '"intimate show" OR "small venue" "sold out" 2026',
  ];
  
  for (const q of queries) {
    const res = await searchBrave(q);
    results.push(...res);
    await new Promise(r => setTimeout(r, 500));
  }
  
  return results;
}

// --- Process & Score Results ---
function processResults(allResults) {
  const events = [];
  const seen = new Set();
  
  // Load watchlist for artist matching
  let watchlistNames = [];
  try {
    const wl = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'watchlist.json'), 'utf8'));
    watchlistNames = wl.artists.map(a => a.name.toLowerCase());
  } catch (e) {}
  
  for (const r of allResults) {
    const text = `${r.title} ${r.text}`.toLowerCase();
    const url = r.url || '';
    
    // Deduplicate by URL
    if (seen.has(url)) continue;
    seen.add(url);
    
    // Score the event
    let score = 0;
    let signals = [];
    
    // Must have at least one live event indicator to proceed
    const isLiveEvent = /concert|show|tour|tickets|venue|club|theater|arena|festival|rave|gig|performance|presale|on.?sale|lineup|setlist|opener|headlin/.test(text);
    if (!isLiveEvent) continue;
    
    // Sold out / scarcity signals (most important)
    if (/sold out|sold-out|sellout/.test(text)) { score += 5; signals.push('SOLD OUT'); }
    if (/selling fast|almost gone|limited tickets|few left|going fast/.test(text)) { score += 4; signals.push('selling fast'); }
    if (/can't get tickets|impossible to get|tickets gone/.test(text)) { score += 4; signals.push('high demand'); }
    
    // Platform signals
    if (url.includes('eventbrite.com')) { score += 2; signals.push('Eventbrite'); }
    if (url.includes('dice.fm')) { score += 2; signals.push('DICE'); }
    if (url.includes('ra.co')) { score += 2; signals.push('RA'); }
    if (url.includes('reddit.com')) { score += 1; signals.push('Reddit'); }
    
    // Small venue signals
    if (/club|warehouse|basement|diy|loft|gallery|bar|lounge|cellar|speakeasy/.test(text)) { score += 2; signals.push('small venue'); }
    if (/secret show|pop.?up|surprise|underground|intimate/.test(text)) { score += 3; signals.push('underground'); }
    
    // Watchlist artist match (bonus)
    const matchedArtist = watchlistNames.find(name => text.includes(name));
    if (matchedArtist) { score += 3; signals.push(`watchlist: ${matchedArtist}`); }
    
    // Filter non-US events
    const nonUS = /india|mumbai|philippines|korea|kpop|k-pop|japan|tokyo|london|uk |manchester|paris|berlin|amsterdam|melbourne|sydney|australia|brazil|são paulo|toronto|canada|mexico|barcelona|ubc|okanagan/i;
    if (nonUS.test(text)) continue;
    
    // Filter obviously non-event content
    const junkPatterns = /wayfair|nordstrom|tj maxx|cosmopolitan|markdown|furniture|bedroom|patio|shopping hack|fashion|beauty|skincare|coupon|promo code|simplycodes|trustpilot|tiktok.*creative ways|amc theatre|block and reserve|fauxmoi|cnn underscored|whowhatwear/i;
    if (junkPatterns.test(text) || junkPatterns.test(url)) continue;
    
    // Must have minimum score
    if (score >= 4) {
      // Determine category
      let category = 'other';
      if (/comedy|comedian|standup|stand-up|funny|comic/.test(text)) category = 'comedy';
      else if (/dj|edm|rave|electronic|house|techno|bass|dubstep|dnb|warehouse/.test(text)) category = 'electronic';
      else if (/indie|rock|punk|hardcore|metal|alternative|folk/.test(text)) category = 'indie/rock';
      else if (/hip.?hop|rap|r&b/.test(text)) category = 'hip-hop';
      else if (/country|americana|bluegrass|red dirt/.test(text)) category = 'country';
      else if (/jam|grateful|phish|goose|dead/.test(text)) category = 'jam';
      else if (/latin|reggaeton|salsa|cumbia/.test(text)) category = 'latin';
      
      // Try to extract event name from title
      let eventName = r.title || '';
      // Clean up common prefixes
      eventName = eventName.replace(/^(r\/\w+ on Reddit: |.*? - )/i, '').substring(0, 100);
      
      events.push({
        eventName,
        category,
        score,
        signals,
        text: (r.text || '').substring(0, 200),
        url,
        source: url.includes('eventbrite') ? 'eventbrite' : 
                url.includes('dice.fm') ? 'dice' :
                url.includes('ra.co') ? 'ra' :
                url.includes('reddit.com') ? 'reddit' : 'web',
        matchedArtist: matchedArtist || null,
        published: r.published
      });
    }
  }
  
  // Sort by score
  events.sort((a, b) => b.score - a.score);
  return events;
}

// --- Format Discord Alert ---
function formatAlert(events) {
  if (events.length === 0) return null;
  
  let msg = '🕵️ **UNDERGROUND SCANNER** — Events Only Fans Know About 🏴‍☠️\n\n';
  
  const soldOut = events.filter(e => e.signals.includes('SOLD OUT'));
  const sellingFast = events.filter(e => !e.signals.includes('SOLD OUT') && e.score >= 6);
  const watchlistHits = events.filter(e => e.matchedArtist);
  const rest = events.filter(e => !e.signals.includes('SOLD OUT') && e.score < 6 && !e.matchedArtist);
  
  if (soldOut.length > 0) {
    msg += '**🔴 SOLD OUT (resale opportunity):**\n';
    for (const e of soldOut.slice(0, 8)) {
      msg += `- [${e.category}] **${e.eventName}**\n`;
      msg += `  ${e.signals.join(' | ')} — ${e.source}\n`;
      if (e.url) msg += `  <${e.url}>\n`;
    }
    msg += '\n';
  }
  
  if (sellingFast.length > 0) {
    msg += '**🟡 SELLING FAST (buy now):**\n';
    for (const e of sellingFast.slice(0, 8)) {
      msg += `- [${e.category}] **${e.eventName}**\n`;
      msg += `  ${e.signals.join(' | ')} — ${e.source}\n`;
      if (e.url) msg += `  <${e.url}>\n`;
    }
    msg += '\n';
  }
  
  if (watchlistHits.length > 0) {
    msg += '**⭐ WATCHLIST ARTIST MATCHES:**\n';
    for (const e of watchlistHits.slice(0, 5)) {
      msg += `- **${e.matchedArtist}** — ${e.eventName}\n`;
      if (e.url) msg += `  <${e.url}>\n`;
    }
    msg += '\n';
  }
  
  if (rest.length > 0) {
    msg += '**👀 ON THE RADAR:**\n';
    for (const e of rest.slice(0, 8)) {
      msg += `- [${e.category}] ${e.eventName}\n`;
      if (e.url) msg += `  <${e.url}>\n`;
    }
  }
  
  return msg;
}

// --- Main ---
async function runUndergroundScan() {
  console.log('🕵️ Blackbeard Underground Scanner running...');
  
  const allResults = [];
  
  const eventbrite = await scanEventbrite();
  allResults.push(...eventbrite);
  console.log(`  Eventbrite: ${eventbrite.length} results`);
  
  const dice = await scanDice();
  allResults.push(...dice);
  console.log(`  DICE: ${dice.length} results`);
  
  const ra = await scanResidentAdvisor();
  allResults.push(...ra);
  console.log(`  Resident Advisor: ${ra.length} results`);
  
  const reddit = await scanFanSubreddits();
  allResults.push(...reddit);
  console.log(`  Fan subreddits: ${reddit.length} results`);
  
  const local = await scanLocalCalendars();
  allResults.push(...local);
  console.log(`  Local calendars: ${local.length} results`);
  
  const events = processResults(allResults);
  console.log(`  Total scored events: ${events.length}`);
  
  const alert = formatAlert(events);
  
  // Save report
  const reportDir = path.join(__dirname, '..', 'reports');
  if (!fs.existsSync(reportDir)) fs.mkdirSync(reportDir, { recursive: true });
  fs.writeFileSync(
    path.join(reportDir, 'underground-latest.json'),
    JSON.stringify({ timestamp: new Date().toISOString(), events }, null, 2)
  );
  
  return { events, alert };
}

module.exports = { runUndergroundScan };

if (require.main === module) {
  runUndergroundScan().then(({ events, alert }) => {
    if (alert) console.log('\n' + alert);
    else console.log('No underground events found.');
    process.exit(0);
  }).catch(e => { console.error(e); process.exit(1); });
}
