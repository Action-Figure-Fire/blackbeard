#!/usr/bin/env node
/**
 * Blackbeard 🏴‍☠️ — Sellout Predictor
 * Usage: node predict-artist.js "Artist Name"
 *        node predict-artist.js --batch "Artist1" "Artist2" "Artist3"
 * 
 * Pulls real-time data from Brave, SeatGeek, Twitter, Bandsintown
 * and scores likelihood of sellout on a 0-100 scale.
 * 
 * Output: Sellout probability tier + reasoning
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { getVelocityScore } = require('./velocity-tracker');
const { getPatternMatchScore } = require('./breakout-matcher');
const { getRedditMentions, getRedditHypeScore } = require('./reddit-hype-index');

// Load .env
try {
  const envPath = path.join(__dirname, '..', '.env');
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf8').split('\n');
    for (const line of lines) {
      const [key, ...val] = line.split('=');
      if (key && val.length) process.env[key.trim()] = val.join('=').trim();
    }
  }
} catch (e) {}

// ---- HTTP Helper ----
function fetch(url, options = {}) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, {
      headers: { 'User-Agent': 'Blackbeard-Predict/2.0', ...options.headers },
      timeout: 15000
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, data }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

function parseNumber(str) {
  if (!str) return 0;
  str = str.toString().toLowerCase().replace(/,/g, '');
  const m = str.match(/([\d.]+)\s*(m|million|k|thousand|b|billion)?/i);
  if (!m) return 0;
  let num = parseFloat(m[1]);
  const unit = (m[2] || '').toLowerCase();
  if (unit === 'm' || unit === 'million') num *= 1000000;
  else if (unit === 'k' || unit === 'thousand') num *= 1000;
  else if (unit === 'b' || unit === 'billion') num *= 1000000000;
  return Math.round(num);
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

// ---- API Calls ----

async function braveSearch(query) {
  const key = process.env.BRAVE_API_KEY;
  if (!key) return [];
  try {
    const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=10`;
    const res = await fetch(url, { headers: { 'X-Subscription-Token': key } });
    if (res.status !== 200) return [];
    const data = JSON.parse(res.data);
    return (data.web?.results || []).map(r => ({ title: r.title || '', snippet: r.description || '', url: r.url }));
  } catch (e) { return []; }
}

async function getSeatGeekEvents(artistName) {
  const sgId = process.env.SEATGEEK_CLIENT_ID;
  const sgSecret = process.env.SEATGEEK_SECRET;
  if (!sgId) return [];
  try {
    const q = encodeURIComponent(artistName);
    const url = `https://api.seatgeek.com/2/events?q=${q}&client_id=${sgId}&client_secret=${sgSecret}&per_page=30&sort=datetime_utc.asc`;
    const res = await fetch(url);
    if (res.status !== 200) return [];
    const data = JSON.parse(res.data);
    return (data.events || []).filter(e => {
      // Only future events
      return new Date(e.datetime_utc) > new Date();
    }).map(e => ({
      title: e.title,
      venue: e.venue?.name || '',
      city: e.venue?.city || '',
      state: e.venue?.state || '',
      capacity: e.venue?.capacity || 0,
      date: e.datetime_local,
      score: e.score || 0,
      lowestPrice: e.stats?.lowest_sg_base_price || e.stats?.lowest_price || null,
      avgPrice: e.stats?.average_price || null,
      highestPrice: e.stats?.highest_price || null,
      listingCount: e.stats?.listing_count || null,
      medianPrice: e.stats?.median_price || null,
    }));
  } catch (e) { return []; }
}

// Use SerpAPI Google Knowledge Graph to get reliable artist stats
async function getArtistStats(artistName) {
  const key = process.env.SERPAPI_KEY;
  if (!key) return null;
  try {
    const q = encodeURIComponent(`${artistName} musician spotify monthly listeners`);
    const url = `https://serpapi.com/search.json?engine=google&q=${q}&api_key=${key}&num=5`;
    const res = await fetch(url);
    if (res.status !== 200) return null;
    const data = JSON.parse(res.data);
    
    const stats = { monthlyListeners: 0, spotifyFollowers: 0, genres: [] };
    
    // Knowledge graph often has stats
    const kg = data.knowledge_graph;
    if (kg) {
      // Try to find listener/follower counts
      const kgText = JSON.stringify(kg);
      const mlMatch = kgText.match(/(\d[\d,.]*)\s*(million|m|billion|b|k|thousand)?\s*monthly\s*listeners/i);
      if (mlMatch) stats.monthlyListeners = parseNumber(mlMatch[1] + (mlMatch[2] || ''));
      if (kg.type) stats.genres.push(kg.type);
    }
    
    // Also check organic results for stats
    const combined = (data.organic_results || []).map(r => `${r.title} ${r.snippet || ''}`).join(' ');
    
    // Monthly listeners
    if (!stats.monthlyListeners) {
      const mlMatch = combined.match(/(\d[\d,.]*)\s*(million|m|billion|b|k|thousand)?\s*monthly\s*listeners/i);
      if (mlMatch) stats.monthlyListeners = parseNumber(mlMatch[1] + (mlMatch[2] || ''));
    }
    
    // Spotify followers
    const sfMatch = combined.match(/(\d[\d,.]*)\s*(million|m|k|thousand)?\s*(?:spotify\s*)?followers/i);
    if (sfMatch) stats.spotifyFollowers = parseNumber(sfMatch[1] + (sfMatch[2] || ''));
    
    console.log(`     SerpAPI: ${stats.monthlyListeners > 0 ? (stats.monthlyListeners/1e6).toFixed(1)+'M listeners' : 'no listener data'}`);
    return stats;
  } catch (e) { console.log(`     SerpAPI error: ${e.message}`); return null; }
}

async function getBandsintown(artistName) {
  try {
    const encoded = encodeURIComponent(artistName);
    const url = `https://rest.bandsintown.com/artists/${encoded}/events?app_id=squarespace-blackbeard&date=upcoming`;
    const res = await fetch(url);
    if (res.status !== 200) return [];
    return JSON.parse(res.data);
  } catch (e) { return []; }
}

async function twitterSearch(query) {
  const token = process.env.TWITTER_BEARER_TOKEN;
  if (!token) return [];
  try {
    const url = `https://api.twitter.com/2/tweets/search/recent?query=${encodeURIComponent(query)}&max_results=20&tweet.fields=public_metrics,created_at`;
    const res = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
    if (res.status !== 200) return [];
    const data = JSON.parse(res.data);
    return data.data || [];
  } catch (e) { return []; }
}

// ---- Existing Data Lookup ----

function loadExistingData(artistName) {
  const lower = artistName.toLowerCase();
  
  // Check rising-stars.json
  try {
    const rs = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'docs', 'data', 'rising-stars.json'), 'utf8'));
    const match = (rs.artists || []).find(a => a.name?.toLowerCase() === lower);
    if (match) return match;
  } catch (e) {}
  
  // Check watchlist
  try {
    const wl = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'watchlist.json'), 'utf8'));
    const match = (wl.artists || []).find(a => a.name?.toLowerCase() === lower);
    if (match) return { ...match, source: 'watchlist' };
  } catch (e) {}
  
  return null;
}

// ---- Sellout Scoring Engine ----

function predictSellout(artistName, braveResults, events, bitEvents, tweets, existing, redditResult) {
  let score = 0;
  const factors = [];
  const warnings = [];
  
  const combined = braveResults.map(r => `${r.title} ${r.snippet}`).join(' ');
  const lower = combined.toLowerCase();
  
  // ==========================================
  // 1. DEMAND SIGNALS (max 30)
  // ==========================================
  let demandScore = 0;
  
  // Monthly listeners — try multiple patterns from Brave + existing data
  let ml = existing?.monthlyListeners || 0;
  const mlPatterns = [
    /(\d[\d,.]*)\s*(m|million|k|thousand)?\s*monthly\s*listeners/i,
    /monthly\s*listeners[:\s]*(\d[\d,.]*)\s*(m|million|k|thousand)?/i,
    /(\d[\d,.]*)\s*(m|million|k|thousand)?\s*(?:spotify|streams)/i,
  ];
  for (const p of mlPatterns) {
    const m = combined.match(p);
    if (m) { const parsed = parseNumber(m[1] + (m[2] || '')); if (parsed > ml) ml = parsed; break; }
  }
  
  if (ml >= 30000000) { demandScore += 15; factors.push(`${(ml/1e6).toFixed(1)}M monthly listeners — superstar demand`); }
  else if (ml >= 10000000) { demandScore += 12; factors.push(`${(ml/1e6).toFixed(1)}M monthly listeners — massive demand`); }
  else if (ml >= 3000000) { demandScore += 9; factors.push(`${(ml/1e6).toFixed(1)}M monthly listeners — strong`); }
  else if (ml >= 1000000) { demandScore += 7; factors.push(`${(ml/1e6).toFixed(1)}M monthly listeners — solid`); }
  else if (ml >= 300000) { demandScore += 4; factors.push(`${(ml/1000).toFixed(0)}K monthly listeners`); }
  else if (ml > 0) { demandScore += 2; factors.push(`${(ml/1000).toFixed(0)}K monthly listeners — niche`); }
  
  // Social following
  let ttFollowers = existing?.tiktokFollowers || 0;
  let igFollowers = existing?.instagramFollowers || 0;
  let ytSubs = existing?.youtubeSubscribers || 0;
  let spFollowers = existing?.spotifyFollowers || 0;
  
  const ttMatch = combined.match(/(\d[\d,.]*)\s*(m|million|k|thousand)?\s*(?:tiktok|tik\s*tok)\s*followers/i);
  if (ttMatch) { const v = parseNumber(ttMatch[1] + (ttMatch[2] || '')); if (v > ttFollowers) ttFollowers = v; }
  
  if (ttFollowers >= 10000000) { demandScore += 6; factors.push(`TikTok: ${(ttFollowers/1e6).toFixed(1)}M — massive viral reach`); }
  else if (ttFollowers >= 5000000) { demandScore += 4; factors.push(`TikTok: ${(ttFollowers/1e6).toFixed(1)}M`); }
  else if (ttFollowers >= 1000000) { demandScore += 2; factors.push(`TikTok: ${(ttFollowers/1e6).toFixed(1)}M`); }
  
  if (igFollowers >= 5000000) { demandScore += 3; factors.push(`Instagram: ${(igFollowers/1e6).toFixed(1)}M`); }
  if (ytSubs >= 2000000) { demandScore += 2; factors.push(`YouTube: ${(ytSubs/1e6).toFixed(1)}M subs`); }
  if (spFollowers >= 5000000) { demandScore += 3; factors.push(`${(spFollowers/1e6).toFixed(1)}M Spotify followers — committed fans`); }
  else if (spFollowers >= 1000000) { demandScore += 2; factors.push(`${(spFollowers/1e6).toFixed(1)}M Spotify followers`); }
  
  // Buzz mentions
  const buzzPatterns = [/blow(?:ing|n)\s*up/i, /breakout/i, /rising\s*star/i, /explod/i, /viral/i, /trending/i, /on\s*the\s*rise/i, /one\s*to\s*watch/i, /next\s*big/i, /skyrocket/i, /surge/i, /momentum/i, /hottest/i, /phenomenon/i, /sensation/i];
  let buzzCount = 0;
  for (const p of buzzPatterns) if (p.test(combined)) buzzCount++;
  if (buzzCount >= 5) { demandScore += 6; factors.push(`🔥 ${buzzCount} buzz signals — major media heat`); }
  else if (buzzCount >= 3) { demandScore += 4; factors.push(`🔥 ${buzzCount} buzz/growth mentions`); }
  else if (buzzCount >= 1) { demandScore += 2; factors.push(`📡 ${buzzCount} growth mention(s)`); }
  
  score += Math.min(demandScore, 35);
  
  // ==========================================
  // 2. SOLD-OUT HISTORY (max 30) — strongest predictor, weighted highest
  // ==========================================
  let soldOutScore = 0;
  
  // From Brave search
  const soldOutPatterns = [/sold[\s-]*out/i, /selling\s*out/i, /sells?\s*out/i, /no\s*tickets\s*(?:left|available|remaining)/i, /completely\s*sold/i, /sell[\s-]*out/i];
  let soldOutMentions = 0;
  let soldOutSnippets = [];
  for (const r of braveResults) {
    const text = `${r.title} ${r.snippet}`;
    for (const p of soldOutPatterns) {
      if (p.test(text)) { soldOutMentions++; soldOutSnippets.push(r.title); break; }
    }
  }
  
  // From existing data — add existing mentions
  const existingSoldOut = existing?.soldOutMentions || 0;
  const totalSoldOut = soldOutMentions + existingSoldOut;
  
  // Multi-source verified = gold standard
  if (existing?.soldOutSourceCount >= 3) {
    soldOutScore += 18;
    factors.push(`✅ Sold-out confirmed by ${existing.soldOutSourceCount} independent sources — VERY STRONG`);
  } else if (existing?.soldOutSourceCount >= 2) {
    soldOutScore += 14;
    factors.push(`✅ Sold-out verified by ${existing.soldOutSourceCount} sources — strong signal`);
  }
  
  // Raw mention volume — sold-out history is THE strongest sellout predictor
  if (totalSoldOut >= 10) { soldOutScore += 20; factors.push(`🔥 ${totalSoldOut} sold-out mentions — overwhelming evidence`); }
  else if (totalSoldOut >= 7) { soldOutScore += 16; factors.push(`${totalSoldOut} sold-out mentions — consistent pattern`); }
  else if (totalSoldOut >= 5) { soldOutScore += 12; factors.push(`${totalSoldOut} sold-out mentions — strong pattern`); }
  else if (totalSoldOut >= 3) { soldOutScore += 8; factors.push(`${totalSoldOut} sold-out mentions`); }
  else if (totalSoldOut >= 1) { soldOutScore += 4; factors.push(`${totalSoldOut} sold-out reference(s)`); }
  
  // "Added dates" or "extended tour" = previous dates sold well
  if (/added\s*(?:dates|shows)|extend(?:ed|s)\s*tour|due\s*to\s*(?:popular|demand)|second\s*show|added\s*(?:a\s*)?second/i.test(combined)) {
    soldOutScore += 6;
    factors.push(`📈 Added shows/extended tour — previous dates sold strongly`);
  }
  
  // Twitter sold-out buzz
  const soldOutTweets = tweets.filter(t => /sold[\s-]*out|no\s*tickets|sold\s*out/i.test(t.text || ''));
  if (soldOutTweets.length >= 3) { soldOutScore += 5; factors.push(`${soldOutTweets.length} recent tweets about sellouts`); }
  else if (soldOutTweets.length >= 1) { soldOutScore += 2; factors.push(`Twitter chatter about sellouts`); }
  
  // SeatGeek event score (demand proxy — higher = more popular)
  if (events.length > 0) {
    const avgSgScore = events.reduce((a, e) => a + (e.score || 0), 0) / events.length;
    if (avgSgScore >= 0.85) { soldOutScore += 6; factors.push(`SeatGeek demand: ${avgSgScore.toFixed(2)} — very high`); }
    else if (avgSgScore >= 0.7) { soldOutScore += 4; factors.push(`SeatGeek demand: ${avgSgScore.toFixed(2)} — elevated`); }
    else if (avgSgScore >= 0.5) { soldOutScore += 2; factors.push(`SeatGeek demand: ${avgSgScore.toFixed(2)}`); }
  }
  
  score += Math.min(soldOutScore, 35);
  
  // ==========================================
  // 3. SUPPLY/SCARCITY (max 20)
  // ==========================================
  let scarcityScore = 0;
  
  const upcomingShows = events.length;
  const bitShowCount = bitEvents.length;
  const totalShows = Math.max(upcomingShows, bitShowCount);
  
  // Few shows + high demand = sellout
  if (ml >= 3000000 && totalShows <= 10) {
    scarcityScore += 10;
    factors.push(`⚠️ Only ${totalShows} shows for ${(ml/1e6).toFixed(1)}M listeners — severe undersupply`);
  } else if (ml >= 1000000 && totalShows <= 10) {
    scarcityScore += 8;
    factors.push(`Only ${totalShows} shows for ${(ml/1e6).toFixed(1)}M listeners — undersupply`);
  } else if (ml >= 500000 && totalShows <= 15) {
    scarcityScore += 5;
    factors.push(`${totalShows} shows for ${(ml/1000).toFixed(0)}K listeners — tight supply`);
  } else if (totalShows <= 5 && ml >= 200000) {
    scarcityScore += 6;
    factors.push(`Only ${totalShows} dates — scarcity`);
  }
  
  // Venue size vs demand mismatch
  if (events.length > 0) {
    const caps = events.filter(e => e.capacity > 0).map(e => e.capacity);
    const avgCap = caps.length > 0 ? caps.reduce((a, b) => a + b, 0) / caps.length : 0;
    
    if (ml >= 5000000 && avgCap > 0 && avgCap < 10000) {
      scarcityScore += 7;
      factors.push(`⚠️ ${(ml/1e6).toFixed(1)}M listeners in ${avgCap.toFixed(0)}-cap venues — undersized`);
    } else if (ml >= 3000000 && avgCap > 0 && avgCap < 5000) {
      scarcityScore += 6;
      factors.push(`⚠️ ${(ml/1e6).toFixed(1)}M listeners in ${avgCap.toFixed(0)}-cap venues — mismatch`);
    } else if (ml >= 1000000 && avgCap > 0 && avgCap < 3000) {
      scarcityScore += 5;
      factors.push(`${(ml/1e6).toFixed(1)}M listeners in ${avgCap.toFixed(0)}-cap venues`);
    }
  }
  
  // SeatGeek listing count (low = scarce)
  const lowListings = events.filter(e => e.listingCount !== null && e.listingCount < 20);
  if (lowListings.length >= 5) { scarcityScore += 5; factors.push(`${lowListings.length} shows with <20 listings — drying up`); }
  else if (lowListings.length >= 3) { scarcityScore += 3; factors.push(`${lowListings.length} shows with low inventory`); }
  
  score += Math.min(scarcityScore, 20);
  
  // ==========================================
  // 4. PRICING SIGNALS (max 15)
  // ==========================================
  let priceScore = 0;
  
  const pricedEvents = events.filter(e => e.avgPrice && e.avgPrice > 0);
  let peakPrice = existing?.peakPrice || 0;
  
  if (pricedEvents.length > 0) {
    const avgPrice = pricedEvents.reduce((a, e) => a + e.avgPrice, 0) / pricedEvents.length;
    const maxPrice = Math.max(...pricedEvents.map(e => e.highestPrice || e.avgPrice));
    peakPrice = Math.max(peakPrice, maxPrice);
    
    if (avgPrice >= 300) { priceScore += 10; factors.push(`💰 Avg resale: $${avgPrice.toFixed(0)} — elite demand`); }
    else if (avgPrice >= 200) { priceScore += 8; factors.push(`💰 Avg resale: $${avgPrice.toFixed(0)} — premium`); }
    else if (avgPrice >= 100) { priceScore += 5; factors.push(`💰 Avg resale: $${avgPrice.toFixed(0)} — strong`); }
    else if (avgPrice >= 50) { priceScore += 3; factors.push(`Avg resale: $${avgPrice.toFixed(0)}`); }
    
    if (maxPrice >= 1000) { priceScore += 5; factors.push(`🔥 Peak: $${maxPrice.toFixed(0)} — extreme whale demand`); }
    else if (maxPrice >= 500) { priceScore += 4; factors.push(`Peak: $${maxPrice.toFixed(0)} — whale demand`); }
    else if (maxPrice >= 200) { priceScore += 2; factors.push(`Peak: $${maxPrice.toFixed(0)}`); }
  } else if (peakPrice > 0) {
    if (peakPrice >= 1000) { priceScore += 8; factors.push(`💰 Known peak: $${peakPrice} — premium market`); }
    else if (peakPrice >= 500) { priceScore += 6; factors.push(`💰 Known peak: $${peakPrice}`); }
    else if (peakPrice >= 100) { priceScore += 3; factors.push(`Known peak: $${peakPrice}`); }
  }
  
  // Price mentions in Brave results
  const priceMatch = combined.match(/\$(\d{3,})/g);
  if (priceMatch && pricedEvents.length === 0) {
    const prices = priceMatch.map(p => parseInt(p.replace('$', '')));
    const maxBravePrice = Math.max(...prices);
    if (maxBravePrice >= 200) { priceScore += 4; factors.push(`💰 Resale prices spotted up to $${maxBravePrice}`); }
  }
  
  score += Math.min(priceScore, 15);
  
  // ==========================================
  // 5. CATALYSTS (max 15)
  // ==========================================
  let catalystScore = 0;
  
  // Album/tour cycle
  if (/new\s*album|debut\s*album|album\s*release|new\s*record|upcoming\s*album/i.test(combined)) {
    catalystScore += 4; factors.push(`💿 New album cycle — tour demand peaks`);
  }
  
  // Festival presence
  const fests = [/coachella/i, /bonnaroo/i, /lollapalooza/i, /governors\s*ball/i, /outside\s*lands/i, /acl|austin\s*city/i, /edc|electric\s*daisy/i, /rolling\s*loud/i, /sxsw/i, /glastonbury/i, /firefly/i, /electric\s*forest/i, /reading\s*(?:and|&)\s*leeds/i];
  let festCount = 0;
  for (const f of fests) if (f.test(combined)) festCount++;
  if (festCount >= 3) { catalystScore += 5; factors.push(`🎪 ${festCount} major festivals — massive exposure`); }
  else if (festCount >= 2) { catalystScore += 4; factors.push(`🎪 ${festCount} major festival bookings`); }
  else if (festCount >= 1) { catalystScore += 2; factors.push(`🎪 Festival booked — visibility boost`); }
  
  // TV/viral/award moment
  if (/SNL|Saturday Night Live/i.test(combined)) { catalystScore += 3; factors.push(`📺 SNL appearance — massive exposure`); }
  if (/Grammy|grammy/i.test(combined)) { catalystScore += 3; factors.push(`🏆 Grammy recognition`); }
  if (/Billboard Hot 100|#1|number[\s-]*one/i.test(combined)) { catalystScore += 3; factors.push(`📈 Billboard Hot 100 / #1 hit`); }
  if (/Fallon|Kimmel|Colbert/i.test(combined)) { catalystScore += 2; factors.push(`📺 Late night TV appearance`); }
  
  // Support tour → headline pipeline
  if (/opening\s*for|support(?:ing)?\s*(?:act|slot)|warm(?:ing)?\s*up\s*for/i.test(combined)) {
    catalystScore += 3; factors.push(`🎤 Support tour slot — headline tour incoming`);
  }
  
  score += Math.min(catalystScore, 15);
  
  // ==========================================
  // 6. VELOCITY (max 25) — growth rate from tracked snapshots
  // ==========================================
  const velocityResult = getVelocityScore(artistName);
  if (velocityResult.score > 0) {
    score += velocityResult.score;
    factors.push(...velocityResult.factors);
  }
  
  // ==========================================
  // 7. REDDIT HYPE INDEX (max 12)
  // ==========================================
  const redditHype = getRedditHypeScore(redditResult);
  if (redditHype.score > 0) {
    score += redditHype.score;
    factors.push(...redditHype.factors);
  }
  
  // ==========================================
  // 8. BREAKOUT PATTERN MATCHING (max 25) — comparison to known breakouts
  // ==========================================
  const patternResult = getPatternMatchScore(artistName, {
    name: artistName,
    monthlyListeners: ml,
    spotifyFollowers: spFollowers,
    tiktokFollowers: ttFollowers,
    instagramFollowers: igFollowers,
    youtubeSubscribers: ytSubs,
    soldOutMentions: totalSoldOut,
    genre: existing?.genre || '',
    avgVenueCapacity: events.length > 0 ? 
      events.filter(e => e.capacity > 0).reduce((a, e) => a + e.capacity, 0) / Math.max(1, events.filter(e => e.capacity > 0).length) : 0,
  });
  if (patternResult.score > 0) {
    score += patternResult.score;
    factors.push(...patternResult.factors);
  }
  
  // ==========================================
  // 9. HISTORICAL DATA — Wayback + Reddit Archives (max 20)
  // Only uses VERIFIED/LIKELY credibility data
  // ==========================================
  let historyScore = 0;
  const histFile = path.join(__dirname, '..', 'data', 'historical', 'wayback-prices.json');
  try {
    if (fs.existsSync(histFile)) {
      const hist = JSON.parse(fs.readFileSync(histFile, 'utf8'));
      
      // Wayback price trajectory
      const wb = hist.wayback?.[artistName];
      if (wb?.snapshots?.length >= 3) {
        const priced = wb.snapshots.filter(s => s.marketPrice || s.lowestPrice);
        if (priced.length >= 3) {
          const marketPrices = priced.map(s => s.marketPrice || s.lowestPrice);
          const avgHistPrice = marketPrices.reduce((a, b) => a + b, 0) / marketPrices.length;
          const maxHistPrice = Math.max(...marketPrices);
          const minHistPrice = Math.min(...marketPrices);
          
          // Price appreciation = demand growth
          const firstHalf = marketPrices.slice(0, Math.floor(marketPrices.length / 2));
          const secondHalf = marketPrices.slice(Math.floor(marketPrices.length / 2));
          const avgFirst = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
          const avgSecond = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;
          
          if (avgSecond > avgFirst * 1.5) {
            historyScore += 6;
            factors.push(`📈 Historical prices rising: $${avgFirst.toFixed(0)} → $${avgSecond.toFixed(0)} (+${((avgSecond/avgFirst - 1)*100).toFixed(0)}%)`);
          } else if (avgSecond > avgFirst * 1.2) {
            historyScore += 3;
            factors.push(`📈 Prices trending up: $${avgFirst.toFixed(0)} → $${avgSecond.toFixed(0)}`);
          } else if (avgSecond < avgFirst * 0.7) {
            factors.push(`📉 Prices declining: $${avgFirst.toFixed(0)} → $${avgSecond.toFixed(0)} — cooling demand`);
          }
          
          // Historical sold-out snapshots
          const soldOutSnaps = wb.snapshots.filter(s => s.soldOut);
          if (soldOutSnaps.length >= 2) {
            historyScore += 5;
            factors.push(`🔴 ${soldOutSnaps.length} historical sold-out snapshots (Wayback verified)`);
          } else if (soldOutSnaps.length === 1) {
            historyScore += 2;
            factors.push(`Historical sold-out snapshot: ${soldOutSnaps[0].date}`);
          }
          
          // Listing count trend (declining = selling through)
          const listed = wb.snapshots.filter(s => s.listingCount > 0);
          if (listed.length >= 3) {
            const firstListings = listed.slice(0, Math.floor(listed.length / 2)).map(s => s.listingCount);
            const lastListings = listed.slice(Math.floor(listed.length / 2)).map(s => s.listingCount);
            const avgFirstL = firstListings.reduce((a, b) => a + b, 0) / firstListings.length;
            const avgLastL = lastListings.reduce((a, b) => a + b, 0) / lastListings.length;
            if (avgLastL < avgFirstL * 0.5) {
              historyScore += 4;
              factors.push(`📉 Listings declining: ${avgFirstL.toFixed(0)} → ${avgLastL.toFixed(0)} avg — supply drying up`);
            }
          }
        }
      }
      
      // Reddit archive credibility (ONLY VERIFIED or LIKELY)
      const rd = hist.reddit?.[artistName];
      if (rd?.credibility) {
        const soldOutCred = rd.credibility.soldOut;
        if (soldOutCred?.credibility === 'VERIFIED') {
          historyScore += 8;
          factors.push(`✅ Reddit VERIFIED sellout history (${soldOutCred.sources} independent sources, ${soldOutCred.totalUpvotes}↑)`);
        } else if (soldOutCred?.credibility === 'LIKELY') {
          historyScore += 4;
          factors.push(`🟡 Reddit LIKELY sellout (${soldOutCred.sources} sources — needs more confirmation)`);
        }
        // UNVERIFIED intentionally excluded
        
        const priceCred = rd.credibility.highPrices;
        if (priceCred?.credibility === 'VERIFIED') {
          historyScore += 3;
          factors.push(`✅ Reddit VERIFIED high resale prices (${priceCred.sources} sources)`);
        }
        
        // Consensus price from Reddit (only if VERIFIED/LIKELY)
        if (rd.consensusPrice?.credibility === 'VERIFIED') {
          factors.push(`💰 Reddit consensus: $${rd.consensusPrice.low}-$${rd.consensusPrice.high} (median $${rd.consensusPrice.median}, ${rd.consensusPrice.sampleSize} posts)`);
        }
      }
    }
  } catch (e) { /* historical data unavailable — skip silently */ }
  
  score += Math.min(historyScore, 20);
  
  // ==========================================
  // FINAL CLASSIFICATION
  // ==========================================
  score = Math.min(score, 100);
  
  let verdict, emoji, confidence;
  if (score >= 75) {
    verdict = 'WILL SELL OUT'; emoji = '🔴'; confidence = 'Very High';
  } else if (score >= 60) {
    verdict = 'LIKELY SELLS OUT'; emoji = '🟠'; confidence = 'High';
  } else if (score >= 45) {
    verdict = 'GOOD CHANCE'; emoji = '🟡'; confidence = 'Moderate';
  } else if (score >= 30) {
    verdict = 'POSSIBLE'; emoji = '🔵'; confidence = 'Low-Moderate';
  } else if (score >= 15) {
    verdict = 'UNLIKELY'; emoji = '⚪'; confidence = 'Low';
  } else {
    verdict = 'NO SIGNAL'; emoji = '⬜'; confidence = 'Insufficient Data';
  }
  
  // Warnings
  if (totalShows === 0) warnings.push('⚠️ No upcoming shows found — prediction based on demand only');
  if (ml === 0 && !existing) warnings.push('⚠️ No streaming data found — limited prediction');
  if (pricedEvents.length === 0 && peakPrice === 0) warnings.push('No resale pricing data available');
  
  return {
    artist: artistName,
    score,
    verdict,
    emoji,
    confidence,
    factors,
    warnings,
    data: {
      monthlyListeners: ml,
      spotifyFollowers: spFollowers || existing?.spotifyFollowers || 0,
      tiktokFollowers: ttFollowers,
      instagramFollowers: igFollowers,
      youtubeSubscribers: ytSubs,
      upcomingShows: totalShows,
      avgPrice: pricedEvents.length > 0 ? pricedEvents.reduce((a, e) => a + e.avgPrice, 0) / pricedEvents.length : null,
      peakPrice,
      soldOutMentions,
      verificationTier: existing?.verificationTier || null,
      velocityStage: velocityResult.stage || null,
      patternMatches: patternResult.matches?.slice(0, 3) || [],
    }
  };
}

