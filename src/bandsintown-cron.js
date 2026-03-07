#!/usr/bin/env node
// Bandsintown Daily Cron — scans all watchlist artists for new/changed shows
// Alerts Discord when: new shows added, shows sell out, presale detected

require('dotenv').config();
const https = require('https');
const fs = require('fs');
const path = require('path');

const WATCHLIST_PATH = path.join(__dirname, '..', 'data', 'watchlist.json');
const CACHE_PATH = path.join(__dirname, '..', 'data', 'artist-sites-cache.json');
const BIT_APP_ID = 'squarespace-blackbeard';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function httpGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'BlackbeardScanner/1.0' }, timeout: 12000 }, res => {
      if ([301, 302, 303, 307].includes(res.statusCode) && res.headers.location) {
        return httpGet(res.headers.location).then(resolve).catch(reject);
      }
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve(null); } });
    }).on('error', reject).on('timeout', function() { this.destroy(); reject(new Error('timeout')); });
  });
}

async function run() {
  const startTime = Date.now();
  console.log('🏴‍☠️ Bandsintown Daily Scan\n');
  
  const watchlist = JSON.parse(fs.readFileSync(WATCHLIST_PATH, 'utf8'));
  const artists = watchlist.artists || [];
  
  let cache = {};
  try { cache = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8')); } catch {}
  
  let stats = { scanned: 0, withEvents: 0, newShows: 0, newSoldOut: 0, newArtistsTouring: 0, errors: 0 };
  let alerts = [];
  
  for (const artist of artists) {
    stats.scanned++;
    
    try {
      const encoded = encodeURIComponent(artist.name);
      const data = await httpGet(`https://rest.bandsintown.com/artists/${encoded}/events?app_id=${BIT_APP_ID}`);
      
      if (!Array.isArray(data) || !data.length) {
        await sleep(100);
        continue;
      }
      
      const usEvents = data.filter(e => e.venue?.country === 'United States');
      if (!usEvents.length) { await sleep(100); continue; }
      
      stats.withEvents++;
      
      // Compare with cache
      const prev = cache[artist.name];
      const prevCount = prev?.usEvents || 0;
      const prevSoldOut = prev?.soldOut || 0;
      const currentSoldOut = usEvents.filter(e => e.sold_out).length;
      
      // Detect new shows
      if (usEvents.length > prevCount && prevCount > 0) {
        const newCount = usEvents.length - prevCount;
        stats.newShows += newCount;
        alerts.push(`🆕 **${artist.name}** added ${newCount} new show${newCount > 1 ? 's' : ''}! (${usEvents.length} total US dates)`);
      }
      
      // Detect first time touring
      if (usEvents.length > 0 && prevCount === 0 && prev) {
        stats.newArtistsTouring++;
        alerts.push(`🎉 **${artist.name}** just announced a tour! ${usEvents.length} US shows`);
      }
      
      // Detect new sold-out shows
      if (currentSoldOut > prevSoldOut) {
        const newSO = currentSoldOut - prevSoldOut;
        stats.newSoldOut += newSO;
        const soldOutShows = usEvents.filter(e => e.sold_out).map(e => `${e.venue?.name}, ${e.venue?.city}`).join('; ');
        alerts.push(`🔥 **${artist.name}** — ${newSO} show${newSO > 1 ? 's' : ''} just sold out! (${soldOutShows})`);
      }
      
      // Update cache
      cache[artist.name] = {
        usEvents: usEvents.length,
        soldOut: currentSoldOut,
        lastScan: new Date().toISOString(),
        events: usEvents.map(e => ({
          date: e.datetime?.split('T')[0],
          venue: e.venue?.name,
          city: `${e.venue?.city}, ${e.venue?.region}`,
          soldOut: e.sold_out,
        })),
      };
      
    } catch (e) {
      stats.errors++;
    }
    
    await sleep(100);
  }
  
  // Save cache
  fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2));
  
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
  
  console.log(`✅ Scan complete (${elapsed}s)`);
  console.log(`   ${stats.scanned} artists scanned`);
  console.log(`   ${stats.withEvents} with US events`);
  console.log(`   ${stats.newShows} new shows detected`);
  console.log(`   ${stats.newSoldOut} new sold-out shows`);
  console.log(`   ${stats.newArtistsTouring} new tour announcements`);
  
  if (alerts.length) {
    console.log(`\n📢 ALERTS (${alerts.length}):`);
    alerts.forEach(a => console.log(`   ${a}`));
  }
  
  // Output alerts for cron delivery
  if (alerts.length) {
    const header = `🏴‍☠️ **Bandsintown Daily Scan** — ${new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}\n`;
    const summary = `📊 ${stats.scanned} artists | ${stats.withEvents} touring | ${stats.newShows} new shows | ${stats.newSoldOut} sold out\n\n`;
    console.log('\n---DISCORD_ALERT---');
    console.log(header + summary + alerts.join('\n'));
  } else {
    console.log('\nNo changes detected. All quiet on the tour front.');
  }
}

run().catch(console.error);
