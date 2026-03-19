#!/usr/bin/env node
/**
 * Cross-Platform Artist Price Lookup
 * When an artist is hot at one venue, check prices across ALL platforms:
 * - Vivid Seats (internal API — free, structured)
 * - SeatGeek (API — free tier)
 * - TickPick, GoTickets (via Brave Search)
 * 
 * Usage: node cross-platform-lookup.js "Artist Name"
 *        node cross-platform-lookup.js --batch "Artist1,Artist2,Artist3"
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

// Load env
const envPath = path.join(__dirname, '..', '.env');
let BRAVE_KEY, SEATGEEK_CLIENT, SEATGEEK_SECRET;
try {
  const env = fs.readFileSync(envPath, 'utf8');
  BRAVE_KEY = (env.match(/BRAVE_API_KEY=(.+)/) || [])[1]?.trim();
  SEATGEEK_CLIENT = (env.match(/SEATGEEK_CLIENT_ID=(.+)/) || [])[1]?.trim();
  SEATGEEK_SECRET = (env.match(/SEATGEEK_CLIENT_SECRET=(.+)/) || [])[1]?.trim();
} catch(e) {}

const VIVID_VENUES = {
  'Terminal 5 NYC': 5351,
  'Brooklyn Steel': 16236,
  'Irving Plaza NYC': 796,
  'Webster Hall NYC': 3035,
  'Bowery Ballroom NYC': 1973,
  'Roadrunner Boston': 28114,
  'House of Blues Boston': 6480,
  'Fillmore Philly': 14270,
  'Union Transfer Philly': 9115,
  'Franklin Music Hall Philly': 504,
  'Stage AE Pittsburgh': 8774,
  'Salt Shed Chicago': 28594,
  'Fillmore Charlotte': 7558,
  'Bomb Factory Dallas': 12843,
  'History Toronto': 27545,
};

function fetch(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const opts = { hostname: u.hostname, path: u.pathname + u.search, headers: { 'User-Agent': 'Mozilla/5.0', ...headers } };
    https.get(opts, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve({ status: res.statusCode, data: d }));
    }).on('error', reject);
  });
}

async function searchVividSeats(artist) {
  const results = [];
  const artistLower = artist.toLowerCase();
  
  for (const [venueName, venueId] of Object.entries(VIVID_VENUES)) {
    try {
      const url = `https://www.vividseats.com/hermes/api/v1/productions?venueId=${venueId}&limit=50`;
      const res = await fetch(url);
      if (res.status !== 200) continue;
      
      const data = JSON.parse(res.data);
      const items = data.items || data.productions || data;
      if (!Array.isArray(items)) continue;
      
      for (const item of items) {
        const name = (item.name || item.title || '').toLowerCase();
        if (name.includes(artistLower) || artistLower.split(' ').every(w => name.includes(w))) {
          results.push({
            platform: 'VividSeats',
            venue: venueName,
            event: item.name || item.title,
            date: item.dateLocal || item.utcDate || item.date,
            getIn: item.minPrice || item.price,
            listings: item.listingCount,
            tickets: item.ticketCount,
          });
        }
      }
    } catch(e) { /* skip venue errors */ }
  }
  return results;
}

async function searchSeatGeek(artist) {
  if (!SEATGEEK_CLIENT) return [];
  const results = [];
  try {
    const q = encodeURIComponent(artist);
    const url = `https://api.seatgeek.com/2/events?q=${q}&per_page=25&client_id=${SEATGEEK_CLIENT}&client_secret=${SEATGEEK_SECRET}`;
    const res = await fetch(url);
    if (res.status !== 200) return [];
    
    const data = JSON.parse(res.data);
    for (const event of (data.events || [])) {
      const venue = event.venue || {};
      if ((venue.capacity || 99999) > 10000) continue; // skip arenas
      
      results.push({
        platform: 'SeatGeek',
        venue: `${venue.name} (${venue.city || ''})`,
        event: event.title,
        date: event.datetime_local,
        getIn: event.stats?.lowest_price || null,
        avgPrice: event.stats?.average_price || null,
        listings: event.stats?.listing_count || null,
        url: event.url,
      });
    }
  } catch(e) {}
  return results;
}

async function searchBrave(artist, platform) {
  if (!BRAVE_KEY) return [];
  const results = [];
  try {
    const q = encodeURIComponent(`${artist} tickets site:${platform}`);
    const url = `https://api.search.brave.com/res/v1/web/search?q=${q}&count=5`;
    const res = await fetch(url, { 'X-Subscription-Token': BRAVE_KEY });
    if (res.status !== 200) return [];
    
    const data = JSON.parse(res.data);
    for (const r of (data.web?.results || [])) {
      // Extract price from snippet if available
      const priceMatch = (r.description || '').match(/\$(\d+[\.,]?\d*)/);
      results.push({
        platform: platform.replace('.com', '').replace('www.', ''),
        title: r.title,
        url: r.url,
        snippet: (r.description || '').substring(0, 150),
        priceHint: priceMatch ? `$${priceMatch[1]}` : null,
      });
    }
  } catch(e) {}
  return results;
}

