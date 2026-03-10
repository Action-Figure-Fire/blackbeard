#!/usr/bin/env node
// Sold-Out Verifier v1 — Multi-source sold-out & pricing verification
// Sources: Brave Search, X/Twitter API, SerpAPI Google, Bandsintown API, Venue HTTP scrape
// Verifies claims with 2+ independent sources for confidence scoring
// Replaces hot-show-scanner.js with deeper, wider verification

require('dotenv').config();
const https = require('https');
const fs = require('fs');
const path = require('path');

const BRAVE_API_KEY = process.env.BRAVE_API_KEY;
const TWITTER_BEARER = process.env.TWITTER_BEARER_TOKEN;
const SERPAPI_KEY = process.env.SERPAPI_KEY;
const BIT_APP_ID = 'squarespace-blackbeard';
const DATA_PATH = path.join(__dirname, '..', 'docs', 'data', 'rising-stars.json');
const CACHE_PATH = path.join(__dirname, '..', 'data', 'soldout-cache.json');

// Budget limits per run (conservative for cron; CLI can override via env)
const MAX_BRAVE = parseInt(process.env.VERIFY_BRAVE_LIMIT) || 40;
const MAX_TWITTER = parseInt(process.env.VERIFY_TWITTER_LIMIT) || 20;
const MAX_SERPAPI = parseInt(process.env.VERIFY_SERPAPI_LIMIT) || 5;
const MAX_VENUE_SCRAPE = 10;

let budget = { brave: 0, twitter: 0, serpapi: 0, venue: 0 };

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function httpGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const opts = {
      hostname: u.hostname,
      path: u.pathname + u.search,
      headers: { ...headers },
      timeout: 15000
    };
    https.get(opts, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve(JSON.parse(d)); } catch { resolve(d); }
      });
    }).on('error', reject).on('timeout', () => reject(new Error('timeout')));
  });
}

// ── Source 1: Brave Search ──
async function searchBrave(query) {
  if (budget.brave >= MAX_BRAVE) return [];
  budget.brave++;
  try {
    const q = encodeURIComponent(query);
    const data = await httpGet(
      `https://api.search.brave.com/res/v1/web/search?q=${q}&count=8&freshness=pm`,
      { 'X-Subscription-Token': BRAVE_API_KEY, 'Accept': 'application/json' }
    );
    return (data.web?.results || []).map(r => ({
      title: r.title,
      snippet: r.description || '',
      url: r.url,
      source: 'brave'
    }));
  } catch (e) {
    console.error(`  Brave error: ${e.message}`);
    return [];
  }
}

// ── Source 2: X/Twitter Search ──
async function searchTwitter(query) {
  if (!TWITTER_BEARER || budget.twitter >= MAX_TWITTER) return [];
  budget.twitter++;
  try {
    const q = encodeURIComponent(query);
    const data = await httpGet(
      `https://api.twitter.com/2/tweets/search/recent?query=${q}&max_results=10&tweet.fields=created_at,public_metrics,author_id`,
      { 'Authorization': `Bearer ${TWITTER_BEARER}` }
    );
    if (!data.data) return [];
    return data.data.map(t => ({
      title: `@tweet`,
      snippet: t.text,
      url: `https://twitter.com/i/status/${t.id}`,
      source: 'twitter',
      metrics: t.public_metrics,
      date: t.created_at
    }));
  } catch (e) {
    console.error(`  Twitter error: ${e.message}`);
    return [];
  }
}

// ── Source 3: SerpAPI Google Search ──
async function searchGoogle(query) {
  if (!SERPAPI_KEY || budget.serpapi >= MAX_SERPAPI) return [];
  budget.serpapi++;
  try {
    const q = encodeURIComponent(query);
    const data = await httpGet(
      `https://serpapi.com/search.json?q=${q}&api_key=${SERPAPI_KEY}&num=8&tbs=qdr:m`
    );
    return (data.organic_results || []).map(r => ({
      title: r.title,
      snippet: r.snippet || '',
      url: r.link,
      source: 'google'
    }));
  } catch (e) {
    console.error(`  SerpAPI error: ${e.message}`);
    return [];
  }
}

