#!/usr/bin/env node
/**
 * Blackbeard Playlist & Music Blog Discovery Scanner v2.0
 * 
 * TWO discovery methods, both API-efficient:
 * 
 * 1. Spotify editorial playlists via embed scraping (FREE - 0 API calls)
 *    - Scrapes 14 playlists, finds artists on 2+ playlists
 * 
 * 2. Music blog/site scanning via Brave Search (~15 queries total)
 *    - Searches major music sites for "breaking out" / "rising" / "ones to watch"
 *    - One query = dozens of artist names extracted
 * 
 * Combined: discovers 50+ rising artists for ~15 Brave calls
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');

const BRAVE_API_KEY = process.env.BRAVE_API_KEY;
const SEATGEEK_CLIENT_ID = process.env.SEATGEEK_CLIENT_ID;

const DATA_DIR = path.join(__dirname, '..', 'data');
const DOCS_DATA_DIR = path.join(__dirname, '..', 'docs', 'data');
const CACHE_FILE = path.join(DATA_DIR, 'discovery-cache.json');

const sleep = ms => new Promise(r => setTimeout(r, ms));
let braveCallCount = 0;

// Big names to filter
const MAINSTREAM_FILTER = new Set([
  'bruno mars', 'lana del rey', 'blackpink', 'a$ap rocky', 'baby keem',
  'lil baby', 'don toliver', 'dababy', 'drake', 'taylor swift', 'beyonce',
  'the weeknd', 'bad bunny', 'dua lipa', 'ed sheeran', 'post malone',
  'travis scott', 'kanye west', 'ye', 'kendrick lamar', 'sza', 'doja cat',
  'billie eilish', 'olivia rodrigo', 'harry styles', 'ariana grande',
  'j balvin', 'timbaland', 'robyn', 'doechii', 'yeat', 'melanie martinez',
  'gorillaz', 'james blake', 'thundercat', 'fred again..', 'laufey',
  'mitski', 'raye', 'brent faiyaz', 'summer walker', 'kehlani',
  'bryson tiller', 'daniel caesar', 'bleachers', 'swae lee', 'kaskade',
  'ive', 'john summit', 'pinkpantheress', 'wet leg', 'courtney barnett',
  'snail mail', 'arlo parks', 'lykke li', 'perfume genius', 'american football',
  'adele', 'coldplay', 'imagine dragons', 'maroon 5', 'twenty one pilots',
  'the 1975', 'arctic monkeys', 'tame impala', 'mac demarco'
]);

// ============================================================
// PART 1: Spotify Playlist Scraping (FREE)
// ============================================================

const PLAYLISTS = [
  { id: '37i9dQZF1DWUa8ZRTfalHk', name: 'Pop Rising' },
  { id: '37i9dQZF1DWWBHeXOYZf74', name: 'Rock Rising' },
  { id: '37i9dQZF1DX8tZsk68tuDw', name: 'Dance Rising' },
  { id: '37i9dQZF1DWUVpAXiEPK8P', name: 'Hot Country' },
  { id: '37i9dQZF1DX2Nc3B70tvx0', name: 'All New Indie' },
  { id: '37i9dQZF1DX4JAvHpjipBk', name: 'New Music Friday' },
  { id: '37i9dQZF1DX4dyzvuaRJ0n', name: 'mint (Electronic)' },
  { id: '37i9dQZF1DXdbXrPNafg9d', name: 'Pollen' },
  { id: '37i9dQZF1DX2RxBh64BHjQ', name: 'Most Necessary' },
  { id: '37i9dQZF1DX4SBhb3fqCJd', name: 'Are & Be' },
  { id: '37i9dQZF1DWXRqgorJj26U', name: 'Fresh Finds' },
  { id: '37i9dQZF1DX6J5NfMJS675', name: 'Anti Pop' },
  { id: '37i9dQZF1DX0XUsuxWHRQd', name: 'Rap Caviar' },
  { id: '37i9dQZF1DX10zKzsJ2jva', name: 'Viva Latino' },
];

async function scrapePlaylist(id) {
  try {
    const r = await fetch(`https://open.spotify.com/embed/playlist/${id}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' }
    });
    const html = await r.text();
    const m = html.match(/<script id="__NEXT_DATA__"[^>]*>(.*?)<\/script>/s);
    if (!m) return [];
    const nd = JSON.parse(m[1]);
    return nd.props?.pageProps?.state?.data?.entity?.trackList || [];
  } catch { return []; }
}

async function scanPlaylists() {
  console.log('📋 Scanning Spotify editorial playlists (FREE)...');
  const artistMap = new Map();
  
  for (const pl of PLAYLISTS) {
    process.stdout.write(`  🎵 ${pl.name}...`);
    const tracks = await scrapePlaylist(pl.id);
    for (const t of tracks) {
      const artist = t.subtitle?.split(',')[0]?.trim();
      if (!artist || MAINSTREAM_FILTER.has(artist.toLowerCase())) continue;
      if (artistMap.has(artist)) {
        artistMap.get(artist).playlists.add(pl.name);
      } else {
        artistMap.set(artist, { name: artist, playlists: new Set([pl.name]) });
      }
    }
    console.log(` ${tracks.length} tracks`);
    await sleep(400);
  }
  
  return [...artistMap.values()]
    .map(a => ({ ...a, playlists: [...a.playlists], playlistCount: a.playlists.size }))
    .filter(a => a.playlistCount >= 2)
    .sort((a, b) => b.playlistCount - a.playlistCount);
}

// ============================================================
// PART 2: Music Blog Discovery (~15 Brave queries)
// ============================================================

async function braveSearch(query) {
  braveCallCount++;
  try {
    const r = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=10`, {
      headers: { 'X-Subscription-Token': BRAVE_API_KEY, 'Accept': 'application/json' }
    });
    if (r.status !== 200) return null;
    return r.json();
  } catch { return null; }
}

// ---- TOP 15 MUSIC PUBLICATIONS ----
// Each publication runs annual "artists to watch" lists naming 10-50 artists.
// One Brave query per pub = massive discovery ROI.
const MUSIC_PUBS = [
  { site: 'pitchfork.com', name: 'Pitchfork' },
  { site: 'nme.com', name: 'NME' },
  { site: 'stereogum.com', name: 'Stereogum' },
  { site: 'consequence.net', name: 'Consequence of Sound' },
  { site: 'thefader.com', name: 'The FADER' },
  { site: 'billboard.com', name: 'Billboard' },
  { site: 'clashmusic.com', name: 'Clash Magazine' },
  { site: 'atwoodmagazine.com', name: 'Atwood Magazine' },
  { site: 'onestowatch.com', name: 'Ones To Watch' },
  { site: 'complex.com', name: 'Complex' },
  { site: 'rollingstone.com', name: 'Rolling Stone' },
  { site: 'diymag.com', name: 'DIY Magazine' },
  { site: 'thelineofbestfit.com', name: 'Line of Best Fit' },
  { site: 'pastemagazine.com', name: 'Paste Magazine' },
  { site: 'stilllisteningmagazine.com', name: 'Still Listening' },
];

// --- DAILY queries (demand signals — 5 Brave calls) ---
const DAILY_QUERIES = [
  'concert "sold out" "added dates" OR "venue upgrade" 2026',
  '"first headlining tour" 2026 sold out tickets',
  '"selling fast" OR "ticket demand" emerging artist tour 2026',
  'EDM OR indie OR rapper OR country "breaking out" 2026 tour sold out',
  'Coachella OR Bonnaroo OR Lollapalooza 2026 undercard "ones to watch" OR "breakout"',
];

// --- WEEKLY queries (publication sweep — 20 Brave calls, run on Mondays) ---
const WEEKLY_QUERIES = [
  ...MUSIC_PUBS.map(p => `site:${p.site} "artists to watch" OR "ones to watch" OR "rising" OR "emerging" 2026`),
  // Genre roundups
  'EDM DJ "rising star" OR "ones to watch" 2026 tour',
  'indie band "rising" OR "artists to watch" 2026 tour',
  'rapper "next up" OR "ones to watch" 2026',
  'country "rising star" OR "artists to watch" 2026',
  'comedian "selling out" OR "breaking out" 2026 tour',
];

// Choose which queries to run based on day of week
function getDiscoveryQueries() {
  const dayOfWeek = new Date().getDay(); // 0=Sun, 1=Mon
  if (dayOfWeek === 1) {
    // Monday: full sweep (publications + daily)
    console.log('  📅 Monday — running FULL publication sweep + daily signals');
    return [...WEEKLY_QUERIES, ...DAILY_QUERIES];
  } else {
    // Other days: just demand signals
    console.log('  📅 Daily mode — demand signals only');
    return DAILY_QUERIES;
  }
}

// For backward compat
const DISCOVERY_QUERIES = DAILY_QUERIES;

function extractArtistNames(text, title) {
  const names = new Set();
  const fullText = `${title || ''} ${text || ''}`;
  
  // Common noise words that aren't artist names
  const NOISE = new Set([
    'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'her', 'was',
    'one', 'our', 'out', 'new', 'has', 'his', 'how', 'its', 'may', 'who', 'did',
    'get', 'got', 'let', 'say', 'she', 'too', 'use', 'way', 'many', 'some', 'than',
    'them', 'then', 'what', 'when', 'will', 'with', 'from', 'have', 'been', 'more',
    'also', 'back', 'been', 'here', 'just', 'like', 'make', 'made', 'much', 'over',
    'such', 'take', 'that', 'this', 'very', 'well', 'were', 'year', 'your', 'best',
    'artists', 'artist', 'watch', 'music', 'emerging', 'rising', 'ones', 'list',
    'features', 'feature', 'album', 'albums', 'track', 'tracks', 'song', 'songs',
    'tour', 'tours', 'concert', 'concerts', 'tickets', 'ticket', 'festival',
    'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august',
    'september', 'october', 'november', 'december', 'read', 'more', 'click',
    'south', 'north', 'east', 'west', 'united', 'states', 'based', 'born',
    'debut', 'released', 'release', 'latest', 'first', 'last', 'next',
    'hype', 'audio', 'inception', 'define', 'could', 'future', 'world',
    'check', 'listen', 'spotify', 'apple', 'youtube', 'instagram', 'tiktok'
  ]);
  
  function isValidName(name) {
    if (!name || name.length < 2 || name.length > 35) return false;
    if (MAINSTREAM_FILTER.has(name.toLowerCase())) return false;
    const words = name.toLowerCase().split(/\s+/);
    if (words.length === 1 && NOISE.has(words[0])) return false;
    if (words.every(w => NOISE.has(w))) return false;
    // Must have at least one capitalized word or be all-caps (DJ names)
    if (!/[A-Z]/.test(name) && !/^[A-Z0-9\s]+$/.test(name)) return false;
    return true;
  }
  
  // Pattern 1: Comma-separated lists (very common in "artists to watch" articles)
  // "includes After, Jalen Ngonda, Mon Rovîa, Karri, Violet Grohl"
  const listPatterns = [
    /(?:include|including|featuring|like|such as|profiles?|spotlights?|picks?)[:\s]+([^.]+)/gi,
    /(?:artists?|acts?|musicians?|performers?)[:\s]+([A-Z][^.]{10,200})/gi,
  ];
  for (const pat of listPatterns) {
    let m;
    while ((m = pat.exec(fullText)) !== null) {
      const list = m[1];
      // Split on commas, semicolons, " and ", " & "
      const parts = list.split(/,|;|\band\b|\b&\b/).map(s => s.trim()).filter(Boolean);
      for (const part of parts) {
        // Clean up: remove leading articles, trailing context
        const clean = part
          .replace(/^(the|a|an)\s+/i, '')
          .replace(/\s+(is|are|was|were|has|have|who|whose|with|from|on|at|in|for|to|and|the|–|—|\|).*/i, '')
          .trim();
        if (isValidName(clean)) names.add(clean);
      }
    }
  }
  
  // Pattern 2: "Artist Name" in bold or quoted
  const boldPattern = /<strong>([^<]+)<\/strong>/gi;
  let bm;
  while ((bm = boldPattern.exec(fullText)) !== null) {
    const name = bm[1].trim();
    if (isValidName(name)) names.add(name);
  }
  
  // Pattern 3: Names followed by musical context
  const contextPatterns = [
    /(?:^|[.!,;]\s*)([A-Z][a-zA-Zé']+(?:\s+[A-Z][a-zA-Zé']+){0,3})\s+(?:sold out|selling fast|added dates|venue upgrade|headlin|broke out|breakout|debut|released)/gi,
    /(?:singer|rapper|DJ|producer|band|duo|trio|songwriter|vocalist|artist)\s+([A-Z][a-zA-Zé']+(?:\s+[A-Z][a-zA-Zé']+){0,2})/gi,
    /([A-Z][a-zA-Zé']+(?:\s+[A-Z][a-zA-Zé']+){0,2})\s+(?:is\s+(?:a\s+)?(?:rising|emerging|breakout|up-and-coming))/gi,
  ];
  for (const pat of contextPatterns) {
    let m;
    while ((m = pat.exec(fullText)) !== null) {
      const name = m[1]?.trim();
      if (isValidName(name)) names.add(name);
    }
  }
  
  // Pattern 4: Title parsing — "Artists to Watch: Name1, Name2, Name3"
  if (title) {
    const titleList = title.match(/[:–—|]\s*(.+)/);
    if (titleList) {
      const parts = titleList[1].split(/,|;|\band\b|\b&\b/).map(s => s.trim());
      for (const part of parts) {
        const clean = part.replace(/\s+(more|\.{3}|…).*/i, '').trim();
        if (isValidName(clean)) names.add(clean);
      }
    }
  }
  
  return [...names];
}

