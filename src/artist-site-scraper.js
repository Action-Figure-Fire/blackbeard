#!/usr/bin/env node
// Artist Tour Scanner v3 — Bandsintown API + Website Fallback
// Bandsintown API is FREE, returns full tour data including:
// - Dates, venues, cities, ticket URLs
// - on_sale_datetime, sold_out status
// - Presale info, descriptions
// Uses Brave Search to discover artist websites as fallback + for website URL storage

require('dotenv').config();
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

const WATCHLIST_PATH = path.join(__dirname, '..', 'data', 'watchlist.json');
const RISING_STARS_PATH = path.join(__dirname, '..', 'docs', 'data', 'rising-stars.json');
const CACHE_PATH = path.join(__dirname, '..', 'data', 'artist-sites-cache.json');
const BRAVE_API_KEY = process.env.BRAVE_API_KEY;
const BIT_APP_ID = 'squarespace-blackbeard';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function httpGet(url) {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith('https') ? https : http;
    proto.get(url, { headers: { 'User-Agent': 'BlackbeardScanner/1.0' }, timeout: 12000 }, res => {
      if ([301, 302, 303, 307].includes(res.statusCode) && res.headers.location) {
        const next = res.headers.location.startsWith('http') ? res.headers.location : new (require('url').URL)(res.headers.location, url).href;
        return httpGet(next).then(resolve).catch(reject);
      }
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve({ status: res.statusCode, body: d }));
    }).on('error', reject).on('timeout', function() { this.destroy(); reject(new Error('timeout')); });
  });
}

async function getBandsintownEvents(artistName) {
  const encoded = encodeURIComponent(artistName);
  const url = `https://rest.bandsintown.com/artists/${encoded}/events?app_id=${BIT_APP_ID}`;
  
  try {
    const res = await httpGet(url);
    if (res.status !== 200) {
      // Try alternate name formats
      const altNames = [
        artistName.replace(/\s+/g, ''),           // "MauP" 
        artistName.replace(/&/g, 'and'),           // "Amyl and The Sniffers"
        artistName + ' (Comedy)',                   // "Josh Johnson (Comedy)"
      ];
      
      for (const alt of altNames) {
        try {
          const altRes = await httpGet(`https://rest.bandsintown.com/artists/${encodeURIComponent(alt)}/events?app_id=${BIT_APP_ID}`);
          if (altRes.status === 200) {
            const events = JSON.parse(altRes.body);
            if (Array.isArray(events) && events.length > 0) return events;
          }
        } catch {}
      }
      return [];
    }
    
    const events = JSON.parse(res.body);
    if (!Array.isArray(events)) return [];
    return events;
  } catch (e) {
    return [];
  }
}

async function discoverWebsite(artistName) {
  return new Promise((resolve) => {
    const q = encodeURIComponent(`${artistName} official website`);
    const opts = {
      hostname: 'api.search.brave.com',
      path: `/res/v1/web/search?q=${q}&count=5`,
      headers: { 'X-Subscription-Token': BRAVE_API_KEY, 'Accept': 'application/json' },
    };
    const skipDomains = ['wikipedia', 'instagram', 'twitter', 'x.com', 'facebook', 'youtube',
      'spotify', 'apple.com', 'tiktok', 'reddit', 'seatgeek', 'ticketmaster', 'stubhub',
      'bandsintown', 'songkick', 'setlist.fm', 'genius', 'discogs', 'last.fm', 'allmusic',
      'vividseats', 'imdb', 'rateyourmusic'];
    
    https.get(opts, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try {
          const results = JSON.parse(d).web?.results || [];
          for (const r of results) {
            if (!skipDomains.some(s => r.url.toLowerCase().includes(s))) {
              resolve(r.url);
              return;
            }
          }
          resolve(null);
        } catch { resolve(null); }
      });
    }).on('error', () => resolve(null));
  });
}