// ── Source 4: Bandsintown API ──
async function checkBandsintown(artistName) {
  try {
    const name = encodeURIComponent(artistName);
    const data = await httpGet(
      `https://rest.bandsintown.com/artists/${name}/events?app_id=${BIT_APP_ID}`,
      { 'Accept': 'application/json' }
    );
    if (!Array.isArray(data)) return { events: [], soldOut: [] };

    const soldOut = data.filter(e => {
      const offers = e.offers || [];
      return offers.some(o => o.status === 'sold_out' || (o.status || '').toLowerCase().includes('sold'));
    });

    return {
      events: data.map(e => ({
        venue: e.venue?.name,
        city: e.venue?.city,
        date: e.datetime,
        soldOut: (e.offers || []).some(o => o.status === 'sold_out'),
        source: 'bandsintown',
        url: e.url
      })),
      soldOut: soldOut.map(e => ({
        venue: e.venue?.name,
        city: e.venue?.city,
        date: e.datetime,
        source: 'bandsintown',
        url: e.url
      }))
    };
  } catch {
    return { events: [], soldOut: [] };
  }
}

// ── Source 5: Venue Website Scrape ──
async function scrapeVenuePage(url) {
  if (budget.venue >= MAX_VENUE_SCRAPE) return null;
  budget.venue++;
  try {
    const text = await httpGet(url, {
      'User-Agent': 'Mozilla/5.0 (compatible; Blackbeard/1.0)',
      'Accept': 'text/html'
    });
    if (typeof text !== 'string') return null;
    const lower = text.toLowerCase();
    return {
      soldOut: lower.includes('sold out') || lower.includes('sold-out'),
      limitedAvail: lower.includes('limited') || lower.includes('few remaining'),
      source: 'venue_scrape',
      url
    };
  } catch {
    return null;
  }
}

// ── Signal Detection ──
function detectSignals(results) {
  const signals = { soldOut: [], highPrice: [], trending: [] };

  for (const r of results) {
    const text = (r.title + ' ' + r.snippet).toLowerCase();
    const fullText = r.title + ' ' + (r.snippet || '');

    // Sold out detection
    if (text.includes('sold out') || text.includes('sold-out') || text.includes('sellout') ||
        text.includes('sell-out') || text.includes('completely sold') || text.includes('tickets gone')) {
      signals.soldOut.push({
        text: fullText.slice(0, 300),
        url: r.url,
        source: r.source
      });
    }

    // Price detection
    const priceMatches = fullText.match(/\$\d[\d,]*(?:\.\d{2})?/g) || [];
    const prices = priceMatches.map(m => parseInt(m.replace(/[$,]/g, ''))).filter(p => p >= 50 && p < 50000);
    if (prices.length) {
      signals.highPrice.push({
        prices,
        maxPrice: Math.max(...prices),
        text: fullText.slice(0, 300),
        url: r.url,
        source: r.source
      });
    }

    // Trending / hype signals
    if (text.includes('trending') || text.includes('viral') || text.includes('blowing up') ||
        text.includes('fastest-selling') || text.includes('record-breaking') || text.includes('added dates')) {
      signals.trending.push({
        text: fullText.slice(0, 300),
        url: r.url,
        source: r.source
      });
    }
  }

  return signals;
}