async function scanMusicBlogs() {
  const queries = getDiscoveryQueries();
  console.log(`\n🌐 Scanning music blogs & sites (${queries.length} Brave queries)...`);
  const artistMentions = new Map();
  
  for (let qi = 0; qi < queries.length; qi++) {
    const query = queries[qi];
    // Identify which publication this query targets
    const pubMatch = MUSIC_PUBS.find(p => query.includes(p.site));
    const pubName = pubMatch?.name || 'Web';
    process.stdout.write(`  🔎 ${pubName}: ${query.slice(0, 50)}...`);
    const results = await braveSearch(query);
    if (!results?.web?.results) { console.log(' ❌'); continue; }
    
    let found = 0;
    for (const r of results.web.results) {
      const text = r.description || '';
      const artists = extractArtistNames(text, r.title);
      
      for (const name of artists) {
        if (artistMentions.has(name)) {
          artistMentions.get(name).mentions++;
          artistMentions.get(name).sources.add(r.url?.split('/')[2] || 'unknown');
        } else {
          artistMentions.set(name, {
            name,
            mentions: 1,
            sources: new Set([r.url?.split('/')[2] || 'unknown']),
            snippets: [{ title: r.title, url: r.url, snippet: (r.description || '').slice(0, 150) }]
          });
        }
        found++;
      }
      
      // Also store the full result for manual review
      if (text.toLowerCase().includes('sold out') || text.toLowerCase().includes('venue upgrade') || text.toLowerCase().includes('added dates')) {
        // These results are gold even without artist extraction
      }
    }
    console.log(` ${found} artist mentions`);
    await sleep(300);
  }
  
  return [...artistMentions.values()]
    .map(a => ({ ...a, sources: [...a.sources], sourceCount: a.sources.size }))
    .sort((a, b) => b.mentions - a.mentions || b.sourceCount - a.sourceCount);
}

