#!/usr/bin/env node
// Trending Events Scanner — "What's Hot This Week"
// Sources: Google Trends (SerpAPI), Twitter Trending, Brave Search
// Filters to ONLY events: concerts, sports, comedy, tours, festivals
// Resets weekly — shows what's trending RIGHT NOW
// Output: docs/data/trending.json

require('dotenv').config();
const https = require('https');
const fs = require('fs');
const path = require('path');

const SERPAPI_KEY = process.env.SERPAPI_KEY;
const TWITTER_BEARER = process.env.TWITTER_BEARER_TOKEN;
const BRAVE_API_KEY = process.env.BRAVE_API_KEY;
const OUTPUT_PATH = path.join(__dirname, '..', 'docs', 'data', 'trending.json');

// Event-related keywords for filtering
const EVENT_KEYWORDS = [
  'tour', 'concert', 'tickets', 'presale', 'onsale', 'sold out', 'festival',
  'arena', 'stadium', 'amphitheater', 'theater', 'venue',
  'nba', 'nfl', 'mlb', 'nhl', 'mls', 'ufc', 'wwe', 'ncaa', 'march madness',
  'playoff', 'championship', 'super bowl', 'world series', 'finals',
  'comedy', 'standup', 'stand-up', 'comedian', 'special',
  'residency', 'farewell', 'reunion', 'headlining',
  'coachella', 'lollapalooza', 'bonnaroo', 'edc', 'rolling loud',
  'red rocks', 'msg', 'madison square garden', 'sphere',
];

// Known artist/event names to boost matching
const BOOST_NAMES = new Set();
const ARTIST_PROPER_NAMES = {}; // lowercase → proper casing

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function httpGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    https.get({ hostname: u.hostname, path: u.pathname + u.search, headers, timeout: 15000 }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve(null); } });
    }).on('error', reject).on('timeout', () => reject(new Error('timeout')));
  });
}

// Load known artist names for matching
function loadKnownArtists() {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'docs', 'data', 'rising-stars.json'), 'utf8'));
    (data.artists || []).forEach(a => {
      BOOST_NAMES.add(a.name.toLowerCase());
      ARTIST_PROPER_NAMES[a.name.toLowerCase()] = a.name;
    });
  } catch {}
  try {
    const wl = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'watchlist.json'), 'utf8'));
    (wl.artists || []).forEach(a => {
      BOOST_NAMES.add(a.name.toLowerCase());
      ARTIST_PROPER_NAMES[a.name.toLowerCase()] = a.name;
    });
  } catch {}
}

// Noise filter — reject anything that's not a specific artist/event
const NOISE_PATTERNS = [
  'things to do', 'best things', 'weekend guide', 'what to do', 'where to go',
  'restaurants', 'bars', 'food', 'dining', 'brunch', 'happy hour',
  'real estate', 'weather', 'traffic', 'news', 'politics',
  'most anticipated', 'best of', 'top 10', 'top 20', 'top 25', 'roundup',
  'this week in', 'concerts to experience', 'must-catch', 'guide',
  'love is blind', 'reunion', 'reality tv', 'bachelor', 'survivor',
  'every music artist', 'all of the biggest', 'upcoming rock tours',
  'concert tickets 2026', 'popular artists touring', 'highest-grossing',
  'concerts in europe', 'australia tour', 'meininger', 'jambase',
  'wikipedia', 'must-see shows', 'list of',
  'how to watch', 'how to get', 'how to buy', 'how to secure',
  'upcoming concert events', 'venue, schedule', 'concert events, venue',
  'tour presale alerts, tour dates', 'tourpresale',
  'highest paid', 'go + do events', 'greeley tribune'
];

