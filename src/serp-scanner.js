#!/usr/bin/env node
// SerpAPI-powered scanner — Reddit + Twitter + Google Trends combined
// Uses ~30-40 SerpAPI calls per scan (budget: ~900/month on Starter = 1 scan/day)

const https = require('https');
const fs = require('fs');
const path = require('path');

const SERPAPI_KEY = process.env.SERPAPI_KEY || '';
const PREV_FILE = path.join(__dirname, '..', 'reports', 'serp-prev.json');

function loadPrev() {
  try { return JSON.parse(fs.readFileSync(PREV_FILE, 'utf8')); }
  catch { return { seenUrls: [], lastScan: null }; }
}
function savePrev(data) {
  const dir = path.dirname(PREV_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(PREV_FILE, JSON.stringify(data, null, 2));
}

function serpSearch(query, extra = '') {
  return new Promise((resolve) => {
    const url = `https://serpapi.com/search.json?engine=google&q=${encodeURIComponent(query)}&num=10&tbs=qdr:d${extra}&api_key=${SERPAPI_KEY}`;
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

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function runScan() {
  console.log('🔍 SerpAPI Scanner starting... (' + new Date().toISOString() + ')');
  const prev = loadPrev();
  const seenUrls = new Set(prev.seenUrls || []);
  const findings = [];

  // =============================================
  // REDDIT SEARCHES (via Google, last 24h)
  // =============================================
  const redditQueries = [
    'site:reddit.com "sold out" tickets concert 2026',
    'site:reddit.com "sold out" tickets comedy tour 2026',
    'site:reddit.com "added second show" OR "added dates" OR "venue upgrade" tour 2026',
    'site:reddit.com "presale code" tickets 2026',
    'site:reddit.com college baseball tickets "sold out" SEC',
    'site:reddit.com wrestling tickets "sold out" NCAA Big Ten',
    'site:reddit.com Steelers "season tickets" OR "PSL" sell OR sale OR transfer',
    'site:reddit.com "just announced" tour tickets 2026 small venue OR club',
    'site:reddit.com spring training tickets "sold out" 2026',
    'site:reddit.com "selling fast" OR "almost sold out" tickets 2026',
  ];

  console.log('\n📱 Reddit (via Google)...');
  for (const q of redditQueries) {
    const results = await serpSearch(q);
    for (const r of results) {
      const url = r.link?.split('?')[0];
      if (url && !seenUrls.has(url)) {
        findings.push({
          source: 'reddit',
          title: r.title || '',
          snippet: r.snippet || '',
          url: url,
          subreddit: url.match(/reddit\.com\/r\/([^/]+)/)?.[1] || 'unknown',
        });
        seenUrls.add(url);
      }
    }
    await sleep(1500);
  }
  console.log(`  Found ${findings.filter(f => f.source === 'reddit').length} Reddit results`);

  // =============================================
  // TWITTER/X SEARCHES (via Google, last 24h)
  // =============================================
  const twitterQueries = [
    'site:twitter.com OR site:x.com "sold out" tickets tour 2026',
    'site:twitter.com OR site:x.com "just announced" tour tickets 2026',
    'site:twitter.com OR site:x.com "added shows" OR "added dates" tour 2026',
    'site:twitter.com OR site:x.com "presale" tickets concert 2026',
    'site:twitter.com OR site:x.com "venue upgrade" OR "second show added" 2026',
    'site:twitter.com OR site:x.com "selling fast" tickets 2026',
  ];

  console.log('\n🐦 Twitter/X (via Google)...');
  const twitterStart = findings.length;
  for (const q of twitterQueries) {
    const results = await serpSearch(q);
    for (const r of results) {
      const url = r.link?.split('?')[0];
      if (url && !seenUrls.has(url) && (url.includes('twitter.com') || url.includes('x.com'))) {
        findings.push({
          source: 'twitter',
          title: r.title || '',
          snippet: r.snippet || '',
          url: url,
          handle: url.match(/(?:twitter|x)\.com\/([^/]+)/)?.[1] || 'unknown',
        });
        seenUrls.add(url);
      }
    }
    await sleep(1500);
  }
  console.log(`  Found ${findings.length - twitterStart} Twitter results`);

  // =============================================
  // GENERAL WEB — onsale/sold-out news (last 24h)
  // =============================================
  const webQueries = [
    '"sold out" tour concert 2026 small venue OR club OR theater',
    '"added second show" OR "added dates" tour 2026 tickets',
    '"venue upgrade" tour 2026 demand',
    '"presale" concert tickets onsale this week March 2026',
    'college sports tickets "sold out" 2026 wrestling gymnastics baseball',
  ];

  console.log('\n🌐 Web (news/blogs)...');
  const webStart = findings.length;
  for (const q of webQueries) {
    const results = await serpSearch(q);
    for (const r of results) {
      const url = r.link?.split('?')[0];
      if (url && !seenUrls.has(url) && !url.includes('reddit.com') && !url.includes('twitter.com') && !url.includes('x.com')) {
        findings.push({
          source: 'web',
          title: r.title || '',
          snippet: r.snippet || '',
          url: url,
          site: r.displayed_link?.split('/')[0] || 'unknown',
        });
        seenUrls.add(url);
      }
    }
    await sleep(1500);
  }
  console.log(`  Found ${findings.length - webStart} Web results`);

  // =============================================
  // SCORE & FILTER
  // =============================================
  console.log(`\n📊 Total raw findings: ${findings.length}`);

  // Score each finding by relevance
  const scored = findings.map(f => {
    const text = (f.title + ' ' + f.snippet).toLowerCase();
    let score = 0;

    // Sold out signals (highest value)
    if (text.includes('sold out') || text.includes('sell out')) score += 30;
    if (text.includes('added second show') || text.includes('added dates')) score += 25;
    if (text.includes('venue upgrade')) score += 25;
    if (text.includes('selling fast') || text.includes('almost sold out')) score += 20;

    // Presale/onsale intel
    if (text.includes('presale code') || text.includes('presale')) score += 15;
    if (text.includes('on sale') || text.includes('onsale')) score += 10;

    // Ticket scarcity keywords
    if (text.includes('tickets left') || text.includes('limited')) score += 10;
    if (text.includes('resale') || text.includes('stubhub') || text.includes('seatgeek')) score += 5;

    // Small venue / niche (our focus)
    if (text.includes('small venue') || text.includes('club') || text.includes('theater') || text.includes('ballroom')) score += 10;
    if (text.includes('college') || text.includes('ncaa') || text.includes('sec ')) score += 10;
    if (text.includes('comedy') || text.includes('comedian')) score += 8;

    // Steelers PSL (special interest)
    if (text.includes('steeler') && (text.includes('psl') || text.includes('season ticket'))) score += 40;

    // Penalize noise
    if (text.includes('nfl draft') || text.includes('fantasy') || text.includes('mock draft')) score -= 20;
    if (text.includes('k-pop') || text.includes('bts ') || text.includes('blackpink')) score -= 10;

    return { ...f, score };
  });

  // Sort by score, take top findings
  scored.sort((a, b) => b.score - a.score);
  const top = scored.filter(f => f.score >= 15);

  console.log(`Relevant findings (score >= 15): ${top.length}`);

  // =============================================
  // FORMAT ALERT
  // =============================================
  let alert = '';
  if (top.length > 0) {
    alert = '🔍 **SERP INTELLIGENCE SCAN** — ' + new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }) + '\n\n';

    // Group by category
    const soldOut = top.filter(f => (f.title + f.snippet).toLowerCase().match(/sold out|sell out/));
    const expansion = top.filter(f => (f.title + f.snippet).toLowerCase().match(/added.*show|added.*date|venue upgrade/));
    const presale = top.filter(f => (f.title + f.snippet).toLowerCase().match(/presale|on.?sale/));
    const other = top.filter(f => !soldOut.includes(f) && !expansion.includes(f) && !presale.includes(f));

    if (soldOut.length > 0) {
      alert += '🚨 **SOLD OUT / SELLING FAST**\n';
      for (const f of soldOut.slice(0, 8)) {
        const icon = f.source === 'reddit' ? '💬' : f.source === 'twitter' ? '🐦' : '🌐';
        alert += `${icon} **${f.title.substring(0, 80)}**\n`;
        if (f.snippet) alert += `> ${f.snippet.substring(0, 150)}\n`;
        alert += `<${f.url}>\n\n`;
      }
    }

    if (expansion.length > 0) {
      alert += '🚀 **ADDED DATES / VENUE UPGRADES**\n';
      for (const f of expansion.slice(0, 5)) {
        const icon = f.source === 'reddit' ? '💬' : f.source === 'twitter' ? '🐦' : '🌐';
        alert += `${icon} ${f.title.substring(0, 80)}\n<${f.url}>\n\n`;
      }
    }

    if (presale.length > 0) {
      alert += '🎟️ **PRESALE / ONSALE INTEL**\n';
      for (const f of presale.slice(0, 5)) {
        const icon = f.source === 'reddit' ? '💬' : f.source === 'twitter' ? '🐦' : '🌐';
        alert += `${icon} ${f.title.substring(0, 80)}\n<${f.url}>\n\n`;
      }
    }

    if (other.length > 0) {
      alert += '📌 **OTHER SIGNALS**\n';
      for (const f of other.slice(0, 5)) {
        const icon = f.source === 'reddit' ? '💬' : f.source === 'twitter' ? '🐦' : '🌐';
        alert += `${icon} ${f.title.substring(0, 80)}\n<${f.url}>\n\n`;
      }
    }

    alert += `\n_Sources: ${findings.filter(f => f.source === 'reddit').length} Reddit • ${findings.filter(f => f.source === 'twitter').length} Twitter • ${findings.filter(f => f.source === 'web').length} Web_`;
  } else {
    alert = '🔍 SerpAPI Scan complete — no high-signal findings today.';
  }

  // Save state
  savePrev({ seenUrls: [...seenUrls], lastScan: new Date().toISOString() });

  console.log('\n--- ALERT ---');
  console.log(alert);
  console.log('--- END ---');

  return alert;
}

runScan().catch(console.error);
