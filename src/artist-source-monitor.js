#!/usr/bin/env node
// Artist Source Monitor — checks Bandsintown + artist websites for new tour announcements
// Usage: node src/artist-source-monitor.js [--limit N]

const fs = require('fs');
const path = require('path');
const https = require('https');

// Load .env
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const [key, ...val] = line.split('=');
    if (key && !key.startsWith('#')) process.env[key.trim()] = val.join('=').trim();
  });
}

const BRAVE_API_KEY = process.env.BRAVE_API_KEY;
const BANDSINTOWN_APP_ID = 'squarespace-blackbeard';
const MAX_BRAVE_CALLS = 30;
let braveCallsUsed = 0;

const CACHE_PATH = path.join(__dirname, '..', 'data', 'source-monitor-cache.json');
const WATCHLIST_PATH = path.join(__dirname, '..', 'data', 'watchlist.json');
const RISING_STARS_PATH = path.join(__dirname, '..', 'docs', 'data', 'rising-stars.json');
const INTEL_CACHE_PATH = path.join(__dirname, '..', 'data', 'artist-intel-cache.json');

function parseArgs() {
  const args = process.argv.slice(2);
  let limit = 50;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--limit' && args[i + 1]) limit = parseInt(args[i + 1]);
  }
  return { limit };
}

function loadJSON(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

function fetch(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const opts = { hostname: u.hostname, path: u.pathname + u.search, headers };
    https.get(opts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve(JSON.parse(data)); } catch { resolve(data); }
        } else { reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 200)}`)); }
      });
    }).on('error', reject);
  });
}

async function getBandsintownEvents(artistName) {
  const encoded = encodeURIComponent(artistName);
  const url = `https://rest.bandsintown.com/artists/${encoded}/events?app_id=${BANDSINTOWN_APP_ID}`;
  try {
    const events = await fetch(url);
    if (!Array.isArray(events)) return [];
    return events.map(e => ({
      id: e.id,
      date: e.datetime,
      venue: e.venue?.name,
      city: e.venue?.city,
      region: e.venue?.region,
      country: e.venue?.country,
      onSaleDate: e.on_sale_datetime,
      offers: (e.offers || []).map(o => ({ type: o.type, url: o.url, status: o.status }))
    }));
  } catch (e) {
    return [];
  }
}

async function braveSearch(query) {
  if (braveCallsUsed >= MAX_BRAVE_CALLS) return null;
  braveCallsUsed++;
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=5`;
  try {
    const res = await fetch(url, { 'X-Subscription-Token': BRAVE_API_KEY, 'Accept': 'application/json' });
    return (res.web?.results || []).map(r => ({ title: r.title, url: r.url, description: r.description, age: r.age }));
  } catch { return null; }
}

async function main() {
  const { limit } = parseArgs();
  const watchlist = loadJSON(WATCHLIST_PATH);
  const risingStars = loadJSON(RISING_STARS_PATH);
  const intelCache = loadJSON(INTEL_CACHE_PATH) || {};
  const cache = loadJSON(CACHE_PATH) || { artists: {}, lastRun: null };

  if (!watchlist || !risingStars) {
    console.error('Missing watchlist or rising-stars data');
    process.exit(1);
  }

  // Build priority artist list
  const rsArtists = risingStars.artists || {};
  const highPriorityNames = new Set();

  // From watchlist: priority HIGH
  for (const a of watchlist.artists || []) {
    if (a.tier === 'S' || a.tier === 'A') highPriorityNames.add(a.name);
  }
  // From rising-stars: tier S or A
  for (const [key, a] of Object.entries(rsArtists)) {
    if (a.tier === 'S' || a.tier === 'A') highPriorityNames.add(a.name);
  }
  // Also add watchlist HIGH priority
  for (const a of watchlist.artists || []) {
    if (a.priority === 'HIGH') highPriorityNames.add(a.name);
  }

  const artistsToCheck = Array.from(highPriorityNames).slice(0, limit);
  console.error(`Checking ${artistsToCheck.length} high-priority artists...`);

  const alerts = [];

  for (const name of artistsToCheck) {
    const artistCache = cache.artists[name] || { eventIds: [], lastChecked: null };

    // 1. Check Bandsintown
    const events = await getBandsintownEvents(name);
    const cachedIds = new Set(artistCache.eventIds || []);
    const newEvents = events.filter(e => e.id && !cachedIds.has(String(e.id)));

    if (newEvents.length > 0) {
      alerts.push({
        artist: name,
        source: 'bandsintown',
        newEvents: newEvents.length,
        events: newEvents.slice(0, 10).map(e => ({
          date: e.date,
          venue: e.venue,
          city: e.city,
          region: e.region,
          country: e.country
        }))
      });
    }

    // Update cache with all event IDs
    artistCache.eventIds = events.map(e => String(e.id));
    artistCache.lastChecked = new Date().toISOString();

    // 2. Check artist website via Brave (if we have a URL and budget remains)
    const intelEntry = Object.values(intelCache).find(v => v && typeof v === 'object' &&
      (v.url || '').toLowerCase().includes(name.toLowerCase().replace(/[^a-z]/g, '')));

    if (intelEntry?.url && braveCallsUsed < MAX_BRAVE_CALLS) {
      const domain = new URL(intelEntry.url).hostname;
      const results = await braveSearch(`site:${domain} tour OR tickets OR dates`);
      if (results && results.length > 0) {
        const cachedUrls = new Set(artistCache.websiteUrls || []);
        const newPages = results.filter(r => !cachedUrls.has(r.url));
        if (newPages.length > 0) {
          alerts.push({
            artist: name,
            source: 'website',
            domain,
            newPages: newPages.map(p => ({ title: p.title, url: p.url, age: p.age }))
          });
        }
        artistCache.websiteUrls = results.map(r => r.url);
      }
    }

    cache.artists[name] = artistCache;

    // Small delay to be nice to APIs
    await new Promise(r => setTimeout(r, 200));
  }

  cache.lastRun = new Date().toISOString();
  cache.braveCallsUsed = braveCallsUsed;
  fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2));

  const output = {
    timestamp: new Date().toISOString(),
    artistsChecked: artistsToCheck.length,
    braveCallsUsed,
    alertCount: alerts.length,
    alerts
  };

  console.log(JSON.stringify(output, null, 2));
}

main().catch(e => { console.error(e); process.exit(1); });