// ---- Main Prediction ----

async function predictArtist(artistName) {
  console.log(`\n🏴‍☠️ Predicting sellout for: ${artistName}`);
  console.log('─'.repeat(50));
  
  // 1. Check existing data
  let existing = loadExistingData(artistName);
  if (existing) console.log(`  📂 Found in database (${existing.verificationTier || existing.tier || 'tracked'})`);
  
  // 2. SerpAPI — structured Google results for stats
  console.log('  📊 Checking SerpAPI...');
  const serpStats = await getArtistStats(artistName);
  if (serpStats) {
    if (!existing) existing = {};
    if (serpStats.monthlyListeners > (existing.monthlyListeners || 0)) existing.monthlyListeners = serpStats.monthlyListeners;
    if (serpStats.spotifyFollowers > (existing.spotifyFollowers || 0)) existing.spotifyFollowers = serpStats.spotifyFollowers;
  }
  await delay(300);
  
  // 3. Brave Search — sold-out + demand signals
  console.log('  🔍 Searching Brave...');
  const braveResults = await braveSearch(`"${artistName}" concert tickets sold out 2025 2026`);
  await delay(400);
  
  // 4. Brave Search — stats/momentum
  const statsResults = await braveSearch(`"${artistName}" monthly listeners followers tour 2026`);
  await delay(400);
  
  // 5. SeatGeek events + pricing
  console.log('  🎟️ Checking SeatGeek...');
  const events = await getSeatGeekEvents(artistName);
  await delay(300);
  
  // 6. Bandsintown
  console.log('  📅 Checking Bandsintown...');
  const bitEvents = await getBandsintown(artistName);
  await delay(300);
  
  // 7. Twitter buzz
  console.log('  🐦 Checking Twitter...');
  const tweets = await twitterSearch(`"${artistName}" sold out OR tickets OR presale`);
  
  // 8. Reddit hype
  console.log('  📡 Checking Reddit...');
  const redditResult = await getRedditMentions(artistName);
  await delay(300);
  
  // Combine Brave results
  const allBrave = [...braveResults, ...statsResults];
  
  // Run prediction
  const result = predictSellout(artistName, allBrave, events, bitEvents, tweets, existing, redditResult);
  
  return result;
}