// ============================================================
// PART 3: Combine & Enrich (only NEW artists, using cache)
// ============================================================

function loadCache() {
  try { return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')); }
  catch { return { artists: {}, lastUpdated: null }; }
}

function saveCache(cache) {
  cache.lastUpdated = new Date().toISOString();
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
}

function parseNumber(str) {
  if (!str) return null;
  str = str.replace(/,/g, '').trim();
  const m = str.match(/([\d.]+)\s*(billion|B|million|M|thousand|K)?/i);
  if (!m) return null;
  let num = parseFloat(m[1]);
  const unit = (m[2] || '').toLowerCase();
  if (unit === 'billion' || unit === 'b') num *= 1000000000;
  else if (unit === 'million' || unit === 'm') num *= 1000000;
  else if (unit === 'thousand' || unit === 'k') num *= 1000;
  return Math.round(num);
}

async function enrichNewArtist(name) {
  // Single Brave query to get everything
  const q = await braveSearch(`"${name}" spotify monthly listeners instagram tiktok concert "sold out" tour 2026`);
  const stats = { monthlyListeners: null, instagramFollowers: null, tiktokFollowers: null, soldOutMentions: 0, albumCount: null };
  
  if (q?.web?.results) {
    for (const r of q.web.results) {
      const text = `${r.title} ${r.description || ''}`;
      if (!stats.monthlyListeners) {
        const m = text.match(/([\d,.]+)\s*(million|M|thousand|K)?\s*monthly\s*listeners?/i);
        if (m) stats.monthlyListeners = parseNumber(m[1] + ' ' + (m[2] || ''));
      }
      if (!stats.instagramFollowers) {
        const m = text.match(/instagram[^.]{0,30}?([\d,.]+)\s*(million|M|thousand|K)/i);
        if (m) stats.instagramFollowers = parseNumber(m[1] + ' ' + (m[2] || ''));
      }
      if (!stats.tiktokFollowers) {
        const m = text.match(/tiktok[^.]{0,30}?([\d,.]+)\s*(million|M|thousand|K)/i);
        if (m) stats.tiktokFollowers = parseNumber(m[1] + ' ' + (m[2] || ''));
      }
      if (/sold.out|sell.out|selling fast/i.test(text)) stats.soldOutMentions++;
      if (stats.albumCount === null) {
        const m = text.match(/(\d+)\s*(?:studio\s*)?albums?/i);
        if (m && parseInt(m[1]) <= 20) stats.albumCount = parseInt(m[1]);
      }
    }
  }
  return stats;
}

async function checkTourDates(name) {
  try {
    const r = await fetch(`https://api.seatgeek.com/2/events?q=${encodeURIComponent(name)}&per_page=10&sort=datetime_utc.asc&datetime_utc.gte=${new Date().toISOString().split('T')[0]}&client_id=${SEATGEEK_CLIENT_ID}`);
    if (r.status !== 200) return { upcoming: 0, events: [] };
    const data = await r.json();
    return {
      upcoming: data.events?.length || 0,
      events: (data.events || []).slice(0, 5).map(e => ({
        title: e.title, date: e.datetime_utc?.split('T')[0],
        venue: e.venue?.name, city: `${e.venue?.city}, ${e.venue?.state}`,
        capacity: e.venue?.capacity, avgPrice: e.stats?.average_price, url: e.url
      }))
    };
  } catch { return { upcoming: 0, events: [] }; }
}

function scoreArtist(a) {
  let score = 0;
  // Playlist presence
  if (a.playlistCount >= 4) score += 25;
  else if (a.playlistCount >= 3) score += 20;
  else if (a.playlistCount >= 2) score += 15;
  // Blog mentions
  if (a.blogMentions >= 3) score += 15;
  else if (a.blogMentions >= 2) score += 10;
  else if (a.blogMentions >= 1) score += 5;
  // Monthly listeners sweet spot
  const ml = a.monthlyListeners || 0;
  if (ml > 0 && ml <= 500000) score += 20;
  else if (ml <= 2000000) score += 12;
  else if (ml <= 5000000) score += 5;
  // Sold-outs
  if (a.soldOutMentions >= 3) score += 20;
  else if (a.soldOutMentions >= 1) score += 12;
  // Social
  if (a.tiktokFollowers > 500000) score += 5;
  if (a.instagramFollowers > 100000) score += 3;
  // Tour scarcity
  if (a.upcomingShows >= 1 && a.upcomingShows <= 5) score += 10;
  else if (a.upcomingShows === 0) score += 3;
  // Albums (new = good)
  if (a.albumCount >= 1 && a.albumCount <= 2) score += 8;
  return Math.min(100, score);
}

// --- Main ---

async function run() {
  console.log('🏴‍☠️ Blackbeard Discovery Scanner v2.0');
  console.log('='.repeat(50));
  
  const cache = loadCache();
  let watchlistNames = new Set();
  try {
    const wl = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'watchlist.json'), 'utf8'));
    watchlistNames = new Set(wl.artists.map(a => a.name.toLowerCase()));
  } catch {}
  
  // Phase 1: Playlists (FREE)
  const playlistArtists = await scanPlaylists();
  console.log(`\n  ✅ ${playlistArtists.length} artists on 2+ editorial playlists`);
  
  // Phase 2: Music blogs (~15 Brave calls)
  const blogArtists = await scanMusicBlogs();
  console.log(`\n  ✅ ${blogArtists.length} artists mentioned in music blogs`);
  
  // Phase 3: Merge & dedupe
  const merged = new Map();
  
  for (const a of playlistArtists) {
    merged.set(a.name.toLowerCase(), {
      name: a.name,
      playlists: a.playlists,
      playlistCount: a.playlistCount,
      blogMentions: 0,
      blogSources: [],
      onWatchlist: watchlistNames.has(a.name.toLowerCase()),
      source: 'playlist'
    });
  }
  
  for (const a of blogArtists) {
    const key = a.name.toLowerCase();
    if (merged.has(key)) {
      merged.get(key).blogMentions = a.mentions;
      merged.get(key).blogSources = a.sources;
      merged.get(key).source = 'playlist+blog';
    } else {
      merged.set(key, {
        name: a.name,
        playlists: [],
        playlistCount: 0,
        blogMentions: a.mentions,
        blogSources: a.sources,
        onWatchlist: watchlistNames.has(key),
        source: 'blog'
      });
    }
  }
  
  // Sort by combined signal strength
  const candidates = [...merged.values()]
    .sort((a, b) => (b.playlistCount * 3 + b.blogMentions) - (a.playlistCount * 3 + a.blogMentions));
  
  // Phase 4: Enrich only NEW artists not in cache (saves API calls)
  console.log('\n🔍 Phase 4: Enriching new discoveries (1 Brave call each)...');
  const enriched = [];
  let enrichCount = 0;
  const MAX_ENRICH = 20; // Only enrich top 20 new ones
  
  for (const c of candidates) {
    const cacheKey = c.name.toLowerCase();
    const cached = cache.artists[cacheKey];
    const cacheAge = cached ? (Date.now() - new Date(cached.enrichedAt).getTime()) / (1000*60*60*24) : Infinity;
    
    let stats;
    if (cached && cacheAge < 7) {
      // Use cached data (less than 7 days old)
      stats = cached;
    } else if (enrichCount < MAX_ENRICH) {
      // Fresh enrichment
      process.stdout.write(`  🆕 ${c.name}...`);
      stats = await enrichNewArtist(c.name);
      const tour = await checkTourDates(c.name);
      stats.upcomingShows = tour.upcoming;
      stats.tourDates = tour.events;
      stats.enrichedAt = new Date().toISOString();
      cache.artists[cacheKey] = stats;
      enrichCount++;
      
      const ml = stats.monthlyListeners ? `${(stats.monthlyListeners/1000000).toFixed(1)}M` : '?';
      console.log(` ${ml} listeners | ${stats.soldOutMentions} sold-outs | ${tour.upcoming} shows`);
      await sleep(300);
    } else {
      stats = {};
    }
    
    const result = {
      ...c,
      monthlyListeners: stats.monthlyListeners || null,
      instagramFollowers: stats.instagramFollowers || null,
      tiktokFollowers: stats.tiktokFollowers || null,
      soldOutMentions: stats.soldOutMentions || 0,
      albumCount: stats.albumCount || null,
      upcomingShows: stats.upcomingShows || 0,
      tourDates: stats.tourDates || []
    };
    result.risingStarScore = scoreArtist(result);
    enriched.push(result);
  }
  
  enriched.sort((a, b) => b.risingStarScore - a.risingStarScore);
  saveCache(cache);
  
  // Save output
  if (!fs.existsSync(DOCS_DATA_DIR)) fs.mkdirSync(DOCS_DATA_DIR, { recursive: true });
  
  const output = {
    scanDate: new Date().toISOString().split('T')[0],
    scanTime: new Date().toISOString(),
    playlistsScanned: PLAYLISTS.length,
    blogQueriesUsed: DISCOVERY_QUERIES.length,
    braveCallsUsed: braveCallCount,
    totalCandidates: candidates.length,
    enrichedCount: enrichCount,
    artists: enriched.slice(0, 100) // Top 100
  };
  
  fs.writeFileSync(path.join(DOCS_DATA_DIR, 'playlist-discoveries.json'), JSON.stringify(output, null, 2));
  
  // Summary
  const breakouts = enriched.filter(a => a.risingStarScore >= 45);
  const newFinds = enriched.filter(a => !a.onWatchlist && a.risingStarScore >= 20);
  
  console.log('\n' + '='.repeat(50));
  console.log('🏴‍☠️ DISCOVERY COMPLETE');
  console.log(`  Playlist artists (2+): ${playlistArtists.length} (FREE)`);
  console.log(`  Blog mentions: ${blogArtists.length} (~${DISCOVERY_QUERIES.length} Brave calls)`);
  console.log(`  New enrichments: ${enrichCount} (~${enrichCount} Brave calls)`);
  console.log(`  Total Brave calls: ${braveCallCount}`);
  console.log(`  Breakouts (≥45): ${breakouts.length}`);
  console.log(`  New discoveries: ${newFinds.length}`);
  
  console.log('\n🌟 TOP 20 DISCOVERIES:');
  for (const a of enriched.slice(0, 20)) {
    const ml = a.monthlyListeners ? `${(a.monthlyListeners/1000000).toFixed(1)}M` : '?';
    const wl = a.onWatchlist ? ' 📋' : ' 🆕';
    const pls = a.playlistCount ? `${a.playlistCount} playlists` : '';
    const blogs = a.blogMentions ? `${a.blogMentions} blog mentions` : '';
    const signals = [pls, blogs].filter(Boolean).join(', ');
    console.log(`  ${a.risingStarScore}/100 | ${a.name}${wl} | ${signals} | ${ml} listeners | ${a.upcomingShows} shows`);
  }
  
  return { enriched, breakouts, newFinds };
}

function formatDiscordAlert(results) {
  const { enriched, breakouts, newFinds } = results;
  let msg = '📋 **DISCOVERY SCAN** 📋\n\n';
  
  if (breakouts.length) {
    msg += '🚨 **BREAKOUT SIGNALS:**\n';
    for (const b of breakouts.slice(0, 8)) {
      const ml = b.monthlyListeners ? `${(b.monthlyListeners/1000000).toFixed(1)}M listeners` : '';
      const signals = [];
      if (b.playlistCount) signals.push(`${b.playlistCount} playlists`);
      if (b.blogMentions) signals.push(`${b.blogMentions} blog mentions`);
      if (b.soldOutMentions) signals.push(`${b.soldOutMentions} sold-outs`);
      const wl = b.onWatchlist ? ' 📋' : ' 🆕';
      msg += `> 🔥 **${b.name}**${wl} — **${b.risingStarScore}**/100 | ${signals.join(' | ')} | ${ml}\n`;
    }
    msg += '\n';
  }
  
  if (newFinds.length) {
    msg += `🆕 **${newFinds.length} NEW discoveries** — consider adding to watchlist\n`;
  }
  
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