async function run() {
  const args = process.argv.slice(2);
  const singleArtist = args.find(a => !a.startsWith('--'));
  const discoverMode = args.includes('--discover');
  const maxArtists = parseInt(args.find(a => a.startsWith('--max='))?.split('=')[1] || '76');
  
  console.log('🏴‍☠️ Artist Tour Scanner v3 (Bandsintown API)\n');
  
  const watchlist = JSON.parse(fs.readFileSync(WATCHLIST_PATH, 'utf8'));
  const risingStars = JSON.parse(fs.readFileSync(RISING_STARS_PATH, 'utf8'));
  
  let cache = {};
  try { cache = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8')); } catch {}
  
  let artists = watchlist.artists || [];
  if (singleArtist) {
    artists = artists.filter(a => a.name.toLowerCase().includes(singleArtist.toLowerCase()));
  }
  
  let braveCallsUsed = 0;
  let stats = { total: 0, withEvents: 0, soldOut: 0, totalShows: 0, newShows: 0, websites: 0 };
  
  for (const artist of artists.slice(0, maxArtists)) {
    stats.total++;
    process.stdout.write(`  ${artist.name}...`);
    
    // Get Bandsintown events
    const events = await getBandsintownEvents(artist.name);
    await sleep(200);
    
    if (!events.length) {
      console.log(' ❌ no events');
      continue;
    }
    
    // Filter US events only
    const usEvents = events.filter(e => e.venue?.country === 'United States');
    const soldOutEvents = usEvents.filter(e => e.sold_out);
    
    stats.withEvents++;
    stats.totalShows += usEvents.length;
    
    console.log(` ✅ ${usEvents.length} US shows${soldOutEvents.length ? ` (${soldOutEvents.length} SOLD OUT 🔥)` : ''}`);
    
    // Update rising-stars.json
    const rsArtist = risingStars.artists?.find(a => a.name === artist.name);
    if (rsArtist) {
      // Count previous tour dates to detect new shows
      const prevCount = rsArtist.tourDates?.length || 0;
      
      rsArtist.bandsintownEvents = usEvents.map(e => ({
        date: e.datetime?.split('T')[0],
        venue: e.venue?.name,
        city: `${e.venue?.city}, ${e.venue?.region}`,
        soldOut: e.sold_out || false,
        ticketUrl: e.offers?.[0]?.url || null,
        onsaleDate: e.on_sale_datetime || null,
        presale: e.presale || null,
        description: (e.description || '').slice(0, 200),
      }));
      
      rsArtist.bandsintownSoldOut = soldOutEvents.length;
      rsArtist.bandsintownTotal = usEvents.length;
      rsArtist.lastBitScan = new Date().toISOString();
      
      // Detect new shows added since last scan
      if (usEvents.length > prevCount && prevCount > 0) {
        const newCount = usEvents.length - prevCount;
        stats.newShows += newCount;
        console.log(`     🆕 ${newCount} NEW shows added since last scan!`);
      }
      
      if (soldOutEvents.length) {
        stats.soldOut++;
        soldOutEvents.forEach(e => {
          console.log(`     🔥 SOLD OUT: ${e.venue?.name}, ${e.venue?.city} (${e.datetime?.split('T')[0]})`);
        });
      }
    }
    
    // Discover website if needed
    if (!artist.website && discoverMode && braveCallsUsed < 40) {
      const website = await discoverWebsite(artist.name);
      braveCallsUsed++;
      if (website) {
        artist.website = website;
        stats.websites++;
        if (rsArtist) rsArtist.artistWebsite = website;
      }
      await sleep(300);
    }
    
    // Update cache
    cache[artist.name] = {
      artist: artist.name,
      website: artist.website,
      usEvents: usEvents.length,
      soldOut: soldOutEvents.length,
      scannedAt: new Date().toISOString(),
      events: usEvents.map(e => ({
        date: e.datetime?.split('T')[0],
        venue: e.venue?.name,
        city: `${e.venue?.city}, ${e.venue?.region}`,
        soldOut: e.sold_out,
        ticketUrl: e.offers?.[0]?.url,
        onsaleDate: e.on_sale_datetime,
      })),
    };
  }
  
  // Save
  fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2));
  fs.writeFileSync(WATCHLIST_PATH, JSON.stringify(watchlist, null, 2));
  fs.writeFileSync(RISING_STARS_PATH, JSON.stringify(risingStars, null, 2));
  
  console.log(`\n✅ Scan complete`);
  console.log(`   ${stats.total} artists scanned`);
  console.log(`   ${stats.withEvents} with US events (${stats.totalShows} total shows)`);
  console.log(`   ${stats.soldOut} artists with sold-out shows`);
  if (stats.newShows) console.log(`   🆕 ${stats.newShows} new shows detected!`);
  if (stats.websites) console.log(`   🌐 ${stats.websites} websites discovered`);
  if (braveCallsUsed) console.log(`   ${braveCallsUsed} Brave calls used`);
  
  return stats;
}

run().catch(console.error);
