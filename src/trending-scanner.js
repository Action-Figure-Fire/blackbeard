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
    (data.artists || []).forEach(a => BOOST_NAMES.add(a.name.toLowerCase()));
  } catch {}
  try {
    const wl = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'watchlist.json'), 'utf8'));
    (wl.artists || []).forEach(a => BOOST_NAMES.add(a.name.toLowerCase()));
  } catch {}
}

function isEventRelated(text) {
  const lower = text.toLowerCase();
  // Check event keywords
  if (EVENT_KEYWORDS.some(kw => lower.includes(kw))) return true;
  // Check if it's a known artist
  if (BOOST_NAMES.has(lower.trim())) return true;
  // Check partial name match
  for (const name of BOOST_NAMES) {
    if (lower.includes(name) && name.length > 3) return true;
  }
  return false;
}

function categorizeEvent(text) {
  const lower = text.toLowerCase();
  if (['nba', 'nfl', 'mlb', 'nhl', 'mls', 'ufc', 'wwe', 'ncaa', 'march madness', 'playoff', 'championship', 'finals', 'super bowl', 'world series'].some(k => lower.includes(k))) return 'sports';
  if (['comedy', 'comedian', 'standup', 'stand-up', 'special', 'snl'].some(k => lower.includes(k))) return 'comedy';
  if (['festival', 'coachella', 'lollapalooza', 'bonnaroo', 'edc', 'rolling loud'].some(k => lower.includes(k))) return 'festival';
  return 'music';
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
    'trending concerts this week 2026 tickets',
    'hottest events selling out this week',
    'trending comedy shows 2026',
    'most searched sports events this week tickets',
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

  // Score: multiple sources = higher, known artist = higher
  for (const t of unique) {
    let score = 0;
    const lower = t.query.toLowerCase();
    
    // Source scoring
    const sources = new Set();
    for (const all of allTrends) {
      if (all.query.toLowerCase().includes(lower) || lower.includes(all.query.toLowerCase())) {
        sources.add(all.source);
      }
    }
    score += sources.size * 20;
    t.sources = [...sources];
    t.sourceCount = sources.size;

    // Volume bonus
    if (t.volume) score += Math.min(30, Math.log10(t.volume) * 5);

    // Known artist bonus
    if (BOOST_NAMES.has(lower.trim())) score += 25;
    for (const name of BOOST_NAMES) {
      if (lower.includes(name) && name.length > 3) { score += 15; break; }
    }

    // Categorize
    t.category = categorizeEvent(t.fullText);
    t.trendScore = Math.round(score);
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
    t.context = enriched.context || t.snippet;
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
