/**
 * Blackbeard 🏴‍☠️ — Breakout Predictor
 * Identifies artists likely to crush presales BEFORE tickets go on sale
 * 
 * Scoring Algorithm (0-100):
 * 
 * MOMENTUM (max 35):
 *   - Monthly listener velocity (growth rate over 3-6 months)
 *   - Social follower growth signals
 *   - Playlist additions (editorial playlist momentum)
 *   - Google Trends movement
 * 
 * VENUE PROGRESSION (max 25):
 *   - Venue size escalation (300→1500 cap = breakout)
 *   - Sold-out history at current tier
 *   - Market expansion (adding new cities)
 * 
 * CATALYST SIGNALS (max 25):
 *   - Support slot on major tour (→ headline tour incoming)
 *   - Festival billing upgrade
 *   - Viral moment (TikTok, meme, TV appearance)
 *   - Album/EP release within 6 months
 *   - Label signing or distribution deal
 * 
 * SCARCITY INDICATORS (max 15):
 *   - Low show count relative to demand
 *   - Small venue bookings despite high listener count
 *   - Geographic gaps (huge fanbase in cities with no dates)
 * 
 * Output tiers:
 *   🔮 BREAKOUT IMMINENT (80+) — presale will likely crush, act on announcement
 *   ⚡ HIGH POTENTIAL (60-79) — watch closely, prepare to move fast
 *   📡 ON THE RADAR (40-59) — monitoring, building case
 *   ⚪ DEVELOPING (<40) — early signal, needs more data
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

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

function fetch(url, options = {}) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : require('http');
    const req = mod.get(url, {
      headers: { 'User-Agent': 'Blackbeard-Breakout/1.0', ...options.headers },
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

// ---- Data Loaders ----

function loadWatchlist() {
  const p = path.join(__dirname, '..', 'data', 'watchlist.json');
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function loadDiscoveryCache() {
  const p = path.join(__dirname, '..', 'data', 'discovery-cache.json');
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return {}; }
}

function loadRisingStars() {
  const p = path.join(__dirname, '..', 'docs', 'data', 'rising-stars.json');
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return { redHot: [], warm: [] }; }
}

function loadBreakoutState() {
  const p = path.join(__dirname, '..', 'data', 'breakout-state.json');
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return { artists: {}, lastFullScan: null }; }
}

function saveBreakoutState(data) {
  const dir = path.join(__dirname, '..', 'data');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'breakout-state.json'), JSON.stringify(data, null, 2));
}

function loadWatchlistCache() {
  const p = path.join(__dirname, '..', 'data', 'watchlist-stats-cache.json');
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return {}; }
}

// ---- Brave Search Helper ----

async function braveSearch(query) {
  const key = process.env.BRAVE_API_KEY;
  if (!key) return [];
  try {
    const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=8&freshness=pm`;
    const res = await fetch(url, { headers: { 'X-Subscription-Token': key } });
    if (res.status !== 200) return [];
    const data = JSON.parse(res.data);
    return (data.web?.results || []).map(r => ({
      title: r.title || '',
      description: r.description || '',
      url: r.url,
    }));
  } catch (e) { return []; }
}

// ---- Number Parser ----

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

// ---- SeatGeek Helper ----

async function getSeatGeekEvents(artistName) {
  const sgId = process.env.SEATGEEK_CLIENT_ID;
  const sgSecret = process.env.SEATGEEK_SECRET;
  if (!sgId) return [];
  try {
    const q = encodeURIComponent(artistName);
    const url = `https://api.seatgeek.com/2/events?q=${q}&client_id=${sgId}&client_secret=${sgSecret}&per_page=20&sort=datetime_utc.asc`;
    const res = await fetch(url);
    if (res.status !== 200) return [];
    const data = JSON.parse(res.data);
    return (data.events || []).map(e => ({
      title: e.title,
      venue: e.venue?.name || '',
      city: e.venue?.city || '',
      state: e.venue?.state || '',
      capacity: e.venue?.capacity || 0,
      date: e.datetime_local,
      score: e.score || 0,
      lowestPrice: e.stats?.lowest_sg_base_price || e.stats?.lowest_price || null,
      avgPrice: e.stats?.average_price || null,
      listingCount: e.stats?.listing_count || null,
    }));
  } catch (e) { return []; }
}

// ---- Signal Extractors ----

// Extract monthly listeners, social stats, growth signals from Brave results
function extractMomentumSignals(results, artistName) {
  const signals = {
    monthlyListeners: 0,
    listenerGrowth: null, // percentage or description
    tiktokFollowers: 0,
    instagramFollowers: 0,
    twitterFollowers: 0,
    playlistAdds: [],
    viralMoments: [],
    growthMentions: 0,
  };

  const combined = results.map(r => `${r.title} ${r.description}`).join(' ');
  const lower = combined.toLowerCase();

  // Monthly listeners
  const mlMatch = combined.match(/(\d[\d,.]*)\s*(m|million|k|thousand)?\s*monthly\s*listeners/i);
  if (mlMatch) signals.monthlyListeners = parseNumber(mlMatch[1] + (mlMatch[2] || ''));

  // TikTok
  const ttMatch = combined.match(/(\d[\d,.]*)\s*(m|million|k|thousand)?\s*(?:tiktok|tik\s*tok)\s*followers/i) ||
                  combined.match(/tiktok[:\s]*(\d[\d,.]*)\s*(m|million|k|thousand)?/i);
  if (ttMatch) signals.tiktokFollowers = parseNumber(ttMatch[1] + (ttMatch[2] || ''));

  // Instagram
  const igMatch = combined.match(/(\d[\d,.]*)\s*(m|million|k|thousand)?\s*(?:instagram|ig)\s*followers/i) ||
                  combined.match(/instagram[:\s]*(\d[\d,.]*)\s*(m|million|k|thousand)?/i);
  if (igMatch) signals.instagramFollowers = parseNumber(igMatch[1] + (igMatch[2] || ''));

  // Growth signals
  const growthPatterns = [
    /blow(?:ing|n)\s*up/i, /breakout/i, /break\s*out/i, /rising\s*star/i,
    /fastest.growing/i, /rapid(?:ly)?\s*grow/i, /explod(?:ing|ed)/i,
    /viral/i, /went\s*viral/i, /trending/i, /on\s*the\s*rise/i,
    /one\s*to\s*watch/i, /artist\s*to\s*watch/i, /next\s*big/i,
    /skyrocket/i, /surge|surging/i, /momentum/i,
  ];
  for (const p of growthPatterns) {
    if (p.test(combined)) signals.growthMentions++;
  }

  // Playlist mentions
  const playlistPatterns = [
    /pop\s*rising/i, /rock\s*rising/i, /dance\s*rising/i, /hot\s*country/i,
    /new\s*music\s*friday/i, /rap\s*caviar/i, /today'?s\s*top\s*hits/i,
    /all\s*new\s*(?:indie|rock|punk)/i, /mint/i, /editorial\s*playlist/i,
    /discover\s*weekly/i, /release\s*radar/i,
  ];
  for (const p of playlistPatterns) {
    if (p.test(combined)) {
      const match = combined.match(p);
      if (match) signals.playlistAdds.push(match[0]);
    }
  }

  // Viral moments
  const viralPatterns = [
    /tiktok\s*(?:hit|viral|trend)/i, /went\s*viral/i, /snl|saturday\s*night\s*live/i,
    /jimmy\s*(?:fallon|kimmel)/i, /colbert/i, /seth\s*meyers/i, /coachella/i,
    /grammy/i, /billboard\s*hot\s*100/i, /number\s*one/i, /#1/i,
    /debut.*album/i, /new\s*album/i, /ep\s*release/i,
  ];
  for (const p of viralPatterns) {
    if (p.test(combined)) {
      const match = combined.match(p);
      if (match) signals.viralMoments.push(match[0]);
    }
  }

  return signals;
}

// Extract catalyst signals (support tours, festival billing, label deals)
function extractCatalystSignals(results, artistName) {
  const signals = {
    supportTour: null,      // "opening for [headliner]"
    festivalBilling: [],    // festival appearances
    labelDeal: null,        // label signing
    albumRelease: null,     // upcoming/recent release
    tvAppearance: null,     // late night, SNL, etc.
    awardNom: null,         // Grammy, etc.
  };

  const combined = results.map(r => `${r.title} ${r.description}`).join(' ');

  // Support tour detection
  const supportMatch = combined.match(/(?:opening|support(?:ing)?|warm(?:ing)?\s*up)\s*(?:for|act\s*for)\s*["']?([A-Za-z][A-Za-z\s&.]+?)["']?\s*(?:on|tour|at|\.|,)/i) ||
                       combined.match(/(?:join(?:ing|s)?|added\s*to)\s*["']?([A-Za-z][A-Za-z\s&.]+?)["']?\s*(?:tour|on\s*tour)/i);
  if (supportMatch) signals.supportTour = supportMatch[1].trim();

  // Festival billing
  const festPatterns = [
    /coachella/i, /bonnaroo/i, /lollapalooza/i, /governors\s*ball/i,
    /outside\s*lands/i, /austin\s*city\s*limits/i, /electric\s*daisy/i,
    /ultra/i, /edc/i, /firefly/i, /pitchfork\s*fest/i, /primavera/i,
    /glastonbury/i, /reading/i, /hard\s*summer/i, /rolling\s*loud/i,
    /sxsw/i, /summerfest/i, /electric\s*forest/i, /lost\s*lands/i,
    /bass\s*canyon/i, /shambhala/i, /red\s*rocks/i,
  ];
  for (const p of festPatterns) {
    if (p.test(combined)) {
      const match = combined.match(p);
      if (match) signals.festivalBilling.push(match[0]);
    }
  }

  // Album/EP release
  const albumMatch = combined.match(/(?:new|debut|upcoming|announces?)\s*(?:album|ep|record|lp)\s*["']?([^"'\n,]{3,40})["']?/i) ||
                     combined.match(/["']([^"']{3,40})["']\s*(?:album|ep)\s*(?:out|release|drop|coming)/i);
  if (albumMatch) signals.albumRelease = albumMatch[1]?.trim() || 'upcoming release';

  // Label deal
  const labelMatch = combined.match(/sign(?:ed|s|ing)\s*(?:with|to)\s*["']?([A-Za-z][A-Za-z\s&.]+?)["']?\s*(?:records|music|label|entertainment|\.|,)/i);
  if (labelMatch) signals.labelDeal = labelMatch[1].trim();

  // TV appearance
  const tvMatch = combined.match(/(SNL|Saturday Night Live|Jimmy Fallon|Jimmy Kimmel|Colbert|Seth Meyers|James Corden|Graham Norton|Ellen|Kelly Clarkson|GMA|Today Show|Tiny Desk)/i);
  if (tvMatch) signals.tvAppearance = tvMatch[1];

  return signals;
}

// ---- Scoring Engine ----

function scoreBreakoutPotential(artist, momentum, catalysts, events, prevState) {
  let score = 0;
  const reasons = [];

  // ==========================================
  // MOMENTUM (max 35)
  // ==========================================
  let momentumScore = 0;

  // Monthly listener sweet spot: 200K-5M = breakout zone
  const ml = momentum.monthlyListeners;
  if (ml >= 200000 && ml < 500000) { momentumScore += 8; reasons.push(`${(ml/1000).toFixed(0)}K listeners — early breakout zone`); }
  else if (ml >= 500000 && ml < 1000000) { momentumScore += 10; reasons.push(`${(ml/1000).toFixed(0)}K listeners — prime breakout zone`); }
  else if (ml >= 1000000 && ml < 3000000) { momentumScore += 12; reasons.push(`${(ml/1000000).toFixed(1)}M listeners — hot zone`); }
  else if (ml >= 3000000 && ml < 5000000) { momentumScore += 8; reasons.push(`${(ml/1000000).toFixed(1)}M listeners — established but still scalable`); }
  else if (ml >= 5000000) { momentumScore += 4; reasons.push(`${(ml/1000000).toFixed(1)}M listeners — large base, less upside`); }
  else if (ml > 0) { momentumScore += 3; reasons.push(`${(ml/1000).toFixed(0)}K listeners — early stage`); }

  // Listener velocity (compare to previous scan)
  const prev = prevState?.monthlyListeners;
  if (prev && ml && prev > 0) {
    const growth = ((ml - prev) / prev) * 100;
    if (growth > 50) { momentumScore += 10; reasons.push(`🚀 ${growth.toFixed(0)}% listener growth since last scan`); }
    else if (growth > 20) { momentumScore += 7; reasons.push(`📈 ${growth.toFixed(0)}% listener growth`); }
    else if (growth > 5) { momentumScore += 4; reasons.push(`↗️ ${growth.toFixed(0)}% listener growth`); }
    else if (growth < -10) { momentumScore -= 3; reasons.push(`↘️ ${growth.toFixed(0)}% listener decline`); }
  }

  // Growth buzz mentions
  if (momentum.growthMentions >= 4) { momentumScore += 6; reasons.push(`🔥 ${momentum.growthMentions} growth/buzz mentions across sources`); }
  else if (momentum.growthMentions >= 2) { momentumScore += 4; reasons.push(`📡 ${momentum.growthMentions} growth mentions`); }
  else if (momentum.growthMentions >= 1) { momentumScore += 2; reasons.push(`Signal: growth mentioned`); }

  // Playlist additions
  if (momentum.playlistAdds.length >= 3) { momentumScore += 5; reasons.push(`🎵 ${momentum.playlistAdds.length} playlist placements: ${momentum.playlistAdds.join(', ')}`); }
  else if (momentum.playlistAdds.length >= 1) { momentumScore += 3; reasons.push(`🎵 Playlist: ${momentum.playlistAdds.join(', ')}`); }

  // TikTok (huge predictor for concert demand)
  if (momentum.tiktokFollowers >= 1000000) { momentumScore += 4; reasons.push(`TikTok: ${(momentum.tiktokFollowers/1000000).toFixed(1)}M followers`); }
  else if (momentum.tiktokFollowers >= 300000) { momentumScore += 2; reasons.push(`TikTok: ${(momentum.tiktokFollowers/1000).toFixed(0)}K followers`); }

  score += Math.min(momentumScore, 35);

  // ==========================================
  // VENUE PROGRESSION (max 25)
  // ==========================================
  let venueScore = 0;

  if (events.length > 0) {
    const capacities = events.filter(e => e.capacity > 0).map(e => e.capacity);
    const avgCap = capacities.length > 0 ? capacities.reduce((a, b) => a + b, 0) / capacities.length : 0;
    const maxCap = capacities.length > 0 ? Math.max(...capacities) : 0;
    const uniqueCities = new Set(events.map(e => e.city)).size;
    const upcomingCount = events.length;

    // Venue size vs listener mismatch (high listeners + small venues = SCARCITY)
    if (ml >= 1000000 && avgCap < 3000 && avgCap > 0) {
      venueScore += 10;
      reasons.push(`⚠️ ${(ml/1000000).toFixed(1)}M listeners but avg venue only ${avgCap.toFixed(0)} cap — extreme undersupply`);
    } else if (ml >= 500000 && avgCap < 2000 && avgCap > 0) {
      venueScore += 8;
      reasons.push(`⚠️ ${(ml/1000).toFixed(0)}K listeners but avg venue ${avgCap.toFixed(0)} cap — undersupply`);
    } else if (ml >= 200000 && avgCap < 1000 && avgCap > 0) {
      venueScore += 6;
      reasons.push(`${(ml/1000).toFixed(0)}K listeners in ${avgCap.toFixed(0)}-cap venues — tight supply`);
    }

    // Compare to previous venue sizes (progression)
    const prevAvgCap = prevState?.avgVenueCap;
    if (prevAvgCap && avgCap > prevAvgCap * 1.5) {
      venueScore += 8;
      reasons.push(`📈 Venue upgrade: avg ${prevAvgCap.toFixed(0)} → ${avgCap.toFixed(0)} cap (+${((avgCap/prevAvgCap-1)*100).toFixed(0)}%)`);
    } else if (prevAvgCap && avgCap > prevAvgCap * 1.2) {
      venueScore += 5;
      reasons.push(`↗️ Venue size growing: ${prevAvgCap.toFixed(0)} → ${avgCap.toFixed(0)} cap`);
    }

    // Market expansion
    if (uniqueCities >= 15) { venueScore += 5; reasons.push(`🌎 ${uniqueCities} cities — national tour`); }
    else if (uniqueCities >= 8) { venueScore += 3; reasons.push(`📍 ${uniqueCities} cities`); }

    // Low show count relative to listeners (scarcity)
    if (ml >= 500000 && upcomingCount <= 5) {
      venueScore += 4;
      reasons.push(`Only ${upcomingCount} upcoming shows for ${(ml/1000).toFixed(0)}K listeners — scarce`);
    }
  }

  score += Math.min(venueScore, 25);

  // ==========================================
  // CATALYST SIGNALS (max 25)
  // ==========================================
  let catalystScore = 0;

  // Support tour → headline pipeline
  if (catalysts.supportTour) {
    catalystScore += 10;
    reasons.push(`🎤 Opening for ${catalysts.supportTour} — headline tour likely incoming`);
  }

  // Festival billing
  if (catalysts.festivalBilling.length >= 3) {
    catalystScore += 8;
    reasons.push(`🎪 ${catalysts.festivalBilling.length} festivals: ${catalysts.festivalBilling.slice(0,3).join(', ')}`);
  } else if (catalysts.festivalBilling.length >= 1) {
    catalystScore += 5;
    reasons.push(`🎪 Festival: ${catalysts.festivalBilling.join(', ')}`);
  }

  // Album/EP release
  if (catalysts.albumRelease) {
    catalystScore += 6;
    reasons.push(`💿 Release: "${catalysts.albumRelease}" — tours follow releases`);
  }

  // Label deal
  if (catalysts.labelDeal) {
    catalystScore += 5;
    reasons.push(`📝 Signed to ${catalysts.labelDeal} — bigger tours incoming`);
  }

  // TV/media appearance
  if (catalysts.tvAppearance) {
    catalystScore += 6;
    reasons.push(`📺 ${catalysts.tvAppearance} appearance — mainstream exposure spike`);
  }

  // Viral moments
  if (momentum.viralMoments.length >= 2) {
    catalystScore += 6;
    reasons.push(`🔥 Viral signals: ${momentum.viralMoments.join(', ')}`);
  } else if (momentum.viralMoments.length >= 1) {
    catalystScore += 3;
    reasons.push(`📡 ${momentum.viralMoments[0]}`);
  }

  score += Math.min(catalystScore, 25);

  // ==========================================
  // SCARCITY INDICATORS (max 15)
  // ==========================================
  let scarcityScore = 0;

  // SeatGeek score (demand proxy)
  const avgSgScore = events.length > 0 ? events.reduce((a, e) => a + (e.score || 0), 0) / events.length : 0;
  if (avgSgScore >= 0.8) { scarcityScore += 5; reasons.push(`SeatGeek demand score: ${avgSgScore.toFixed(2)} (very high)`); }
  else if (avgSgScore >= 0.6) { scarcityScore += 3; reasons.push(`SeatGeek score: ${avgSgScore.toFixed(2)} (elevated)`); }

  // Pricing signals (if available)
  const pricedEvents = events.filter(e => e.avgPrice && e.avgPrice > 0);
  if (pricedEvents.length > 0) {
    const avgPrice = pricedEvents.reduce((a, e) => a + e.avgPrice, 0) / pricedEvents.length;
    if (avgPrice >= 150) { scarcityScore += 5; reasons.push(`💰 Avg resale: $${avgPrice.toFixed(0)} — premium demand`); }
    else if (avgPrice >= 80) { scarcityScore += 3; reasons.push(`💰 Avg resale: $${avgPrice.toFixed(0)} — strong`); }
  }

  // Zero listings = likely sold out
  const soldOutEvents = events.filter(e => e.listingCount === 0);
  if (soldOutEvents.length >= 3) { scarcityScore += 5; reasons.push(`🎟️ ${soldOutEvents.length} shows with 0 listings — likely sold out`); }
  else if (soldOutEvents.length >= 1) { scarcityScore += 3; reasons.push(`🎟️ ${soldOutEvents.length} show(s) with 0 listings`); }

  score += Math.min(scarcityScore, 15);

  // ==========================================
  // TIER CLASSIFICATION
  // ==========================================
  let tier, emoji;
  if (score >= 80) { tier = 'BREAKOUT IMMINENT'; emoji = '🔮'; }
  else if (score >= 60) { tier = 'HIGH POTENTIAL'; emoji = '⚡'; }
  else if (score >= 40) { tier = 'ON THE RADAR'; emoji = '📡'; }
  else { tier = 'DEVELOPING'; emoji = '⚪'; }

  return {
    score: Math.min(score, 100),
    tier,
    emoji,
    reasons,
    data: {
      monthlyListeners: ml,
      tiktokFollowers: momentum.tiktokFollowers,
      instagramFollowers: momentum.instagramFollowers,
      playlistAdds: momentum.playlistAdds,
      viralMoments: momentum.viralMoments,
      growthMentions: momentum.growthMentions,
      supportTour: catalysts.supportTour,
      festivalBilling: catalysts.festivalBilling,
      albumRelease: catalysts.albumRelease,
      labelDeal: catalysts.labelDeal,
      tvAppearance: catalysts.tvAppearance,
      upcomingShows: events.length,
      avgVenueCap: events.filter(e => e.capacity > 0).length > 0 ?
        events.filter(e => e.capacity > 0).reduce((a, e) => a + e.capacity, 0) / events.filter(e => e.capacity > 0).length : 0,
    },
  };
}

// ---- Main Scan ----

async function runBreakoutScan() {
  console.log('🔮 Blackbeard Breakout Predictor running...');
  const now = new Date();
  
  const watchlist = loadWatchlist();
  const discoveryCache = loadDiscoveryCache();
  const risingStars = loadRisingStars();
  const state = loadBreakoutState();
  let braveCallCount = 0;
  const MAX_BRAVE_CALLS = 40;

  // Build candidate list: watchlist artists + rising stars
  const candidates = [];
  
  // All watchlist artists
  for (const a of watchlist.artists) {
    candidates.push({ name: a.name, category: a.category, tier: a.tier, source: 'watchlist' });
  }
  
  // Rising stars not already in watchlist
  const watchlistNames = new Set(watchlist.artists.map(a => a.name.toLowerCase()));
  for (const rs of [...(risingStars.redHot || []), ...(risingStars.warm || [])]) {
    if (!watchlistNames.has(rs.name?.toLowerCase())) {
      candidates.push({ name: rs.name, category: rs.category || 'unknown', tier: 'RS', source: 'rising-stars' });
    }
  }

  console.log(`  Analyzing ${candidates.length} candidates...`);
  const results = [];

  for (const artist of candidates) {
    if (braveCallCount >= MAX_BRAVE_CALLS) {
      console.log(`  ⚠️ Brave API budget reached (${MAX_BRAVE_CALLS} calls)`);
      break;
    }

    console.log(`  📊 ${artist.name}...`);

    // Query 1: Momentum + stats
    const momentumResults = await braveSearch(`"${artist.name}" artist monthly listeners followers 2026`);
    braveCallCount++;
    await new Promise(r => setTimeout(r, 400));

    // Query 2: Catalysts (tours, festivals, releases)
    const catalystResults = await braveSearch(`"${artist.name}" tour festival album 2026 announced`);
    braveCallCount++;
    await new Promise(r => setTimeout(r, 400));

    // SeatGeek events
    const events = await getSeatGeekEvents(artist.name);
    await new Promise(r => setTimeout(r, 300));

    // Extract signals
    const momentum = extractMomentumSignals([...momentumResults, ...catalystResults], artist.name);
    const catalysts = extractCatalystSignals(catalystResults, artist.name);

    // Previous state for velocity comparison
    const prevArtistState = state.artists[artist.name] || null;

    // Score
    const prediction = scoreBreakoutPotential(artist, momentum, catalysts, events, prevArtistState);

    // Update state
    state.artists[artist.name] = {
      lastScanned: now.toISOString(),
      monthlyListeners: momentum.monthlyListeners || prevArtistState?.monthlyListeners || 0,
      avgVenueCap: prediction.data.avgVenueCap || prevArtistState?.avgVenueCap || 0,
      lastScore: prediction.score,
    };

    results.push({
      name: artist.name,
      category: artist.category,
      watchlistTier: artist.tier,
      source: artist.source,
      ...prediction,
    });
  }

  // Sort by score descending
  results.sort((a, b) => b.score - a.score);

  state.lastFullScan = now.toISOString();
  saveBreakoutState(state);

  // Build Discord alert
  let alertMsg = null;
  const breakouts = results.filter(r => r.score >= 60);
  const radar = results.filter(r => r.score >= 40 && r.score < 60);

  if (breakouts.length > 0 || radar.length > 0) {
    alertMsg = '🔮 **BREAKOUT PREDICTOR** 🏴‍☠️\n_Artists most likely to crush their next presale_\n\n';

    const imminent = breakouts.filter(r => r.score >= 80);
    const highPot = breakouts.filter(r => r.score >= 60 && r.score < 80);

    if (imminent.length > 0) {
      alertMsg += '**🔮 BREAKOUT IMMINENT (80+):**\n';
      for (const r of imminent) {
        alertMsg += `\n**${r.name}** — Score: **${r.score}/100**\n`;
        for (const reason of r.reasons.slice(0, 5)) {
          alertMsg += `  ${reason}\n`;
        }
      }
      alertMsg += '\n';
    }

    if (highPot.length > 0) {
      alertMsg += '**⚡ HIGH POTENTIAL (60-79):**\n';
      for (const r of highPot) {
        alertMsg += `\n**${r.name}** — Score: **${r.score}/100**\n`;
        for (const reason of r.reasons.slice(0, 4)) {
          alertMsg += `  ${reason}\n`;
        }
      }
      alertMsg += '\n';
    }

    if (radar.length > 0) {
      alertMsg += '**📡 ON THE RADAR (40-59):**\n';
      for (const r of radar.slice(0, 10)) {
        alertMsg += `- **${r.name}** (${r.score}) — ${r.reasons[0] || 'monitoring'}\n`;
      }
    }

    alertMsg += `\n_Scanned ${candidates.length} artists | ${braveCallCount} Brave calls | ${results.filter(r=>r.score>=40).length} actionable predictions_`;
  }

  // Save full report
  const reportDir = path.join(__dirname, '..', 'reports');
  if (!fs.existsSync(reportDir)) fs.mkdirSync(reportDir, { recursive: true });
  fs.writeFileSync(
    path.join(reportDir, 'breakout-latest.json'),
    JSON.stringify({
      timestamp: now.toISOString(),
      candidatesScanned: candidates.length,
      braveCallsUsed: braveCallCount,
      results: results.filter(r => r.score >= 30), // Only save meaningful results
    }, null, 2)
  );

  // Save to docs for dashboard
  const docsDataDir = path.join(__dirname, '..', 'docs', 'data');
  if (!fs.existsSync(docsDataDir)) fs.mkdirSync(docsDataDir, { recursive: true });
  fs.writeFileSync(
    path.join(docsDataDir, 'breakout-predictions.json'),
    JSON.stringify({
      lastUpdated: now.toISOString(),
      imminent: results.filter(r => r.score >= 80),
      highPotential: results.filter(r => r.score >= 60 && r.score < 80),
      onRadar: results.filter(r => r.score >= 40 && r.score < 60),
    }, null, 2)
  );

  console.log(`\n  ✅ Breakout Predictor complete:`);
  console.log(`     ${results.filter(r => r.score >= 80).length} BREAKOUT IMMINENT`);
  console.log(`     ${results.filter(r => r.score >= 60 && r.score < 80).length} HIGH POTENTIAL`);
  console.log(`     ${results.filter(r => r.score >= 40 && r.score < 60).length} ON THE RADAR`);
  console.log(`     ${braveCallCount} Brave API calls used`);

  return { results, alertMsg };
}

module.exports = { runBreakoutScan };

if (require.main === module) {
  runBreakoutScan().then(({ results, alertMsg }) => {
    if (alertMsg) console.log('\n' + alertMsg);
    else console.log('No breakout predictions at this time.');
    process.exit(0);
  }).catch(e => { console.error(e); process.exit(1); });
}
