#!/usr/bin/env node
/**
 * WEEKLY SELLOUT SCANNER — Saturday morning sweep
 * 
 * Searches for events that sold out or added shows in the past week
 * that Blackbeard may have missed. Catches opportunities we didn't predict.
 * 
 * Sources:
 *   - Brave Search: "sold out" + "added shows" + "second night added"
 *   - Bandsintown: recently added shows for tracked venues
 *   - Cross-references against watchlist to flag unknown artists
 * 
 * Usage:
 *   node weekly-sellout-scanner.js
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const WATCHLIST_FILE = path.join(DATA_DIR, 'watchlist.json');
const VIP_FILE = path.join(DATA_DIR, 'vip-watchlist.json');
const LEDGER_FILE = path.join(DATA_DIR, 'outcome-ledger.json');
const SCAN_HISTORY_FILE = path.join(DATA_DIR, 'weekly-sellout-scans.json');

const BRAVE_API_KEY = process.env.BRAVE_API_KEY || process.env.BSA_KEY || (() => {
  try {
    const env = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
    const match = env.match(/BRAVE_(?:SEARCH_)?API_KEY=(.+)/);
    return match ? match[1].trim() : null;
  } catch { return null; }
})();

// ─── Search Queries ───────────────────────────────────────────────────────

const SEARCH_QUERIES = [
  // Sellout signals
  '"sold out" concert tickets this week 2026',
  '"second show added" OR "second night added" concert 2026',
  '"added shows" OR "added dates" tour 2026 due to demand',
  '"tickets sold out in minutes" concert 2026',
  
  // Venue-specific sellouts (our signal venues)
  '"sold out" site:reddit.com concert tickets this week',
  '"sold out" Terminal 5 OR "Brooklyn Steel" OR "Irving Plaza" OR Roadrunner 2026',
  '"sold out" Fillmore OR "Union Transfer" OR "Franklin Music Hall" 2026',
  '"sold out" "9:30 Club" OR Ryman OR "First Avenue" OR Tabernacle 2026',
  
  // Added shows = demand overflow
  '"due to demand" added show concert 2026',
  '"upgrade" venue concert moved larger 2026',
];

// ─── Brave Search ─────────────────────────────────────────────────────────

function braveSearch(query) {
  return new Promise((resolve, reject) => {
    if (!BRAVE_API_KEY) {
      reject(new Error('No Brave API key'));
      return;
    }
    
    const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=10&freshness=pw`;
    
    const options = {
      headers: {
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip',
        'X-Subscription-Token': BRAVE_API_KEY,
      },
    };

    https.get(url, options, (res) => {
      let data = '';
      
      if (res.headers['content-encoding'] === 'gzip') {
        const zlib = require('zlib');
        const gunzip = zlib.createGunzip();
        res.pipe(gunzip);
        gunzip.on('data', chunk => data += chunk);
        gunzip.on('end', () => {
          try { resolve(JSON.parse(data)); } catch { resolve({ web: { results: [] } }); }
        });
        gunzip.on('error', reject);
      } else {
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try { resolve(JSON.parse(data)); } catch { resolve({ web: { results: [] } }); }
        });
      }
    }).on('error', reject);
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── Result Processing ───────────────────────────────────────────────────

function extractArtistSignals(results) {
  const signals = [];
  const seen = new Set();

  for (const result of results) {
    const title = result.title || '';
    const desc = result.description || '';
    const url = result.url || '';
    const text = `${title} ${desc}`.toLowerCase();

    // Skip noise
    if (text.includes('nfl') || text.includes('nba') || text.includes('mlb') && !text.includes('concert')) continue;
    if (text.includes('real estate') || text.includes('housing')) continue;

    const signal = {
      title: title.replace(/<<<.*?>>>/g, '').replace(/Source:.*?---/g, '').trim(),
      description: desc.replace(/<<<.*?>>>/g, '').replace(/Source:.*?---/g, '').trim(),
      url,
      type: null,
      published: result.published || result.age || null,
    };

    // Classify signal type
    if (text.includes('sold out')) signal.type = 'SOLD_OUT';
    else if (text.includes('added show') || text.includes('added date') || text.includes('second night') || text.includes('second show')) signal.type = 'ADDED_SHOWS';
    else if (text.includes('upgrade') || text.includes('moved to larger') || text.includes('bigger venue')) signal.type = 'VENUE_UPGRADE';
    else if (text.includes('due to demand')) signal.type = 'HIGH_DEMAND';
    else signal.type = 'OTHER';

    const key = `${signal.title.slice(0, 50)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    signals.push(signal);
  }

  return signals;
}

function crossReferenceWatchlist(signals) {
  const watchlist = loadJSON(WATCHLIST_FILE);
  const vip = loadJSON(VIP_FILE);
  const ledger = loadJSON(LEDGER_FILE);

  const watchlistNames = new Set();
  if (watchlist) {
    const artists = watchlist.artists || watchlist;
    const list = Array.isArray(artists) ? artists : Object.values(artists);
    for (const a of list) {
      const name = (a.name || a.artist || '').toLowerCase();
      if (name) watchlistNames.add(name);
    }
  }
  if (vip?.confirmedSellers) {
    for (const s of vip.confirmedSellers) {
      if (s.artist) watchlistNames.add(s.artist.toLowerCase());
    }
  }
  if (ledger?.predictions) {
    for (const p of ledger.predictions) {
      if (p.artist) watchlistNames.add(p.artist.toLowerCase());
    }
  }

  // Check each signal against known artists
  for (const signal of signals) {
    const text = `${signal.title} ${signal.description}`.toLowerCase();
    signal.knownArtist = false;
    signal.matchedArtist = null;
    
    for (const name of watchlistNames) {
      if (name.length > 3 && text.includes(name)) {
        signal.knownArtist = true;
        signal.matchedArtist = name;
        break;
      }
    }
  }

  return signals;
}

function loadJSON(filepath) {
  try { return JSON.parse(fs.readFileSync(filepath, 'utf8')); } catch { return null; }
}

// ─── Main ─────────────────────────────────────────────────────────────────

async function main() {
  console.log('🔍 WEEKLY SELLOUT SCANNER — Saturday Sweep');
  console.log('═'.repeat(50));
  console.log(`Searching for sellouts & added shows from the past week...\n`);

  if (!BRAVE_API_KEY) {
    console.log('❌ No Brave API key found. Set BRAVE_API_KEY in environment or .env');
    process.exit(1);
  }

  let allResults = [];

  for (let i = 0; i < SEARCH_QUERIES.length; i++) {
    const query = SEARCH_QUERIES[i];
    console.log(`[${i + 1}/${SEARCH_QUERIES.length}] Searching: ${query.slice(0, 60)}...`);
    
    try {
      const response = await braveSearch(query);
      const results = response?.web?.results || [];
      allResults.push(...results);
      console.log(`   Found ${results.length} results`);
    } catch (err) {
      console.log(`   ⚠️ Error: ${err.message}`);
    }
    
    // Rate limit: 1 req/sec for Brave free tier
    if (i < SEARCH_QUERIES.length - 1) await sleep(1200);
  }

  console.log(`\nTotal raw results: ${allResults.length}`);

  // Process and deduplicate
  let signals = extractArtistSignals(allResults);
  console.log(`After dedup: ${signals.length} unique signals\n`);

  // Cross-reference with our watchlist
  signals = crossReferenceWatchlist(signals);

  // Separate into categories
  const soldOut = signals.filter(s => s.type === 'SOLD_OUT');
  const addedShows = signals.filter(s => s.type === 'ADDED_SHOWS');
  const venueUpgrades = signals.filter(s => s.type === 'VENUE_UPGRADE');
  const highDemand = signals.filter(s => s.type === 'HIGH_DEMAND');
  const unknown = signals.filter(s => !s.knownArtist);
  const known = signals.filter(s => s.knownArtist);

  // Build report
  console.log('🏴‍☠️ WEEKLY SELLOUT REPORT');
  console.log('═'.repeat(50));
  
  if (soldOut.length > 0) {
    console.log(`\n🔥 SOLD OUT (${soldOut.length}):`);
    for (const s of soldOut) {
      const tag = s.knownArtist ? `[TRACKED: ${s.matchedArtist}]` : '[⚡ NEW — NOT ON WATCHLIST]';
      console.log(`  ${tag}`);
      console.log(`  ${s.title}`);
      console.log(`  ${s.url}`);
      console.log('');
    }
  }

  if (addedShows.length > 0) {
    console.log(`\n📅 ADDED SHOWS / SECOND NIGHTS (${addedShows.length}):`);
    for (const s of addedShows) {
      const tag = s.knownArtist ? `[TRACKED: ${s.matchedArtist}]` : '[⚡ NEW — NOT ON WATCHLIST]';
      console.log(`  ${tag}`);
      console.log(`  ${s.title}`);
      console.log(`  ${s.url}`);
      console.log('');
    }
  }

  if (venueUpgrades.length > 0) {
    console.log(`\n⬆️ VENUE UPGRADES (${venueUpgrades.length}):`);
    for (const s of venueUpgrades) {
      const tag = s.knownArtist ? `[TRACKED: ${s.matchedArtist}]` : '[⚡ NEW — NOT ON WATCHLIST]';
      console.log(`  ${tag}`);
      console.log(`  ${s.title}`);
      console.log(`  ${s.url}`);
      console.log('');
    }
  }

  if (highDemand.length > 0) {
    console.log(`\n📈 HIGH DEMAND SIGNALS (${highDemand.length}):`);
    for (const s of highDemand) {
      const tag = s.knownArtist ? `[TRACKED: ${s.matchedArtist}]` : '[⚡ NEW — NOT ON WATCHLIST]';
      console.log(`  ${tag}`);
      console.log(`  ${s.title}`);
      console.log(`  ${s.url}`);
      console.log('');
    }
  }

  // Summary stats
  console.log('═'.repeat(50));
  console.log(`\n📊 SUMMARY:`);
  console.log(`  Total signals: ${signals.length}`);
  console.log(`  Sold out: ${soldOut.length}`);
  console.log(`  Added shows: ${addedShows.length}`);
  console.log(`  Venue upgrades: ${venueUpgrades.length}`);
  console.log(`  High demand: ${highDemand.length}`);
  console.log(`  Already tracked: ${known.length}`);
  console.log(`  ⚡ NEW (not on watchlist): ${unknown.length}`);

  if (unknown.length > 0) {
    console.log(`\n⚡ MISSED OPPORTUNITIES — Artists NOT on our watchlist:`);
    for (const s of unknown.slice(0, 15)) {
      console.log(`  • ${s.title.slice(0, 80)}`);
      console.log(`    Type: ${s.type} | ${s.url}`);
    }
  }

  // Save scan history
  const history = loadJSON(SCAN_HISTORY_FILE) || { scans: [] };
  history.scans.push({
    date: new Date().toISOString(),
    totalSignals: signals.length,
    soldOut: soldOut.length,
    addedShows: addedShows.length,
    venueUpgrades: venueUpgrades.length,
    newArtists: unknown.length,
    trackedArtists: known.length,
    topSignals: signals.slice(0, 20).map(s => ({
      title: s.title.slice(0, 100),
      type: s.type,
      knownArtist: s.knownArtist,
      matchedArtist: s.matchedArtist,
      url: s.url,
    })),
  });
  // Keep last 52 weeks
  if (history.scans.length > 52) history.scans = history.scans.slice(-52);
  fs.writeFileSync(SCAN_HISTORY_FILE, JSON.stringify(history, null, 2));

  console.log(`\n✅ Scan complete. History saved.`);
}

main().catch(console.error);
