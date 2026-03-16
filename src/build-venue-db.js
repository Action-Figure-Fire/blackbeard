#!/usr/bin/env node
// Venue Intelligence Database Builder
// Builds data/venue-db.json — every notable venue under 3K cap in top 30 US markets
// Usage: node src/build-venue-db.js

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

const MARKETS = [
  'New York', 'Los Angeles', 'Chicago', 'Houston', 'Phoenix',
  'Philadelphia', 'San Antonio', 'San Diego', 'Dallas', 'San Jose',
  'Austin', 'Jacksonville', 'Fort Worth', 'Columbus', 'Charlotte',
  'Indianapolis', 'San Francisco', 'Seattle', 'Denver', 'Washington',
  'Nashville', 'Oklahoma City', 'Portland', 'Las Vegas', 'Memphis',
  'Louisville', 'Baltimore', 'Milwaukee', 'Albuquerque', 'Tucson'
];

const MANUAL_VENUES = [
  { name: 'Masonic Lodge at Hollywood Forever', city: 'Los Angeles', state: 'CA', capacity: 150, slug: 'masonic-lodge-hollywood-forever', lat: 34.09, lon: -118.32 },
  { name: 'The Duck Room', city: 'St. Louis', state: 'MO', capacity: 400, slug: 'the-duck-room', lat: 38.63, lon: -90.26 },
  { name: 'Shrine Social Club', city: 'Boise', state: 'ID', capacity: 300, slug: 'shrine-social-club', lat: 43.62, lon: -116.20 },
  { name: 'Basement East', city: 'Nashville', state: 'TN', capacity: 800, slug: 'basement-east', lat: 36.18, lon: -86.74 },
  { name: 'SPACE', city: 'Portland', state: 'ME', capacity: 250, slug: 'space-portland', lat: 43.66, lon: -70.26 }
];

function fetch(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    https.get({ hostname: u.hostname, path: u.pathname + u.search }, res => {
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

async function main() {
  const allVenues = [];
  const seen = new Set();

  console.error(`Fetching venues from ${MARKETS.length} markets...`);

  for (const city of MARKETS) {
    const url = `https://api.seatgeek.com/2/venues?city=${encodeURIComponent(city)}&per_page=100&client_id=${SEATGEEK_CLIENT_ID}`;
    try {
      const res = await fetch(url);
      for (const v of (res.venues || [])) {
        if (v.capacity > 0 && v.capacity <= 3000 && !seen.has(v.id)) {
          seen.add(v.id);
          allVenues.push({
            name: v.name,
            city: v.city,
            state: v.state,
            capacity: v.capacity,
            slug: v.slug,
            lat: v.location?.lat || null,
            lon: v.location?.lon || null,
            seatgeekId: v.id
          });
        }
      }
      console.error(`  ${city}: ${(res.venues || []).filter(v => v.capacity > 0 && v.capacity <= 3000).length} venues`);
    } catch (e) {
      console.error(`  ${city}: ERROR - ${e.message}`);
    }
    await new Promise(r => setTimeout(r, 300));
  }

  // Add manual venues
  for (const mv of MANUAL_VENUES) {
    if (!allVenues.some(v => v.name.toLowerCase() === mv.name.toLowerCase())) {
      allVenues.push(mv);
    }
  }

  allVenues.sort((a, b) => a.capacity - b.capacity);

  const db = {
    generatedAt: new Date().toISOString(),
    totalVenues: allVenues.length,
    markets: MARKETS.length,
    venues: allVenues
  };

  const outPath = path.join(__dirname, '..', 'data', 'venue-db.json');
  fs.writeFileSync(outPath, JSON.stringify(db, null, 2));
  console.error(`\nSaved ${allVenues.length} venues to data/venue-db.json`);
  console.log(JSON.stringify({ totalVenues: allVenues.length, markets: MARKETS.length }, null, 2));
}

main().catch(e => { console.error(e); process.exit(1); });
