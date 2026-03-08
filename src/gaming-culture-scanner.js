#!/usr/bin/env node
/**
 * Gaming & Culture Scanner
 * 
 * Tracks artists appearing in games, TV, and cultural moments that predict ticket demand:
 * 
 * 1. FORTNITE — Festival mode songs, Icon Series skins, in-game concerts
 *    (Travis Scott's Fortnite concert → 12M concurrent viewers → arena tour demand)
 * 2. ROCKET LEAGUE — Licensed soundtrack songs
 * 3. BEAT SABER — DLC music packs
 * 4. FIFA / EA FC — Soundtrack artists
 * 5. NBA 2K — Soundtrack artists
 * 6. GTA — Radio station additions
 * 7. TV/FILM SYNCS — Songs in Netflix, HBO, etc. (Stranger Things → Kate Bush)
 * 8. SATURDAY NIGHT LIVE — Musical guests (huge demand spike signal)
 * 9. LATE NIGHT TV — Fallon, Kimmel, Colbert, Seth Meyers musical guests
 * 10. AWARD SHOW PERFORMERS — Grammys, VMAs, etc.
 * 
 * Logic: If an artist gets a Fortnite skin or SNL booking, they're at peak cultural 
 * relevance → tour tickets will command premium secondary pricing
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');

const BRAVE_API_KEY = process.env.BRAVE_API_KEY;
const DATA_DIR = path.join(__dirname, '..', 'data');
const CACHE_FILE = path.join(DATA_DIR, 'gaming-culture-cache.json');
const WATCHLIST_FILE = path.join(DATA_DIR, 'watchlist.json');

const MAX_BRAVE_CALLS = 25;
const RATE_LIMIT_MS = 300;
let braveCallCount = 0;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function loadJSON(f) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } }
function saveJSON(f, d) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(d, null, 2)); }

async function braveSearch(query) {
  if (braveCallCount >= MAX_BRAVE_CALLS) return [];
  braveCallCount++;
  await sleep(RATE_LIMIT_MS);
  try {
    const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=10&freshness=pw`;
    const res = await fetch(url, {
      headers: { 'Accept': 'application/json', 'Accept-Encoding': 'gzip', 'X-Subscription-Token': BRAVE_API_KEY }
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.web?.results || []).map(r => ({ title: r.title || '', url: r.url || '', description: r.description || '', published: r.age || null }));
  } catch { return []; }
}

// ── Gaming platforms to monitor ──
const GAMING_QUERIES = [
  { platform: 'Fortnite', queries: [
    'fortnite festival new songs added 2026',
    'fortnite icon series skin artist musician 2026',
    'fortnite concert event artist 2026',
    'fortnite emote music licensed song 2026',
  ], weight: 10, icon: '🎮' },
  { platform: 'Rocket League', queries: [
    'rocket league new soundtrack songs artist 2026',
  ], weight: 6, icon: '🚗' },
  { platform: 'Beat Saber', queries: [
    'beat saber new music pack DLC artist 2026',
  ], weight: 5, icon: '⚔️' },
  { platform: 'EA FC / FIFA', queries: [
    'EA FC 26 soundtrack artists songs 2026',
  ], weight: 7, icon: '⚽' },
  { platform: 'NBA 2K', queries: [
    'NBA 2K27 soundtrack artists songs 2026',
  ], weight: 6, icon: '🏀' },
  { platform: 'GTA', queries: [
    'GTA 6 radio station songs artists confirmed 2026',
  ], weight: 9, icon: '🚗' },
];

// ── Cultural moment queries ──
const CULTURE_QUERIES = [
  { platform: 'SNL Musical Guest', queries: [
    'saturday night live musical guest 2026',
    'SNL musical guest this week 2026',
  ], weight: 9, icon: '📺' },
  { platform: 'Late Night TV', queries: [
    'tonight show musical guest performer 2026',
    'jimmy kimmel late show musical guest 2026',
  ], weight: 6, icon: '🌙' },
  { platform: 'Netflix/Streaming Sync', queries: [
    'netflix show song soundtrack viral trending 2026',
    'TV show song went viral streaming 2026',
  ], weight: 8, icon: '🎬' },
  { platform: 'Award Shows', queries: [
    'grammy performers 2026 lineup',
    'award show performer concert announcement 2026',
  ], weight: 8, icon: '🏆' },
  { platform: 'Super Bowl / Halftime', queries: [
    'super bowl halftime performer 2026 2027',
  ], weight: 10, icon: '🏈' },
];

// ── Big-name filter (skip obvious arena acts) ──
const BIG_NAMES = new Set([
  'taylor swift', 'beyonce', 'drake', 'bts', 'bad bunny', 'the weeknd', 'ed sheeran',
  'harry styles', 'lady gaga', 'bruno mars', 'ariana grande', 'billie eilish', 'dua lipa',
  'post malone', 'travis scott', 'kanye', 'eminem', 'rihanna', 'adele', 'coldplay',
  'imagine dragons', 'maroon 5', 'justin bieber', 'olivia rodrigo', 'sza', 'doja cat',
]);

function extractArtists(result) {
  const text = `${result.title} ${result.description}`;
  const artists = [];
  
  const patterns = [
    /(?:artist|singer|musician|rapper|band|performer)\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){0,2})/g,
    /([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){0,2})\s+(?:song|track|joins|performs|featured|announced)/g,
    /(?:featuring|feat\.?|ft\.?|by)\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){0,2})/g,
  ];

  for (const p of patterns) {
    let m;
    while ((m = p.exec(text)) !== null) {
      const name = m[1].trim();
      if (name.length > 3 && !BIG_NAMES.has(name.toLowerCase()) && !isNoise(name)) {
        artists.push(name);
      }
    }
  }
  return [...new Set(artists)];
}

function isNoise(name) {
  const noise = ['the game', 'the show', 'the new', 'the best', 'this week', 'new song',
    'new music', 'full list', 'official', 'youtube', 'spotify', 'listen', 'watch',
    'download', 'subscribe', 'episode', 'season', 'festival', 'fortnite', 'rocket league',
    'beat saber', 'announced', 'confirmed', 'update', 'patch', 'trailer'];
  return noise.includes(name.toLowerCase());
}

// ── Scan gaming platforms ──
async function scanGaming() {
  console.log('\n🎮 Phase 1: Scanning gaming platforms for artist integrations...');
  const finds = [];

  for (const platform of GAMING_QUERIES) {
    for (const q of platform.queries) {
      if (braveCallCount >= MAX_BRAVE_CALLS) break;
      const results = await braveSearch(q);
      
      for (const r of results) {
        const artists = extractArtists(r);
        for (const artist of artists) {
          finds.push({
            artist,
            platform: platform.platform,
            weight: platform.weight,
            icon: platform.icon,
            title: r.title,
            snippet: r.description?.slice(0, 200),
            url: r.url,
            published: r.published
          });
        }
      }
    }
    if (braveCallCount >= MAX_BRAVE_CALLS) break;
  }

  console.log(`   Found ${finds.length} gaming mentions across ${braveCallCount} calls`);
  return dedupeFinds(finds);
}

// ── Scan cultural moments ──
async function scanCulture() {
  console.log('\n📺 Phase 2: Scanning cultural moments (SNL, TV syncs, awards)...');
  const finds = [];

  for (const source of CULTURE_QUERIES) {
    for (const q of source.queries) {
      if (braveCallCount >= MAX_BRAVE_CALLS) break;
      const results = await braveSearch(q);

      for (const r of results) {
        const artists = extractArtists(r);
        for (const artist of artists) {
          finds.push({
            artist,
            platform: source.platform,
            weight: source.weight,
            icon: source.icon,
            title: r.title,
            snippet: r.description?.slice(0, 200),
            url: r.url,
            published: r.published
          });
        }
      }
    }
    if (braveCallCount >= MAX_BRAVE_CALLS) break;
  }

  console.log(`   Found ${finds.length} cultural mentions`);
  return dedupeFinds(finds);
}

// ── Cross-reference with watchlist ──
async function crossRefWatchlist(gaming, culture) {
  console.log('\n🔗 Phase 3: Cross-referencing with watchlist...');
  const watchlist = loadJSON(WATCHLIST_FILE);
  if (!watchlist?.artists) return [];

  const watchNames = new Set(watchlist.artists.map(a => a.name.toLowerCase()));
  const allFinds = [...gaming, ...culture];
  
  const matches = allFinds.filter(f => watchNames.has(f.artist.toLowerCase()));
  if (matches.length) {
    console.log(`   ⚡ ${matches.length} watchlist artist(s) found in gaming/culture!`);
    for (const m of matches) {
      console.log(`      ${m.icon} ${m.artist} → ${m.platform}`);
    }
  }
  return matches;
}

function dedupeFinds(finds) {
  const map = new Map();
  for (const f of finds) {
    const key = `${f.artist.toLowerCase()}|${f.platform}`;
    if (!map.has(key)) {
      map.set(key, { ...f, mentionCount: 1 });
    } else {
      map.get(key).mentionCount++;
    }
  }
  return [...map.values()].sort((a, b) => (b.weight * b.mentionCount) - (a.weight * a.mentionCount));
}

// ── Main ──
async function run() {
  console.log('🎮 Gaming & Culture Scanner starting...');
  console.log(`   Budget: ${MAX_BRAVE_CALLS} Brave calls`);

  const startTime = Date.now();
  const prevCache = loadJSON(CACHE_FILE) || { history: [] };

  const gaming = await scanGaming();
  const culture = await scanCulture();
  const watchlistMatches = await crossRefWatchlist(gaming, culture);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  const result = {
    lastScan: new Date().toISOString(),
    elapsed: `${elapsed}s`,
    apiCalls: { brave: braveCallCount },
    gaming,
    culture,
    watchlistMatches,
    history: [
      { date: new Date().toISOString().split('T')[0], gaming: gaming.length, culture: culture.length, watchlist: watchlistMatches.length },
      ...(prevCache.history || []).slice(0, 13)
    ]
  };

  saveJSON(CACHE_FILE, result);

  console.log(`\n✅ Gaming & Culture Scan complete in ${elapsed}s`);
  console.log(`   Brave calls: ${braveCallCount}/${MAX_BRAVE_CALLS}`);
  console.log(`   Gaming: ${gaming.length} | Culture: ${culture.length} | Watchlist hits: ${watchlistMatches.length}`);

  return result;
}

// ── Discord formatting ──
function formatDiscordAlert(results) {
  if (!results) return '';

  let msg = '🎮 **Gaming & Culture Scanner**\n';
  msg += `Brave calls: ${results.apiCalls?.brave || 0}\n\n`;

  if (results.gaming?.length) {
    msg += '**🎮 Artists in Games:**\n';
    for (const g of results.gaming.slice(0, 8)) {
      msg += `• ${g.icon} **${g.artist}** — ${g.platform}`;
      if (g.mentionCount > 1) msg += ` (${g.mentionCount}x)`;
      msg += '\n';
    }
    msg += '\n';
  }

  if (results.culture?.length) {
    msg += '**📺 Cultural Moments:**\n';
    for (const c of results.culture.slice(0, 8)) {
      msg += `• ${c.icon} **${c.artist}** — ${c.platform}`;
      if (c.mentionCount > 1) msg += ` (${c.mentionCount}x)`;
      if (c.snippet) msg += ` — _${c.snippet.slice(0, 80)}_`;
      msg += '\n';
    }
    msg += '\n';
  }

  if (results.watchlistMatches?.length) {
    msg += '**⚡ WATCHLIST MATCHES (Actionable!):**\n';
    for (const m of results.watchlistMatches) {
      msg += `• ${m.icon} **${m.artist}** spotted in ${m.platform} — check tour dates!\n`;
    }
    msg += '\n';
  }

  if (!results.gaming?.length && !results.culture?.length) {
    msg += '_No significant gaming/culture signals this scan._\n';
  }

  return msg;
}

module.exports = { run, formatDiscordAlert };

if (require.main === module) {
  run().then(r => {
    console.log('\n' + formatDiscordAlert(r));
  }).catch(e => { console.error(e); process.exit(1); });
}
