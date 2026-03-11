#!/usr/bin/env node
/**
 * Blackbeard 🏴‍☠️ — Reddit Hype Index
 * Uses SerpAPI site:reddit.com to measure artist buzz across music subreddits.
 * 
 * Tracks: mention count, sentiment signals, subreddit spread, recency.
 * Higher reddit buzz often precedes mainstream sellout by 2-6 months.
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

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
      headers: { 'User-Agent': 'Blackbeard-Reddit/1.0', ...options.headers },
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

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

const MUSIC_SUBREDDITS = [
  'indieheads', 'popheads', 'hiphopheads', 'EDM', 'LetsTalkMusic',
  'concerts', 'ifyoulikeblank', 'listentothis', 'Music',
  'country', 'metalcore', 'poppunkers', 'rnb', 'electronicmusic',
];

const POSITIVE_SIGNALS = [
  /blow(?:ing|n)\s*up/i, /incredible\s*live/i, /best\s*(?:show|concert|set)/i,
  /sold[\s-]*out/i, /can'?t\s*get\s*tickets/i, /amazing\s*(?:live|show|concert)/i,
  /insane\s*(?:show|concert|energy)/i, /obsessed/i, /masterpiece/i,
  /holy\s*shit/i, /absolutely\s*(?:incredible|insane|amazing)/i,
  /changed\s*my\s*life/i, /underrated/i, /slept\s*on/i, /go\s*see\s*them/i,
  /tickets\s*(?:sold|gone|impossible)/i, /recommend(?:ed)?/i,
];

const HYPE_SIGNALS = [
  /presale/i, /ticket/i, /tour/i, /new\s*album/i, /just\s*(?:saw|seen)/i,
  /live\s*show/i, /opening\s*for/i, /festival/i,
];

async function getRedditMentions(artistName) {
  const key = process.env.SERPAPI_KEY;
  if (!key) return null;

  try {
    const q = encodeURIComponent(`site:reddit.com "${artistName}" (concert OR tour OR tickets OR live OR presale)`);
    const url = `https://serpapi.com/search.json?engine=google&q=${q}&api_key=${key}&num=10&tbs=qdr:m`; // past month
    const res = await fetch(url);
    if (res.status !== 200) return null;
    const data = JSON.parse(res.data);
    const results = data.organic_results || [];

    let mentionCount = 0;
    let positiveCount = 0;
    let hypeCount = 0;
    const subreddits = new Set();
    const snippets = [];

    for (const r of results) {
      mentionCount++;
      const text = `${r.title} ${r.snippet || ''}`;

      // Extract subreddit
      const subMatch = r.displayed_link?.match(/reddit\.com\/r\/(\w+)/i) || r.link?.match(/reddit\.com\/r\/(\w+)/i);
      if (subMatch) subreddits.add(subMatch[1]);

      // Check sentiment
      for (const p of POSITIVE_SIGNALS) {
        if (p.test(text)) { positiveCount++; break; }
      }
      for (const p of HYPE_SIGNALS) {
        if (p.test(text)) { hypeCount++; break; }
      }

      snippets.push({ title: r.title, snippet: r.snippet || '', url: r.link });
    }

    // Score: 0-100
    let score = 0;
    score += Math.min(mentionCount * 5, 30);          // mentions (max 30)
    score += Math.min(positiveCount * 8, 25);          // positive sentiment (max 25)
    score += Math.min(subreddits.size * 7, 25);        // subreddit spread (max 25)
    score += Math.min(hypeCount * 5, 20);              // hype signals (max 20)

    return {
      artist: artistName,
      score: Math.min(score, 100),
      mentionCount,
      positiveCount,
      hypeCount,
      subredditCount: subreddits.size,
      subreddits: [...subreddits],
      topSnippets: snippets.slice(0, 3),
    };
  } catch (e) { return null; }
}

// For prediction scoring
function getRedditHypeScore(result) {
  if (!result) return { score: 0, factors: [] };

  let score = 0;
  const factors = [];

  if (result.score >= 70) {
    score += 10;
    factors.push(`🔥 Reddit hype index: ${result.score}/100 — heavy buzz across ${result.subredditCount} subreddits`);
  } else if (result.score >= 45) {
    score += 6;
    factors.push(`📡 Reddit hype: ${result.score}/100 — ${result.mentionCount} mentions in ${result.subredditCount} subreddits`);
  } else if (result.score >= 25) {
    score += 3;
    factors.push(`Reddit activity: ${result.mentionCount} mentions`);
  }

  if (result.positiveCount >= 4) {
    score += 4;
    factors.push(`Strong positive sentiment on Reddit (${result.positiveCount} positive mentions)`);
  }

  return { score: Math.min(score, 12), factors };
}

async function run(artistNames, options = {}) {
  const limit = options.limit || 15;
  console.log(`📡 Reddit Hype Index — Scanning ${artistNames.length} artists (limit: ${limit})`);

  const results = [];
  let calls = 0;

  for (const name of artistNames) {
    if (calls >= limit) break;
    console.log(`  🔍 ${name}...`);
    const r = await getRedditMentions(name);
    calls++;
    if (r) {
      results.push(r);
      console.log(`     Score: ${r.score} | ${r.mentionCount} mentions | ${r.subredditCount} subreddits | ${r.positiveCount} positive`);
    }
    await delay(500);
  }

  results.sort((a, b) => b.score - a.score);
  return results;
}

function formatDiscordAlert(results) {
  if (!results || results.length === 0) return null;

  let msg = '📡 **REDDIT HYPE INDEX** 🏴‍☠️\n_Who\'s buzzing on Reddit right now_\n\n';

  const hot = results.filter(r => r.score >= 50);
  const warm = results.filter(r => r.score >= 25 && r.score < 50);

  if (hot.length > 0) {
    msg += '**🔥 HOT:**\n';
    for (const r of hot) {
      msg += `• **${r.artist}** (${r.score}) — ${r.mentionCount} mentions, ${r.subredditCount} subreddits, ${r.positiveCount} positive\n`;
    }
    msg += '\n';
  }

  if (warm.length > 0) {
    msg += '**📡 WARM:**\n';
    for (const r of warm) {
      msg += `• **${r.artist}** (${r.score}) — ${r.mentionCount} mentions\n`;
    }
  }

  return msg;
}

module.exports = { getRedditMentions, getRedditHypeScore, run, formatDiscordAlert };

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    // Default: top emerging artists
    const names = ['Chappell Roan', 'Benson Boone', 'Teddy Swims', 'Gracie Abrams', 'Tyla', 'Mk.gee', 'Sabrina Carpenter', 'Ethel Cain', 'Lola Young', 'Tommy Richman'];
    run(names).then(results => {
      const alert = formatDiscordAlert(results);
      if (alert) console.log('\n' + alert);
    });
  } else {
    run(args).then(results => {
      for (const r of results) console.log(`\n${r.artist}: ${r.score}/100 | ${r.mentionCount} mentions | subs: ${r.subreddits.join(', ')}`);
    });
  }
}