function formatPrediction(p) {
  let msg = `${p.emoji} **${p.artist}** — ${p.verdict} (${p.score}/100)\n`;
  msg += `Confidence: ${p.confidence}\n\n`;
  
  if (p.factors.length > 0) {
    msg += '**Why:**\n';
    for (const f of p.factors) msg += `  • ${f}\n`;
  }
  
  if (p.warnings.length > 0) {
    msg += '\n';
    for (const w of p.warnings) msg += `${w}\n`;
  }
  
  // Key stats line
  const stats = [];
  if (p.data.monthlyListeners) stats.push(`${(p.data.monthlyListeners/1e6).toFixed(1)}M listeners`);
  if (p.data.upcomingShows) stats.push(`${p.data.upcomingShows} shows`);
  if (p.data.avgPrice) stats.push(`avg $${p.data.avgPrice.toFixed(0)}`);
  if (p.data.peakPrice) stats.push(`peak $${p.data.peakPrice}`);
  if (stats.length > 0) msg += `\n📊 ${stats.join(' • ')}`;
  
  return msg;
}

function formatDiscordAlert(predictions) {
  let msg = '🏴‍☠️ **SELLOUT PREDICTIONS** 🔮\n\n';
  
  // Group by verdict
  const tiers = [
    { label: '🔴 WILL SELL OUT', min: 80 },
    { label: '🟠 LIKELY SELLS OUT', min: 65 },
    { label: '🟡 GOOD CHANCE', min: 50 },
    { label: '🔵 POSSIBLE', min: 35 },
    { label: '⚪ UNLIKELY', min: 0 },
  ];
  
  for (const tier of tiers) {
    const artists = predictions.filter(p => {
      if (tier.min === 80) return p.score >= 80;
      if (tier.min === 65) return p.score >= 65 && p.score < 80;
      if (tier.min === 50) return p.score >= 50 && p.score < 65;
      if (tier.min === 35) return p.score >= 35 && p.score < 50;
      return p.score < 35;
    });
    
    if (artists.length === 0) continue;
    
    msg += `**${tier.label}:**\n`;
    for (const p of artists) {
      msg += `• **${p.artist}** (${p.score}) — ${p.factors[0] || 'monitoring'}\n`;
    }
    msg += '\n';
  }
  
  return msg;
}

