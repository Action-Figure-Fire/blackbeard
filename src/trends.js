#!/usr/bin/env node
// Google Trends data via SerpAPI + Brave Search signals
// Provides real Google Trends interest-over-time data plus web demand signals

const https = require('https');
const SERPAPI_KEY = process.env.SERPAPI_KEY || '';
const BRAVE_KEY = process.env.BRAVE_API_KEY || '';

// Google Trends via SerpAPI (real data)
function getGoogleTrends(keyword) {
  return new Promise((resolve) => {
    if (!SERPAPI_KEY) { resolve(null); return; }
    const url = `https://serpapi.com/search.json?engine=google_trends&q=${encodeURIComponent(keyword)}&data_type=TIMESERIES&date=today+3-m&geo=US&api_key=${SERPAPI_KEY}`;
    https.get(url, { timeout: 15000 }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try {
          const j = JSON.parse(d);
          const timeline = j.interest_over_time?.timeline_data || [];
          if (timeline.length < 4) { resolve(null); return; }
          const last4 = timeline.slice(-4);
          const prev4 = timeline.slice(-8, -4);
          const current = last4.reduce((s, p) => s + p.values[0].extracted_value, 0) / last4.length;
          const previous = prev4.length ? prev4.reduce((s, p) => s + p.values[0].extracted_value, 0) / prev4.length : current;
          const change = previous > 0 ? Math.round((current - previous) / previous * 100) : 0;
          const peak = Math.max(...timeline.map(p => p.values[0].extracted_value));
          const latest = timeline.slice(-1)[0]?.values[0].extracted_value || 0;
          resolve({ current: Math.round(current), peak, change, latest, dataPoints: timeline.length });
        } catch { resolve(null); }
      });
    }).on('error', () => resolve(null));
  });
}

// Google search for sold-out/demand signals via SerpAPI
function searchGoogle(query) {
  return new Promise((resolve) => {
    if (!SERPAPI_KEY) { resolve([]); return; }
    const url = `https://serpapi.com/search.json?engine=google&q=${encodeURIComponent(query)}&num=10&api_key=${SERPAPI_KEY}`;
    https.get(url, { timeout: 15000 }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve(JSON.parse(d).organic_results || []); }
        catch { resolve([]); }
      });
    }).on('error', () => resolve([]));
  });
}

// Brave search fallback
function braveSearch(query) {
  return new Promise((resolve) => {
    if (!BRAVE_KEY) { resolve([]); return; }
    const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=5&freshness=pm`;
    https.get(url, { headers: { 'X-Subscription-Token': BRAVE_KEY, 'Accept': 'application/json' }, timeout: 10000 }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d).web?.results || []); } catch { resolve([]); } });
    }).on('error', () => resolve([]));
  });
}

// Full analysis for a keyword
async function analyzeEvent(keyword) {
  const result = {
    keyword,
    googleTrends: null,
    soldOutMentions: 0,
    demandSignals: [],
    score: 0,
    trend: 'unknown'
  };

  // 1. Google Trends (real data via SerpAPI)
  result.googleTrends = await getGoogleTrends(keyword);
  await sleep(1200);

  // 2. Sold-out mentions via Google
  const soldOutResults = await searchGoogle(`"${keyword}" "sold out" tickets 2026`);
  result.soldOutMentions = soldOutResults.filter(r => {
    const text = (r.title + ' ' + (r.snippet || '')).toLowerCase();
    return text.includes('sold out') || text.includes('sell out');
  }).length;
  if (result.soldOutMentions > 0) {
    result.demandSignals.push(`🎟️ ${result.soldOutMentions} "sold out" Google results`);
  }
  await sleep(1200);

  // 3. Expansion signals (added dates, venue upgrades)
  const expansionResults = await braveSearch(`"${keyword}" "added" OR "upgrade" OR "second show" OR "extended" tour 2026`);
  const expansionCount = expansionResults.filter(r => {
    const text = (r.title + ' ' + (r.description || '')).toLowerCase();
    return (text.includes('added') || text.includes('upgrade') || text.includes('extended') || text.includes('second show')) &&
           text.includes(keyword.toLowerCase().split(' ')[0]);
  }).length;
  if (expansionCount > 0) {
    result.demandSignals.push(`🚀 ${expansionCount} expansion signals`);
  }

  // 4. Google Trends signals
  if (result.googleTrends) {
    const gt = result.googleTrends;
    if (gt.change > 50) result.demandSignals.push(`📈 Google Trends: +${gt.change}% (4-week trend)`);
    else if (gt.change > 10) result.demandSignals.push(`📈 Google Trends: +${gt.change}%`);
    else if (gt.change < -30) result.demandSignals.push(`📉 Google Trends: ${gt.change}% (cooling)`);

    if (gt.current >= 70) result.demandSignals.push(`🔥 Google Trends: ${gt.current}/100 interest`);
  }

  // 5. Composite score
  let score = 20; // baseline
  if (result.googleTrends) {
    score += Math.min(result.googleTrends.current * 0.3, 30); // up to 30 from trends
    if (result.googleTrends.change > 50) score += 15;
    else if (result.googleTrends.change > 20) score += 8;
  }
  score += result.soldOutMentions * 10; // up to ~30 from sold-out mentions
  score += expansionCount * 8; // up to ~16 from expansion signals
  result.score = Math.min(Math.round(score), 100);

  // 6. Trend classification
  if (result.score >= 75) result.trend = '🔺 HIGH DEMAND';
  else if (result.score >= 55) result.trend = '📈 ELEVATED';
  else if (result.score >= 40) result.trend = '➡️ MODERATE';
  else result.trend = '⬜ LOW';

  return result;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function batchAnalyze(keywords) {
  const results = [];
  for (const kw of keywords) {
    console.log(`Analyzing: ${kw}...`);
    const r = await analyzeEvent(kw);
    results.push(r);
    const gtStr = r.googleTrends ? ` | GT: ${r.googleTrends.current}/100 (${r.googleTrends.change > 0 ? '+' : ''}${r.googleTrends.change}%)` : '';
    console.log(`  ${r.trend} ${r.score}/100${gtStr}`);
    r.demandSignals.forEach(s => console.log(`    ${s}`));
    await sleep(500);
  }
  return results;
}

module.exports = { analyzeEvent, batchAnalyze, getGoogleTrends, searchGoogle };

if (require.main === module) {
  const keywords = process.argv.slice(2);
  if (keywords.length === 0) {
    console.log('Usage: node trends.js "Freya Skye" "Cat Power tour" ...');
    process.exit(0);
  }
  batchAnalyze(keywords).then(results => {
    console.log('\n=== SUMMARY ===');
    results.sort((a, b) => b.score - a.score);
    results.forEach(r => {
      const gtStr = r.googleTrends ? ` (GT: ${r.googleTrends.current}/100, ${r.googleTrends.change > 0 ? '+' : ''}${r.googleTrends.change}%)` : '';
      console.log(`${r.trend} ${r.keyword}: ${r.score}/100${gtStr}`);
    });
  });
}
