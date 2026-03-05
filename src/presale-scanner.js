/**
 * Blackbeard 🏴‍☠️ — Presale Intelligence Scanner
 * Monitors for presale announcements, codes, and onsale dates for watchlist artists
 * 
 * Sources:
 * - Brave Search: "[artist] presale code", "[artist] presale 2026", "[artist] tickets on sale"
 * - SeatGeek: New event listings (event appears = presale/onsale imminent)
 * - Brave: Artist official sites, Ticketmaster pages, fan communities
 * 
 * Runs 3x daily (7 AM, 12 PM, 5 PM ET) — presales typically announce 24-48h before
 * 
 * Alert tiers:
 * 🚨 PRESALE TODAY — presale happening today, act NOW
 * ⏰ PRESALE TOMORROW — presale dropping tomorrow, prepare
 * 📣 PRESALE ANNOUNCED — presale date announced, window is coming
 * 🎟️ GENERAL ONSALE — public onsale date confirmed
 * 🔑 PRESALE CODE — code found (artist, Spotify, venue, Amex, etc.)
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
      headers: { 'User-Agent': 'Blackbeard-Presale-Scanner/1.0', ...options.headers },
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

function loadWatchlist() {
  const p = path.join(__dirname, '..', 'data', 'watchlist.json');
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function loadPresaleState() {
  const p = path.join(__dirname, '..', 'reports', 'presale-state.json');
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return { alerts: {}, codes: {}, lastScan: null }; }
}

function savePresaleState(data) {
  const dir = path.join(__dirname, '..', 'reports');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'presale-state.json'), JSON.stringify(data, null, 2));
}

// ---- Presale detection patterns ----

const PRESALE_PATTERNS = {
  // Presale happening today/now
  today: /presale\s*(is\s*)?(live|now|today|started|open|happening|begins)|on\s*sale\s*now|tickets?\s*available\s*now|get\s*tickets?\s*now|presale\s*code.*today/i,
  
  // Presale tomorrow
  tomorrow: /presale\s*(is\s*)?(tomorrow|starts?\s*tomorrow)|on\s*sale\s*tomorrow|tickets?\s*(go|going)\s*on\s*sale\s*tomorrow/i,
  
  // Presale announced (general)
  announced: /presale\s*(announced|date|begins?|starts?|opens?|code|access)|fan\s*presale|artist\s*presale|spotify\s*presale|venue\s*presale|amex\s*presale|citi\s*presale|vip\s*presale|presale\s*registration|sign\s*up.*presale|register.*presale/i,
  
  // General onsale
  onsale: /general\s*on\s*sale|public\s*on\s*sale|tickets?\s*on\s*sale|on\s*sale\s*(date|friday|this\s*week)|general\s*admission\s*on\s*sale/i,
  
  // Presale codes
  code: /presale\s*code[:\s]*["']?([A-Z0-9]+)["']?|code[:\s]+["']?([A-Z0-9]{3,20})["']?\s*(for|to\s*get)|use\s*code[:\s]+["']?([A-Z0-9]+)["']?/i,
  
  // Just announced tour (means presale coming soon)
  tourAnnounce: /just\s*announced|tour\s*announced|new\s*tour|announces?\s*(tour|dates|shows?)|added\s*(new\s*)?(dates?|shows?)/i,

  // Presale time patterns
  time: /(\d{1,2})\s*(am|pm)\s*(local|[A-Z]{2,4})|10\s*am|noon|12\s*pm/i,
  
  // Date patterns
  date: /(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s+\d{1,2}/i,
};

// Extract presale codes from text
function extractCodes(text) {
  const codes = [];
  // Pattern: "presale code: XXXXX" or "code: XXXXX" or "use code XXXXX"
  const patterns = [
    /presale\s*code[:\s]+["']?([A-Z0-9]{3,20})["']?/gi,
    /(?:use|enter|try)\s*(?:the\s*)?code[:\s]+["']?([A-Z0-9]{3,20})["']?/gi,
    /code\s*(?:is|=)[:\s]*["']?([A-Z0-9]{3,20})["']?/gi,
    /(?:artist|fan|spotify|venue|amex|citi|vip|aeg|live\s*nation)\s*(?:pre-?sale\s*)?code[:\s]+["']?([A-Z0-9]{3,20})["']?/gi,
  ];
  for (const p of patterns) {
    let m;
    while ((m = p.exec(text)) !== null) {
      const code = m[1].toUpperCase();
      // Filter junk
      if (code.length >= 3 && code.length <= 20 && !/^(THE|AND|FOR|GET|USE|NOW|BUY|VIP|ALL|NEW)$/.test(code)) {
        codes.push(code);
      }
    }
  }
  return [...new Set(codes)];
}

// Extract dates from text
function extractDates(text) {
  const months = { jan:1, january:1, feb:2, february:2, mar:3, march:3, apr:4, april:4, may:5, jun:6, june:6, jul:7, july:7, aug:8, august:8, sep:9, september:9, oct:10, october:10, nov:11, november:11, dec:12, december:12 };
  const matches = [];
  const re = /(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s+(\d{1,2})(?:\s*,?\s*(\d{4}))?/gi;
  let m;
  while ((m = re.exec(text)) !== null) {
    const month = months[m[1].toLowerCase()];
    const day = parseInt(m[2]);
    const year = m[3] ? parseInt(m[3]) : 2026;
    if (month && day >= 1 && day <= 31) {
      matches.push(`${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`);
    }
  }
  return matches;
}

// Extract time from text 
function extractTime(text) {
  const m = text.match(/(\d{1,2})\s*(am|pm)\s*(local|[A-Z]{2,4})?/i);
  if (m) return `${m[1]} ${m[2].toUpperCase()}${m[3] ? ' ' + m[3] : ''}`;
  return null;
}

// Classify the urgency of a presale mention
function classifyPresale(text, today) {
  const textLower = text.toLowerCase();
  
  if (PRESALE_PATTERNS.today.test(text)) return { urgency: 'TODAY', emoji: '🚨', priority: 0 };
  if (PRESALE_PATTERNS.tomorrow.test(text)) return { urgency: 'TOMORROW', emoji: '⏰', priority: 1 };
  
  // Check if any extracted date is today or tomorrow
  const dates = extractDates(text);
  const todayStr = today.toISOString().split('T')[0];
  const tmrw = new Date(today); tmrw.setDate(tmrw.getDate() + 1);
  const tmrwStr = tmrw.toISOString().split('T')[0];
  
  for (const d of dates) {
    if (d === todayStr) return { urgency: 'TODAY', emoji: '🚨', priority: 0 };
    if (d === tmrwStr) return { urgency: 'TOMORROW', emoji: '⏰', priority: 1 };
  }
  
  if (PRESALE_PATTERNS.code.test(text)) return { urgency: 'CODE FOUND', emoji: '🔑', priority: 2 };
  if (PRESALE_PATTERNS.announced.test(text)) return { urgency: 'ANNOUNCED', emoji: '📣', priority: 3 };
  if (PRESALE_PATTERNS.onsale.test(text)) return { urgency: 'ONSALE', emoji: '🎟️', priority: 4 };
  if (PRESALE_PATTERNS.tourAnnounce.test(text)) return { urgency: 'NEW TOUR', emoji: '📢', priority: 5 };
  
  return null;
}

// ---- Brave Search queries ----

async function braveSearch(query) {
  const key = process.env.BRAVE_API_KEY;
  if (!key) return [];
  
  try {
    const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=8&freshness=pw`;
    const res = await fetch(url, { headers: { 'X-Subscription-Token': key } });
    if (res.status !== 200) return [];
    const data = JSON.parse(res.data);
    return (data.web?.results || []).map(r => ({
      title: r.title || '',
      description: r.description || '',
      url: r.url,
      age: r.age || '',
    }));
  } catch (e) { return []; }
}

// ---- Main scan ----

async function runPresaleScan() {
  console.log('🎟️ Blackbeard Presale Intelligence Scanner running...');
  const now = new Date();
  // Adjust to ET for date comparisons
  const etOffset = -5; // EST (adjust for EDT if needed)
  const etNow = new Date(now.getTime() + etOffset * 3600000);
  
  const watchlist = loadWatchlist();
  const state = loadPresaleState();
  const alerts = [];
  let braveCallCount = 0;
  const MAX_BRAVE_CALLS = 25; // Budget per scan

  // Priority: Tier A artists first, then B
  const tierA = watchlist.artists.filter(a => a.tier === 'A');
  const tierB = watchlist.artists.filter(a => a.tier === 'B');
  const allArtists = [...tierA, ...tierB];

  // Strategy 1: Batch presale queries (saves API calls)
  // Group artists into batches of 3 for "presale" queries
  const batches = [];
  for (let i = 0; i < allArtists.length; i += 3) {
    batches.push(allArtists.slice(i, i + 3));
  }

  // Run batched presale queries for Tier A artists (most important)
  for (const batch of batches) {
    if (braveCallCount >= MAX_BRAVE_CALLS) break;
    
    const names = batch.map(a => `"${a.name}"`).join(' OR ');
    const query = `(${names}) (presale OR "on sale" OR "presale code") tickets 2026`;
    
    console.log(`  Searching: ${batch.map(a=>a.name).join(', ')}...`);
    const results = await braveSearch(query);
    braveCallCount++;
    
    for (const result of results) {
      const combined = `${result.title} ${result.description}`;
      
      // Match which artist
      let matchedArtist = null;
      for (const a of batch) {
        if (combined.toLowerCase().includes(a.name.toLowerCase())) {
          matchedArtist = a;
          break;
        }
      }
      if (!matchedArtist) continue;
      
      // Classify urgency
      const classification = classifyPresale(combined, etNow);
      if (!classification) continue;
      
      // Dedup by artist + URL
      const key = `${matchedArtist.name}-${result.url}`;
      if (state.alerts[key]) continue;
      
      // Extract any codes
      const codes = extractCodes(combined);
      const dates = extractDates(combined);
      const time = extractTime(combined);
      
      state.alerts[key] = {
        firstSeen: now.toISOString(),
        urgency: classification.urgency,
      };
      
      // Track codes separately
      for (const code of codes) {
        const codeKey = `${matchedArtist.name}-${code}`;
        if (!state.codes[codeKey]) {
          state.codes[codeKey] = {
            artist: matchedArtist.name,
            code,
            source: result.url,
            foundAt: now.toISOString(),
          };
        }
      }
      
      alerts.push({
        artist: matchedArtist.name,
        category: matchedArtist.category,
        tier: matchedArtist.tier,
        ...classification,
        title: result.title,
        description: result.description,
        url: result.url,
        age: result.age,
        codes,
        dates,
        time,
      });
    }
    
    await new Promise(r => setTimeout(r, 500));
  }

  // Strategy 2: Direct "presale code" searches for highest-priority artists
  // These are separate queries to catch codes specifically
  const topArtists = tierA.slice(0, 5); // Top 5 Tier A
  for (const artist of topArtists) {
    if (braveCallCount >= MAX_BRAVE_CALLS) break;
    
    const query = `"${artist.name}" "presale code" 2026`;
    const results = await braveSearch(query);
    braveCallCount++;
    
    for (const result of results) {
      const combined = `${result.title} ${result.description}`;
      const codes = extractCodes(combined);
      
      if (codes.length === 0) continue;
      
      const key = `${artist.name}-code-${result.url}`;
      if (state.alerts[key]) continue;
      
      state.alerts[key] = { firstSeen: now.toISOString(), urgency: 'CODE FOUND' };
      
      for (const code of codes) {
        const codeKey = `${artist.name}-${code}`;
        if (!state.codes[codeKey]) {
          state.codes[codeKey] = {
            artist: artist.name,
            code,
            source: result.url,
            foundAt: now.toISOString(),
          };
        }
      }
      
      // Only add if not already alerted for this artist+code combo
      const existing = alerts.find(a => a.artist === artist.name && a.codes?.some(c => codes.includes(c)));
      if (!existing) {
        alerts.push({
          artist: artist.name,
          category: artist.category,
          tier: artist.tier,
          urgency: 'CODE FOUND',
          emoji: '🔑',
          priority: 2,
          title: result.title,
          description: result.description,
          url: result.url,
          age: result.age,
          codes,
          dates: extractDates(combined),
          time: extractTime(combined),
        });
      }
    }
    
    await new Promise(r => setTimeout(r, 500));
  }

  // Strategy 3: General "presale today" / "presale tomorrow" sweep
  if (braveCallCount < MAX_BRAVE_CALLS) {
    const sweepQueries = [
      'concert presale today tickets 2026',
      'concert presale tomorrow tickets 2026',
      'new tour announced tickets presale 2026',
    ];
    
    for (const q of sweepQueries) {
      if (braveCallCount >= MAX_BRAVE_CALLS) break;
      console.log(`  Sweep: ${q}`);
      const results = await braveSearch(q);
      braveCallCount++;
      
      for (const result of results) {
        const combined = `${result.title} ${result.description}`;
        const classification = classifyPresale(combined, etNow);
        if (!classification || classification.priority > 4) continue; // Only high-urgency from sweep
        
        // Check if any watchlist artist mentioned
        let matchedArtist = null;
        for (const a of allArtists) {
          if (combined.toLowerCase().includes(a.name.toLowerCase())) {
            matchedArtist = a;
            break;
          }
        }
        
        // Even if no watchlist match, capture TODAY/TOMORROW presales for tracked venues
        const venues = loadTrackedVenues();
        let matchedVenue = null;
        if (!matchedArtist) {
          for (const v of venues) {
            if (combined.toLowerCase().includes(v.name.toLowerCase())) {
              matchedVenue = v;
              break;
            }
          }
        }
        
        if (!matchedArtist && !matchedVenue) continue;
        
        const key = `sweep-${result.url}`;
        if (state.alerts[key]) continue;
        state.alerts[key] = { firstSeen: now.toISOString(), urgency: classification.urgency };
        
        alerts.push({
          artist: matchedArtist?.name || `[${matchedVenue?.name}]`,
          category: matchedArtist?.category || 'venue',
          tier: matchedArtist?.tier || 'V',
          ...classification,
          title: result.title,
          description: result.description,
          url: result.url,
          age: result.age,
          codes: extractCodes(combined),
          dates: extractDates(combined),
          time: extractTime(combined),
          venueMatch: matchedVenue?.name || null,
        });
      }
      
      await new Promise(r => setTimeout(r, 500));
    }
  }

  state.lastScan = now.toISOString();
  savePresaleState(state);

  // Sort by priority (TODAY first, then TOMORROW, etc.)
  alerts.sort((a, b) => a.priority - b.priority);

  // Build Discord alert
  let alertMsg = null;
  if (alerts.length > 0) {
    alertMsg = '🎟️ **PRESALE INTELLIGENCE** 🏴‍☠️\n\n';
    
    const todayAlerts = alerts.filter(a => a.urgency === 'TODAY');
    const tmrwAlerts = alerts.filter(a => a.urgency === 'TOMORROW');
    const codeAlerts = alerts.filter(a => a.urgency === 'CODE FOUND');
    const announceAlerts = alerts.filter(a => ['ANNOUNCED', 'ONSALE', 'NEW TOUR'].includes(a.urgency));

    if (todayAlerts.length > 0) {
      alertMsg += '**🚨 PRESALE TODAY — ACT NOW:**\n';
      for (const a of todayAlerts) {
        alertMsg += `- **${a.artist}** [${a.tier}]`;
        if (a.time) alertMsg += ` — ${a.time}`;
        if (a.codes.length > 0) alertMsg += ` — Code: \`${a.codes.join('`, `')}\``;
        alertMsg += '\n';
        alertMsg += `  ${a.title}\n`;
        if (a.url) alertMsg += `  <${a.url}>\n`;
      }
      alertMsg += '\n';
    }

    if (tmrwAlerts.length > 0) {
      alertMsg += '**⏰ PRESALE TOMORROW — PREPARE:**\n';
      for (const a of tmrwAlerts) {
        alertMsg += `- **${a.artist}** [${a.tier}]`;
        if (a.time) alertMsg += ` — ${a.time}`;
        if (a.codes.length > 0) alertMsg += ` — Code: \`${a.codes.join('`, `')}\``;
        alertMsg += '\n';
        alertMsg += `  ${a.title}\n`;
        if (a.url) alertMsg += `  <${a.url}>\n`;
      }
      alertMsg += '\n';
    }

    if (codeAlerts.length > 0) {
      alertMsg += '**🔑 PRESALE CODES FOUND:**\n';
      for (const a of codeAlerts) {
        alertMsg += `- **${a.artist}** [${a.tier}] — Code: \`${a.codes.join('`, `')}\`\n`;
        if (a.url) alertMsg += `  <${a.url}>\n`;
      }
      alertMsg += '\n';
    }

    if (announceAlerts.length > 0) {
      alertMsg += '**📣 RECENTLY ANNOUNCED:**\n';
      for (const a of announceAlerts.slice(0, 10)) {
        alertMsg += `- ${a.emoji} **${a.artist}** [${a.tier}] — ${a.title}\n`;
        if (a.dates.length > 0) alertMsg += `  📅 ${a.dates.join(', ')}`;
        if (a.time) alertMsg += ` @ ${a.time}`;
        if (a.dates.length > 0 || a.time) alertMsg += '\n';
        if (a.url) alertMsg += `  <${a.url}>\n`;
      }
    }

    alertMsg += `\n_${braveCallCount} Brave API calls | ${alerts.length} presale signals | ${Object.keys(state.codes).length} total codes tracked_`;
  }

  // Save report
  const reportDir = path.join(__dirname, '..', 'reports');
  fs.writeFileSync(
    path.join(reportDir, 'presale-latest.json'),
    JSON.stringify({
      timestamp: now.toISOString(),
      braveCallsUsed: braveCallCount,
      alertCount: alerts.length,
      alerts,
      allTrackedCodes: state.codes,
    }, null, 2)
  );

  console.log(`  ✅ Presale scan complete: ${alerts.length} alerts, ${braveCallCount} Brave calls, ${Object.keys(state.codes).length} codes tracked`);
  
  return { alerts, alertMsg };
}

function loadTrackedVenues() {
  try {
    const p = path.join(__dirname, '..', 'data', 'watchlist.json');
    const data = JSON.parse(fs.readFileSync(p, 'utf8'));
    return data.trackedVenues || [];
  } catch (e) { return []; }
}

module.exports = { runPresaleScan };

if (require.main === module) {
  runPresaleScan().then(({ alerts, alertMsg }) => {
    if (alertMsg) console.log('\n' + alertMsg);
    else console.log('No presale alerts at this time.');
    process.exit(0);
  }).catch(e => { console.error(e); process.exit(1); });
}
