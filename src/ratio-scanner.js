#!/usr/bin/env node
// Follower-to-Venue Ratio Scanner — the "Nessa Barrett Formula"
// Finds artists where huge online following meets tiny venue = guaranteed sellout
// Usage: node src/ratio-scanner.js [--limit N]

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

const SEATGEEK_CLIENT_ID = process.env.SEATGEEK_CLIENT_ID;
const BANDSINTOWN_APP_ID = 'squarespace-blackbeard';
let seatgeekCalls = 0, bandsintownCalls = 0;
const MAX_SEATGEEK = 50, MAX_BANDSINTOWN = 50;

// Venue capacity cache to avoid duplicate SeatGeek lookups
const venueCapacityCache = {};

function parseArgs() {
  const args = process.argv.slice(2);
  let limit = 100;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--limit' && args[i + 1]) limit = parseInt(args[i + 1]);
  }
  return { limit };
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
        } else { reject(new Error(`HTTP ${res.statusCode}`)); }
      });
    }).on('error', reject);
  });
}

async function getBandsintownEvents(artistName) {
  if (bandsintownCalls >= MAX_BANDSINTOWN) return [];
  bandsintownCalls++;
  const url = `https://rest.bandsintown.com/artists/${encodeURIComponent(artistName)}/events?app_id=${BANDSINTOWN_APP_ID}`;
  try {
    const events = await fetch(url);
    if (!Array.isArray(events)) return [];
    return events.filter(e => e.venue?.country === 'United States').map(e => ({
      date: e.datetime,
      venue: e.venue?.name,
      city: e.venue?.city,
      region: e.venue?.region
    }));
  } catch { return []; }
}

async function getVenueCapacity(venueName) {
  if (venueCapacityCache[venueName] !== undefined) return venueCapacityCache[venueName];
  if (seatgeekCalls >= MAX_SEATGEEK) return null;
  seatgeekCalls++;
  const url = `https://api.seatgeek.com/2/venues?q=${encodeURIComponent(venueName)}&client_id=${SEATGEEK_CLIENT_ID}&per_page=3`;
  try {
    const res = await fetch(url);
    const venue = (res.venues || []).find(v => v.capacity > 0);
    const cap = venue?.capacity || null;
    venueCapacityCache[venueName] = cap;
    return cap;
  } catch {
    venueCapacityCache[venueName] = null;
    return null;
  }
}

async function main() {
  const { limit } = parseArgs();
  const risingStars = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'docs', 'data', 'rising-stars.json'), 'utf8'));
  const artists = risingStars.artists || {};

  // Sort by monthlyListeners desc, take top N
  const sorted = Object.entries(artists)
    .filter(([, a]) => a.monthlyListeners || a.spotifyFollowers)
    .sort(([, a], [, b]) => (b.monthlyListeners || b.spotifyFollowers || 0) - (a.monthlyListeners || a.spotifyFollowers || 0))
    .slice(0, limit);

  console.error(`Scanning ${sorted.length} artists for ratio alerts...`);

  const results = [];

  for (const [key, artist] of sorted) {
    const followers = artist.monthlyListeners || artist.spotifyFollowers || 0;
    if (followers === 0) continue;

    const events = await getBandsintownEvents(artist.name);
    if (events.length === 0) continue;

    for (const event of events) {
      if (!event.venue) continue;
      const capacity = await getVenueCapacity(event.venue);
      if (!capacity || capacity > 3000) continue;

      const ratio = Math.round(followers / capacity);
      if (ratio < 1000) continue;

      let level;
      if (ratio > 5000) level = '🔴 EXTREME';
      else if (ratio > 2000) level = '🟡 HIGH';
      else level = '⚪ NOTABLE';

      results.push({
        artist: artist.name,
        tier: artist.tier,
        monthlyListeners: artist.monthlyListeners,
        spotifyFollowers: artist.spotifyFollowers,
        venue: event.venue,
        city: event.city,
        region: event.region,
        date: event.date,
        capacity,
        ratio,
        level
      });
    }

    // Rate limit
    await new Promise(r => setTimeout(r, 200));

    if (seatgeekCalls >= MAX_SEATGEEK && bandsintownCalls >= MAX_BANDSINTOWN) break;
  }

  results.sort((a, b) => b.ratio - a.ratio);

  const output = {
    timestamp: new Date().toISOString(),
    artistsScanned: sorted.length,
    apiCalls: { seatgeek: seatgeekCalls, bandsintown: bandsintownCalls },
    alertCount: results.length,
    alerts: results
  };

  const outPath = path.join(__dirname, '..', 'docs', 'data', 'ratio-alerts.json');
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log(JSON.stringify(output, null, 2));
}

main().catch(e => { console.error(e); process.exit(1); });