async function lookupArtist(artist) {
  console.log(`\n🔍 Cross-platform lookup: ${artist}`);
  console.log('='.repeat(60));
  
  // Run all lookups in parallel
  const [vivid, seatgeek, tickpick, gotickets] = await Promise.all([
    searchVividSeats(artist),
    searchSeatGeek(artist),
    searchBrave(artist, 'tickpick.com'),
    searchBrave(artist, 'gotickets.com'),
  ]);
  
  const allResults = { artist, timestamp: new Date().toISOString(), vivid, seatgeek, tickpick, gotickets };
  
  // Print Vivid Seats
  if (vivid.length) {
    console.log(`\n📊 VIVID SEATS (${vivid.length} shows):`);
    for (const r of vivid.sort((a,b) => (b.getIn||0) - (a.getIn||0))) {
      console.log(`  $${r.getIn || '?'} get-in | ${r.venue} | ${r.date?.split('T')[0] || '?'} | ${r.listings || '?'} listings`);
    }
  } else {
    console.log('\n📊 VIVID SEATS: No results');
  }
  
  // Print SeatGeek
  if (seatgeek.length) {
    console.log(`\n🎫 SEATGEEK (${seatgeek.length} shows):`);
    for (const r of seatgeek.sort((a,b) => (b.getIn||0) - (a.getIn||0))) {
      console.log(`  $${r.getIn || '?'} get-in | ${r.venue} | ${r.date?.split('T')[0] || '?'} | ${r.listings || '?'} listings`);
    }
  } else {
    console.log('\n🎫 SEATGEEK: No results (or no pricing on free tier)');
  }
  
  // Print TickPick
  if (tickpick.length) {
    console.log(`\n🏷️ TICKPICK:`);
    for (const r of tickpick) {
      console.log(`  ${r.priceHint || 'price N/A'} | ${r.title.substring(0, 80)}`);
      console.log(`    ${r.url}`);
    }
  }
  
  // Print GoTickets
  if (gotickets.length) {
    console.log(`\n🎟️ GOTICKETS:`);
    for (const r of gotickets) {
      console.log(`  ${r.priceHint || 'price N/A'} | ${r.title.substring(0, 80)}`);
      console.log(`    ${r.url}`);
    }
  }
  
  // Summary
  const vividPrices = vivid.filter(r => r.getIn).map(r => r.getIn);
  const sgPrices = seatgeek.filter(r => r.getIn).map(r => r.getIn);
  const allPrices = [...vividPrices, ...sgPrices];
  
  if (allPrices.length >= 2) {
    const min = Math.min(...allPrices);
    const max = Math.max(...allPrices);
    const spread = max / min;
    console.log(`\n💰 PRICE SPREAD: $${min} – $${max} (${spread.toFixed(1)}x)`);
    if (spread >= 2) console.log('  ⚠️ REGIONAL ARBITRAGE DETECTED — buy in cheap markets, sell in premium');
    if (max >= 100) console.log('  🔥 HOT — get-in above $100 confirmed');
  }
  
  return allResults;
}

async function main() {
  const args = process.argv.slice(2);
  
  if (args.includes('--batch')) {
    const idx = args.indexOf('--batch');
    const artists = args[idx + 1]?.split(',').map(a => a.trim()) || [];
    const all = [];
    for (const artist of artists) {
      const result = await lookupArtist(artist);
      all.push(result);
      // Rate limit pause
      if (artists.indexOf(artist) < artists.length - 1) {
        await new Promise(r => setTimeout(r, 1500));
      }
    }
    // Save results
    const outPath = path.join(__dirname, '..', 'data', 'cross-platform-lookups', `batch-${new Date().toISOString().split('T')[0]}.json`);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(all, null, 2));
    console.log(`\n✅ Saved ${all.length} lookups to ${outPath}`);
  } else if (args.length) {
    const artist = args.filter(a => !a.startsWith('--')).join(' ');
    const result = await lookupArtist(artist);
    // Save individual result
    const slug = artist.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const outPath = path.join(__dirname, '..', 'data', 'cross-platform-lookups', `${slug}-${new Date().toISOString().split('T')[0]}.json`);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(result, null, 2));
    console.log(`\n✅ Saved to ${outPath}`);
  } else {
    console.log('Usage: node cross-platform-lookup.js "Artist Name"');
    console.log('       node cross-platform-lookup.js --batch "Artist1,Artist2,Artist3"');
  }
}

main().catch(console.error);