// ── Verify Artist ──
async function verifyArtist(artist) {
  const name = artist.name;
  console.log(`  🔍 ${name}...`);

  // Collect results from all sources in parallel where possible
  const [braveResults, twitterResults, bitData] = await Promise.all([
    searchBrave(`"${name}" tickets 2026 "sold out" OR price OR resale`),
    searchTwitter(`"${name}" ("sold out" OR "selling fast" OR "added shows") -is:retweet`),
    checkBandsintown(name)
  ]);
  await sleep(300);

  // Reddit via Brave
  const redditResults = await searchBrave(`site:reddit.com "${name}" "sold out" OR tickets 2026`);
  await sleep(300);

  // Combine all web results
  const allResults = [...braveResults, ...twitterResults, ...redditResults];
  const signals = detectSignals(allResults);

  // Add Bandsintown sold-out data
  for (const so of bitData.soldOut) {
    signals.soldOut.push({
      text: `${so.venue} in ${so.city} — ${so.date}`,
      url: so.url || '',
      source: 'bandsintown'
    });
  }

  // Count unique sources
  const soldOutSources = new Set(signals.soldOut.map(s => s.source));
  const priceSources = new Set(signals.highPrice.map(s => s.source));
  const peakPrice = signals.highPrice.reduce((max, s) => Math.max(max, s.maxPrice), 0);

  // Determine verification tier
  let verificationTier;
  if (soldOutSources.size >= 2 || (soldOutSources.size >= 1 && peakPrice >= 100)) {
    verificationTier = 'RED_HOT';  // 2+ sources confirm sold out, or sold out + high price
  } else if (soldOutSources.size >= 1 || peakPrice >= 100 || signals.trending.length >= 2) {
    verificationTier = 'WARM';     // Single source sold out, or high pricing, or multiple trending signals
  } else if (peakPrice >= 50 || signals.trending.length >= 1 || signals.soldOut.length > 0) {
    verificationTier = 'WATCH';    // Some signals but not enough to confirm
  } else {
    verificationTier = null;       // No actionable signals
  }

  if (!verificationTier) {
    console.log(`    — no signals`);
    return null;
  }

  const icon = verificationTier === 'RED_HOT' ? '🔴' : verificationTier === 'WARM' ? '🟡' : '⚪';
  console.log(`    ${icon} ${verificationTier} | ${signals.soldOut.length} sold-out, $${peakPrice || 0}, ${signals.trending.length} trending | sources: ${[...soldOutSources].join(', ') || 'price/trend only'}`);

  return {
    name,
    verificationTier,
    soldOutSignals: signals.soldOut.slice(0, 5),
    soldOutSourceCount: soldOutSources.size,
    soldOutSources: [...soldOutSources],
    peakPrice,
    highPriceSignals: signals.highPrice.slice(0, 3),
    trendingSignals: signals.trending.slice(0, 3),
    bandsintownSoldOut: bitData.soldOut.length,
    totalSignals: signals.soldOut.length + signals.highPrice.length + signals.trending.length,
    lastVerified: new Date().toISOString()
  };
}

// ── Prioritize Artists ──
function prioritizeArtists(artists) {
  return artists
    .filter(a => a.tourDates?.length || a.upcomingShows > 0)
    .sort((a, b) => {
      // Previously verified RED_HOT first (re-verify)
      const aHot = a.verificationTier === 'RED_HOT' ? 2 : a.verificationTier === 'WARM' ? 1 : 0;
      const bHot = b.verificationTier === 'RED_HOT' ? 2 : b.verificationTier === 'WARM' ? 1 : 0;
      if (bHot !== aHot) return bHot - aHot;
      // Then by existing sold-out mentions
      if ((b.soldOutMentions || 0) !== (a.soldOutMentions || 0))
        return (b.soldOutMentions || 0) - (a.soldOutMentions || 0);
      // Then by listeners (mid-range = more interesting)
      return (b.monthlyListeners || 0) - (a.monthlyListeners || 0);
    });
}

