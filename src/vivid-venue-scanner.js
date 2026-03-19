#!/usr/bin/env node
/**
 * Vivid Seats Venue Scanner
 * Pulls all upcoming shows + pricing for a venue via Vivid Seats internal API
 * Usage: node src/vivid-venue-scanner.js "Stage AE"
 *        node src/vivid-venue-scanner.js --id 8774
 *        node src/vivid-venue-scanner.js --search "Salt Shed Chicago"
 */

const https = require('https');
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

// Known venue IDs (add as we discover them)
const KNOWN_VENUES = {
  // NYC (signal venues)
  'terminal 5': 5351,          // Cap: 3000
  'brooklyn steel': 16236,     // Cap: 1800
  'irving plaza': 796,         // Cap: 1025
  'webster hall': 3035,        // Cap: 1500
  'bowery ballroom': 1973,     // Cap: 575
  // Boston (signal venues)
  'roadrunner': 28114,         // Cap: 3500
  'house of blues boston': 6480, // Cap: 1800
  // Philly (signal venues)
  'fillmore philadelphia': 14270, // Cap: 2500
  'union transfer': 9115,      // Cap: 1000
  'franklin music hall': 504,  // Cap: 3000
  // Other tracked venues
  'stage ae': 8774,            // Cap: 5500 (Pittsburgh)
  'salt shed': 28594,          // Cap: 3600 (Chicago)
  'fillmore charlotte': 7558,  // Cap: 2000
  'bomb factory': 12843,       // Cap: 4300 (Dallas)
  'history toronto': 27545,    // Cap: 2500
  'red rocks': 198,
  'the anthem dc': 17580,
  '9:30 club': 1654,
  'the ryman': 1076,
  'the wiltern': 1318,
  'first avenue': 1501,
};

function httpGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip, deflate, br',
        'Referer': 'https://www.vividseats.com/'
      }
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        const enc = res.headers['content-encoding'];
        try {
          if (enc === 'gzip') zlib.gunzip(buf, (e, d) => { if (e) reject(e); else resolve(JSON.parse(d.toString())); });
          else if (enc === 'br') zlib.brotliDecompress(buf, (e, d) => { if (e) reject(e); else resolve(JSON.parse(d.toString())); });
          else resolve(JSON.parse(buf.toString()));
        } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

async function fetchVenueShows(venueId) {
  const shows = [];
  let page = 1;
  let totalPages = 1;

  while (page <= totalPages) {
    const url = `https://www.vividseats.com/hermes/api/v1/productions?venueId=${venueId}&limit=50&page=${page}`;
    const data = await httpGet(url);
    totalPages = data.numberOfPages || 1;
    if (data.items) shows.push(...data.items);
    page++;
  }

  return shows;
}

function formatShow(e) {
  return {
    date: e.localDate?.substring(0, 10),
    time: e.localDate?.substring(11, 16),
    artist: e.name,
    getIn: Math.round(e.minPrice || 0),
    avg: Math.round(e.avgPrice || 0),
    median: Math.round(e.medianPrice || 0),
    max: Math.round(e.maxPrice || 0),
    listings: e.listingCount || 0,
    tickets: e.ticketCount || 0,
    category: e.performers?.[0]?.category?.subCategories?.[0]?.name || 'Unknown',
    onsaleDate: e.onsaleDate?.substring(0, 10) || null,
    presaleDate: e.presale1Date?.substring(0, 10) || null,
    url: e.webPath ? `https://www.vividseats.com${e.webPath}` : null,
  };
}

