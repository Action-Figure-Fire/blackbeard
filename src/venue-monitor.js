#!/usr/bin/env node
/**
 * Blackbeard Venue Price Monitor v1.0
 * 
 * Monitors specific venues on SeatGeek for shows with high get-in prices.
 * Uses SeatGeek API for event listings + Brave for pricing when API stats empty.
 * 
 * Alerts when:
 * - New show added at a tracked venue
 * - Get-in price crosses threshold ($80+)
 * - Price spikes detected (vs previous scan)
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');

const SEATGEEK_CLIENT_ID = process.env.SEATGEEK_CLIENT_ID;
const SEATGEEK_SECRET = process.env.SEATGEEK_SECRET;
const BRAVE_API_KEY = process.env.BRAVE_API_KEY;

const DATA_DIR = path.join(__dirname, '..', 'data');
const VENUE_CACHE = path.join(DATA_DIR, 'venue-monitor-cache.json');

const sleep = ms => new Promise(r => setTimeout(r, ms));
let braveCallCount = 0;

// === VENUE CONFIG ===
// Add venues here. SeatGeek venue IDs can be found via their API.
// Price threshold: only alert if get-in >= this amount
const TRACKED_VENUES = [
  // --- ICONIC / HIGH-DEMAND ---
  { id: 196, name: 'Red Rocks Amphitheatre', city: 'Morrison, CO', threshold: 80, capacity: 9525 },
  { id: 292, name: 'Ryman Auditorium', city: 'Nashville, TN', threshold: 100, capacity: 2362 },
  { id: 4348, name: 'Radio City Music Hall', city: 'New York, NY', threshold: 100, capacity: 6015 },
  // --- MID-SIZE TASTEMAKERS ---
  { id: 420076, name: 'Brooklyn Steel', city: 'Brooklyn, NY', threshold: 80, capacity: 1800 },
  { id: 814, name: 'Terminal 5', city: 'New York, NY', threshold: 70, capacity: 3000 },
  { id: 719, name: 'Bowery Ballroom', city: 'New York, NY', threshold: 80, capacity: 575 },
  { id: 538, name: '9:30 Club', city: 'Washington, DC', threshold: 80, capacity: 1200 },
  { id: 430286, name: 'The Anthem', city: 'Washington, DC', threshold: 80, capacity: 6000 },
  { id: 456, name: 'The Wiltern', city: 'Los Angeles, CA', threshold: 80, capacity: 2400 },
  { id: 78730, name: 'The Fillmore Philadelphia', city: 'Philadelphia, PA', threshold: 70, capacity: 2500 },
];

// Can be expanded by user: { id, name, city, threshold, capacity }

function loadCache() {
  try { return JSON.parse(fs.readFileSync(VENUE_CACHE, 'utf8')); }
  catch { return { venues: {}, lastScan: null }; }
}

function saveCache(c) {
  c.lastScan = new Date().toISOString();
  fs.writeFileSync(VENUE_CACHE, JSON.stringify(c, null, 2));
}

// --- SeatGeek API ---

async function getVenueEvents(venueId) {
  const today = new Date().toISOString().split('T')[0];
  const url = `https://api.seatgeek.com/2/events?venue.id=${venueId}&per_page=50&sort=datetime_utc.asc&datetime_utc.gte=${today}&client_id=${SEATGEEK_CLIENT_ID}&client_secret=${SEATGEEK_SECRET}`;
  try {
    const r = await fetch(url);
    if (r.status !== 200) return [];
    const j = await r.json();
    return (j.events || []).map(e => ({
      id: e.id,
      title: e.title,
      date: e.datetime_utc?.split('T')[0],
      time: e.datetime_utc?.split('T')[1]?.slice(0, 5),
      artist: e.performers?.[0]?.name || e.title.split(' tickets')[0],
      type: e.type,
      sgScore: e.score,
      lowestPrice: e.stats?.lowest_sg_base_price || e.stats?.lowest_price || null,
      avgPrice: e.stats?.average_price || null,
      highestPrice: e.stats?.highest_price || null,
      listingCount: e.stats?.listing_count || null,
      url: e.url
    }));
  } catch { return []; }
}

// --- Brave pricing fallback ---

async function getBravePricing(artistName, venueName) {
  braveCallCount++;
  try {
    const q = `"${artistName}" "${venueName}" tickets price 2026`;
    const r = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(q)}&count=5`, {
      headers: { 'X-Subscription-Token': BRAVE_API_KEY, 'Accept': 'application/json' }
    });
    if (r.status !== 200) return null;
    const j = await r.json();
    
    for (const result of (j.web?.results || [])) {
      const text = `${result.title} ${result.description || ''}`;
      // Look for "from $X" or "$X" patterns
      const priceMatch = text.match(/(?:from|starting at|get[- ]in|tickets?\s*(?:from)?)\s*\$?([\d,]+)/i)
        || text.match(/\$([\d,]+)\s*(?:get[- ]in|starting|lowest|from)/i);
      if (priceMatch) {
        const price = parseInt(priceMatch[1].replace(/,/g, ''));
        if (price >= 10 && price <= 10000) return price;
      }
    }
    return null;
  } catch { return null; }
}

// --- Main Scan ---

async function run(customVenues) {
  const venues = customVenues || TRACKED_VENUES;
  console.log('🏴‍☠️ Blackbeard Venue Price Monitor v1.0');
  console.log('='.repeat(50));
  console.log(`Monitoring ${venues.length} venues...\n`);
  
  const cache = loadCache();
  const alerts = [];      // Shows crossing price threshold
  const newShows = [];     // New shows not seen before
  const hotShows = [];     // All shows above threshold
  const allShows = [];     // Everything for data export
  
  for (const venue of venues) {
    console.log(`📍 ${venue.name} (${venue.city}) — threshold $${venue.threshold}`);
    const events = await getVenueEvents(venue.id);
    
    if (!events.length) {
      console.log('   No upcoming events\n');
      continue;
    }
    
    const prevEvents = cache.venues[venue.id]?.events || {};
    let venueHot = 0;
    
    for (const event of events) {
      let price = event.lowestPrice;
      
      // If SeatGeek doesn't have pricing, try Brave (limit calls)
      if (!price && braveCallCount < 20) {
        price = await getBravePricing(event.artist, venue.name);
        if (price) event.lowestPrice = price;
        event.priceSource = 'brave';
        await sleep(300);
      }
      
      const prevEvent = prevEvents[event.id];
      const isNew = !prevEvent;
      const priceChanged = prevEvent && price && prevEvent.lowestPrice && price !== prevEvent.lowestPrice;
      const priceUp = priceChanged && price > prevEvent.lowestPrice;
      
      // Track the show
      const showData = {
        ...event,
        venueName: venue.name,
        venueCity: venue.city,
        venueCapacity: venue.capacity,
        threshold: venue.threshold
      };
      allShows.push(showData);
      
      if (price && price >= venue.threshold) {
        hotShows.push(showData);
        venueHot++;
        
        if (isNew) {
          newShows.push(showData);
          alerts.push({ type: 'new_hot', ...showData });
        } else if (priceUp) {
          alerts.push({ type: 'price_spike', prevPrice: prevEvent.lowestPrice, ...showData });
        }
      } else if (isNew && price) {
        newShows.push(showData);
      }
      
      // Update cache
      if (!cache.venues[venue.id]) cache.venues[venue.id] = { events: {} };
      cache.venues[venue.id].events[event.id] = {
        title: event.title, lowestPrice: price, date: event.date, lastSeen: new Date().toISOString()
      };
    }
    
    // Print venue summary
    const priced = events.filter(e => e.lowestPrice);
    if (priced.length) {
      const prices = priced.map(e => e.lowestPrice).sort((a, b) => b - a);
      console.log(`   ${events.length} shows | ${priced.length} priced | ${venueHot} above $${venue.threshold}`);
      
      // Show top 5 by price
      const top = priced.sort((a, b) => (b.lowestPrice || 0) - (a.lowestPrice || 0)).slice(0, 5);
      for (const e of top) {
        const hot = e.lowestPrice >= venue.threshold ? '🔥' : '  ';
        console.log(`   ${hot} $${e.lowestPrice} — ${e.artist} (${e.date})`);
      }
    } else {
      console.log(`   ${events.length} shows | no pricing data available`);
    }
    console.log();
    await sleep(200);
  }
  
  saveCache(cache);
  
  // Summary
  console.log('='.repeat(50));
  console.log('🏴‍☠️ VENUE MONITOR SUMMARY');
  console.log(`  Total shows tracked: ${allShows.length}`);
  console.log(`  Shows above threshold: ${hotShows.length}`);
  console.log(`  New hot shows: ${alerts.filter(a => a.type === 'new_hot').length}`);
  console.log(`  Price spikes: ${alerts.filter(a => a.type === 'price_spike').length}`);
  console.log(`  Brave calls used: ${braveCallCount}`);
  
  if (hotShows.length) {
    console.log('\n🔥 ALL HOT SHOWS (above threshold):');
    hotShows.sort((a, b) => (b.lowestPrice || 0) - (a.lowestPrice || 0));
    for (const s of hotShows.slice(0, 20)) {
      console.log(`  $${s.lowestPrice} get-in | ${s.artist} | ${s.venueName} (${s.venueCity}) | ${s.date}`);
    }
  }
  
  return { alerts, hotShows, newShows, allShows };
}

function formatDiscordAlert(results) {
  const { alerts, hotShows } = results;
  if (!alerts.length && !hotShows.length) return null;
  
  let msg = '🏟️ **VENUE PRICE MONITOR** 🏟️\n\n';
  
  // New hot shows
  const newHot = alerts.filter(a => a.type === 'new_hot');
  if (newHot.length) {
    msg += '🆕 **NEW shows above threshold:**\n';
    for (const a of newHot.slice(0, 10)) {
      msg += `> 🔥 **$${a.lowestPrice}** get-in — **${a.artist}** | ${a.venueName} | ${a.date}\n`;
    }
    msg += '\n';
  }
  
  // Price spikes
  const spikes = alerts.filter(a => a.type === 'price_spike');
  if (spikes.length) {
    msg += '📈 **PRICE SPIKES:**\n';
    for (const a of spikes.slice(0, 10)) {
      msg += `> 📈 **${a.artist}** — $${a.prevPrice} → **$${a.lowestPrice}** | ${a.venueName} | ${a.date}\n`;
    }
    msg += '\n';
  }
  
  // Top 10 hottest shows overall
  if (hotShows.length) {
    msg += '🔥 **TOP 10 HOTTEST get-in prices:**\n';
    const sorted = [...hotShows].sort((a, b) => b.lowestPrice - a.lowestPrice);
    for (const s of sorted.slice(0, 10)) {
      msg += `> **$${s.lowestPrice}** — ${s.artist} | ${s.venueName} (${s.venueCity}) | ${s.date}\n`;
    }
  }
  
  return msg;
}

// Allow adding venues via command line
if (require.main === module) {
  run().then(results => {
    const msg = formatDiscordAlert(results);
    if (msg) {
      console.log('\n--- DISCORD ALERT ---');
      console.log(msg);
      console.log('--- END ---');
    }
  }).catch(e => {
    console.error('Fatal:', e);
    process.exit(1);
  });
}

module.exports = { run, formatDiscordAlert, TRACKED_VENUES };