// Sports keywords — filter these OUT (Zach only wants music + comedy)
const SPORTS_KEYWORDS = [
  'nba', 'nfl', 'mlb', 'nhl', 'mls', 'ufc', 'wwe', 'ncaa', 'march madness',
  'playoff', 'championship', 'super bowl', 'world series', 'finals',
  'draft', 'trade', 'roster', 'injury', 'standings', 'score',
  'vs ', ' vs.', 'grizzlies', 'nets', 'knicks', 'clippers', 'warriors', 'jazz',
  'celtics', 'lakers', 'bulls', 'heat', 'bucks', 'nuggets', 'suns',
  'cowboys', 'eagles', 'chiefs', 'ravens', 'bills', 'lions', '49ers',
  'yankees', 'dodgers', 'mets', 'cubs', 'red sox', 'astros',
  'acc tournament', 'big ten', 'sec tournament', 'baseball score',
  'touchdown', 'quarterback', 'rushing', 'interception', 'fumble',
  'free agent', 'signing', 'contract', 'cap space',
  'sensabaugh', 'arozarena', 'blankenship', 'dowdle', 'kalif raymond',
  'how to watch golden state', 'how to watch', 'game time'
];

function isEventRelated(text) {
  const lower = text.toLowerCase().trim();
  // Reject noise
  if (NOISE_PATTERNS.some(p => lower.includes(p))) return false;
  // Reject sports
  if (SPORTS_KEYWORDS.some(p => lower.includes(p))) return false;
  // PRIORITY 1: Exact match to a known artist in our database
  if (BOOST_NAMES.has(lower)) return true;
  // PRIORITY 2: Contains a known artist name (3+ chars to avoid false matches)
  for (const name of BOOST_NAMES) {
    if (name.length > 3 && lower.includes(name)) return true;
  }
  // PRIORITY 3: Strong event keywords (tour announce, presale, sold out — NOT generic like "tickets")
  const strongKeywords = ['presale', 'sold out', 'sell out', 'tour announce', 'new tour', 'farewell tour',
    'residency', 'added dates', 'added shows', 'comedian', 'comedy special', 'snl host'];
  if (strongKeywords.some(kw => lower.includes(kw))) return true;
  // Skip generic event keywords — too many false positives from Brave articles
  return false;
}

function categorizeEvent(text) {
  const lower = text.toLowerCase();
  if (['comedy', 'comedian', 'standup', 'stand-up', 'special', 'snl'].some(k => lower.includes(k))) return 'comedy';
  if (['festival', 'coachella', 'lollapalooza', 'bonnaroo', 'edc', 'rolling loud', 'glastonbury', 'ultra'].some(k => lower.includes(k))) return 'festival';
  return 'music';
}