function printReport(venue, shows) {
  const venueName = venue.name || 'Unknown Venue';
  const capacity = venue.capacity || '?';
  const city = venue.city || '';
  const state = venue.state || '';

  console.log(`\n🏟️  ${venueName} — ${city}, ${state} | Cap: ${capacity.toLocaleString()} | ${shows.length} upcoming shows`);
  console.log('='.repeat(90));
  console.log('');

  const formatted = shows.map(formatShow).sort((a, b) => a.date.localeCompare(b.date));

  // Header
  console.log('DATE        | GET-IN  | AVG     | MED     | LISTINGS | TICKETS | ARTIST');
  console.log('------------|---------|---------|---------|----------|---------|--------');

  formatted.forEach(s => {
    const getin = ('$' + s.getIn).padEnd(7);
    const avg = ('$' + s.avg).padEnd(7);
    const med = ('$' + s.median).padEnd(7);
    const listings = String(s.listings).padEnd(8);
    const tickets = String(s.tickets).padEnd(7);
    console.log(`${s.date} | ${getin} | ${avg} | ${med} | ${listings} | ${tickets} | ${s.artist}`);
  });

  // Highlights
  console.log('\n📊 HIGHLIGHTS:');
  const hot = formatted.filter(s => s.listings < 20 || s.getIn > 80).sort((a, b) => b.getIn - a.getIn);
  if (hot.length) {
    console.log('\n🔴 HIGH DEMAND (low supply or high get-in):');
    hot.slice(0, 10).forEach(s => {
      console.log(`   ${s.artist} (${s.date}) — $${s.getIn} get-in, ${s.listings} listings, ${s.tickets} tix left`);
    });
  }

  const cheap = formatted.filter(s => s.getIn < 30 && s.tickets > 100).sort((a, b) => a.getIn - b.getIn);
  if (cheap.length) {
    console.log('\n🟢 CHEAP (potential undervalued):');
    cheap.slice(0, 5).forEach(s => {
      console.log(`   ${s.artist} (${s.date}) — $${s.getIn} get-in, ${s.tickets} tix available`);
    });
  }

  return formatted;
}

async function saveSnapshot(venueId, venueName, formatted) {
  const dir = path.join(__dirname, '..', 'data', 'vivid-snapshots');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const date = new Date().toISOString().substring(0, 10);
  const slug = venueName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '');
  const file = path.join(dir, `${slug}-${date}.json`);

  const snapshot = {
    venueId,
    venueName,
    snapshotDate: new Date().toISOString(),
    showCount: formatted.length,
    shows: formatted,
  };

  fs.writeFileSync(file, JSON.stringify(snapshot, null, 2));
  console.log(`\n💾 Saved snapshot to ${file}`);
  return file;
}

async function searchVenue(query) {
  // Try known venues first
  const lower = query.toLowerCase();
  for (const [name, id] of Object.entries(KNOWN_VENUES)) {
    if (lower.includes(name) || name.includes(lower)) {
      return id;
    }
  }

  // Search Brave for Vivid Seats venue URL
  console.log(`Searching for venue: ${query}...`);
  const searchUrl = `https://www.vividseats.com/hermes/api/v1/search?query=${encodeURIComponent(query)}&limit=5`;
  try {
    const results = await httpGet(searchUrl);
    if (results.venues?.length) {
      const v = results.venues[0];
      console.log(`Found: ${v.name} (ID: ${v.id})`);
      return v.id;
    }
  } catch (e) {
    // Search endpoint may not exist; fall back
  }

  console.error(`Could not find venue ID for "${query}". Use --id <venueId> or add to KNOWN_VENUES.`);
  process.exit(1);
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help')) {
    console.log('Usage:');
    console.log('  node src/vivid-venue-scanner.js "Stage AE"');
    console.log('  node src/vivid-venue-scanner.js --id 8774');
    console.log('  node src/vivid-venue-scanner.js --list');
    console.log('');
    console.log('Known venues:');
    Object.entries(KNOWN_VENUES).forEach(([name, id]) => console.log(`  ${name} (${id})`));
    return;
  }

  if (args.includes('--list')) {
    console.log('Known venues:');
    Object.entries(KNOWN_VENUES).forEach(([name, id]) => console.log(`  ${name} → venueId ${id}`));
    return;
  }

  let venueId;
  const idIdx = args.indexOf('--id');
  if (idIdx > -1 && args[idIdx + 1]) {
    venueId = parseInt(args[idIdx + 1]);
  } else {
    venueId = await searchVenue(args.join(' '));
  }

  console.log(`Fetching shows for venue ID ${venueId}...`);
  const shows = await fetchVenueShows(venueId);

  if (!shows.length) {
    console.log('No upcoming shows found for this venue.');
    return;
  }

  const venue = shows[0].venue || {};
  const formatted = printReport(venue, shows);
  await saveSnapshot(venueId, venue.name || `venue-${venueId}`, formatted);
}

main().catch(e => { console.error('Error:', e.message); process.exit(1); });