// ---- CLI ----
async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log('Usage: node predict-artist.js "Artist Name"');
    console.log('       node predict-artist.js --batch "Artist1" "Artist2" ...');
    process.exit(1);
  }
  
  const isBatch = args[0] === '--batch';
  const artists = isBatch ? args.slice(1) : [args.join(' ')];
  
  const predictions = [];
  
  for (const artist of artists) {
    try {
      const p = await predictArtist(artist);
      predictions.push(p);
      console.log('\n' + formatPrediction(p));
      console.log('─'.repeat(50));
      if (artists.length > 1) await delay(1000); // rate limit between batch
    } catch (e) {
      console.error(`  ❌ Error predicting ${artist}: ${e.message}`);
    }
  }
  
  if (predictions.length > 1) {
    console.log('\n\n' + formatDiscordAlert(predictions));
  }
  
  // Save results
  const outPath = path.join(__dirname, '..', 'data', 'predictions-latest.json');
  fs.writeFileSync(outPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    predictions: predictions.sort((a, b) => b.score - a.score),
  }, null, 2));
  console.log(`\n💾 Saved to ${outPath}`);
}

module.exports = { predictArtist, formatPrediction, formatDiscordAlert };

if (require.main === module) {
  main().catch(e => { console.error(e); process.exit(1); });
}
