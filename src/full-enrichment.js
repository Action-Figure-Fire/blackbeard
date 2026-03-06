#!/usr/bin/env node
/**
 * One-time full enrichment of all 76 watchlist artists
 * Uses SeatGeek (free) for tour data, Brave (budgeted) for stats
 * Outputs enriched rising-stars.json for the dashboard
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');

const BRAVE_API_KEY = process.env.BRAVE_API_KEY;
const SEATGEEK_CLIENT_ID = process.env.SEATGEEK_CLIENT_ID;
const DATA_DIR = path.join(__dirname, '..', 'data');
const DOCS_DATA_DIR = path.join(__dirname, '..', 'docs', 'data');
const CACHE_PATH = path.join(DATA_DIR, 'watchlist-stats-cache.json');

const sleep = ms => new Promise(r => setTimeout(r, ms));
let braveCallCount = 0;
const MAX_BRAVE_CALLS = parseInt(process.env.MAX_BRAVE_CALLS) || 120; // Higher for full sweep

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

async function braveSearch(query) {
  if (braveCallCount >= MAX_BRAVE_CALLS) return null;
  braveCallCount++;
  try {
    const r = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=8`, {
      headers: { 'X-Subscription-Token': BRAVE_API_KEY, 'Accept': 'application/json' }
    });
    if (r.status === 429) { console.log('  ⚠️ Brave rate limited'); return null; }
    if (r.status !== 200) return null;
    return r.json();
  } catch { return null; }
}

async function getArtistStats(name) {
  const stats = { monthlyListeners: null, spotifyFollowers: null, instagramFollowers: null,
    tiktokFollowers: null, twitterFollowers: null, youtubeSubscribers: null,
    albumCount: null, genres: [], soldOutMentions: 0, soldOutSnippets: [], topSong: null, spotifyUrl: null };

  // Combined query: listeners + social (saves 1 Brave call vs 2 separate)
  const q1 = await braveSearch(`${name} spotify monthly listeners instagram tiktok followers`);
  if (q1?.web?.results) {
    for (const r of q1.web.results) {
      const text = `${r.title} ${r.description || ''}`;
      if (!stats.monthlyListeners) {
        const m = text.match(/([\d,.]+)\s*(million|M|thousand|K)?\s*monthly\s*listeners?/i);
        if (m) stats.monthlyListeners = parseNumber(m[1] + ' ' + (m[2] || ''));
      }
      if (!stats.spotifyUrl && r.url?.includes('open.spotify.com/artist')) stats.spotifyUrl = r.url;
      if (!stats.spotifyFollowers) {
        const f = text.match(/([\d,.]+)\s*(million|M|thousand|K)?\s*followers/i);
        if (f) stats.spotifyFollowers = parseNumber(f[1] + ' ' + (f[2] || ''));
      }
      if (!stats.instagramFollowers) {
        const m = text.match(/instagram[^.]*?([\d,.]+)\s*(million|M|thousand|K)/i) || text.match(/([\d,.]+)\s*(million|M|thousand|K)[^.]*?instagram/i);
        if (m) stats.instagramFollowers = parseNumber(m[1] + ' ' + (m[2] || ''));
      }
      if (!stats.tiktokFollowers) {
        const m = text.match(/tiktok[^.]*?([\d,.]+)\s*(million|M|thousand|K)/i) || text.match(/([\d,.]+)\s*(million|M|thousand|K)[^.]*?tiktok/i);
        if (m) stats.tiktokFollowers = parseNumber(m[1] + ' ' + (m[2] || ''));
      }
      if (stats.albumCount === null) {
        const m = text.match(/(\d+)\s*(?:studio\s*)?albums?/i);
        if (m && parseInt(m[1]) <= 20) stats.albumCount = parseInt(m[1]);
      }
    }
  }
  await sleep(300);

  // Sold-out signals
  const q2 = await braveSearch(`"${name}" concert "sold out" OR "selling fast" OR "added dates" 2025 OR 2026`);
  if (q2?.web?.results) {
    stats.soldOutSnippets = q2.web.results
      .filter(r => {
        const t = `${r.title} ${r.description || ''}`.toLowerCase();
        return t.includes('sold out') || t.includes('sell out') || t.includes('sold-out') || t.includes('selling fast') || t.includes('added dates');
      })
      .map(r => ({ title: r.title, snippet: (r.description||'').slice(0,150), url: r.url }));
    stats.soldOutMentions = stats.soldOutSnippets.length;
  }
  await sleep(300);

  return stats;
}

async function checkTourDates(name) {
  try {
    const r = await fetch(`https://api.seatgeek.com/2/events?q=${encodeURIComponent(name)}&per_page=25&sort=datetime_utc.asc&datetime_utc.gte=${new Date().toISOString().split('T')[0]}&client_id=${SEATGEEK_CLIENT_ID}`);
    if (r.status !== 200) return { upcoming: 0, events: [] };
    const data = await r.json();
    if (!data?.events?.length) return { upcoming: 0, events: [] };
    return {
      upcoming: data.events.length,
      events: data.events.slice(0, 8).map(e => ({
        title: e.title, date: e.datetime_utc?.split('T')[0],
        venue: e.venue?.name, city: `${e.venue?.city}, ${e.venue?.state}`,
        capacity: e.venue?.capacity,
        lowestPrice: e.stats?.lowest_sg_base_price || e.stats?.lowest_price,
        avgPrice: e.stats?.average_price, highestPrice: e.stats?.highest_price,
        listingCount: e.stats?.listing_count, url: e.url
      }))
    };
  } catch { return { upcoming: 0, events: [] }; }
}

function scoreArtist(a) {
  let score = 0;
  const ml = a.monthlyListeners || 0;
  if (ml >= 500000 && ml <= 3000000) score += 20;
  else if (ml >= 100000 && ml <= 5000000) score += 12;
  else if (ml >= 50000 && ml <= 10000000) score += 5;
  else if (ml > 0) score += 2;

  const albums = a.albumCount || 0;
  if (albums >= 1 && albums <= 2) score += 15;
  else if (albums === 3) score += 10;
  else if (albums === 0) score += 5;

  if (a.soldOutMentions >= 4) score += 25;
  else if (a.soldOutMentions >= 2) score += 18;
  else if (a.soldOutMentions >= 1) score += 12;

  const socials = [a.instagramFollowers, a.tiktokFollowers, a.twitterFollowers, a.youtubeSubscribers].filter(Boolean).length;
  if (socials >= 3) score += 12;
  else if (socials >= 2) score += 8;
  else if (socials >= 1) score += 4;

  if (a.tiktokFollowers > 1000000) score += 8;
  else if (a.tiktokFollowers > 500000) score += 5;
  else if (a.tiktokFollowers > 100000) score += 3;

  const shows = a.upcomingShows || 0;
  if (shows >= 1 && shows <= 5) score += 12;
  else if (shows === 0) score += 5;
  else if (shows <= 15) score += 3;

  if (a.tourDates?.length) {
    const avgPrices = a.tourDates.filter(t => t.avgPrice > 0).map(t => t.avgPrice);
    if (avgPrices.length) {
      const avg = avgPrices.reduce((s, v) => s + v, 0) / avgPrices.length;
      if (avg > 150) score += 8;
      else if (avg > 80) score += 4;
    }
  }

  // Bonus: Tier A artists get a small boost (user hand-curated = signal)
  if (a.tier === 'A') score += 5;

  return Math.min(100, score);
}

async function main() {
  console.log('🏴‍☠️ Full Enrichment Sweep — All 76 Watchlist Artists');
  console.log('='.repeat(50));
  
  const watchlist = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'watchlist.json'), 'utf8'));
  let cache = {};
  try { cache = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8')); } catch {}

  const results = [];

  // Phase 1: SeatGeek for ALL artists (free, no limit)
  console.log('\n📊 Phase 1: SeatGeek tour dates for all artists...');
  const tourMap = {};
  for (const a of watchlist.artists) {
    process.stdout.write(`  🎟️ ${a.name}...`);
    const td = await checkTourDates(a.name);
    tourMap[a.name] = td;
    const prices = td.events.filter(e => e.avgPrice > 0).map(e => `$${e.avgPrice}`);
    console.log(` ${td.upcoming} shows ${prices.length ? '(' + prices.slice(0,3).join(', ') + ')' : ''}`);
    await sleep(200);
  }

  // Phase 2: Brave enrichment — prioritize Tier A and uncached
  console.log(`\n🔍 Phase 2: Brave enrichment (budget: ${MAX_BRAVE_CALLS} calls)...`);
  
  // Sort: Tier A first, then by most stale cache
  const enrichOrder = [...watchlist.artists].sort((a, b) => {
    if (a.tier === 'A' && b.tier !== 'A') return -1;
    if (b.tier === 'A' && a.tier !== 'A') return 1;
    const aCacheAge = cache[a.name.toLowerCase()]?._cachedAt ? Date.now() - new Date(cache[a.name.toLowerCase()]._cachedAt).getTime() : Infinity;
    const bCacheAge = cache[b.name.toLowerCase()]?._cachedAt ? Date.now() - new Date(cache[b.name.toLowerCase()]._cachedAt).getTime() : Infinity;
    return bCacheAge - aCacheAge;
  });

  for (const a of enrichOrder) {
    const cacheKey = a.name.toLowerCase();
    const cached = cache[cacheKey];
    const hasData = cached && cached.monthlyListeners;
    
    let stats;
    if (braveCallCount < MAX_BRAVE_CALLS && !hasData) {
      // Fresh Brave scan
      process.stdout.write(`  🌐 ${a.name}...`);
      stats = await getArtistStats(a.name);
      cache[cacheKey] = { ...stats, _cachedAt: new Date().toISOString() };
      const ml = stats.monthlyListeners ? `${(stats.monthlyListeners/1000000).toFixed(1)}M` : '?';
      console.log(` ${ml} listeners | ${stats.soldOutMentions} sold-outs`);
    } else if (hasData) {
      stats = cached;
      process.stdout.write(`  📦 ${a.name} (cached)...`);
      console.log(` ${(stats.monthlyListeners/1000000).toFixed(1)}M`);
    } else {
      // Budget exhausted, no cache
      stats = {};
      console.log(`  ⏭️ ${a.name} (skipped — budget exhausted)`);
    }

    const td = tourMap[a.name] || { upcoming: 0, events: [] };
    const result = {
      name: a.name, tier: a.tier, genre: a.genre || a.type,
      source: 'watchlist',
      monthlyListeners: stats.monthlyListeners || null,
      spotifyFollowers: stats.spotifyFollowers || null,
      instagramFollowers: stats.instagramFollowers || null,
      tiktokFollowers: stats.tiktokFollowers || null,
      twitterFollowers: stats.twitterFollowers || null,
      youtubeSubscribers: stats.youtubeSubscribers || null,
      albumCount: stats.albumCount || null,
      soldOutMentions: stats.soldOutMentions || 0,
      soldOutSnippets: stats.soldOutSnippets || [],
      upcomingShows: td.upcoming,
      tourDates: td.events
    };
    result.score = scoreArtist(result);
    results.push(result);
  }

  // Save cache
  fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2));

  // Sort by score
  results.sort((a, b) => b.score - a.score);

  // Save
  if (!fs.existsSync(DOCS_DATA_DIR)) fs.mkdirSync(DOCS_DATA_DIR, { recursive: true });
  const output = {
    scanDate: new Date().toISOString().split('T')[0],
    scanTime: new Date().toISOString(),
    watchlistCount: results.length,
    braveCallsUsed: braveCallCount,
    artists: results
  };
  fs.writeFileSync(path.join(DOCS_DATA_DIR, 'rising-stars.json'), JSON.stringify(output, null, 2));

  console.log('\n' + '='.repeat(50));
  console.log(`🏴‍☠️ ENRICHMENT COMPLETE — ${results.length} artists scored`);
  console.log(`  Brave calls used: ${braveCallCount}/${MAX_BRAVE_CALLS}`);

  console.log('\n🌟 TOP 20:');
  for (const a of results.slice(0, 20)) {
    const ml = a.monthlyListeners ? (a.monthlyListeners >= 1000000 ? `${(a.monthlyListeners/1000000).toFixed(1)}M` : `${Math.round(a.monthlyListeners/1000)}K`) : '?';
    console.log(`  ${String(a.score).padStart(3)}/100 | ${a.tier} | ${a.name.padEnd(25)} | ${ml.padStart(6)} listeners | ${a.upcomingShows||0} shows | ${a.soldOutMentions||0} sold-outs`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
