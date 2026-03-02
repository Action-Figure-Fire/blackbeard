#!/usr/bin/env node
// Steelers Season Ticket / PSL License Scanner
// Monitors Craigslist Pittsburgh + Brave Search for full season ticket license sales
// Alerts to Discord ⏰alerts⏰ channel

const https = require('https');
const fs = require('fs');
const path = require('path');

const BRAVE_API_KEY = process.env.BRAVE_API_KEY || '';
const PREV_FILE = path.join(__dirname, '..', 'reports', 'steelers-prev.json');

// Load previously seen URLs
function loadPrev() {
  try { return JSON.parse(fs.readFileSync(PREV_FILE, 'utf8')); }
  catch { return { seenUrls: [] }; }
}
function savePrev(data) {
  const dir = path.dirname(PREV_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(PREV_FILE, JSON.stringify(data, null, 2));
}

// Brave Search
function braveSearch(query) {
  return new Promise((resolve, reject) => {
    const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=10&freshness=pw`;
    const opts = { headers: { 'X-Subscription-Token': BRAVE_API_KEY, 'Accept': 'application/json' } };
    https.get(url, opts, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const j = JSON.parse(data);
          resolve((j.web?.results || []).map(r => ({
            title: r.title, url: r.url, description: r.description, published: r.age || ''
          })));
        } catch (e) { resolve([]); }
      });
    }).on('error', () => resolve([]));
  });
}

// Craigslist Pittsburgh search
function searchCraigslist() {
  return new Promise((resolve, reject) => {
    const url = 'https://pittsburgh.craigslist.org/search/tia?query=steelers+season+tickets&sort=date';
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 15000 }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        const listings = [];
        // Parse CL listing titles and URLs from HTML
        const regex = /<a[^>]*href="(\/[^"]*)"[^>]*class="posting-title"[^>]*>[\s\S]*?<span class="label">([\s\S]*?)<\/span>/gi;
        let match;
        while ((match = regex.exec(data)) !== null) {
          listings.push({
            url: 'https://pittsburgh.craigslist.org' + match[1],
            title: match[2].trim(),
            source: 'craigslist'
          });
        }
        // Fallback: try simpler pattern
        if (listings.length === 0) {
          const simpleRegex = /href="(https:\/\/pittsburgh\.craigslist\.org\/[^"]*)"[^>]*>(.*?)<\/a>/gi;
          while ((match = simpleRegex.exec(data)) !== null) {
            const title = match[2].replace(/<[^>]*>/g, '').trim();
            if (title.toLowerCase().includes('steeler') || title.toLowerCase().includes('season')) {
              listings.push({ url: match[1], title, source: 'craigslist' });
            }
          }
        }
        resolve(listings);
      });
    }).on('error', () => resolve([]));
  });
}

async function runScan() {
  console.log('🏈 Steelers PSL/Season Ticket Scanner starting...');
  const prev = loadPrev();
  const seenUrls = new Set(prev.seenUrls || []);
  const allResults = [];

  // Brave searches
  const queries = [
    // Direct sale listings
    '"Steelers" "season tickets" "for sale" OR "selling" OR "transfer"',
    '"Steelers" "PSL" "for sale" OR "selling" OR "transfer" OR "license"',
    '"Steelers" "seat license" sell OR transfer OR price',
    '"Steelers" "full season" tickets owner selling 2026',
    'Pittsburgh Steelers PSL seat license owner sale price',
    // Marketplaces
    'site:facebook.com/marketplace "Steelers" season tickets',
    'site:craigslist.org "Steelers" season tickets',
    'site:offerup.com Steelers season tickets',
    // Reddit
    'site:reddit.com/r/steelers season tickets selling PSL',
    'site:reddit.com/r/steelers "selling" OR "for sale" tickets season',
    'site:reddit.com/r/pittsburghsteelers season tickets selling',
    // Forums
    'site:steelernationforum.com season tickets selling OR sale OR transfer',
    'site:steelersdepot.com PSL season tickets sell',
    // Broader
    '"Acrisure Stadium" season tickets sell OR transfer OR PSL',
  ];

  for (const q of queries) {
    try {
      const results = await braveSearch(q);
      for (const r of results) {
        // Filter for relevance
        const text = (r.title + ' ' + r.description).toLowerCase();
        const hasTeam = text.includes('steeler') || text.includes('pittsburgh');
        const hasTicket = text.includes('season') || text.includes('psl') || text.includes('license') || text.includes('seat license') || text.includes('ticket');
        const hasSale = text.includes('sell') || text.includes('sale') || text.includes('transfer') || text.includes('buy') || 
             text.includes('marketplace') || text.includes('craigslist') || text.includes('price') || text.includes('$') ||
             text.includes('offer') || text.includes('available') || text.includes('looking');
        // Exclude news/analysis articles about the team (not ticket sales)
        const isNews = r.url.includes('yahoo.com/articles') || r.url.includes('wikipedia.org') || 
             r.url.includes('espn.com/nfl/story') || r.url.includes('bleacherreport.com') ||
             r.url.includes('nbcsports.com') || r.url.includes('sportskeeda.com') ||
             r.url.includes('sbnation.com') || r.url.includes('nfl.com/news') ||
             r.url.includes('cbssports.com/nfl') || r.url.includes('profootballtalk');
        // Boost: actual marketplace/forum/classifieds
        const isMarketplace = r.url.includes('facebook.com/marketplace') || r.url.includes('craigslist.org') ||
             r.url.includes('offerup.com') || r.url.includes('reddit.com') || 
             r.url.includes('forum') || r.url.includes('steelernation');
        if (hasTeam && hasTicket && (hasSale || isMarketplace) && !isNews) {
          allResults.push({ ...r, source: 'brave' });
        }
      }
    } catch (e) { console.error('Brave search error:', e.message); }
    await new Promise(r => setTimeout(r, 500));
  }

  // Craigslist direct
  try {
    const clResults = await searchCraigslist();
    allResults.push(...clResults);
  } catch (e) { console.error('CL error:', e.message); }

  // Dedup by URL
  const unique = [];
  const urlSet = new Set();
  for (const r of allResults) {
    const cleanUrl = r.url.split('?')[0].split('#')[0];
    if (!urlSet.has(cleanUrl)) {
      urlSet.add(cleanUrl);
      unique.push(r);
    }
  }

  // Filter out previously seen
  const newResults = unique.filter(r => !seenUrls.has(r.url.split('?')[0].split('#')[0]));

  console.log(`Found ${unique.length} total results, ${newResults.length} new`);

  // Build alert
  let alert = '';
  if (newResults.length > 0) {
    alert = '🏈 **STEELERS SEASON TICKET / PSL SCANNER** 🏈\n';
    alert += `Found **${newResults.length}** new listing(s):\n\n`;
    for (const r of newResults.slice(0, 15)) {
      alert += `**${r.title}**\n`;
      if (r.description) alert += `> ${r.description.substring(0, 200)}\n`;
      alert += `🔗 <${r.url}>\n`;
      alert += `📍 Source: ${r.source} ${r.published ? '| ' + r.published : ''}\n\n`;
    }
    if (newResults.length > 15) {
      alert += `_...and ${newResults.length - 15} more results_\n`;
    }
  } else {
    alert = '🏈 Steelers PSL Scanner: No new listings found this scan. Will check again tomorrow.';
  }

  // Update seen URLs
  for (const r of unique) {
    seenUrls.add(r.url.split('?')[0].split('#')[0]);
  }
  savePrev({ seenUrls: [...seenUrls], lastScan: new Date().toISOString() });

  // Output alert
  console.log('\n--- ALERT ---');
  console.log(alert);
  console.log('--- END ---');
  
  return alert;
}

runScan().catch(console.error);
