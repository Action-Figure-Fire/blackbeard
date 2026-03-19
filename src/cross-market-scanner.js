#!/usr/bin/env node
/**
 * Cross-Market Anomaly Scanner
 * Scans all 10 NE Corridor signal venues via Vivid Seats API
 * Flags artists where:
 *   - Get-in price > $100 at 2+ venues
 *   - Listing count >= 10 (real resale volume, not noise)
 *   - Venue cap < 5K (scarcity play)
 * 
 * Usage: node cross-market-scanner.js [--save] [--verbose]
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const SIGNAL_VENUES = {
  // NYC
  'Terminal 5':       { id: 5351,  cap: 3000, city: 'NYC' },
  'Brooklyn Steel':   { id: 16236, cap: 1800, city: 'NYC' },
  'Irving Plaza':     { id: 796,   cap: 1025, city: 'NYC' },
  'Webster Hall':     { id: 3035,  cap: 1500, city: 'NYC' },
  'Bowery Ballroom':  { id: 1973,  cap: 575,  city: 'NYC' },
  // Boston
  'Roadrunner':       { id: 28114, cap: 3500, city: 'Boston' },
  'House of Blues Boston': { id: 6480, cap: 1800, city: 'Boston' },
  // Philly
  'Fillmore Philly':  { id: 14270, cap: 2500, city: 'Philly' },
  'Union Transfer':   { id: 9115,  cap: 1000, city: 'Philly' },
  'Franklin Music Hall': { id: 504, cap: 3000, city: 'Philly' },
  // Pittsburgh
  'Stage AE':         { id: 8774,  cap: 5500, city: 'Pittsburgh' },
  // Chicago
  'Salt Shed Indoor': { id: 28594, cap: 3600, city: 'Chicago' },
  'Salt Shed Outdoor':{ id: 30121, cap: 3600, city: 'Chicago' },
  // Charlotte
  'Fillmore Charlotte': { id: 7558, cap: 2000, city: 'Charlotte' },
  // Dallas
  'Bomb Factory':     { id: 12843, cap: 4300, city: 'Dallas' },
  // Toronto
  'History Toronto':  { id: 27545, cap: 2500, city: 'Toronto' },
};

// Thresholds
const MIN_GETIN = 100;
const MIN_VENUES = 2;
const MIN_LISTINGS = 10;
const MAX_VENUE_CAP = 5000;

function fetchVenue(venueId) {
  return new Promise((resolve, reject) => {
    const url = `https://www.vividseats.com/hermes/api/v1/productions?venueId=${venueId}&limit=50`;
    const opts = {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' }
    };
    https.get(url, opts, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`Parse error for venue ${venueId}`)); }
      });
    }).on('error', reject);
  });
}

function normalizeArtist(name) {
  // Extract primary artist name (before " - ", " at ", " with ", etc.)
  return name
    .replace(/\s*(tickets|tour|live|concert|show|2026|2025)\s*/gi, '')
    .replace(/\s*-\s.*$/, '')
    .replace(/\s+at\s+.*$/i, '')
    .trim()
    .toLowerCase();
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function scan() {
  const verbose = process.argv.includes('--verbose');
  const shouldSave = process.argv.includes('--save');
  
  console.log('🏴‍☠️ Cross-Market Anomaly Scanner');
  console.log(`Criteria: get-in >$${MIN_GETIN} at ${MIN_VENUES}+ venues, ${MIN_LISTINGS}+ listings, cap <${MAX_VENUE_CAP}`);
  console.log(`Scanning ${Object.keys(SIGNAL_VENUES).length} NE Corridor venues...\n`);

  // artist name → [{ venue, city, date, minPrice, avgPrice, listingCount, ticketCount, event }]
  const artistMap = {};
  let totalShows = 0;

  for (const [venueName, info] of Object.entries(SIGNAL_VENUES)) {
    process.stdout.write(`  📍 ${venueName} (${info.city}, ${info.cap} cap)... `);
    try {
      const data = await fetchVenue(info.id);
      const items = data.items || [];
      console.log(`${items.length} shows`);
      totalShows += items.length;

      for (const item of items) {
        const key = normalizeArtist(item.name || '');
        if (!key) continue;

        if (!artistMap[key]) artistMap[key] = { appearances: [], originalName: item.name };

        artistMap[key].appearances.push({
          venue: venueName,
          city: info.city,
          cap: info.cap,
          date: item.localDate || 'TBD',
          minPrice: item.minPrice || 0,
          avgPrice: item.avgPrice || 0,
          medianPrice: item.medianPrice || 0,
          maxPrice: item.maxPrice || 0,
          listingCount: item.listingCount || 0,
          ticketCount: item.ticketCount || 0,
          event: item.name,
        });
      }
    } catch (e) {
      console.log(`ERROR: ${e.message}`);
    }
    await sleep(500); // gentle pacing
  }

  console.log(`\nTotal shows scanned: ${totalShows}`);
  console.log(`Unique artists found: ${Object.keys(artistMap).length}\n`);

  // Filter: get-in > $100 at 2+ venues, listings >= 10, cap < 5K
  const flagged = [];

  for (const [key, data] of Object.entries(artistMap)) {
    const hotAppearances = data.appearances.filter(a =>
      a.minPrice > MIN_GETIN &&
      a.listingCount >= MIN_LISTINGS &&
      a.cap < MAX_VENUE_CAP
    );

    if (hotAppearances.length >= MIN_VENUES) {
      const avgGetIn = hotAppearances.reduce((s, a) => s + a.minPrice, 0) / hotAppearances.length;
      const totalListings = hotAppearances.reduce((s, a) => s + a.listingCount, 0);
      const totalTickets = hotAppearances.reduce((s, a) => s + a.ticketCount, 0);

      flagged.push({
        artist: data.originalName,
        key,
        venueCount: hotAppearances.length,
        avgGetIn: Math.round(avgGetIn),
        totalListings,
        totalTickets,
        appearances: hotAppearances,
        allAppearances: data.appearances,
      });
    }
  }

  // Sort by avg get-in descending
  flagged.sort((a, b) => b.avgGetIn - a.avgGetIn);

  console.log('━'.repeat(70));
  console.log(`🚨 FLAGGED: ${flagged.length} artists meet ALL criteria`);
  console.log('━'.repeat(70));

  if (flagged.length === 0) {
    console.log('No artists matched. Consider lowering thresholds.');
    return { flagged: [], scanned: totalShows, timestamp: new Date().toISOString() };
  }

  for (const f of flagged) {
    console.log(`\n🔥 ${f.artist}`);
    console.log(`   Avg get-in: $${f.avgGetIn} across ${f.venueCount} venues | ${f.totalListings} listings / ${f.totalTickets} tix`);
    for (const a of f.appearances) {
      console.log(`   📍 ${a.venue} (${a.city}) — $${a.minPrice} get-in / $${Math.round(a.avgPrice)} avg / ${a.listingCount} listings / ${a.ticketCount} tix — ${a.date.split('T')[0]}`);
    }
    // Show other venues where they appear but didn't meet threshold
    const otherVenues = f.allAppearances.filter(a => !f.appearances.includes(a));
    if (otherVenues.length > 0) {
      for (const a of otherVenues) {
        const reasons = [];
        if (a.minPrice <= MIN_GETIN) reasons.push(`$${a.minPrice} get-in`);
        if (a.listingCount < MIN_LISTINGS) reasons.push(`${a.listingCount} listings`);
        console.log(`   ⚪ ${a.venue} (${a.city}) — ${reasons.join(', ')} — didn't qualify`);
      }
    }
  }

  const result = {
    flagged: flagged.map(f => ({
      artist: f.artist,
      venueCount: f.venueCount,
      avgGetIn: f.avgGetIn,
      totalListings: f.totalListings,
      totalTickets: f.totalTickets,
      appearances: f.appearances.map(a => ({
        venue: a.venue, city: a.city, minPrice: a.minPrice,
        avgPrice: Math.round(a.avgPrice), listingCount: a.listingCount,
        ticketCount: a.ticketCount, date: a.date.split('T')[0]
      }))
    })),
    scanned: totalShows,
    venuesChecked: Object.keys(SIGNAL_VENUES).length,
    timestamp: new Date().toISOString(),
  };

  if (shouldSave) {
    const snapDir = path.join(__dirname, '..', 'data', 'vivid-snapshots');
    if (!fs.existsSync(snapDir)) fs.mkdirSync(snapDir, { recursive: true });
    const fname = `cross-market-${new Date().toISOString().split('T')[0]}.json`;
    fs.writeFileSync(path.join(snapDir, fname), JSON.stringify(result, null, 2));
    console.log(`\n💾 Saved to data/vivid-snapshots/${fname}`);
  }

  return result;
}

scan().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