// Proper capitalization for artist/event names
function properCase(str) {
  const lower = str.toLowerCase().trim();
  // Use exact known casing if it's a known artist
  if (ARTIST_PROPER_NAMES[lower]) return ARTIST_PROPER_NAMES[lower];
  // Check partial matches
  for (const [key, proper] of Object.entries(ARTIST_PROPER_NAMES)) {
    if (lower === key) return proper;
  }
  // Don't touch already-capitalized acronyms/bands (DJ, EDC, ALLEYCVT, etc.)
  if (str === str.toUpperCase() && str.length <= 10) return str;
  // Title case
  return str.replace(/\b\w+/g, w => {
    if (['a','an','the','and','or','but','in','on','at','to','for','of','vs','is','s'].includes(w.toLowerCase()) && w !== str.split(' ')[0]) return w.toLowerCase();
    return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
  }).replace(/'s\b/gi, "'s");
}

// ── Source 1: Google Trends (real-time trending) ──
async function getGoogleTrends() {
  if (!SERPAPI_KEY) return [];
  console.log('  📈 Google Trends...');
  try {
    const data = await httpGet(
      `https://serpapi.com/search.json?engine=google_trends_trending_now&geo=US&api_key=${SERPAPI_KEY}`
    );
    const trends = data?.trending_searches || [];
    console.log(`     ${trends.length} trending searches found`);

    return trends.map(t => {
      const query = t.query || t.title || '';
      const articles = t.articles || [];
      const snippet = articles[0]?.snippet || articles[0]?.title || '';
      return {
        query,
        snippet,
        fullText: query + ' ' + snippet,
        volume: t.search_volume || null,
        source: 'google_trends'
      };
    });
  } catch (e) {
    console.log(`     Error: ${e.message}`);
    return [];
  }
}

// ── Source 2: Twitter Trending ──
async function getTwitterTrending() {
  if (!TWITTER_BEARER) return [];
  console.log('  🐦 Twitter Trending...');
  try {
    const data = await httpGet(
      'https://api.twitter.com/2/trends/by/woeid/23424977',
      { 'Authorization': `Bearer ${TWITTER_BEARER}` }
    );
    const trends = data?.data || [];
    console.log(`     ${trends.length} Twitter trends found`);

    return trends.map(t => ({
      query: t.trend_name || t.name || '',
      snippet: '',
      fullText: (t.trend_name || t.name || ''),
      volume: t.tweet_count || null,
      source: 'twitter'
    }));
  } catch (e) {
    console.log(`     Error: ${e.message}`);
    return [];
  }
}

// ── Source 3: Brave Search for trending events ──
async function getBraveTrending() {
  console.log('  🔍 Brave Search (trending events)...');
  const queries = [
    '"sold out" concert tour this week 2026',
    '"presale" artist tour announced this week 2026',
    '"selling fast" tickets concert 2026',
    'comedian "added shows" OR "sold out" 2026',
  ];

  const results = [];
  for (const q of queries) {
    try {
      const data = await httpGet(
        `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(q)}&count=5&freshness=pw`,
        { 'X-Subscription-Token': BRAVE_API_KEY, 'Accept': 'application/json' }
      );
      for (const r of (data?.web?.results || [])) {
        results.push({
          query: r.title || '',
          snippet: r.description || '',
          fullText: (r.title || '') + ' ' + (r.description || ''),
          url: r.url,
          source: 'brave'
        });
      }
      await sleep(300);
    } catch (e) {
      console.log(`     Brave error: ${e.message}`);
    }
  }
  console.log(`     ${results.length} Brave results`);
  return results;
}

// ── Enrich trending event with Brave for context ──
async function enrichTrend(query) {
  try {
    const data = await httpGet(
      `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query + ' tickets 2026')}&count=3&freshness=pm`,
      { 'X-Subscription-Token': BRAVE_API_KEY, 'Accept': 'application/json' }
    );
    const results = data?.web?.results || [];
    let ticketUrl = null;
    let context = '';
    for (const r of results) {
      const text = (r.title + ' ' + (r.description || '')).toLowerCase();
      if (!ticketUrl && (r.url.includes('seatgeek.com') || r.url.includes('ticketmaster.com') || r.url.includes('stubhub.com'))) {
        ticketUrl = r.url;
      }
      if (!context && (text.includes('sold out') || text.includes('ticket') || text.includes('tour') || text.includes('presale'))) {
        context = (r.description || '').substring(0, 200);
      }
    }
    return { ticketUrl, context };
  } catch {
    return { ticketUrl: null, context: '' };
  }
}

// ── Main ──
async function run() {
  console.log('🔥 Trending Events Scanner — "What\'s Hot This Week"');
  console.log(`   Sources: Google Trends, Twitter, Brave Search\n`);

  loadKnownArtists();
  console.log(`   ${BOOST_NAMES.size} known artists loaded for matching\n`);

  // Gather all trending data
  const [googleTrends, twitterTrends, braveTrends] = await Promise.all([
    getGoogleTrends(),
    getTwitterTrending(),
    getBraveTrending()
  ]);

  const allTrends = [...googleTrends, ...twitterTrends, ...braveTrends];
  console.log(`\n   Total raw trends: ${allTrends.length}`);

  // Filter to event-related only
  const eventTrends = allTrends.filter(t => isEventRelated(t.fullText));
  console.log(`   Event-related: ${eventTrends.length}`);

  // Deduplicate by query similarity
  const seen = new Set();
  const unique = [];
  for (const t of eventTrends) {
    const key = t.query.toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 20);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(t);
  }
  console.log(`   Unique trends: ${unique.length}`);

  // Score on 0-100 scale:
  // - Google Trends position (top = higher): 0-40 pts
  // - Multi-source confirmation: 0-30 pts (10 per additional source)
  // - Known artist in our database: +20 pts
  // - Has ticket-related context: +10 pts
  for (const t of unique) {
    let score = 0;
    const lower = t.query.toLowerCase();
    
    // Source tracking
    const sources = new Set();
    for (const all of allTrends) {
      if (all.query.toLowerCase().includes(lower) || lower.includes(all.query.toLowerCase())) {
        sources.add(all.source);
      }
    }
    t.sources = [...sources];
    t.sourceCount = sources.size;

    // Google Trends position score (higher position in trending = more points)
    const gtIndex = googleTrends.findIndex(g => (g.query || '').toLowerCase() === lower);
    if (gtIndex >= 0) {
      score += Math.max(5, 40 - Math.floor(gtIndex / 10) * 5); // Top 10 = 40pts, 11-20 = 35pts, etc.
    }

    // Multi-source bonus
    score += (sources.size - 1) * 15; // 2 sources = +15, 3 sources = +30

    // Known artist bonus
    if (BOOST_NAMES.has(lower.trim())) score += 20;
    else {
      for (const name of BOOST_NAMES) {
        if (lower.includes(name) && name.length > 3) { score += 15; break; }
      }
    }

    // Ticket/tour context bonus
    const ctx = t.fullText.toLowerCase();
    if (ctx.includes('ticket') || ctx.includes('tour') || ctx.includes('presale') || ctx.includes('sold out')) score += 10;

    // Cap at 100
    t.category = categorizeEvent(t.fullText);
    t.trendScore = Math.min(100, Math.round(score));

    // Proper capitalization
    t.query = properCase(t.query);
  }

  // Sort by score
  unique.sort((a, b) => b.trendScore - a.trendScore);

  // Enrich top trends with ticket links and context
  console.log('\n  🎫 Enriching top trends with ticket links...');
  const top = unique.slice(0, 20);
  let enrichCalls = 0;
  for (const t of top) {
    if (enrichCalls >= 10) break; // Max 10 Brave calls for enrichment
    const enriched = await enrichTrend(t.query);
    enrichCalls++;
    t.ticketUrl = enriched.ticketUrl;
    // Clean context: strip HTML tags, trim article titles from query
    let ctx = (enriched.context || t.snippet || '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#x27;/g, "'").trim();
    t.context = ctx;
    // Clean the name: strip article source suffixes
    t.query = t.query.replace(/\s*[-–—]\s*(the mirror|los angeles times|grimy goods|syracuse\.com|greeley tribune|rolling stone|billboard|variety|pitchfork|consequence|stereogum|nme).*$/i, '').trim();
    t.query = properCase(t.query);
    await sleep(300);
  }

  // Build output
  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - weekStart.getDay()); // Sunday
  const weekLabel = weekStart.toISOString().split('T')[0];

  const output = {
    weekOf: weekLabel,
    scannedAt: new Date().toISOString(),
    sourceCount: { google: googleTrends.length, twitter: twitterTrends.length, brave: braveTrends.length },
    trends: top.map(t => ({
      name: t.query,
      category: t.category,
      trendScore: t.trendScore,
      sources: t.sources,
      sourceCount: t.sourceCount,
      context: (t.context || '').substring(0, 250),
      ticketUrl: t.ticketUrl,
      volume: t.volume,
    }))
  };

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));

  // Summary
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`🔥 TRENDING THIS WEEK (${weekLabel})`);
  console.log(`${'═'.repeat(60)}`);

  const cats = { music: '🎵', sports: '🏆', comedy: '🎤', festival: '🎪' };
  for (const t of top.slice(0, 15)) {
    const icon = cats[t.category] || '📌';
    const src = t.sources.join('+');
    console.log(`  ${icon} ${t.query} — score: ${t.trendScore} (${src})${t.ticketUrl ? ' 🎟️' : ''}`);
    if (t.context) console.log(`     ${t.context.substring(0, 120)}`);
  }

  return output;
}

function formatDiscordAlert(output) {
  if (!output || !output.trends?.length) return '';
  const cats = { music: '🎵', sports: '🏆', comedy: '🎤', festival: '🎪' };
  let msg = `🔥 **TRENDING THIS WEEK** (${output.weekOf})\n`;
  output.trends.slice(0, 10).forEach(t => {
    const icon = cats[t.category] || '📌';
    msg += `${icon} **${t.name}** — ${t.sources.join('+')}${t.ticketUrl ? ' [🎟️ Tickets](' + t.ticketUrl + ')' : ''}\n`;
  });
  return msg;
}

module.exports = { run, formatDiscordAlert };
if (require.main === module) run().catch(console.error);
