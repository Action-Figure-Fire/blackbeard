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
  if (dayOfWeek === 0) {
    // Sunday: full sweep (publications + daily)
    console.log('  📅 Sunday — running FULL publication sweep + daily signals');
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

// ============================================================
// VETTING PIPELINE — the money maker
// 
// An artist MUST pass multiple hard checks to be flagged:
// 1. PROOF of demand (sold-out shows, venue upgrades, added dates)
// 2. REAL numbers (Spotify listeners, social followers)  
// 3. MOMENTUM (big single, viral moment, playlist placement)
//
// Tiers after vetting:
//   🔴 RED HOT — sold out + big numbers + momentum (BUY NOW)
//   🟡 WARM    — 2 of 3 signals confirmed (WATCH CLOSELY)
//   ⚪ UNVETTED — found in publications but no hard proof yet
// ============================================================

async function vetArtist(name) {
  // Query 1: Spotify + social numbers
  const q1 = await braveSearch(`"${name}" spotify monthly listeners followers`);
  const stats = {
    monthlyListeners: null, spotifyFollowers: null,
    instagramFollowers: null, tiktokFollowers: null, youtubeSubscribers: null,
    soldOutMentions: 0, soldOutSnippets: [],
    venueUpgrades: 0, addedDates: 0,
    bigSingle: null, viralMoment: null,
    albumCount: null, latestRelease: null,
    vetScore: 0, vetTier: 'unvetted', vetSignals: []
  };
  
  if (q1?.web?.results) {
    for (const r of q1.web.results) {
      const text = `${r.title} ${r.description || ''}`;
      // Monthly listeners
      if (!stats.monthlyListeners) {
        const m = text.match(/([\d,.]+)\s*(million|M|thousand|K)?\s*monthly\s*listeners?/i);
        if (m) stats.monthlyListeners = parseNumber(m[1] + ' ' + (m[2] || ''));
      }
      // Spotify followers
      if (!stats.spotifyFollowers) {
        const m = text.match(/([\d,.]+)\s*(million|M|thousand|K)?\s*followers/i);
        if (m) stats.spotifyFollowers = parseNumber(m[1] + ' ' + (m[2] || ''));
      }
      // Instagram
      if (!stats.instagramFollowers) {
        const m = text.match(/instagram[^.]{0,40}?([\d,.]+)\s*(million|M|thousand|K)/i) || text.match(/([\d,.]+)\s*(million|M|thousand|K)[^.]{0,40}?instagram/i);
        if (m) stats.instagramFollowers = parseNumber(m[1] + ' ' + (m[2] || ''));
      }
      // TikTok
      if (!stats.tiktokFollowers) {
        const m = text.match(/tiktok[^.]{0,40}?([\d,.]+)\s*(million|M|thousand|K)/i) || text.match(/([\d,.]+)\s*(million|M|thousand|K)[^.]{0,40}?tiktok/i);
        if (m) stats.tiktokFollowers = parseNumber(m[1] + ' ' + (m[2] || ''));
      }
      // YouTube
      if (!stats.youtubeSubscribers) {
        const m = text.match(/youtube[^.]{0,40}?([\d,.]+)\s*(million|M|thousand|K)/i) || text.match(/([\d,.]+)\s*(million|M|thousand|K)[^.]{0,40}?(?:youtube|subscribers)/i);
        if (m) stats.youtubeSubscribers = parseNumber(m[1] + ' ' + (m[2] || ''));
      }
      // Albums
      if (stats.albumCount === null) {
        const m = text.match(/(\d+)\s*(?:studio\s*)?albums?/i);
        if (m && parseInt(m[1]) <= 20) stats.albumCount = parseInt(m[1]);
      }
    }
  }
  await sleep(250);
  
  // Query 2: Demand proof — sold out, venue upgrades, added dates, viral
  const q2 = await braveSearch(`"${name}" "sold out" OR "venue upgrade" OR "added dates" OR "selling fast" OR "viral" concert tour 2025 OR 2026`);
  if (q2?.web?.results) {
    for (const r of q2.web.results) {
      const text = `${r.title} ${r.description || ''}`.toLowerCase();
      if (text.includes('sold out') || text.includes('sell out') || text.includes('sold-out')) {
        stats.soldOutMentions++;
        stats.soldOutSnippets.push({ title: r.title, snippet: (r.description || '').slice(0, 150), url: r.url });
      }
      if (text.includes('venue upgrade') || text.includes('upgraded venue') || text.includes('moved to a larger')) {
        stats.venueUpgrades++;
        stats.vetSignals.push('🏟️ Venue upgrade detected');
      }
      if (text.includes('added dates') || text.includes('additional dates') || text.includes('second show') || text.includes('added a second')) {
        stats.addedDates++;
        stats.vetSignals.push('📅 Added dates due to demand');
      }
      if (text.includes('viral') || text.includes('blew up') || text.includes('went viral')) {
        stats.viralMoment = (r.description || '').slice(0, 150);
        stats.vetSignals.push('📱 Viral moment detected');
      }
      // Big single detection
      if (text.match(/(\d+)\s*(million|M|billion|B)\s*(streams?|plays?|views?)/i)) {
        const sm = text.match(/(\d+)\s*(million|M|billion|B)\s*(streams?|plays?|views?)/i);
        if (sm) {
          stats.bigSingle = `${sm[1]}${sm[2]} ${sm[3]}`;
          stats.vetSignals.push(`🎵 Big single: ${stats.bigSingle}`);
        }
      }
    }
  }
  await sleep(250);
  
  // === VET SCORING ===
  // Four pillars: DEMAND + NUMBERS + MOMENTUM + RESALE PRICING
  
  let demandScore = 0;  // Max 40
  let numbersScore = 0; // Max 35
  let momentumScore = 0; // Max 25
  
  // DEMAND (hardest signal — proves people will pay)
  if (stats.soldOutMentions >= 3) demandScore += 25;
  else if (stats.soldOutMentions >= 2) demandScore += 18;
  else if (stats.soldOutMentions >= 1) demandScore += 12;
  if (stats.venueUpgrades >= 1) demandScore += 8;
  if (stats.addedDates >= 1) demandScore += 7;
  demandScore = Math.min(40, demandScore);
  
  // NUMBERS (proves real audience, not just hype)
  const ml = stats.monthlyListeners || 0;
  if (ml >= 1000000) numbersScore += 15;
  else if (ml >= 500000) numbersScore += 12;
  else if (ml >= 100000) numbersScore += 8;
  else if (ml >= 50000) numbersScore += 4;
  
  const totalSocial = (stats.instagramFollowers || 0) + (stats.tiktokFollowers || 0) + (stats.youtubeSubscribers || 0);
  if (totalSocial >= 2000000) numbersScore += 12;
  else if (totalSocial >= 500000) numbersScore += 8;
  else if (totalSocial >= 100000) numbersScore += 5;
  
  const socialPlatforms = [stats.instagramFollowers, stats.tiktokFollowers, stats.youtubeSubscribers].filter(Boolean).length;
  if (socialPlatforms >= 2) numbersScore += 8;
  numbersScore = Math.min(35, numbersScore);
  
  // MOMENTUM (timing signal — are they peaking RIGHT NOW?)
  if (stats.bigSingle) momentumScore += 12;
  if (stats.viralMoment) momentumScore += 10;
  // Playlist presence counts as momentum (Spotify is pushing them)
  // (playlistCount will be added by the caller)
  momentumScore = Math.min(25, momentumScore);
  
  stats.vetScore = demandScore + numbersScore + momentumScore;
  stats.demandScore = demandScore;
  stats.numbersScore = numbersScore;
  stats.momentumScore = momentumScore;
  
  // RESALE PRICING will be applied by the caller after checkTourDates()
  // See applyPricingToVet() below
  
  // Base tier assignment (pricing will adjust)
  if (stats.vetScore >= 50 && demandScore >= 15) stats.vetTier = 'red_hot';
  else if (stats.vetScore >= 30 && (demandScore >= 10 || numbersScore >= 15)) stats.vetTier = 'warm';
  else stats.vetTier = 'unvetted';
  
  // Add summary signals
  if (stats.monthlyListeners) stats.vetSignals.unshift(`🎧 ${(stats.monthlyListeners/1000000).toFixed(1)}M Spotify listeners`);
  if (stats.soldOutMentions) stats.vetSignals.unshift(`🔥 ${stats.soldOutMentions} sold-out mentions`);
  if (stats.instagramFollowers) stats.vetSignals.push(`📸 IG: ${(stats.instagramFollowers/1000).toFixed(0)}K`);
  if (stats.tiktokFollowers) stats.vetSignals.push(`🎵 TT: ${(stats.tiktokFollowers/1000000).toFixed(1)}M`);
  
  return stats;
}

// Apply SeatGeek pricing data to vet score
function applyPricingToVet(stats, pricingSignal) {
  if (!pricingSignal || !pricingSignal.showsWithPricing) return;
  
  stats.pricingSignal = pricingSignal;
  
  if (pricingSignal.tier === 'premium') {
    // 💰💰💰 Avg get-in $150+ or 3+ shows over $100
    stats.demandScore = Math.min(40, (stats.demandScore || 0) + 15);
    stats.vetSignals.push(`💰 PREMIUM resale: avg get-in $${pricingSignal.avgGetIn} | ${pricingSignal.over100Count} shows over $100`);
  } else if (pricingSignal.tier === 'strong') {
    // 💰💰 Avg get-in $80+ or at least 1 show over $100
    stats.demandScore = Math.min(40, (stats.demandScore || 0) + 10);
    stats.vetSignals.push(`💰 Strong resale: avg get-in $${pricingSignal.avgGetIn} | ${pricingSignal.over100Count} shows over $100`);
  } else if (pricingSignal.tier === 'moderate') {
    // 💰 Avg get-in $40-80
    stats.vetSignals.push(`💲 Moderate resale: avg get-in $${pricingSignal.avgGetIn}`);
  } else if (pricingSignal.tier === 'weak' && stats.soldOutMentions >= 1) {
    // ⚠️ Sold out BUT cheap resale = DOWNGRADE (this is the key insight)
    stats.demandScore = Math.max(0, (stats.demandScore || 0) - 10);
    stats.vetSignals.push(`⚠️ WEAK resale despite sold-out claims: avg get-in $${pricingSignal.avgGetIn || '?'} — low flip potential`);
  }
  
  // Hot show callouts
  for (const hs of (pricingSignal.hotShows || []).slice(0, 3)) {
    stats.vetSignals.push(`🎟️ ${hs}`);
  }
  
  // Recalculate total + tier
  stats.vetScore = (stats.demandScore || 0) + (stats.numbersScore || 0) + (stats.momentumScore || 0);
  
  if (stats.vetScore >= 50 && (stats.demandScore || 0) >= 15) stats.vetTier = 'red_hot';
  else if (stats.vetScore >= 30 && ((stats.demandScore || 0) >= 10 || (stats.numbersScore || 0) >= 15)) stats.vetTier = 'warm';
  else stats.vetTier = 'unvetted';
}

async function checkTourDates(name) {
  try {
    const r = await fetch(`https://api.seatgeek.com/2/events?q=${encodeURIComponent(name)}&per_page=25&sort=datetime_utc.asc&datetime_utc.gte=${new Date().toISOString().split('T')[0]}&client_id=${SEATGEEK_CLIENT_ID}`);
    if (r.status !== 200) return { upcoming: 0, events: [], pricingSignal: null };
    const data = await r.json();
    if (!data?.events?.length) return { upcoming: 0, events: [], pricingSignal: null };
    
    const events = data.events.map(e => ({
      title: e.title, date: e.datetime_utc?.split('T')[0],
      venue: e.venue?.name, city: `${e.venue?.city}, ${e.venue?.state}`,
      capacity: e.venue?.capacity,
      lowestPrice: e.stats?.lowest_sg_base_price || e.stats?.lowest_price || null,
      avgPrice: e.stats?.average_price || null,
      highestPrice: e.stats?.highest_price || null,
      listingCount: e.stats?.listing_count || null,
      sgScore: e.score || null,
      url: e.url
    }));
    
    // === PRICING ANALYSIS ===
    const priced = events.filter(e => e.lowestPrice && e.lowestPrice > 0);
    const getIns = priced.map(e => e.lowestPrice);
    const avgs = priced.filter(e => e.avgPrice > 0).map(e => e.avgPrice);
    
    let pricingSignal = {
      showsWithPricing: priced.length,
      minGetIn: getIns.length ? Math.min(...getIns) : null,
      maxGetIn: getIns.length ? Math.max(...getIns) : null,
      avgGetIn: getIns.length ? Math.round(getIns.reduce((a, b) => a + b, 0) / getIns.length) : null,
      avgAvgPrice: avgs.length ? Math.round(avgs.reduce((a, b) => a + b, 0) / avgs.length) : null,
      over100Count: getIns.filter(p => p >= 100).length,
      over150Count: getIns.filter(p => p >= 150).length,
      hotShows: [] // Shows with get-in >= $100
    };
    
    // Flag hot shows (get-in >= $80)
    pricingSignal.hotShows = priced
      .filter(e => e.lowestPrice >= 80)
      .map(e => `${e.venue} (${e.city}) ${e.date} — $${e.lowestPrice} get-in / $${e.avgPrice || '?'} avg`);
    
    // Pricing tier
    if (pricingSignal.avgGetIn >= 150 || pricingSignal.over100Count >= 3) {
      pricingSignal.tier = 'premium'; // 💰💰💰
    } else if (pricingSignal.avgGetIn >= 80 || pricingSignal.over100Count >= 1) {
      pricingSignal.tier = 'strong';  // 💰💰
    } else if (pricingSignal.avgGetIn >= 40) {
      pricingSignal.tier = 'moderate'; // 💰
    } else {
      pricingSignal.tier = 'weak';    // ❌
    }
    
    return { upcoming: events.length, events: events.slice(0, 8), pricingSignal };
  } catch { return { upcoming: 0, events: [], pricingSignal: null }; }
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
  
  // Phase 4: VET candidates (2 Brave calls each — only top candidates)
  console.log('\n🔍 Phase 4: Vetting top candidates (2 Brave calls each)...');
  const enriched = [];
  let enrichCount = 0;
  const MAX_ENRICH = 25;
  
  for (const c of candidates) {
    const cacheKey = c.name.toLowerCase();
    const cached = cache.artists[cacheKey];
    const cacheAge = cached ? (Date.now() - new Date(cached.enrichedAt).getTime()) / (1000*60*60*24) : Infinity;
    
    let stats;
    if (cached && cacheAge < 7) {
      stats = cached;
    } else if (enrichCount < MAX_ENRICH) {
      process.stdout.write(`  🔬 ${c.name}...`);
      stats = await vetArtist(c.name);
      const tour = await checkTourDates(c.name);
      stats.upcomingShows = tour.upcoming;
      stats.tourDates = tour.events;
      stats.enrichedAt = new Date().toISOString();
      
      // Apply SeatGeek pricing (the money check)
      applyPricingToVet(stats, tour.pricingSignal);
      
      // Add playlist momentum to vet score
      if (c.playlistCount >= 3) { stats.momentumScore = Math.min(25, (stats.momentumScore || 0) + 15); stats.vetSignals.push(`📋 ${c.playlistCount} Spotify editorial playlists`); }
      else if (c.playlistCount >= 2) { stats.momentumScore = Math.min(25, (stats.momentumScore || 0) + 10); stats.vetSignals.push(`📋 ${c.playlistCount} editorial playlists`); }
      stats.vetScore = (stats.demandScore || 0) + (stats.numbersScore || 0) + (stats.momentumScore || 0);
      
      // Final tier with all data
      if (stats.vetScore >= 50 && (stats.demandScore || 0) >= 15) stats.vetTier = 'red_hot';
      else if (stats.vetScore >= 30 && ((stats.demandScore || 0) >= 10 || (stats.numbersScore || 0) >= 15)) stats.vetTier = 'warm';
      
      cache.artists[cacheKey] = stats;
      enrichCount++;
      
      const tier = stats.vetTier === 'red_hot' ? '🔴' : stats.vetTier === 'warm' ? '🟡' : '⚪';
      const ml = stats.monthlyListeners ? `${(stats.monthlyListeners/1000000).toFixed(1)}M` : '?';
      const price = tour.pricingSignal?.avgGetIn ? ` | $${tour.pricingSignal.avgGetIn} avg get-in` : '';
      console.log(` ${tier} ${stats.vetTier.toUpperCase()} | vet ${stats.vetScore}/100 | ${ml} listeners | ${stats.soldOutMentions} sold-outs | ${tour.upcoming} shows${price}`);
      await sleep(100);
    } else {
      stats = { vetTier: 'unvetted', vetScore: 0 };
    }
    
    const result = {
      ...c,
      ...stats,
      monthlyListeners: stats.monthlyListeners || null,
      instagramFollowers: stats.instagramFollowers || null,
      tiktokFollowers: stats.tiktokFollowers || null,
      soldOutMentions: stats.soldOutMentions || 0,
      albumCount: stats.albumCount || null,
      upcomingShows: stats.upcomingShows || 0,
      tourDates: stats.tourDates || [],
      vetTier: stats.vetTier || 'unvetted',
      vetScore: stats.vetScore || 0,
      vetSignals: stats.vetSignals || []
    };
    result.risingStarScore = scoreArtist(result);
    enriched.push(result);
  }
  
  // Sort by vet score (not discovery score — vetted picks first)
  enriched.sort((a, b) => b.vetScore - a.vetScore || b.risingStarScore - a.risingStarScore);
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
  
  // Summary — only show VETTED picks
  const redHot = enriched.filter(a => a.vetTier === 'red_hot');
  const warm = enriched.filter(a => a.vetTier === 'warm');
  const unvetted = enriched.filter(a => a.vetTier === 'unvetted');
  const newFinds = enriched.filter(a => !a.onWatchlist && a.vetScore >= 20);
  
  console.log('\n' + '='.repeat(50));
  console.log('🏴‍☠️ DISCOVERY + VETTING COMPLETE');
  console.log(`  Playlist artists (2+): ${playlistArtists.length} (FREE)`);
  console.log(`  Blog mentions: ${blogArtists.length}`);
  console.log(`  Vetted: ${enrichCount} artists`);
  console.log(`  Brave calls: ${braveCallCount}`);
  console.log(`  🔴 RED HOT: ${redHot.length}`);
  console.log(`  🟡 WARM: ${warm.length}`);
  console.log(`  ⚪ UNVETTED: ${unvetted.length}`);
  
  if (redHot.length) {
    console.log('\n🔴 RED HOT — CONFIRMED BREAKOUTS (buy signal):');
    for (const a of redHot) {
      console.log(`  🔥 ${a.name} | Vet ${a.vetScore}/100 (demand:${a.demandScore} numbers:${a.numbersScore} momentum:${a.momentumScore})`);
      for (const s of (a.vetSignals || [])) console.log(`     ${s}`);
    }
  }
  
  if (warm.length) {
    console.log('\n🟡 WARM — WATCH CLOSELY:');
    for (const a of warm.slice(0, 10)) {
      const ml = a.monthlyListeners ? `${(a.monthlyListeners/1000000).toFixed(1)}M` : '?';
      console.log(`  ⚡ ${a.name} | Vet ${a.vetScore}/100 | ${ml} listeners | ${a.soldOutMentions} sold-outs`);
      for (const s of (a.vetSignals || []).slice(0, 3)) console.log(`     ${s}`);
    }
  }
  
  return { enriched, redHot, warm, unvetted, newFinds };
}

function formatDiscordAlert(results) {
  const { redHot, warm, newFinds } = results;
  let msg = '📋 **DISCOVERY SCAN — VETTED PICKS** 📋\n\n';
  
  if (redHot.length) {
    msg += '🔴 **RED HOT — CONFIRMED BREAKOUTS:**\n';
    for (const a of redHot) {
      const ml = a.monthlyListeners ? `${(a.monthlyListeners/1000000).toFixed(1)}M listeners` : '';
      const signals = (a.vetSignals || []).slice(0, 4).join(' | ');
      const wl = a.onWatchlist ? ' 📋' : ' 🆕';
      msg += `> 🔥 **${a.name}**${wl} — Vet **${a.vetScore}**/100\n`;
      if (signals) msg += `>    ${signals}\n`;
    }
    msg += '\n';
  }
  
  if (warm.length) {
    msg += '🟡 **WARM — WATCH CLOSELY:**\n';
    for (const a of warm.slice(0, 8)) {
      const ml = a.monthlyListeners ? `${(a.monthlyListeners/1000000).toFixed(1)}M` : '?';
      const so = a.soldOutMentions ? ` | ${a.soldOutMentions} sold-outs` : '';
      const wl = a.onWatchlist ? ' 📋' : ' 🆕';
      msg += `> ⚡ **${a.name}**${wl} — Vet ${a.vetScore}/100 | ${ml} listeners${so}\n`;
    }
    msg += '\n';
  }
  
  if (!redHot.length && !warm.length) {
    msg += '⚪ No confirmed breakouts today — all candidates still unvetted.\n';
  }
  
  if (newFinds.length) {
    msg += `\n🆕 ${newFinds.length} new vetted discoveries not on watchlist yet`;
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
