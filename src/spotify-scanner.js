#!/usr/bin/env node
/**
 * Blackbeard Rising Stars Scanner v3.0
 * 
 * Uses Brave Search as primary data source (no Spotify API rate limits)
 * Pulls: monthly listeners, social followers, album counts, sold-out history
 * Uses SeatGeek for tour dates
 * 
 * Spotify API used only for related artist discovery (low call count)
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');

const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
const SEATGEEK_CLIENT_ID = process.env.SEATGEEK_CLIENT_ID;
const BRAVE_API_KEY = process.env.BRAVE_API_KEY;

const DATA_DIR = path.join(__dirname, '..', 'data');
const DOCS_DATA_DIR = path.join(__dirname, '..', 'docs', 'data');
const SPOTIFY_HISTORY_FILE = path.join(DATA_DIR, 'spotify-history.json');
const RISING_STARS_FILE = path.join(DOCS_DATA_DIR, 'rising-stars.json');

const sleep = ms => new Promise(r => setTimeout(r, ms));
let braveCallCount = 0;
const MAX_BRAVE_CALLS = 30; // Keep it tight — SerpAPI Starter Plan is 1000/mo

// --- Brave Search ---

async function braveSearch(query) {
  if (braveCallCount >= MAX_BRAVE_CALLS) return null;
  braveCallCount++;
  try {
    const r = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=8`, {
      headers: { 'X-Subscription-Token': BRAVE_API_KEY, 'Accept': 'application/json' }
    });
    if (r.status !== 200) return null;
    return r.json();
  } catch { return null; }
}

function parseNumber(str) {
  if (!str) return null;
  str = str.replace(/,/g, '').trim();
  const match = str.match(/([\d.]+)\s*(billion|B|million|M|thousand|K)?/i);
  if (!match) return null;
  let num = parseFloat(match[1]);
  const unit = (match[2] || '').toLowerCase();
  if (unit === 'billion' || unit === 'b') num *= 1000000000;
  else if (unit === 'million' || unit === 'm') num *= 1000000;
  else if (unit === 'thousand' || unit === 'k') num *= 1000;
  return Math.round(num);
}

// --- Full Artist Stats via Brave ---

async function getArtistStats(name) {
  const stats = {
    monthlyListeners: null,
    spotifyFollowers: null,
    instagramFollowers: null,
    tiktokFollowers: null,
    twitterFollowers: null,
    youtubeSubscribers: null,
    albumCount: null,
    genres: [],
    soldOutMentions: 0,
    soldOutSnippets: [],
    topSong: null,
    spotifyUrl: null
  };

  // Query 1: Spotify profile + monthly listeners
  const q1 = await braveSearch(`${name} spotify artist monthly listeners`);
  if (q1?.web?.results) {
    for (const r of q1.web.results) {
      const text = `${r.title} ${r.description || ''}`;
      
      // Monthly listeners
      if (!stats.monthlyListeners) {
        const mlMatch = text.match(/([\d,.]+)\s*(million|M|thousand|K)?\s*monthly\s*listeners?/i);
        if (mlMatch) stats.monthlyListeners = parseNumber(mlMatch[1] + ' ' + (mlMatch[2] || ''));
      }
      
      // Spotify URL
      if (!stats.spotifyUrl && r.url?.includes('open.spotify.com/artist')) {
        stats.spotifyUrl = r.url;
      }

      // Followers from Spotify page
      if (!stats.spotifyFollowers) {
        const fMatch = text.match(/Artist\s*[·•]\s*([\d,.]+)\s*(million|M|thousand|K)?\s*monthly/i);
        // Also check for "X followers" in context
        const f2 = text.match(/([\d,.]+)\s*(million|M|thousand|K)?\s*followers/i);
        if (f2) stats.spotifyFollowers = parseNumber(f2[1] + ' ' + (f2[2] || ''));
      }
    }
  }
  await sleep(250);

  // Query 2: Social media followers + albums
  const q2 = await braveSearch(`${name} instagram tiktok followers albums discography`);
  if (q2?.web?.results) {
    for (const r of q2.web.results) {
      const text = `${r.title} ${r.description || ''}`;
      
      // Instagram
      if (!stats.instagramFollowers) {
        const igMatch = text.match(/instagram[^.]*?([\d,.]+)\s*(million|M|thousand|K)/i) 
          || text.match(/([\d,.]+)\s*(million|M|thousand|K)[^.]*?instagram/i);
        if (igMatch) stats.instagramFollowers = parseNumber(igMatch[1] + ' ' + (igMatch[2] || ''));
      }
      
      // TikTok
      if (!stats.tiktokFollowers) {
        const ttMatch = text.match(/tiktok[^.]*?([\d,.]+)\s*(million|M|thousand|K)/i)
          || text.match(/([\d,.]+)\s*(million|M|thousand|K)[^.]*?tiktok/i);
        if (ttMatch) stats.tiktokFollowers = parseNumber(ttMatch[1] + ' ' + (ttMatch[2] || ''));
      }
      
      // Twitter/X
      if (!stats.twitterFollowers) {
        const twMatch = text.match(/(?:twitter|x\.com|𝕏)[^.]*?([\d,.]+)\s*(million|M|thousand|K)/i);
        if (twMatch) stats.twitterFollowers = parseNumber(twMatch[1] + ' ' + (twMatch[2] || ''));
      }
      
      // YouTube
      if (!stats.youtubeSubscribers) {
        const ytMatch = text.match(/youtube[^.]*?([\d,.]+)\s*(million|M|thousand|K)/i)
          || text.match(/([\d,.]+)\s*(million|M|thousand|K)[^.]*?(?:youtube|subscribers)/i);
        if (ytMatch) stats.youtubeSubscribers = parseNumber(ytMatch[1] + ' ' + (ytMatch[2] || ''));
      }
      
      // Albums — look for "X studio albums" or "albums: X" or discography counts
      if (stats.albumCount === null) {
        const alMatch = text.match(/(\d+)\s*(?:studio\s*)?albums?/i);
        if (alMatch && parseInt(alMatch[1]) <= 20) stats.albumCount = parseInt(alMatch[1]);
      }
    }
  }
  await sleep(250);

  // Query 3: Sold-out history + tour buzz
  const q3 = await braveSearch(`"${name}" concert "sold out" OR "selling fast" OR "added dates" 2025 OR 2026`);
  if (q3?.web?.results) {
    stats.soldOutSnippets = q3.web.results
      .filter(r => {
        const text = `${r.title} ${r.description || ''}`.toLowerCase();
        return text.includes('sold out') || text.includes('sell out') || text.includes('sold-out') 
          || text.includes('selling fast') || text.includes('added dates') || text.includes('venue upgrade');
      })
      .map(r => ({ title: r.title, snippet: (r.description || '').slice(0, 150), url: r.url }));
    stats.soldOutMentions = stats.soldOutSnippets.length;
  }
  await sleep(250);

  return stats;
}

// --- SeatGeek Tour Dates ---

async function checkTourDates(name) {
  try {
    const r = await fetch(`https://api.seatgeek.com/2/events?q=${encodeURIComponent(name)}&per_page=25&sort=datetime_utc.asc&datetime_utc.gte=${new Date().toISOString().split('T')[0]}&client_id=${SEATGEEK_CLIENT_ID}`);
    if (r.status !== 200) return { upcoming: 0, events: [] };
    const data = await r.json();
    if (!data?.events?.length) return { upcoming: 0, events: [] };
    
    // Filter to small/medium venues (≤10K cap) where possible
    const events = data.events.map(e => ({
      title: e.title,
      date: e.datetime_utc?.split('T')[0],
      venue: e.venue?.name,
      city: `${e.venue?.city}, ${e.venue?.state}`,
      capacity: e.venue?.capacity,
      lowestPrice: e.stats?.lowest_sg_base_price || e.stats?.lowest_price,
      avgPrice: e.stats?.average_price,
      highestPrice: e.stats?.highest_price,
      listingCount: e.stats?.listing_count,
      score: e.score,
      url: e.url
    }));
    
    return { upcoming: events.length, events: events.slice(0, 8) };
  } catch { return { upcoming: 0, events: [] }; }
}

// --- Growth Tracking ---

function loadHistory() {
  try { return JSON.parse(fs.readFileSync(SPOTIFY_HISTORY_FILE, 'utf8')); }
  catch { return { snapshots: [] }; }
}

function saveHistory(h) {
  fs.writeFileSync(SPOTIFY_HISTORY_FILE, JSON.stringify(h, null, 2));
}

function calculateGrowth(name, current, history) {
  const prev = history.snapshots
    .filter(s => s.artists?.[name])
    .sort((a, b) => new Date(b.date) - new Date(a.date))[0];
  if (!prev) return { listenerGrowth: null, isNew: true };
  const prevML = prev.artists[name].monthlyListeners;
  if (!prevML || !current.monthlyListeners) return { listenerGrowth: null, isNew: false };
  const growth = ((current.monthlyListeners - prevML) / prevML * 100).toFixed(1);
  return { listenerGrowth: parseFloat(growth), isNew: false };
}

// --- Rising Star Score (0-100) ---

function calculateRisingStarScore(a) {
  let score = 0;
  
  // Monthly listeners sweet spot
  const ml = a.monthlyListeners || 0;
  if (ml >= 500000 && ml <= 3000000) score += 20;
  else if (ml >= 100000 && ml <= 5000000) score += 12;
  else if (ml >= 50000 && ml <= 10000000) score += 5;
  else if (ml > 0) score += 2;
  
  // Album count: fewer = newer to scene
  const albums = a.albumCount || 0;
  if (albums >= 1 && albums <= 2) score += 15;
  else if (albums === 3) score += 10;
  else if (albums === 0) score += 5;
  
  // Sold-out / demand signals (strongest)
  if (a.soldOutMentions >= 4) score += 25;
  else if (a.soldOutMentions >= 2) score += 18;
  else if (a.soldOutMentions >= 1) score += 12;
  
  // Social presence (multi-platform = real)
  const socials = [a.instagramFollowers, a.tiktokFollowers, a.twitterFollowers, a.youtubeSubscribers].filter(Boolean).length;
  if (socials >= 3) score += 12;
  else if (socials >= 2) score += 8;
  else if (socials >= 1) score += 4;
  
  // TikTok virality
  if (a.tiktokFollowers > 1000000) score += 8;
  else if (a.tiktokFollowers > 500000) score += 5;
  else if (a.tiktokFollowers > 100000) score += 3;
  
  // Growth
  if (a.listenerGrowth > 20) score += 10;
  else if (a.listenerGrowth > 10) score += 7;
  else if (a.listenerGrowth > 5) score += 3;
  
  // Tour scarcity (limited dates = $$$)
  const shows = a.upcomingShows || 0;
  if (shows >= 1 && shows <= 5) score += 12;
  else if (shows === 0) score += 5;
  else if (shows <= 15) score += 3;
  
  // Pricing signal from SeatGeek
  if (a.tourDates?.length) {
    const avgPrices = a.tourDates.filter(t => t.avgPrice > 0).map(t => t.avgPrice);
    if (avgPrices.length) {
      const avg = avgPrices.reduce((a, b) => a + b, 0) / avgPrices.length;
      if (avg > 150) score += 8;
      else if (avg > 80) score += 4;
    }
  }
  
  return Math.min(100, score);
}

// --- Spotify Related Artists (low call count) ---

async function discoverRelated(seedNames) {
  let token;
  try {
    const auth = Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString('base64');
    const tr = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Authorization': `Basic ${auth}` },
      body: 'grant_type=client_credentials'
    });
    const tj = await tr.json();
    token = tj.access_token;
    if (!token) { console.log('  ⚠️ Spotify token unavailable, skipping related discovery'); return []; }
  } catch { console.log('  ⚠️ Spotify auth failed, skipping'); return []; }
  
  const seen = new Set();
  const discoveries = [];
  
  for (const name of seedNames.slice(0, 8)) {
    try {
      // Search for artist ID
      const sr = await fetch(`https://api.spotify.com/v1/search?q=${encodeURIComponent(name)}&type=artist&limit=1`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (sr.status === 429) { console.log('  ⚠️ Spotify rate limited, stopping related discovery'); break; }
      const sj = await sr.json();
      const id = sj.artists?.items?.[0]?.id;
      if (!id) continue;
      
      // Get related
      const rr = await fetch(`https://api.spotify.com/v1/artists/${id}/related-artists`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (rr.status === 429) break;
      const rj = await rr.json();
      
      for (const a of (rj.artists || [])) {
        if (seen.has(a.name)) continue;
        seen.add(a.name);
        discoveries.push({ name: a.name, spotifyId: a.id, image: a.images?.[0]?.url, source: 'related', seedArtist: name });
      }
      await sleep(500);
    } catch { continue; }
  }
  
  return discoveries;
}

// --- Main ---

async function run() {
  console.log('🏴‍☠️ Blackbeard Rising Stars Scanner v3.0');
  console.log('='.repeat(50));
  
  const watchlist = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'watchlist.json'), 'utf8'));
  const history = loadHistory();
  const today = new Date().toISOString().split('T')[0];
  
  // Load cache to skip recently-scanned artists
  let cache = {};
  const CACHE_PATH = path.join(DATA_DIR, 'watchlist-stats-cache.json');
  try { cache = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8')); } catch {}
  
  // === PHASE 1: Scan watchlist artists (use cache for recent, Brave for stale) ===
  console.log(`\n📊 Phase 1: Scanning ${watchlist.artists.length} watchlist artists...`);
  const watchlistResults = [];
  let freshScans = 0;
  
  for (const wa of watchlist.artists) {
    const cacheKey = wa.name.toLowerCase();
    const cached = cache[cacheKey];
    const cacheAge = cached ? (Date.now() - new Date(cached._cachedAt).getTime()) / (1000*60*60*24) : Infinity;
    
    let stats, tourData;
    
    if (cached && cacheAge < 7 && braveCallCount >= MAX_BRAVE_CALLS) {
      // Use cache if Brave is exhausted
      stats = cached;
      tourData = { upcoming: cached._upcomingShows || 0, events: cached._tourDates || [] };
      process.stdout.write(`  📦 ${wa.name} (cached)...`);
    } else if (braveCallCount < MAX_BRAVE_CALLS && (cacheAge >= 3 || !cached)) {
      // Fresh scan if cache is stale (>3 days) or missing
      process.stdout.write(`  🎵 ${wa.name}...`);
      stats = await getArtistStats(wa.name);
      tourData = await checkTourDates(wa.name);
      // Cache it
      cache[cacheKey] = { ...stats, _cachedAt: new Date().toISOString(), _upcomingShows: tourData.upcoming, _tourDates: tourData.events };
      freshScans++;
    } else {
      // Use cache
      stats = cached || {};
      tourData = { upcoming: cached?._upcomingShows || 0, events: cached?._tourDates || [] };
      process.stdout.write(`  📦 ${wa.name} (cached)...`);
    }
    const growth = calculateGrowth(wa.name, stats, history);
    
    const result = {
      name: wa.name,
      tier: wa.tier,
      genre: wa.genre,
      source: 'watchlist',
      ...stats,
      upcomingShows: tourData.upcoming,
      tourDates: tourData.events,
      listenerGrowth: growth.listenerGrowth,
      isNewToTracking: growth.isNew
    };
    result.risingStarScore = calculateRisingStarScore(result);
    watchlistResults.push(result);
    
    const ml = stats.monthlyListeners ? `${(stats.monthlyListeners / 1000000).toFixed(1)}M listeners` : 'no listener data';
    const ig = stats.instagramFollowers ? ` | IG ${(stats.instagramFollowers/1000).toFixed(0)}K` : '';
    const tt = stats.tiktokFollowers ? ` | TT ${(stats.tiktokFollowers/1000000).toFixed(1)}M` : '';
    const so = stats.soldOutMentions ? ` | ${stats.soldOutMentions} sold-outs` : '';
    console.log(` ✅ ${ml}${ig}${tt}${so} | ${stats.albumCount || '?'} albums | ${tourData.upcoming} shows | score ${result.risingStarScore}`);
  }
  
  // === PHASE 2: Discover related artists ===
  console.log('\n🔍 Phase 2: Related artist discovery via Spotify...');
  const topSeeds = watchlistResults
    .sort((a, b) => b.risingStarScore - a.risingStarScore)
    .slice(0, 8)
    .map(r => r.name);
  
  const relatedRaw = await discoverRelated(topSeeds);
  const watchlistNames = new Set(watchlist.artists.map(a => a.name.toLowerCase()));
  const relatedNew = relatedRaw.filter(r => !watchlistNames.has(r.name.toLowerCase()));
  console.log(`  Found ${relatedNew.length} new related artists`);
  
  // === PHASE 3: Enrich top related discoveries ===
  console.log('\n📊 Phase 3: Enriching top discoveries...');
  const enrichedDiscoveries = [];
  
  for (const d of relatedNew.slice(0, 15)) {
    if (braveCallCount >= MAX_BRAVE_CALLS) {
      console.log(`  ⚠️ Brave limit reached`);
      break;
    }
    process.stdout.write(`  🆕 ${d.name}...`);
    
    const stats = await getArtistStats(d.name);
    const tourData = await checkTourDates(d.name);
    
    const result = {
      ...d,
      ...stats,
      upcomingShows: tourData.upcoming,
      tourDates: tourData.events
    };
    result.risingStarScore = calculateRisingStarScore(result);
    enrichedDiscoveries.push(result);
    
    const ml = stats.monthlyListeners ? `${(stats.monthlyListeners / 1000000).toFixed(1)}M` : '?';
    console.log(` ${ml} listeners | ${stats.albumCount || '?'} albums | score ${result.risingStarScore}`);
  }
  
  // Save cache
  fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2));
  console.log(`\n  Fresh scans: ${freshScans}, Cached: ${watchlistResults.length - freshScans}`);
  
  // === Save history ===
  const snapshot = { date: today, artists: {} };
  for (const r of watchlistResults) {
    if (r.monthlyListeners) snapshot.artists[r.name] = { monthlyListeners: r.monthlyListeners };
  }
  history.snapshots.push(snapshot);
  history.snapshots = history.snapshots.filter(s => s.date >= new Date(Date.now() - 90*24*60*60*1000).toISOString().split('T')[0]);
  saveHistory(history);
  
  // === Combine & Output ===
  const allResults = [...watchlistResults, ...enrichedDiscoveries]
    .sort((a, b) => b.risingStarScore - a.risingStarScore);
  
  if (!fs.existsSync(DOCS_DATA_DIR)) fs.mkdirSync(DOCS_DATA_DIR, { recursive: true });
  
  const output = {
    scanDate: today,
    scanTime: new Date().toISOString(),
    watchlistCount: watchlistResults.length,
    discoveryCount: enrichedDiscoveries.length,
    totalArtists: allResults.length,
    braveCallsUsed: braveCallCount,
    artists: allResults
  };
  
  fs.writeFileSync(RISING_STARS_FILE, JSON.stringify(output, null, 2));
  fs.writeFileSync(path.join(DATA_DIR, 'spotify-data.json'), JSON.stringify({ scanDate: today, artists: watchlistResults }, null, 2));
  
  // === Summary ===
  console.log('\n' + '='.repeat(50));
  console.log('🏴‍☠️ SCAN COMPLETE');
  console.log(`  Watchlist: ${watchlistResults.length} artists`);
  console.log(`  Discoveries: ${enrichedDiscoveries.length} artists`);
  console.log(`  Brave API calls: ${braveCallCount}/${MAX_BRAVE_CALLS}`);
  
  const breakouts = allResults.filter(a => a.risingStarScore >= 55);
  
  console.log('\n🌟 TOP 15 RISING STARS:');
  for (const a of allResults.slice(0, 15)) {
    const src = a.source === 'watchlist' ? '📋' : '🆕';
    const ml = a.monthlyListeners ? `${(a.monthlyListeners / 1000000).toFixed(1)}M` : '?';
    const ig = a.instagramFollowers ? ` IG:${(a.instagramFollowers/1000).toFixed(0)}K` : '';
    const tt = a.tiktokFollowers ? ` TT:${(a.tiktokFollowers/1000000).toFixed(1)}M` : '';
    console.log(`  ${src} ${a.risingStarScore}/100 | ${a.name} | ${ml} listeners${ig}${tt} | ${a.albumCount || '?'} albums | ${a.upcomingShows || 0} shows | ${a.soldOutMentions || 0} sold-outs`);
  }
  
  if (breakouts.length) {
    console.log(`\n🚨 ${breakouts.length} BREAKOUT ALERTS (score ≥55):`);
    for (const b of breakouts) {
      const ml = b.monthlyListeners ? `${(b.monthlyListeners / 1000000).toFixed(1)}M listeners` : '';
      console.log(`  🔥 ${b.name} — Score ${b.risingStarScore} | ${ml}`);
    }
  }
  
  return { allResults, breakouts, watchlistResults, discoveries: enrichedDiscoveries };
}

function formatDiscordAlert(results) {
  const { allResults, breakouts } = results;
  let msg = '🌟 **RISING STARS SCAN** 🌟\n\n';
  
  if (breakouts.length) {
    msg += '🚨 **BREAKOUT ALERTS:**\n';
    for (const b of breakouts.slice(0, 5)) {
      const ml = b.monthlyListeners ? `${(b.monthlyListeners / 1000000).toFixed(1)}M listeners` : '';
      const so = b.soldOutMentions ? `${b.soldOutMentions} sold-outs` : '';
      const ig = b.instagramFollowers ? `IG ${(b.instagramFollowers/1000).toFixed(0)}K` : '';
      const tt = b.tiktokFollowers ? `TT ${(b.tiktokFollowers/1000000).toFixed(1)}M` : '';
      const details = [ml, so, ig, tt].filter(Boolean).join(' | ');
      msg += `> 🔥 **${b.name}** — Score **${b.risingStarScore}**/100 | ${details}\n`;
    }
    msg += '\n';
  }
  
  msg += '**TOP 10 RISING STARS:**\n';
  for (const a of allResults.slice(0, 10)) {
    const src = a.source === 'watchlist' ? '📋' : '🆕';
    const ml = a.monthlyListeners ? `${(a.monthlyListeners / 1000000).toFixed(1)}M` : '?';
    const shows = a.upcomingShows || 0;
    const so = a.soldOutMentions ? ` | ${a.soldOutMentions} 🔥sold-outs` : '';
    msg += `> ${src} **${a.risingStarScore}**/100 | **${a.name}** | ${ml} listeners | ${a.albumCount || '?'} albums | ${shows} shows${so}\n`;
  }
  
  msg += `\n📊 Full report: <https://action-figure-fire.github.io/blackbeard/rising-stars.html>`;
  return msg;
}

if (require.main === module) {
  run().then(results => {
    console.log('\n--- DISCORD ALERT ---');
    console.log(formatDiscordAlert(results));
    console.log('--- END ---');
  }).catch(e => {
    console.error('Fatal error:', e);
    process.exit(1);
  });
}

module.exports = { run, formatDiscordAlert };
