#!/usr/bin/env node
// Hot Show Scanner v2 — Uses Brave Search to find high-price + sold-out shows
// Searches for resale pricing and sold-out status per artist
// Marks confirmed hot shows in rising-stars.json

require('dotenv').config();
const https = require('https');
const fs = require('fs');
const path = require('path');

const BRAVE_API_KEY = process.env.BRAVE_API_KEY;
const DATA_PATH = path.join(__dirname, '..', 'docs', 'data', 'rising-stars.json');
const MAX_BRAVE_CALLS = 40;

let braveCallsUsed = 0;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function httpGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const opts = { hostname: u.hostname, path: u.pathname + u.search, headers };
    https.get(opts, res => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => {
        try { resolve(JSON.parse(d)); } catch { resolve(d); }
      });
    }).on('error', reject);
  });
}

async function braveSearch(query) {
  if (braveCallsUsed >= MAX_BRAVE_CALLS) return [];
  braveCallsUsed++;
  const q = encodeURIComponent(query);
  const url = `https://api.search.brave.com/res/v1/web/search?q=${q}&count=8&freshness=pm`;
  try {
    const data = await httpGet(url, { 'X-Subscription-Token': BRAVE_API_KEY, 'Accept': 'application/json' });
    return data.web ? data.web.results : [];
  } catch (e) {
    console.error(`  Brave error:`, e.message);
    return [];
  }
}

function extractPrices(text) {
  // Find dollar amounts in text
  const matches = text.match(/\$\d[\d,]*(?:\.\d{2})?/g) || [];
  return matches.map(m => parseInt(m.replace(/[$,]/g, ''))).filter(p => p > 10 && p < 50000);
}

function isSoldOutText(text) {
  const lower = text.toLowerCase();
  return lower.includes('sold out') || lower.includes('sold-out') || lower.includes('sellout') || lower.includes('sell-out');
}

async function scanArtist(artist) {
  // Only scan artists with upcoming shows
  if (!artist.tourDates || !artist.tourDates.length) return null;
  
  // Search for pricing + sold-out info
  const results = await braveSearch(`"${artist.name}" tickets 2026 sold out OR price OR resale`);
  await sleep(400);
  
  if (!results.length) return null;
  
  const hotShows = [];
  let highPriceSignals = [];
  let soldOutSignals = [];
  
  for (const r of results) {
    const text = (r.title + ' ' + (r.description || '')).toLowerCase();
    const fullText = r.title + ' ' + (r.description || '');
    const prices = extractPrices(fullText);
    const isSoldOut = isSoldOutText(text);
    
    if (prices.some(p => p >= 100)) {
      highPriceSignals.push({
        title: r.title,
        url: r.url,
        prices: prices.filter(p => p >= 100),
        snippet: (r.description || '').slice(0, 200),
        soldOut: isSoldOut,
      });
    }
    
    if (isSoldOut) {
      soldOutSignals.push({
        title: r.title,
        url: r.url,
        snippet: (r.description || '').slice(0, 200),
      });
    }
  }
  
  // Determine hot show status
  const maxPrice = highPriceSignals.reduce((max, s) => Math.max(max, ...s.prices), 0);
  const confirmedSoldOut = soldOutSignals.length >= 1;
  
  if (maxPrice >= 100 || confirmedSoldOut) {
    // Try to match to specific tour dates
    for (const td of artist.tourDates) {
      const venueLC = (td.venue || '').toLowerCase();
      const cityLC = (td.city || '').toLowerCase();
      
      // Check if any signal mentions this venue
      const venueMatch = [...highPriceSignals, ...soldOutSignals].find(s => {
        const st = (s.title + ' ' + (s.snippet || '')).toLowerCase();
        return venueLC && st.includes(venueLC.split(' ')[0]);
      });
      
      if (venueMatch) {
        td.hot = true;
        td.hotPrice = venueMatch.prices ? Math.max(...venueMatch.prices) : null;
        td.hotSoldOut = venueMatch.soldOut || soldOutSignals.some(s => 
          (s.title + s.snippet).toLowerCase().includes(venueLC.split(' ')[0])
        );
        td.hotSource = venueMatch.url;
      }
    }
    
    return {
      name: artist.name,
      maxPrice,
      soldOut: confirmedSoldOut,
      soldOutCount: soldOutSignals.length,
      highPriceCount: highPriceSignals.length,
      sources: [...highPriceSignals, ...soldOutSignals].slice(0, 3),
    };
  }
  
  return null;
}

async function run() {
  console.log('🔥 Hot Show Scanner v2 starting...');
  console.log(`   Budget: ${MAX_BRAVE_CALLS} Brave calls`);
  
  const data = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
  const artists = data.artists || [];
  
  // Prioritize: artists with sold-out mentions first, then by score
  const sorted = [...artists]
    .filter(a => a.tourDates && a.tourDates.length)
    .sort((a, b) => {
      if ((b.soldOutMentions || 0) !== (a.soldOutMentions || 0)) 
        return (b.soldOutMentions || 0) - (a.soldOutMentions || 0);
      return (b.score || 0) - (a.score || 0);
    });
  
  console.log(`   ${sorted.length} artists with tour dates to scan\n`);
  
  let hotResults = [];
  
  for (const artist of sorted) {
    if (braveCallsUsed >= MAX_BRAVE_CALLS) {
      console.log(`\n   ⚠️  Brave budget exhausted (${braveCallsUsed}/${MAX_BRAVE_CALLS})`);
      break;
    }
    
    process.stdout.write(`  Scanning ${artist.name}...`);
    const result = await scanArtist(artist);
    
    // Update the artist in the original data
    const orig = artists.find(a => a.name === artist.name);
    if (orig) {
      orig.tourDates = artist.tourDates; // Copy any hot flags back
    }
    
    if (result) {
      console.log(` 🔥 $${result.maxPrice} ${result.soldOut ? '+ SOLD OUT' : ''}`);
      hotResults.push(result);
      
      // Set artist-level hot flag
      if (orig) {
        orig.hasHotShows = true;
        orig.hotShowCount = artist.tourDates.filter(t => t.hot).length;
        orig.confirmedSoldOut = result.soldOut;
        orig.peakPrice = result.maxPrice;
      }
    } else {
      console.log(' —');
    }
  }
  
  // Save
  data.hotShowScan = new Date().toISOString();
  fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));
  
  console.log(`\n✅ Hot Show Scanner complete`);
  console.log(`   ${hotResults.length} artists with hot signals`);
  console.log(`   ${braveCallsUsed}/${MAX_BRAVE_CALLS} Brave calls used`);
  
  if (hotResults.length) {
    console.log('\n🔥 HOT ARTISTS:');
    hotResults.forEach(r => {
      console.log(`   ${r.name}: $${r.maxPrice} ${r.soldOut ? '🔴 SOLD OUT' : '🟡 HIGH PRICE'} (${r.sources.length} sources)`);
    });
  }
  
  return hotResults;
}

run().catch(console.error);
