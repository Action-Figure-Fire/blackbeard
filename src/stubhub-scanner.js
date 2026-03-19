#!/usr/bin/env node
/**
 * StubHub Weekly Scanner
 * Scrapes StubHub venue pages via ScrapingBee, extracts pricing from schema.org JSON-LD
 * Compares against previous scan to flag NEW shows only
 * 
 * Usage: node stubhub-scanner.js [--save] [--new-only] [--verbose]
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

// Load API key
let SCRAPINGBEE_KEY;
try {
  const env = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
  const match = env.match(/SCRAPINGBEE_KEY=(.+)/);
  if (match) SCRAPINGBEE_KEY = match[1].trim();
} catch(e) {}
if (!SCRAPINGBEE_KEY) { console.error('Missing SCRAPINGBEE_KEY in .env'); process.exit(1); }

const VENUES = {
  // Clubs (<3K)
  'Fillmore SF':          { url: 'https://www.stubhub.com/fillmore-san-francisco-tickets/venue/92/', cap: 1150, city: 'San Francisco', tier: 'club' },
  'Fonda Theatre LA':     { url: 'https://www.stubhub.com/the-fonda-theatre-tickets/venue/10306/', cap: 1200, city: 'Los Angeles', tier: 'club' },
  '9:30 Club DC':         { url: 'https://www.stubhub.com/930-club-at-the-atlantis-complex-tickets/venue/2222/', cap: 1200, city: 'Washington DC', tier: 'club' },
  'First Avenue Minneapolis': { url: 'https://www.stubhub.com/first-avenue-minneapolis-tickets/venue/5769/', cap: 1500, city: 'Minneapolis', tier: 'club' },
  'Ryman Nashville':      { url: 'https://www.stubhub.com/ryman-auditorium-tickets/venue/5725/', cap: 2362, city: 'Nashville', tier: 'club' },
  'Ogden Denver':         { url: 'https://www.stubhub.com/ogden-theatre-tickets/venue/10585/', cap: 1600, city: 'Denver', tier: 'club' },
  'Brooklyn Paramount':   { url: 'https://www.stubhub.com/brooklyn-paramount-tickets/venue/440672/', cap: 2800, city: 'Brooklyn', tier: 'club' },
  'Van Buren Phoenix':    { url: 'https://www.stubhub.com/the-van-buren-tickets/venue/102014268/', cap: 1800, city: 'Phoenix', tier: 'club' },
  'Danforth Toronto':     { url: 'https://www.stubhub.com/the-danforth-music-hall-theatre-tickets/venue/78684/', cap: 1500, city: 'Toronto', tier: 'club' },
  'Tabernacle Atlanta':   { url: 'https://www.stubhub.com/the-tabernacle-atlanta-tickets/venue/4704/', cap: 2600, city: 'Atlanta', tier: 'club' },
  'Stubbs Austin':        { url: 'https://www.stubhub.com/stubb-s-waller-creek-amphitheatre-tickets/venue/102062406/', cap: 2100, city: 'Austin', tier: 'club' },

  // Small Arenas (3K-10K)
  'Masonic SF':           { url: 'https://www.stubhub.com/masonic-auditorium-tickets/venue/222/', cap: 3300, city: 'San Francisco', tier: 'arena' },
  'Wiltern LA':           { url: 'https://www.stubhub.com/wiltern-theatre-tickets/venue/2041/', cap: 3700, city: 'Los Angeles', tier: 'arena' },
  'The Anthem DC':        { url: 'https://www.stubhub.com/the-anthem-tickets/venue/102019050/', cap: 6000, city: 'Washington DC', tier: 'arena' },
  'Radio City NYC':       { url: 'https://www.stubhub.com/radio-city-music-hall-tickets/venue/3962/', cap: 6000, city: 'New York', tier: 'arena' },
  'MGM Music Hall Boston': { url: 'https://www.stubhub.com/mgm-music-hall-at-fenway-park-tickets/venue/102589095/', cap: 5000, city: 'Boston', tier: 'arena' },
  'Aragon Ballroom Chicago': { url: 'https://www.stubhub.com/byline-bank-aragon-ballroom-tickets/venue/6723/', cap: 4500, city: 'Chicago', tier: 'arena' },
  'Coca-Cola Roxy Atlanta': { url: 'https://www.stubhub.com/coca-cola-roxy-theatre-tickets/venue/448870/', cap: 3600, city: 'Atlanta', tier: 'arena' },
  'Warfield SF':          { url: 'https://www.stubhub.com/the-warfield-tickets/venue/94/', cap: 2300, city: 'San Francisco', tier: 'arena' },
};

const SNAPSHOT_DIR = path.join(__dirname, '..', 'data', 'stubhub-snapshots');
const BASELINE_FILE = path.join(SNAPSHOT_DIR, 'baseline.json');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function scrapeVenue(name, venueUrl) {
  return new Promise((resolve, reject) => {
    const apiUrl = `https://app.scrapingbee.com/api/v1/?api_key=${SCRAPINGBEE_KEY}&url=${encodeURIComponent(venueUrl)}&render_js=true&premium_proxy=true&wait=10000`;
    
    https.get(apiUrl, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode !== 200) {
          resolve({ venue: name, events: [], error: `HTTP ${res.statusCode}` });
          return;
        }
        
        const events = [];
        const ldMatches = data.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>(.*?)<\/script>/gs);
        if (ldMatches) {
          ldMatches.forEach(m => {
            const json = m.replace(/<[^>]+>/g, '');
            try {
              const obj = JSON.parse(json);
              const items = obj['@graph'] || (Array.isArray(obj) ? obj : [obj]);
              items.forEach(ev => {
                if (!ev.name || /parking|lot/i.test(ev.name)) return;
                if (!ev.startDate) return;
                events.push({
                  artist: ev.name,
                  date: ev.startDate.split('T')[0],
                  datetime: ev.startDate,
                  getIn: ev.offers?.lowPrice ? parseFloat(ev.offers.lowPrice) : null,
                  currency: ev.offers?.priceCurrency || 'USD',
                  url: ev.url || null,
                  venueName: ev.location?.name || name,
                  city: ev.location?.address?.addressLocality || '',
                });
              });
            } catch(e) {}
          });
        }
        resolve({ venue: name, events, error: null });
      });
    }).on('error', e => resolve({ venue: name, events: [], error: e.message }));
  });
}

async function scan() {
  const shouldSave = process.argv.includes('--save');
  const newOnly = process.argv.includes('--new-only');
  const verbose = process.argv.includes('--verbose');
  
  if (!fs.existsSync(SNAPSHOT_DIR)) fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
  
  // Load previous baseline
  let baseline = {};
  if (fs.existsSync(BASELINE_FILE)) {
    try { baseline = JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8')); } catch(e) {}
  }
  const prevKeys = new Set(Object.keys(baseline));
  
  console.log('🏴‍☠️ StubHub Weekly Scanner');
  console.log(`Scanning ${Object.keys(VENUES).length} venues via ScrapingBee...\n`);
  
  const allResults = {};
  const allEvents = [];
  const newEvents = [];
  let totalShows = 0;
  let errors = 0;
  
  const venueEntries = Object.entries(VENUES);
  
  for (let i = 0; i < venueEntries.length; i++) {
    const [name, info] = venueEntries[i];
    process.stdout.write(`  📍 [${i+1}/${venueEntries.length}] ${name} (${info.city}, ${info.cap} cap)... `);
    
    const result = await scrapeVenue(name, info.url);
    
    if (result.error) {
      console.log(`ERROR: ${result.error}`);
      errors++;
    } else {
      console.log(`${result.events.length} shows`);
      totalShows += result.events.length;
    }
    
    result.events.forEach(ev => {
      ev.venue = name;
      ev.cap = info.cap;
      ev.tier = info.tier;
      ev.market = info.city;
      const key = `${ev.artist}|${ev.date}|${name}`;
      allResults[key] = ev;
      allEvents.push(ev);
      
      if (!prevKeys.has(key)) {
        newEvents.push(ev);
      }
    });
    
    // Pace requests — 2 seconds between venues
    if (i < venueEntries.length - 1) await sleep(2000);
  }
  
  console.log(`\n✅ Total: ${totalShows} shows across ${venueEntries.length} venues (${errors} errors)\n`);
  
  // Cross-market analysis: find artists at multiple venues
  const artistMap = {};
  allEvents.forEach(ev => {
    if (!ev.getIn) return;
    const key = ev.artist.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!artistMap[key]) artistMap[key] = { name: ev.artist, appearances: [] };
    artistMap[key].appearances.push(ev);
  });
  
  // Flag artists with get-in > $100 at 2+ venues
  const hotArtists = [];
  for (const [key, data] of Object.entries(artistMap)) {
    const hot = data.appearances.filter(a => a.getIn > 100);
    const uniqueVenues = new Set(hot.map(a => a.venue));
    if (uniqueVenues.size >= 2) {
      const avgGetIn = hot.reduce((s, a) => s + a.getIn, 0) / hot.length;
      hotArtists.push({ ...data, hotCount: uniqueVenues.size, avgGetIn: Math.round(avgGetIn) });
    }
  }
  hotArtists.sort((a, b) => b.avgGetIn - a.avgGetIn);
  
  // Report: hot artists
  if (hotArtists.length > 0) {
    console.log('━'.repeat(70));
    console.log(`🔥 HOT ARTISTS: $100+ get-in at 2+ venues (${hotArtists.length} found)`);
    console.log('━'.repeat(70));
    hotArtists.forEach(a => {
      console.log(`\n🔥 ${a.name} (${a.hotCount} venues, avg $${a.avgGetIn})`);
      a.appearances.sort((x, y) => (y.getIn || 0) - (x.getIn || 0));
      a.appearances.forEach(ev => {
        const flag = ev.getIn > 100 ? '🚨' : '  ';
        console.log(`   ${flag} ${ev.venue} (${ev.market}) — $${ev.getIn} — ${ev.date}`);
      });
    });
  }
  
  // Report: new shows
  if (newOnly || newEvents.length > 0) {
    console.log('\n' + '━'.repeat(70));
    console.log(`🆕 NEW SHOWS since last scan: ${newEvents.length}`);
    console.log('━'.repeat(70));
    
    if (newEvents.length === 0) {
      console.log('No new shows detected.');
    } else {
      // Sort new events by get-in descending
      const priced = newEvents.filter(e => e.getIn).sort((a, b) => b.getIn - a.getIn);
      const topNew = priced.slice(0, 30);
      topNew.forEach(ev => {
        console.log(`   ${ev.artist} | ${ev.venue} (${ev.market}) | $${ev.getIn} | ${ev.date}`);
      });
      if (priced.length > 30) console.log(`   ... and ${priced.length - 30} more`);
    }
  }
  
  // Report: top 20 highest get-in across all venues
  console.log('\n' + '━'.repeat(70));
  console.log('💰 TOP 20 HIGHEST GET-IN ACROSS ALL VENUES');
  console.log('━'.repeat(70));
  const topAll = allEvents.filter(e => e.getIn).sort((a, b) => b.getIn - a.getIn).slice(0, 20);
  topAll.forEach(ev => {
    console.log(`   $${ev.getIn} — ${ev.artist} | ${ev.venue} (${ev.market}) | ${ev.date}`);
  });
  
  // Save
  if (shouldSave) {
    // Save new baseline
    fs.writeFileSync(BASELINE_FILE, JSON.stringify(allResults, null, 2));
    
    // Save dated snapshot
    const dateStr = new Date().toISOString().split('T')[0];
    const snapshotFile = path.join(SNAPSHOT_DIR, `scan-${dateStr}.json`);
    fs.writeFileSync(snapshotFile, JSON.stringify({
      timestamp: new Date().toISOString(),
      venuesScanned: venueEntries.length,
      totalShows,
      errors,
      newShows: newEvents.length,
      hotArtists: hotArtists.map(a => ({
        name: a.name,
        venues: a.hotCount,
        avgGetIn: a.avgGetIn,
        appearances: a.appearances.map(e => ({ venue: e.venue, market: e.market, getIn: e.getIn, date: e.date }))
      })),
      allEvents: allEvents.map(e => ({ artist: e.artist, venue: e.venue, market: e.market, getIn: e.getIn, date: e.date, cap: e.cap }))
    }, null, 2));
    
    console.log(`\n💾 Baseline saved (${Object.keys(allResults).length} events)`);
    console.log(`💾 Snapshot saved to stubhub-snapshots/scan-${dateStr}.json`);
  }
  
  return { totalShows, newEvents: newEvents.length, hotArtists: hotArtists.length, errors };
}

scan().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
