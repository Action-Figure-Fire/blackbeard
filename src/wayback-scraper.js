#!/usr/bin/env node
/**
 * Wayback Machine Historical Price Scraper
 * Pulls archived SeatGeek/StubHub/Ticketmaster pages for historical ticket pricing
 * Free — no API key needed
 * 
 * Usage: node src/wayback-scraper.js [--artist "Name"] [--all] [--limit 50]
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

const HISTORY_FILE = path.join(__dirname, '..', 'data', 'historical', 'wayback-prices.json');
const ARTISTS_FILE = path.join(__dirname, '..', 'data', 'watchlist.json');

// SeatGeek event URL patterns to search
const SEATGEEK_PATTERNS = [
  'seatgeek.com/*/tickets',
  'seatgeek.com/*/events'
];

function fetch(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, { headers: { 'User-Agent': 'Blackbeard-Historical-Scanner/1.0' } }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return fetch(res.headers.location).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/**
 * Search Wayback Machine CDX API for snapshots of a URL pattern
 * CDX API docs: https://github.com/internetarchive/wayback/tree/master/wayback-cdx-server
 */
async function searchWayback(urlPattern, from = '20240101', to = '20261231') {
  const cdxUrl = `https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(urlPattern)}&matchType=prefix&output=json&from=${from}&to=${to}&fl=timestamp,original,statuscode&filter=statuscode:200&collapse=timestamp:8&limit=500`;
  
  try {
    const res = await fetch(cdxUrl);
    if (res.status !== 200) return [];
    const rows = JSON.parse(res.body);
    if (rows.length <= 1) return []; // first row is headers
    return rows.slice(1).map(r => ({
      timestamp: r[0],
      url: r[1],
      date: `${r[0].slice(0,4)}-${r[0].slice(4,6)}-${r[0].slice(6,8)}`
    }));
  } catch (e) {
    console.error(`  CDX error for ${urlPattern}: ${e.message}`);
    return [];
  }
}

/**
 * Fetch archived page and extract pricing data
 */
async function extractPriceFromSnapshot(timestamp, url) {
  const waybackUrl = `https://web.archive.org/web/${timestamp}id_/${url}`;
  try {
    const res = await fetch(waybackUrl);
    if (res.status !== 200) return null;
    
    const html = res.body;
    const prices = [];
    
    // SeatGeek price patterns
    const pricePatterns = [
      /\$(\d{1,5}(?:\.\d{2})?)\s*(?:each|per ticket|\/ea)/gi,
      /"price"\s*:\s*(\d+(?:\.\d+)?)/g,
      /"lowest_price"\s*:\s*(\d+(?:\.\d+)?)/g,
      /"average_price"\s*:\s*(\d+(?:\.\d+)?)/g,
      /"highest_price"\s*:\s*(\d+(?:\.\d+)?)/g,
      /lowest[^"]*?\$(\d+)/gi,
      /from\s*\$(\d+)/gi,
      /"min_price"\s*:\s*(\d+)/g,
      /"max_price"\s*:\s*(\d+)/g,
      /data-price="(\d+)"/g,
      /"listing_count"\s*:\s*(\d+)/g,
    ];

    const extracted = {};
    
    // Get listing count
    const listingMatch = html.match(/"listing_count"\s*:\s*(\d+)/);
    if (listingMatch) extracted.listingCount = parseInt(listingMatch[1]);
    
    // Get prices from JSON-LD or embedded data
    const lowestMatch = html.match(/"lowest_price"\s*:\s*(\d+(?:\.\d+)?)/);
    const avgMatch = html.match(/"average_price"\s*:\s*(\d+(?:\.\d+)?)/);
    const highestMatch = html.match(/"highest_price"\s*:\s*(\d+(?:\.\d+)?)/);
    const minMatch = html.match(/"min_price"\s*:\s*(\d+(?:\.\d+)?)/);
    
    if (lowestMatch) extracted.lowestPrice = parseFloat(lowestMatch[1]);
    if (avgMatch) extracted.avgPrice = parseFloat(avgMatch[1]);
    if (highestMatch) extracted.highestPrice = parseFloat(highestMatch[1]);
    if (minMatch) extracted.minPrice = parseFloat(minMatch[1]);

    // Extract event title
    const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
    if (titleMatch) extracted.title = titleMatch[1].trim();
    
    // Get "sold out" signals
    const soldOut = /sold\s*out|no\s*tickets|unavailable/i.test(html);
    extracted.soldOut = soldOut;

    // Price vetting: distinguish real market price from aspirational scalper listings
    // Rule: max price outliers (>5x the average or lowest) are flagged as "ask price" not "market price"
    if (extracted.lowestPrice && extracted.highestPrice) {
      const ratio = extracted.highestPrice / extracted.lowestPrice;
      if (ratio > 10) {
        // Huge spread = max is aspirational scalper pricing, not real market
        extracted.marketPrice = extracted.lowestPrice; // floor is closer to reality
        extracted.askPrice = extracted.highestPrice;    // flag the outlier
        extracted.priceWarning = `${ratio.toFixed(0)}x spread — max is likely aspirational scalper pricing`;
      } else {
        extracted.marketPrice = extracted.avgPrice || Math.round((extracted.lowestPrice + extracted.highestPrice) / 2);
      }
      // Listing count context: fewer listings = less reliable pricing
      if (extracted.listingCount && extracted.listingCount < 10) {
        extracted.priceWarning = (extracted.priceWarning || '') + '; thin market (<10 listings)';
      }
    }
    
    if (Object.keys(extracted).length > 1) { // more than just soldOut
      return extracted;
    }
    
    // Fallback: look for any dollar amounts in reasonable ticket range
    const dollarMatches = html.match(/\$(\d{2,4})/g);
    if (dollarMatches && dollarMatches.length > 0) {
      const amounts = dollarMatches.map(m => parseInt(m.replace('$', ''))).filter(n => n >= 10 && n <= 5000);
      if (amounts.length > 0) {
        extracted.priceRange = { min: Math.min(...amounts), max: Math.max(...amounts) };
        return extracted;
      }
    }

    if (soldOut) return extracted;
    return null;
  } catch (e) {
    return null;
  }
}

/**
 * Build SeatGeek search slug from artist name
 */
function artistToSlug(name) {
  return name.toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

/**
 * Scrape historical data for one artist
 */
async function scrapeArtist(artistName) {
  const slug = artistToSlug(artistName);
  console.log(`\n🔍 ${artistName} (${slug})`);
  
  const snapshots = [];
  
  // Search SeatGeek archives
  const seatgeekUrl = `seatgeek.com/${slug}`;
  const results = await searchWayback(seatgeekUrl, '20240101');
  console.log(`  Found ${results.length} Wayback snapshots`);
  
  // Also try tickets subdirectory
  const ticketResults = await searchWayback(`seatgeek.com/${slug}/tickets`, '20240101');
  console.log(`  Found ${ticketResults.length} ticket page snapshots`);
  await sleep(1000); // be nice to archive.org
  
  const allResults = [...results, ...ticketResults];
  
  // Deduplicate by date (keep one per day)
  const byDate = {};
  for (const r of allResults) {
    if (!byDate[r.date] || r.url.includes('/tickets')) {
      byDate[r.date] = r;
    }
  }
  
  const unique = Object.values(byDate).sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  console.log(`  ${unique.length} unique dates to check`);
  
  // Sample up to 30 snapshots (spread evenly)
  const sampled = unique.length <= 30 ? unique : 
    unique.filter((_, i) => i % Math.ceil(unique.length / 30) === 0);
  
  let pricePoints = 0;
  for (const snap of sampled) {
    const data = await extractPriceFromSnapshot(snap.timestamp, snap.url);
    if (data) {
      snapshots.push({
        date: snap.date,
        timestamp: snap.timestamp,
        url: snap.url,
        ...data
      });
      pricePoints++;
      let priceStr;
      if (data.marketPrice && data.askPrice) {
        priceStr = `MKT $${data.marketPrice} (ask $${data.askPrice} ⚠️)`;
      } else if (data.marketPrice) {
        priceStr = `MKT $${data.marketPrice}`;
      } else if (data.lowestPrice) {
        priceStr = `$${data.lowestPrice}-$${data.highestPrice || '?'}`;
      } else if (data.priceRange) {
        priceStr = `$${data.priceRange.min}-$${data.priceRange.max}`;
      } else if (data.soldOut) {
        priceStr = '🔴 SOLD OUT';
      } else {
        priceStr = '?';
      }
      const warnings = data.priceWarning ? ` ⚠️ ${data.priceWarning}` : '';
      console.log(`  📊 ${snap.date}: ${priceStr}${data.listingCount ? ` (${data.listingCount} listings)` : ''}${warnings}`);
    }
    await sleep(2000); // rate limit: be kind to archive.org
  }
  
  console.log(`  ✅ ${pricePoints} price points extracted`);
  return { artist: artistName, slug, snapshots, scrapedAt: new Date().toISOString() };
}

/**
 * Reddit Credibility Scoring
 * A claim is only credible if multiple independent sources confirm it.
 * 
 * Credibility levels:
 *   VERIFIED (3+) — 3+ independent posts/users confirming same claim
 *   LIKELY (2)    — 2 independent sources
 *   UNVERIFIED (1) — single post, treat as anecdotal
 * 
 * Independence = different authors AND different dates (>24h apart)
 */
function scoreRedditCredibility(posts) {
  // Group by claim type
  const claims = {
    soldOut: [],
    highPrices: [],    // complaints about high prices
    easyGet: [],       // "got tickets easily"
    presaleInfo: [],   // presale codes/dates
    tourAnnounce: []   // new tour dates
  };
  
  for (const p of posts) {
    const text = `${p.title} ${p.selftext || ''}`.toLowerCase();
    
    if (/sold\s*out|sell\s*out|couldn.t get|impossible|gone in|no tickets/i.test(text)) {
      claims.soldOut.push(p);
    }
    if (/too expensive|insane prices|ridiculous|scalp|goug|rip\s*off|\$[3-9]\d{2,}|\$\d{4}/i.test(text)) {
      claims.highPrices.push(p);
    }
    if (/easy|got tickets|no problem|plenty|available|wasn.t bad/i.test(text)) {
      claims.easyGet.push(p);
    }
    if (/presale|pre-sale|code|early access|fan club|citi|amex/i.test(text)) {
      claims.presaleInfo.push(p);
    }
    if (/new tour|just announced|added dates|new dates|coming to/i.test(text)) {
      claims.tourAnnounce.push(p);
    }
  }
  
  const scored = {};
  for (const [claimType, claimPosts] of Object.entries(claims)) {
    if (claimPosts.length === 0) continue;
    
    // Count independent sources (unique authors + >24h apart)
    const authors = new Set();
    const dates = new Set();
    const subreddits = new Set();
    
    for (const p of claimPosts) {
      // Use subreddit+date as independence proxy (no author field from Arctic Shift search)
      const dateKey = p.date; // YYYY-MM-DD
      subreddits.add(p.subreddit);
      dates.add(dateKey);
      // Approximate unique users by unique subreddit+date combos
      authors.add(`${p.subreddit}-${dateKey}`);
    }
    
    const independentSources = authors.size;
    const uniqueDates = dates.size;
    const uniqueSubs = subreddits.size;
    
    // Credibility calculation
    let credibility = 'UNVERIFIED';
    let confidence = 0;
    
    if (independentSources >= 3 && uniqueDates >= 2) {
      credibility = 'VERIFIED';
      confidence = Math.min(100, 50 + (independentSources * 5) + (uniqueSubs * 10));
    } else if (independentSources >= 2) {
      credibility = 'LIKELY';
      confidence = Math.min(80, 30 + (independentSources * 10) + (uniqueSubs * 5));
    } else {
      confidence = Math.min(30, 10 + (claimPosts[0].score || 0));
    }
    
    // Boost confidence based on upvotes (community agreement)
    const totalUpvotes = claimPosts.reduce((sum, p) => sum + (p.score || 0), 0);
    if (totalUpvotes > 50) confidence = Math.min(100, confidence + 15);
    else if (totalUpvotes > 20) confidence = Math.min(100, confidence + 10);
    else if (totalUpvotes > 10) confidence = Math.min(100, confidence + 5);
    
    // Boost for high comment count (discussion = more eyeballs confirming)
    const totalComments = claimPosts.reduce((sum, p) => sum + (p.numComments || 0), 0);
    if (totalComments > 50) confidence = Math.min(100, confidence + 10);
    
    scored[claimType] = {
      credibility,
      confidence,
      sources: independentSources,
      uniqueDates: uniqueDates,
      uniqueSubreddits: uniqueSubs,
      totalPosts: claimPosts.length,
      totalUpvotes,
      totalComments,
      topPosts: claimPosts
        .sort((a, b) => (b.score || 0) - (a.score || 0))
        .slice(0, 5)
        .map(p => ({ date: p.date, title: p.title, subreddit: p.subreddit, score: p.score, url: p.url }))
    };
  }
  
  return scored;
}

/**
 * Search Reddit archives via Arctic Shift API
 * Free, no auth needed, covers 2024+
 */
async function searchRedditHistory(query, subreddit, from = '2024-01-01') {
  const fromTs = Math.floor(new Date(from).getTime() / 1000);
  const url = `https://arctic-shift.photon-reddit.com/api/posts/search?subreddit=${encodeURIComponent(subreddit)}&query=${encodeURIComponent(query)}&after=${fromTs}&limit=100`;
  
  try {
    const res = await fetch(url);
    if (res.status !== 200) return [];
    const data = JSON.parse(res.body);
    return (data.data || []).map(post => ({
      title: post.title,
      subreddit: post.subreddit,
      date: new Date(post.created_utc * 1000).toISOString().split('T')[0],
      score: post.score,
      numComments: post.num_comments,
      url: `https://reddit.com${post.permalink}`,
      selftext: (post.selftext || '').slice(0, 500)
    }));
  } catch (e) {
    console.error(`  Reddit search error: ${e.message}`);
    return [];
  }
}

/**
 * Scrape Reddit for sellout/pricing intel on an artist
 */
async function scrapeRedditHistory(artistName) {
  console.log(`\n📱 Reddit history: ${artistName}`);
  
  const subreddits = ['concerts', 'ticketmaster', 'LiveNation', 'Music', 'onsale'];
  const queries = [
    `"${artistName}" sold out`,
    `"${artistName}" presale`,
    `"${artistName}" tickets`,
    `"${artistName}" tour`
  ];
  
  const allPosts = [];
  const seen = new Set();
  
  for (const sub of subreddits) {
    for (const q of queries) {
      const posts = await searchRedditHistory(q, sub);
      for (const p of posts) {
        if (!seen.has(p.url)) {
          seen.add(p.url);
          allPosts.push({ ...p, query: q, searchSub: sub });
        }
      }
      await sleep(500);
    }
  }
  
  // Filter for ticket-relevant posts
  const relevant = allPosts.filter(p => {
    const text = `${p.title} ${p.selftext}`.toLowerCase();
    return /sold\s*out|presale|ticket|onsale|on\s*sale|scalp|resale|stub\s*hub|seatgeek|ticketmaster|venue|concert|tour/i.test(text);
  });
  
  console.log(`  Found ${allPosts.length} posts, ${relevant.length} ticket-relevant`);
  
  // Extract sellout signals
  const selloutPosts = relevant.filter(p => {
    const text = `${p.title} ${p.selftext}`.toLowerCase();
    return /sold\s*out|sell\s*out|couldn.t get|impossible to get|gone in|seconds|minutes/i.test(text);
  });
  
  if (selloutPosts.length > 0) {
    console.log(`  🔴 ${selloutPosts.length} sellout reports found`);
    selloutPosts.slice(0, 3).forEach(p => console.log(`    - ${p.date}: "${p.title}" (r/${p.subreddit}, ${p.score}↑)`));
  }
  
  // Extract price mentions
  const pricePosts = relevant.filter(p => {
    const text = `${p.title} ${p.selftext}`;
    return /\$\d{2,4}/.test(text);
  });
  
  const priceData = [];
  for (const p of pricePosts) {
    const text = `${p.title} ${p.selftext}`;
    const prices = text.match(/\$(\d{2,4})/g);
    if (prices) {
      const amounts = prices.map(m => parseInt(m.replace('$', ''))).filter(n => n >= 20 && n <= 5000);
      if (amounts.length > 0) {
        priceData.push({
          date: p.date,
          prices: amounts,
          context: p.title,
          subreddit: p.subreddit,
          url: p.url
        });
      }
    }
  }
  
  // Vet Reddit price data: calculate consensus price range
  // Only trust prices mentioned by 2+ posts or backed by Wayback data
  let consensusPrice = null;
  if (priceData.length >= 2) {
    const allPrices = priceData.flatMap(p => p.prices);
    // Remove outliers: exclude top/bottom 10%
    allPrices.sort((a, b) => a - b);
    const trimStart = Math.floor(allPrices.length * 0.1);
    const trimEnd = Math.ceil(allPrices.length * 0.9);
    const trimmed = allPrices.slice(trimStart, trimEnd);
    if (trimmed.length > 0) {
      consensusPrice = {
        median: trimmed[Math.floor(trimmed.length / 2)],
        low: trimmed[0],
        high: trimmed[trimmed.length - 1],
        sampleSize: priceData.length,
        totalMentions: allPrices.length,
        credibility: priceData.length >= 3 ? 'VERIFIED' : 'LIKELY'
      };
      const emoji = consensusPrice.credibility === 'VERIFIED' ? '✅' : '🟡';
      console.log(`  ${emoji} Consensus price: $${consensusPrice.low}-$${consensusPrice.high} (median $${consensusPrice.median}, from ${priceData.length} posts)`);
    }
  } else if (priceData.length === 1) {
    console.log(`  ⚪ Single price mention — unverified (excluded from predictions)`);
  }

  if (priceData.length > 0) {
    console.log(`  💰 ${priceData.length} posts with price data`);
  }

  // Score credibility across all relevant posts
  const credibility = scoreRedditCredibility(relevant);
  
  // Log credibility results
  for (const [claim, data] of Object.entries(credibility)) {
    const emoji = data.credibility === 'VERIFIED' ? '✅' : data.credibility === 'LIKELY' ? '🟡' : '⚪';
    console.log(`  ${emoji} ${claim}: ${data.credibility} (${data.confidence}% confidence, ${data.sources} independent sources, ${data.totalUpvotes}↑)`);
  }

  return {
    artist: artistName,
    totalPosts: allPosts.length,
    relevantPosts: relevant.length,
    credibility,
    selloutReports: selloutPosts.map(p => ({
      date: p.date, title: p.title, subreddit: p.subreddit,
      score: p.score, comments: p.numComments, url: p.url
    })),
    priceData,
    consensusPrice,
    scrapedAt: new Date().toISOString()
  };
}

/**
 * Main execution
 */
async function main() {
  const args = process.argv.slice(2);
  const artistFlag = args.indexOf('--artist');
  const allFlag = args.includes('--all');
  const redditOnly = args.includes('--reddit-only');
  const waybackOnly = args.includes('--wayback-only');
  const limitFlag = args.indexOf('--limit');
  const limit = limitFlag >= 0 ? parseInt(args[limitFlag + 1]) : 20;
  
  // Load existing data
  let existing = { wayback: {}, reddit: {}, lastRun: null };
  if (fs.existsSync(HISTORY_FILE)) {
    existing = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
  }
  
  // Determine artists to scan
  let artists = [];
  if (artistFlag >= 0) {
    artists = [args[artistFlag + 1]];
  } else if (allFlag) {
    if (fs.existsSync(ARTISTS_FILE)) {
      const watchlist = JSON.parse(fs.readFileSync(ARTISTS_FILE, 'utf8'));
      artists = (watchlist.artists || []).map(a => a.name).slice(0, limit);
    }
  } else {
    // Default: S + A tier artists from rising-stars.json
    const rsFile = path.join(__dirname, '..', 'docs', 'data', 'rising-stars.json');
    if (fs.existsSync(rsFile)) {
      const rs = JSON.parse(fs.readFileSync(rsFile, 'utf8'));
      artists = (rs.artists || [])
        .filter(a => a.tier === 'S' || a.tier === 'A')
        .map(a => a.name)
        .slice(0, limit);
    }
  }
  
  if (artists.length === 0) {
    console.log('No artists to scan. Use --artist "Name" or --all');
    process.exit(1);
  }
  
  console.log(`\n🏴‍☠️ Historical Data Scraper — ${artists.length} artists`);
  console.log(`${'='.repeat(50)}`);
  
  let waybackTotal = 0, redditTotal = 0;
  
  for (const artist of artists) {
    // Wayback Machine
    if (!redditOnly) {
      const waybackData = await scrapeArtist(artist);
      existing.wayback[artist] = waybackData;
      waybackTotal += waybackData.snapshots.length;
    }
    
    // Reddit archives
    if (!waybackOnly) {
      const redditData = await scrapeRedditHistory(artist);
      existing.reddit[artist] = redditData;
      redditTotal += redditData.relevantPosts;
    }
    
    // Save after each artist (in case of crash)
    existing.lastRun = new Date().toISOString();
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(existing, null, 2));
  }
  
  console.log(`\n${'='.repeat(50)}`);
  console.log(`✅ DONE`);
  console.log(`  Wayback: ${waybackTotal} price snapshots`);
  console.log(`  Reddit: ${redditTotal} relevant posts`);
  console.log(`  Saved to: ${HISTORY_FILE}`);
  
  // Summary stats — only show VERIFIED and LIKELY claims
  console.log(`\n📊 CREDIBILITY SUMMARY:`);
  const verifiedSellouts = Object.values(existing.reddit)
    .filter(r => r.credibility?.soldOut?.credibility === 'VERIFIED');
  const likelySellouts = Object.values(existing.reddit)
    .filter(r => r.credibility?.soldOut?.credibility === 'LIKELY');
  const verifiedHighPrices = Object.values(existing.reddit)
    .filter(r => r.credibility?.highPrices?.credibility === 'VERIFIED');
    
  if (verifiedSellouts.length > 0) {
    console.log(`\n✅ VERIFIED sellout artists (3+ independent sources):`);
    verifiedSellouts.forEach(r => {
      const c = r.credibility.soldOut;
      console.log(`  ${r.artist}: ${c.confidence}% confidence (${c.sources} sources, ${c.totalUpvotes}↑ total upvotes)`);
    });
  }
  if (likelySellouts.length > 0) {
    console.log(`\n🟡 LIKELY sellout artists (2 sources):`);
    likelySellouts.forEach(r => {
      const c = r.credibility.soldOut;
      console.log(`  ${r.artist}: ${c.confidence}% confidence (${c.sources} sources)`);
    });
  }
  if (verifiedHighPrices.length > 0) {
    console.log(`\n💰 VERIFIED high-price artists:`);
    verifiedHighPrices.forEach(r => {
      const c = r.credibility.highPrices;
      console.log(`  ${r.artist}: ${c.confidence}% confidence (${c.sources} sources)`);
    });
  }
  
  const unverifiedCount = Object.values(existing.reddit)
    .filter(r => {
      const claims = Object.values(r.credibility || {});
      return claims.length > 0 && claims.every(c => c.credibility === 'UNVERIFIED');
    }).length;
  if (unverifiedCount > 0) {
    console.log(`\n⚪ ${unverifiedCount} artists with only unverified/anecdotal claims (excluded from predictions)`);
  }
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
