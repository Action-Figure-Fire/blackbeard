/**
 * Blackbeard 🏴‍☠️ — Twitter/X Real-Time Presale Stream
 * 
 * Uses Twitter filtered stream API to catch presale announcements, codes,
 * and tour drops THE SECOND they're tweeted. Zero lag.
 * 
 * Runs as a persistent process. Reconnects on disconnect.
 * Outputs alerts to stdout for cron/Discord delivery.
 * 
 * Stream rules:
 * 1. Watchlist artists + presale/ticket keywords
 * 2. Tracked venue accounts + announcement keywords
 * 3. General presale code detection
 * 4. "Just announced" + tour/tickets pattern
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

const BEARER = process.env.TWITTER_BEARER_TOKEN;
if (!BEARER) { console.error('No TWITTER_BEARER_TOKEN in .env'); process.exit(1); }

function loadWatchlist() {
  const p = path.join(__dirname, '..', 'data', 'watchlist.json');
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function loadStreamState() {
  const p = path.join(__dirname, '..', 'data', 'twitter-stream-state.json');
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return { alerts: {}, lastReconnect: null }; }
}

function saveStreamState(data) {
  const dir = path.join(__dirname, '..', 'data');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'twitter-stream-state.json'), JSON.stringify(data, null, 2));
}

// ---- API Helpers ----

function twitterRequest(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.twitter.com',
      path: urlPath,
      method,
      headers: {
        'Authorization': `Bearer ${BEARER}`,
        'Content-Type': 'application/json',
        'User-Agent': 'Blackbeard-Stream/1.0',
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, data, headers: res.headers }));
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// ---- Stream Rules Management ----

async function getCurrentRules() {
  const res = await twitterRequest('GET', '/2/tweets/search/stream/rules');
  const data = JSON.parse(res.data);
  return data.data || [];
}

async function deleteRules(ids) {
  if (!ids.length) return;
  await twitterRequest('POST', '/2/tweets/search/stream/rules', {
    delete: { ids }
  });
}

async function addRules(rules) {
  const res = await twitterRequest('POST', '/2/tweets/search/stream/rules', {
    add: rules
  });
  return JSON.parse(res.data);
}

function buildStreamRules(watchlist) {
  const rules = [];
  
  // Twitter filtered stream has a 512 char limit per rule and 25 rules max on Basic
  
  // Rule 1-4: Watchlist artists + presale keywords (batch artists into groups)
  const tierA = watchlist.artists.filter(a => a.tier === 'A');
  const allArtists = watchlist.artists;
  
  // Build artist name OR groups (fit within 512 chars)
  const presaleKeywords = '(presale OR "pre-sale" OR "on sale" OR "presale code" OR "just announced" OR "new tour" OR "tickets available" OR "sold out")';
  
  // Batch artists into rules (~15 per rule to fit char limit)
  const batches = [];
  let current = [];
  let currentLen = 0;
  
  for (const a of allArtists) {
    const quoted = `"${a.name}"`;
    // Rule format: (artist1 OR artist2 OR ...) presaleKeywords -is:retweet
    const addLen = quoted.length + 4; // + " OR "
    if (currentLen + addLen > 300) { // Leave room for keywords
      batches.push(current);
      current = [];
      currentLen = 0;
    }
    current.push(quoted);
    currentLen += addLen;
  }
  if (current.length) batches.push(current);

  // Add artist batch rules (max ~5 rules for artists)
  for (let i = 0; i < Math.min(batches.length, 5); i++) {
    const artistsOr = batches[i].join(' OR ');
    rules.push({
      value: `(${artistsOr}) ${presaleKeywords} -is:retweet lang:en`,
      tag: `watchlist-batch-${i + 1}`
    });
  }

  // Rule: General presale code catching (high-value pattern)
  rules.push({
    value: '"presale code" (tickets OR concert OR tour) -is:retweet lang:en -"kpop" -"EXO" -"BTS"',
    tag: 'presale-codes'
  });

  // Rule: "Just announced" tour patterns
  rules.push({
    value: '("just announced" OR "tour announced" OR "announces tour") (tickets OR "on sale" OR presale) -is:retweet lang:en',
    tag: 'tour-announcements'
  });

  // Rule: Sold out signals (venue scarcity)
  rules.push({
    value: '("sold out" OR "selling fast" OR "limited tickets") (concert OR show OR tour) -is:retweet lang:en -"kpop" -"EXO" -"BTS"',
    tag: 'sold-out-signals'
  });

  // Rule: Venue upgrade / added shows (expansion signals)
  rules.push({
    value: '("added shows" OR "added dates" OR "venue upgrade" OR "second show" OR "due to demand") (tickets OR tour) -is:retweet lang:en',
    tag: 'expansion-signals'
  });

  return rules;
}

// ---- Presale Code Extraction ----

function extractPresaleCodes(text) {
  const codes = [];
  const patterns = [
    /(?:presale|pre-sale)\s*code[:\s]+["']?([A-Z0-9]{3,20})["']?/gi,
    /(?:use|enter|try)\s*(?:the\s*)?code[:\s]+["']?([A-Z0-9]{3,20})["']?/gi,
    /code[:\s]+["']?([A-Z0-9]{3,20})["']?\s*(?:for|to\s*(?:get|access|unlock))/gi,
  ];
  for (const p of patterns) {
    let m;
    while ((m = p.exec(text)) !== null) {
      const code = m[1].toUpperCase();
      if (code.length >= 3 && !/^(THE|AND|FOR|GET|USE|NOW|BUY|VIP|ALL|NEW|NOT|YOU|CAN|HAS|WAS|ARE|HER|HIS)$/.test(code)) {
        codes.push(code);
      }
    }
  }
  return [...new Set(codes)];
}

// ---- Tweet Classification ----

function classifyTweet(text, watchlist) {
  const lower = text.toLowerCase();
  
  // Match artist
  let matchedArtist = null;
  for (const a of watchlist.artists) {
    if (lower.includes(a.name.toLowerCase())) {
      matchedArtist = a;
      break;
    }
  }

  // Classify type
  let type = null;
  let urgency = 0;

  if (/presale\s*(code|:)/i.test(text)) {
    type = '🔑 PRESALE CODE';
    urgency = 10;
  } else if (/presale\s*(live|now|today|started|open|happening)/i.test(text)) {
    type = '🚨 PRESALE LIVE';
    urgency = 10;
  } else if (/on\s*sale\s*now|tickets?\s*available\s*now/i.test(text)) {
    type = '🚨 ON SALE NOW';
    urgency = 9;
  } else if (/presale\s*(tomorrow|starts?\s*tomorrow)/i.test(text)) {
    type = '⏰ PRESALE TOMORROW';
    urgency = 8;
  } else if (/sold\s*out|selling\s*fast/i.test(text)) {
    type = '🔥 SOLD OUT / SELLING FAST';
    urgency = 7;
  } else if (/just\s*announced|tour\s*announced|announces?\s*(tour|dates)/i.test(text)) {
    type = '📢 JUST ANNOUNCED';
    urgency = 6;
  } else if (/added\s*(shows?|dates?)|second\s*show|due\s*to\s*demand/i.test(text)) {
    type = '🚀 ADDED SHOWS';
    urgency = 6;
  } else if (/presale|pre-sale/i.test(text)) {
    type = '📣 PRESALE MENTION';
    urgency = 5;
  } else if (/on\s*sale|tickets/i.test(text)) {
    type = '🎟️ TICKET NEWS';
    urgency = 3;
  }

  const codes = extractPresaleCodes(text);
  if (codes.length > 0) {
    type = '🔑 PRESALE CODE';
    urgency = 10;
  }

  return { matchedArtist, type, urgency, codes };
}

// ---- Alert Formatting ----

function formatAlert(tweet, classification) {
  const { matchedArtist, type, codes } = classification;
  
  let msg = `🐦 **X/TWITTER ALERT** ${type}\n\n`;
  
  if (matchedArtist) {
    msg += `**Artist:** ${matchedArtist.name} [${matchedArtist.tier}]\n`;
  }
  
  if (codes.length > 0) {
    msg += `**Code:** \`${codes.join('`, `')}\`\n`;
  }
  
  msg += `**Tweet:** ${tweet.text.substring(0, 280)}\n`;
  
  if (tweet.metrics) {
    msg += `❤️ ${tweet.metrics.like_count || 0} | 🔄 ${tweet.metrics.retweet_count || 0}\n`;
  }
  
  msg += `<https://x.com/i/status/${tweet.id}>`;
  
  return msg;
}

// ---- Search-Based Scanner (runs periodically instead of stream) ----
// Using search/recent as a reliable alternative to filtered stream

async function runSearchScan() {
  console.log('🐦 Twitter/X Presale Search Scanner running...');
  
  const watchlist = loadWatchlist();
  const state = loadStreamState();
  const alerts = [];
  let searchCount = 0;
  const MAX_SEARCHES = 15; // Budget per scan

  // Search 1: General presale codes (highest value)
  const codeResults = await searchRecent('"presale code" (tickets OR concert OR tour) -is:retweet lang:en', 20);
  searchCount++;
  
  for (const tweet of codeResults) {
    const classification = classifyTweet(tweet.text, watchlist);
    if (classification.codes.length > 0 && !state.alerts[tweet.id]) {
      state.alerts[tweet.id] = { seen: new Date().toISOString() };
      alerts.push({ tweet, ...classification });
    }
  }
  await sleep(1000);

  // Search 2: Presale live/today
  const liveResults = await searchRecent('(presale live OR "presale today" OR "on sale now") (tickets OR concert) -is:retweet lang:en', 15);
  searchCount++;
  
  for (const tweet of liveResults) {
    const classification = classifyTweet(tweet.text, watchlist);
    if (classification.urgency >= 7 && !state.alerts[tweet.id]) {
      state.alerts[tweet.id] = { seen: new Date().toISOString() };
      alerts.push({ tweet, ...classification });
    }
  }
  await sleep(1000);

  // Search 3-N: Watchlist artist-specific searches (Tier A priority)
  const tierA = watchlist.artists.filter(a => a.tier === 'A');
  const batches = [];
  for (let i = 0; i < tierA.length; i += 4) {
    batches.push(tierA.slice(i, i + 4));
  }

  for (const batch of batches) {
    if (searchCount >= MAX_SEARCHES) break;
    
    const names = batch.map(a => `"${a.name}"`).join(' OR ');
    const query = `(${names}) (presale OR "on sale" OR "sold out" OR "just announced" OR tickets) -is:retweet lang:en`;
    
    const results = await searchRecent(query, 15);
    searchCount++;
    
    for (const tweet of results) {
      const classification = classifyTweet(tweet.text, watchlist);
      if (classification.urgency >= 5 && !state.alerts[tweet.id]) {
        state.alerts[tweet.id] = { seen: new Date().toISOString() };
        alerts.push({ tweet, ...classification });
      }
    }
    await sleep(1000);
  }

  // Search: Sold out / expansion signals
  if (searchCount < MAX_SEARCHES) {
    const soldOutResults = await searchRecent('("sold out" OR "added shows" OR "added dates" OR "second show added") (concert OR tour) -is:retweet lang:en', 15);
    searchCount++;
    
    for (const tweet of soldOutResults) {
      const classification = classifyTweet(tweet.text, watchlist);
      if ((classification.matchedArtist || classification.urgency >= 6) && !state.alerts[tweet.id]) {
        state.alerts[tweet.id] = { seen: new Date().toISOString() };
        alerts.push({ tweet, ...classification });
      }
    }
  }

  // Clean old state (keep last 7 days)
  const weekAgo = Date.now() - 7 * 24 * 3600 * 1000;
  for (const [id, val] of Object.entries(state.alerts)) {
    if (new Date(val.seen).getTime() < weekAgo) delete state.alerts[id];
  }

  state.lastScan = new Date().toISOString();
  saveStreamState(state);

  // Sort by urgency
  alerts.sort((a, b) => b.urgency - a.urgency);

  // Build Discord message
  let alertMsg = null;
  if (alerts.length > 0) {
    alertMsg = '🐦 **X/TWITTER PRESALE INTEL** 🏴‍☠️\n\n';
    
    const codeAlerts = alerts.filter(a => a.codes.length > 0);
    const urgentAlerts = alerts.filter(a => a.urgency >= 7 && a.codes.length === 0);
    const otherAlerts = alerts.filter(a => a.urgency >= 5 && a.urgency < 7 && a.codes.length === 0);

    if (codeAlerts.length > 0) {
      alertMsg += '**🔑 PRESALE CODES FOUND:**\n';
      for (const a of codeAlerts.slice(0, 8)) {
        const artist = a.matchedArtist ? `**${a.matchedArtist.name}** [${a.matchedArtist.tier}]` : '**Unknown Artist**';
        alertMsg += `- ${artist} — Code: \`${a.codes.join('`, `')}\`\n`;
        alertMsg += `  ${a.tweet.text.substring(0, 150).replace(/\n/g, ' ')}\n`;
        alertMsg += `  <https://x.com/i/status/${a.tweet.id}>\n`;
      }
      alertMsg += '\n';
    }

    if (urgentAlerts.length > 0) {
      alertMsg += '**🚨 URGENT:**\n';
      for (const a of urgentAlerts.slice(0, 6)) {
        const artist = a.matchedArtist ? `**${a.matchedArtist.name}**` : '';
        alertMsg += `- ${a.type} ${artist}\n`;
        alertMsg += `  ${a.tweet.text.substring(0, 150).replace(/\n/g, ' ')}\n`;
        alertMsg += `  ❤️ ${a.tweet.metrics?.like_count || 0} | <https://x.com/i/status/${a.tweet.id}>\n`;
      }
      alertMsg += '\n';
    }

    if (otherAlerts.length > 0) {
      alertMsg += '**📣 ANNOUNCEMENTS:**\n';
      for (const a of otherAlerts.slice(0, 6)) {
        const artist = a.matchedArtist ? `**${a.matchedArtist.name}**` : '';
        alertMsg += `- ${a.type} ${artist} — ${a.tweet.text.substring(0, 120).replace(/\n/g, ' ')}\n`;
      }
    }

    alertMsg += `\n_${searchCount} searches | ${alerts.length} alerts | ${codeAlerts.length} codes found_`;
  }

  console.log(`  ✅ Twitter scan: ${searchCount} searches, ${alerts.length} alerts, ${alerts.filter(a=>a.codes.length>0).length} codes`);

  return { alerts, alertMsg };
}

async function searchRecent(query, maxResults = 10) {
  try {
    const q = encodeURIComponent(query);
    const url = `/2/tweets/search/recent?query=${q}&max_results=${Math.min(maxResults, 100)}&tweet.fields=created_at,public_metrics,author_id`;
    const res = await twitterRequest('GET', url);
    if (res.status !== 200) {
      if (res.status === 429) console.log('  ⚠️ Twitter rate limited');
      return [];
    }
    const data = JSON.parse(res.data);
    return (data.data || []).map(t => ({
      id: t.id,
      text: t.text,
      createdAt: t.created_at,
      authorId: t.author_id,
      metrics: t.public_metrics,
    }));
  } catch (e) {
    console.log(`  ⚠️ Search error: ${e.message}`);
    return [];
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ---- Stream Setup (for persistent mode) ----

async function setupStreamRules() {
  console.log('Setting up filtered stream rules...');
  
  const watchlist = loadWatchlist();
  const newRules = buildStreamRules(watchlist);
  
  // Get existing rules
  const existing = await getCurrentRules();
  console.log(`  Existing rules: ${existing.length}`);
  
  // Delete all existing
  if (existing.length > 0) {
    await deleteRules(existing.map(r => r.id));
    console.log(`  Deleted ${existing.length} old rules`);
  }
  
  // Add new rules
  const result = await addRules(newRules);
  console.log(`  Added ${newRules.length} new rules`);
  if (result.errors) {
    console.log('  ⚠️ Rule errors:', JSON.stringify(result.errors));
  }
  
  return newRules;
}

// ---- Exports ----

module.exports = { runSearchScan, setupStreamRules, buildStreamRules };

// ---- CLI ----

if (require.main === module) {
  const args = process.argv.slice(2);
  
  if (args[0] === 'setup-rules') {
    // Just set up stream rules
    setupStreamRules().then(rules => {
      console.log('Stream rules configured:', rules.length);
      process.exit(0);
    }).catch(e => { console.error(e); process.exit(1); });
  } else if (args[0] === 'scan') {
    // Run search-based scan
    runSearchScan().then(({ alerts, alertMsg }) => {
      if (alertMsg) console.log('\n' + alertMsg);
      else console.log('No new Twitter presale alerts.');
      process.exit(0);
    }).catch(e => { console.error(e); process.exit(1); });
  } else {
    // Default: run search scan
    runSearchScan().then(({ alerts, alertMsg }) => {
      if (alertMsg) console.log('\n' + alertMsg);
      else console.log('No new Twitter presale alerts.');
      process.exit(0);
    }).catch(e => { console.error(e); process.exit(1); });
  }
}
