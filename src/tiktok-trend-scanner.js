#!/usr/bin/env node
/**
 * TikTok Trend Scanner (Indirect)
 * 
 * Since TikTok killed the public API, we triangulate virality from:
 * 1. Brave Search: site:tiktok.com queries for artist buzz
 * 2. SerpAPI: Google Trends for search volume spikes
 * 3. Brave Search: "trending on tiktok" + "going viral" music queries
 * 4. Cross-reference with our watchlist for actionable alerts
 * 
 * Signals detected:
 * - Artist name + "tiktok" recent mentions
 * - "viral" + "trending" co-occurrence
 * - Google Trends search interest spikes
 * - New sound/song virality indicators
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');

const BRAVE_API_KEY = process.env.BRAVE_API_KEY;
const SERPAPI_KEY = process.env.SERPAPI_KEY;

const DATA_DIR = path.join(__dirname, '..', 'data');
const CACHE_FILE = path.join(DATA_DIR, 'tiktok-trend-cache.json');
const WATCHLIST_FILE = path.join(DATA_DIR, 'watchlist.json');
const RISING_STARS_FILE = path.join(__dirname, '..', 'docs', 'data', 'rising-stars.json');

// Budget: ~30 Brave calls + ~5 SerpAPI calls per run
const MAX_BRAVE_CALLS = 30;
const MAX_SERP_CALLS = 5;
const RATE_LIMIT_MS = 250;

let braveCallCount = 0;
let serpCallCount = 0;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function loadJSON(f) {
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); }
  catch { return null; }
}

function saveJSON(f, data) {
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(data, null, 2));
}

// ── Brave Search ──
async function braveSearch(query) {
  if (braveCallCount >= MAX_BRAVE_CALLS) return [];
  braveCallCount++;
  await sleep(RATE_LIMIT_MS);
  
  try {
    const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=10&freshness=pw`;
    const res = await fetch(url, {
      headers: { 'Accept': 'application/json', 'Accept-Encoding': 'gzip', 'X-Subscription-Token': BRAVE_API_KEY }
    });
    if (!res.ok) { console.error(`Brave ${res.status}: ${query}`); return []; }
    const data = await res.json();
    return (data.web?.results || []).map(r => ({
      title: r.title, url: r.url, description: r.description, published: r.age || null
    }));
  } catch (e) { console.error(`Brave error: ${e.message}`); return []; }
}

// ── SerpAPI Google Trends ──
async function googleTrends(keyword) {
  if (serpCallCount >= MAX_SERP_CALLS || !SERPAPI_KEY) return null;
  serpCallCount++;
  await sleep(RATE_LIMIT_MS);
  
  try {
    const url = `https://serpapi.com/search.json?engine=google_trends&q=${encodeURIComponent(keyword)}&date=today+1-m&api_key=${SERPAPI_KEY}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const points = data.interest_over_time?.timeline_data || [];
    if (!points.length) return null;
    
    const values = points.map(p => parseInt(p.values?.[0]?.extracted_value || 0));
    const recent = values.slice(-7); // last week
    const prior = values.slice(-14, -7); // week before
    const recentAvg = recent.reduce((a, b) => a + b, 0) / (recent.length || 1);
    const priorAvg = prior.reduce((a, b) => a + b, 0) / (prior.length || 1);
    const spike = priorAvg > 0 ? ((recentAvg - priorAvg) / priorAvg * 100).toFixed(0) : 0;
    const peak = Math.max(...values);
    
    return { recentAvg: Math.round(recentAvg), priorAvg: Math.round(priorAvg), spike: Number(spike), peak, dataPoints: values.length };
  } catch (e) { console.error(`SerpAPI error: ${e.message}`); return null; }
}

// ── Discovery: Find trending artists on TikTok ──
async function discoverTrending() {
  console.log('\n📱 Phase 1: Discovering trending artists on TikTok...');
  const discoveries = [];
  
  const discoveryQueries = [
    '"trending on tiktok" artist concert tour 2026',
    '"going viral" tiktok music artist tour tickets',
    '"blowing up on tiktok" musician concert',
    'tiktok viral song artist touring 2026',
    '"tiktok famous" artist sold out concert',
    'site:tiktok.com concert tickets viral artist 2026',
    '"broke out on tiktok" artist tour',
    'tiktok sound viral artist presale tickets',
  ];
  
  for (const q of discoveryQueries) {
    if (braveCallCount >= MAX_BRAVE_CALLS) break;
    const results = await braveSearch(q);
    
    for (const r of results) {
      const text = `${r.title} ${r.description}`.toLowerCase();
      // Extract artist names from context
      const artistMatch = extractArtistFromResult(r);
      if (artistMatch) {
        discoveries.push({
          artist: artistMatch,
          source: 'brave_discovery',
          query: q,
          title: r.title,
          snippet: r.description?.slice(0, 200),
          url: r.url,
          published: r.published
        });
      }
    }
  }
  
  console.log(`   Found ${discoveries.length} mentions across ${braveCallCount} Brave calls`);
  return discoveries;
}

// ── Extract artist names from search results ──
function extractArtistFromResult(result) {
  const text = `${result.title} ${result.description}`;
  
  // Skip noise
  const noise = ['taylor swift', 'bts', 'drake', 'beyonce', 'bad bunny', 'doja cat', 'olivia rodrigo', 
    'billie eilish', 'the weeknd', 'ed sheeran', 'harry styles', 'lady gaga', 'bruno mars',
    'ariana grande', 'justin bieber', 'post malone', 'dua lipa', 'sza', 'kanye', 'travis scott'];
  
  // Common patterns: "Artist Name" + context words
  const patterns = [
    /(?:artist|singer|musician|rapper|band|comedian)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})/,
    /([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})\s+(?:tour|concert|tickets|presale|sold out|trending|viral)/,
    /(?:trending|viral|blowing up).*?([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})/,
  ];
  
  for (const p of patterns) {
    const m = text.match(p);
    if (m && m[1] && m[1].length > 3 && !noise.includes(m[1].toLowerCase())) {
      return m[1].trim();
    }
  }
  return null;
}

// ── Check watchlist artists for TikTok buzz ──
async function scanWatchlistBuzz() {
  console.log('\n🔍 Phase 2: Checking watchlist artists for TikTok buzz...');
  
  const watchlist = loadJSON(WATCHLIST_FILE);
  const risingStars = loadJSON(RISING_STARS_FILE);
  if (!watchlist && !risingStars) { console.log('   No watchlist/rising-stars data'); return []; }
  
  // Get top-tier artists to check
  const artists = [];
  if (watchlist?.artists) {
    for (const a of watchlist.artists) {
      if (a.tier === 'A') artists.push(a.name);
    }
  }
  if (risingStars) {
    const rsArtists = risingStars.artists || (Array.isArray(risingStars) ? risingStars : []);
    const sorted = rsArtists.sort((a, b) => (b.score || 0) - (a.score || 0));
    for (const a of sorted.slice(0, 20)) {
      if (!artists.includes(a.name)) artists.push(a.name);
    }
  }
  
  // Sample a subset to stay in budget
  const sample = artists.slice(0, Math.min(artists.length, 12));
  console.log(`   Checking ${sample.length} artists for TikTok signals...`);
  
  const results = [];
  for (const artist of sample) {
    if (braveCallCount >= MAX_BRAVE_CALLS) break;
    
    const searchResults = await braveSearch(`"${artist}" tiktok viral trending 2026`);
    const mentions = searchResults.filter(r => {
      const text = `${r.title} ${r.description}`.toLowerCase();
      return text.includes('tiktok') && (text.includes('viral') || text.includes('trending') || text.includes('blowing up'));
    });
    
    if (mentions.length > 0) {
      results.push({
        artist,
        tiktokMentions: mentions.length,
        signals: mentions.map(m => ({
          title: m.title,
          snippet: m.description?.slice(0, 200),
          url: m.url
        }))
      });
      console.log(`   🔥 ${artist}: ${mentions.length} TikTok signal(s)`);
    }
  }
  
  return results;
}

// ── Google Trends spikes for top artists ──
async function checkTrendSpikes(trendingArtists) {
  console.log('\n📈 Phase 3: Google Trends spike detection...');
  
  // Combine discovered + watchlist artists, dedupe, take top candidates
  const candidates = [...new Set(trendingArtists.map(a => a.artist || a))].slice(0, MAX_SERP_CALLS);
  
  const spikes = [];
  for (const artist of candidates) {
    const trends = await googleTrends(artist);
    if (trends && trends.spike > 30) {
      spikes.push({ artist, ...trends });
      console.log(`   📈 ${artist}: +${trends.spike}% search interest spike (recent: ${trends.recentAvg}, prior: ${trends.priorAvg})`);
    }
  }
  
  return spikes;
}

// ── Main scan ──
async function run() {
  console.log('🎵 TikTok Trend Scanner (Indirect) starting...');
  console.log(`   Budget: ${MAX_BRAVE_CALLS} Brave + ${MAX_SERP_CALLS} SerpAPI calls`);
  
  const startTime = Date.now();
  const prevCache = loadJSON(CACHE_FILE) || { lastScan: null, discoveries: [], watchlistBuzz: [], spikes: [], history: [] };
  
  // Phase 1: Discover trending artists
  const discoveries = await discoverTrending();
  
  // Phase 2: Check watchlist artists for TikTok buzz
  const watchlistBuzz = await scanWatchlistBuzz();
  
  // Phase 3: Google Trends spikes
  const trendCandidates = [
    ...discoveries.map(d => d.artist),
    ...watchlistBuzz.filter(w => w.tiktokMentions >= 2).map(w => w.artist)
  ];
  const spikes = await checkTrendSpikes([...new Set(trendCandidates)]);
  
  // Compile results
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  
  const scanResult = {
    lastScan: new Date().toISOString(),
    elapsed: `${elapsed}s`,
    apiCalls: { brave: braveCallCount, serpapi: serpCallCount },
    discoveries: dedupeDiscoveries(discoveries),
    watchlistBuzz,
    spikes,
    // Keep last 7 days of history
    history: [
      { date: new Date().toISOString().split('T')[0], discoveryCount: discoveries.length, buzzCount: watchlistBuzz.length, spikeCount: spikes.length },
      ...(prevCache.history || []).slice(0, 6)
    ]
  };
  
  saveJSON(CACHE_FILE, scanResult);
  
  console.log(`\n✅ TikTok Trend Scan complete in ${elapsed}s`);
  console.log(`   API calls: ${braveCallCount} Brave, ${serpCallCount} SerpAPI`);
  console.log(`   Discoveries: ${discoveries.length} | Watchlist buzz: ${watchlistBuzz.length} | Spikes: ${spikes.length}`);
  
  return scanResult;
}

function dedupeDiscoveries(discoveries) {
  const seen = new Map();
  for (const d of discoveries) {
    const key = d.artist.toLowerCase();
    if (!seen.has(key)) {
      seen.set(key, { ...d, mentionCount: 1 });
    } else {
      seen.get(key).mentionCount++;
    }
  }
  return [...seen.values()].sort((a, b) => b.mentionCount - a.mentionCount);
}

// ── Discord alert formatting ──
function formatDiscordAlert(results) {
  if (!results) return '';
  
  let msg = '📱 **TikTok Trend Scanner**\n';
  msg += `API: ${results.apiCalls?.brave || 0} Brave, ${results.apiCalls?.serpapi || 0} SerpAPI\n\n`;
  
  // Top discoveries
  if (results.discoveries?.length) {
    msg += '**🔥 Trending on TikTok:**\n';
    for (const d of results.discoveries.slice(0, 8)) {
      msg += `• **${d.artist}** — ${d.mentionCount} mention(s)`;
      if (d.snippet) msg += ` — _${d.snippet.slice(0, 100)}_`;
      msg += '\n';
    }
    msg += '\n';
  }
  
  // Watchlist buzz
  if (results.watchlistBuzz?.length) {
    msg += '**👀 Watchlist Artists with TikTok Buzz:**\n';
    for (const w of results.watchlistBuzz) {
      msg += `• **${w.artist}** — ${w.tiktokMentions} signal(s)\n`;
    }
    msg += '\n';
  }
  
  // Google Trends spikes
  if (results.spikes?.length) {
    msg += '**📈 Google Trends Spikes (TikTok-driven):**\n';
    for (const s of results.spikes) {
      msg += `• **${s.artist}** — +${s.spike}% search interest (peak: ${s.peak})\n`;
    }
    msg += '\n';
  }
  
  if (!results.discoveries?.length && !results.watchlistBuzz?.length && !results.spikes?.length) {
    msg += '_No significant TikTok signals detected this scan._\n';
  }
  
  return msg;
}

module.exports = { run, formatDiscordAlert };

if (require.main === module) {
  run().then(r => {
    console.log('\n' + formatDiscordAlert(r));
  }).catch(e => { console.error(e); process.exit(1); });
}
