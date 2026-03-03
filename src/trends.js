#!/usr/bin/env node
// Google Trends data collection via Brave Search proxy
// Since direct Google Trends API requires browser/cookies, we:
// 1. Use Brave Search to find recent trend mentions and search volume indicators
// 2. Use Google Trends RSS for daily trending topics
// 3. Score relative interest based on multiple signals

const https = require('https');
const BRAVE_KEY = process.env.BRAVE_API_KEY || '';

function braveSearch(query) {
  return new Promise((resolve) => {
    const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=5&freshness=pm`;
    https.get(url, { headers: { 'X-Subscription-Token': BRAVE_KEY, 'Accept': 'application/json' }, timeout: 10000 }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d).web?.results || []); } catch { resolve([]); } });
    }).on('error', () => resolve([]));
  });
}

function getTrendingRSS() {
  return new Promise((resolve) => {
    https.get('https://trends.google.com/trending/rss?geo=US', { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 10000 }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        const items = [];
        const regex = /<title>(.*?)<\/title>[\s\S]*?<ht:approx_traffic>(.*?)<\/ht:approx_traffic>/g;
        let match;
        while ((match = regex.exec(data)) !== null) {
          items.push({ query: match[1], traffic: match[2] });
        }
        resolve(items);
      });
    }).on('error', () => resolve([]));
  });
}

// Score search interest for a keyword using multiple signals
async function scoreInterest(keyword) {
  const signals = { keyword, searchVolume: 'unknown', trend: 'unknown', signals: [] };
  
  // 1. Check if keyword is in Google Trends daily trending
  const trending = await getTrendingRSS();
  const isTrending = trending.find(t => t.query.toLowerCase().includes(keyword.toLowerCase()));
  if (isTrending) {
    signals.signals.push(`🔥 Trending on Google (${isTrending.traffic} searches)`);
    signals.trend = 'TRENDING';
  }
  
  // 2. Brave search for "sold out" + keyword
  const soldOutResults = await braveSearch(`"${keyword}" "sold out" tickets 2026`);
  const soldOutCount = soldOutResults.filter(r => {
    const text = (r.title + ' ' + (r.description || '')).toLowerCase();
    return text.includes('sold out') && text.includes(keyword.toLowerCase().split(' ')[0]);
  }).length;
  if (soldOutCount > 0) {
    signals.signals.push(`🎟️ ${soldOutCount} "sold out" mentions found`);
  }
  
  // 3. Brave search for tour/ticket demand
  const demandResults = await braveSearch(`"${keyword}" tour tickets 2026 demand`);
  const demandSignals = demandResults.filter(r => {
    const text = (r.title + ' ' + (r.description || '')).toLowerCase();
    return text.includes('sell') || text.includes('demand') || text.includes('added') || text.includes('upgrade');
  }).length;
  if (demandSignals > 0) {
    signals.signals.push(`📈 ${demandSignals} demand/supply signals`);
  }
  
  // 4. Check for "added dates" or "venue upgrade" signals
  const upgradeResults = await braveSearch(`"${keyword}" "added" OR "upgrade" OR "second show" OR "extended" tour 2026`);
  const upgradeCount = upgradeResults.filter(r => {
    const text = (r.title + ' ' + (r.description || '')).toLowerCase();
    return (text.includes('added') || text.includes('upgrade') || text.includes('extended') || text.includes('second show')) &&
           text.includes(keyword.toLowerCase().split(' ')[0]);
  }).length;
  if (upgradeCount > 0) {
    signals.signals.push(`🚀 ${upgradeCount} expansion signals (added dates/venue upgrades)`);
  }
  
  // Score: 0-100 based on signals
  let score = 20; // baseline
  if (isTrending) score += 30;
  score += soldOutCount * 15;
  score += demandSignals * 10;
  score += upgradeCount * 12;
  signals.score = Math.min(score, 100);
  
  // Trend classification
  if (score >= 70) signals.trend = '🔺 HIGH DEMAND';
  else if (score >= 50) signals.trend = '📈 RISING';
  else if (score >= 35) signals.trend = '➡️ MODERATE';
  else signals.trend = '⬜ LOW';
  
  return signals;
}

// Batch score multiple keywords
async function batchScore(keywords) {
  const results = [];
  for (const kw of keywords) {
    console.log(`Scoring: ${kw}...`);
    const result = await scoreInterest(kw);
    results.push(result);
    console.log(`  ${result.trend} (${result.score}/100) — ${result.signals.join(' | ') || 'No strong signals'}`);
    await new Promise(r => setTimeout(r, 500)); // rate limit
  }
  return results;
}

// Export for use in other modules
module.exports = { scoreInterest, batchScore, getTrendingRSS };

// CLI mode
if (require.main === module) {
  const keywords = process.argv.slice(2);
  if (keywords.length === 0) {
    console.log('Usage: node trends.js "Freya Skye" "Cat Power" "Vanderbilt baseball"');
    console.log('\nFetching daily trending topics instead...\n');
    getTrendingRSS().then(items => {
      items.forEach(i => console.log(`  ${i.query} — ${i.traffic} searches`));
    });
  } else {
    batchScore(keywords).then(results => {
      console.log('\n=== SUMMARY ===');
      results.sort((a, b) => b.score - a.score);
      results.forEach(r => {
        console.log(`${r.trend} ${r.keyword}: ${r.score}/100`);
        r.signals.forEach(s => console.log(`    ${s}`));
      });
    });
  }
}