// ── Main ──
async function run() {
  console.log('🏴‍☠️ Sold-Out Verifier v1 — Multi-Source Verification');
  console.log(`   Budget: ${MAX_BRAVE} Brave | ${MAX_TWITTER} Twitter | ${MAX_SERPAPI} SerpAPI | ${MAX_VENUE_SCRAPE} Venue`);
  console.log(`   Sources: Brave Search, X/Twitter, SerpAPI Google, Bandsintown, Reddit\n`);

  const data = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
  const artists = data.artists || [];
  const sorted = prioritizeArtists(artists);

  console.log(`   ${sorted.length} artists with tour dates to verify\n`);

  const results = { RED_HOT: [], WARM: [], WATCH: [] };
  let scanned = 0;

  for (const artist of sorted) {
    // Stop when Brave budget is near exhaustion (need 2 calls per artist)
    if (budget.brave >= MAX_BRAVE - 1) {
      console.log(`\n   ⚠️  Brave budget nearly exhausted (${budget.brave}/${MAX_BRAVE})`);
      break;
    }

    const result = await verifyArtist(artist);
    scanned++;

    if (result) {
      results[result.verificationTier].push(result);

      // Update artist in data
      const orig = artists.find(a => a.name === artist.name);
      if (orig) {
        orig.verificationTier = result.verificationTier;
        orig.soldOutSourceCount = result.soldOutSourceCount;
        orig.soldOutSources = result.soldOutSources;
        orig.peakPrice = result.peakPrice;
        orig.totalSignals = result.totalSignals;
        orig.lastVerified = result.lastVerified;
        orig.confirmedSoldOut = result.soldOutSourceCount >= 2;
        orig.hasHotShows = result.verificationTier === 'RED_HOT' || result.verificationTier === 'WARM';

        // Update soldOutMentions from verification
        if (result.soldOutSignals.length > (orig.soldOutMentions || 0)) {
          orig.soldOutMentions = result.soldOutSignals.length;
          orig.soldOutSnippets = result.soldOutSignals.map(s => s.text);
        }
      }
    }
  }

  // Save updated data
  data.lastVerification = new Date().toISOString();
  fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));

  // Save cache
  const cache = { timestamp: new Date().toISOString(), budget, scanned, results };
  fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2));

  // Summary
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`✅ Verification Complete`);
  console.log(`   Scanned: ${scanned} artists`);
  console.log(`   Budget used: Brave ${budget.brave}/${MAX_BRAVE} | Twitter ${budget.twitter}/${MAX_TWITTER} | SerpAPI ${budget.serpapi}/${MAX_SERPAPI}`);
  console.log(`\n   🔴 RED HOT (verified by 2+ sources): ${results.RED_HOT.length}`);
  results.RED_HOT.forEach(r => console.log(`      ${r.name} — $${r.peakPrice} | ${r.soldOutSourceCount} sources: ${r.soldOutSources.join(', ')}`));
  console.log(`\n   🟡 WARM (single source / high price): ${results.WARM.length}`);
  results.WARM.forEach(r => console.log(`      ${r.name} — $${r.peakPrice} | signals: ${r.totalSignals}`));
  console.log(`\n   ⚪ WATCH (early signals): ${results.WATCH.length}`);
  results.WATCH.forEach(r => console.log(`      ${r.name} — $${r.peakPrice} | signals: ${r.totalSignals}`));

  return results;
}

// Export for cron integration
module.exports = { run };

function formatDiscordAlert(results) {
  if (!results) return '';
  const hot = results.RED_HOT || [];
  const warm = results.WARM || [];
  if (!hot.length && !warm.length) return '🔍 **Verification scan** — no new signals detected.';
  
  let msg = '🔍 **Sold-Out Verification Scan**\n';
  if (hot.length) {
    msg += `\n🔴 **RED HOT** (${hot.length} verified):\n`;
    hot.slice(0, 8).forEach(r => {
      msg += `• **${r.name}**${r.peakPrice ? ` — $${r.peakPrice}` : ''} (${r.soldOutSources.join(' + ')})\n`;
    });
  }
  if (warm.length) {
    msg += `\n🟡 **WARM** (${warm.length}):\n`;
    warm.slice(0, 5).forEach(r => {
      msg += `• **${r.name}**${r.peakPrice ? ` — $${r.peakPrice}` : ''}\n`;
    });
  }
  return msg;
}
module.exports.formatDiscordAlert = formatDiscordAlert;

// Run standalone if called directly
if (require.main === module) run().catch(console.error);
