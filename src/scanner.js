/**
 * Blackbeard 🏴‍☠️ — Sold-Out Event Scanner
 * Searches Reddit, X, and web for buzz around sold-out events
 * Scores by chatter volume, velocity, scarcity language, and obscurity
 */

const https = require('https');
const http = require('http');

// --- Config ---
const SCARCITY_KEYWORDS = [
  'sold out', 'sellout', 'sell out', 'sold-out',
  'can\'t get tickets', 'cant get tickets', 'no tickets',
  'tickets gone', 'impossible to get', 'instantly sold out',
  'sold out in minutes', 'sold out in seconds',
  'willing to pay anything', 'desperate for tickets',
  'looking for tickets', 'need tickets', 'want tickets',
  'resale prices', 'scalpers', 'stubhub prices',
  'face value', 'above face', 'over face',
  'waitlist', 'lottery', 'presale sold out'
];

const EVENT_CATEGORIES = {
  comedy: ['comedy show', 'stand-up', 'standup', 'comedian', 'comedy tour', 'comedy special', 'open mic'],
  concerts: ['concert', 'tour', 'live show', 'music festival', 'gig', 'album tour', 'world tour', 'arena show'],
  sports: [
    'game tickets', 'match tickets', 'bout', 'fight night',
    'championship', 'finals tickets', 'playoff', 'derby',
    'rivalry game', 'bowl game', 'tournament',
    // obscure sports
    'lacrosse', 'rugby', 'cricket', 'handball', 'water polo',
    'field hockey', 'curling', 'fencing', 'wrestling',
    'roller derby', 'bull riding', 'rodeo', 'motocross',
    'pickleball', 'disc golf', 'cornhole tournament',
    'esports', 'fighting game tournament', 'smash bros',
    'drone racing', 'arm wrestling', 'strongman',
    'marathon', 'triathlon', 'ironman', 'ultramarathon',
    'boxing undercard', 'bare knuckle', 'muay thai', 'kickboxing',
    'minor league', 'college', 'high school championship',
    'wnba', 'nwsl', 'usl', 'usfl', 'xfl', 'pfl',
    'indycar', 'nascar truck series', 'dirt track',
    'horse racing', 'dog show', 'cat show'
  ]
};

const LARGE_VENUE_INDICATORS = [
  'stadium', 'arena tour', 'world tour',
  'msg', 'madison square garden', 'staples center',
  'crypto.com arena', 'united center', 'td garden',
  'barclays center', 'chase center', 'sofi stadium',
  'metlife', 'at&t stadium', 'allegiant stadium'
];

// --- HTTP fetch helper ---
function fetch(url, options = {}) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, {
      headers: {
        'User-Agent': 'Blackbeard-Scanner/1.0 (event-research-bot)',
        ...options.headers
      },
      timeout: 15000
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ status: res.statusCode, data });
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${url}`));
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout: ' + url)); });
  });
}

// --- Reddit Scanner ---
async function scanReddit() {
  const subreddits = [
    'tickets', 'concerts', 'livemusic', 'comedy', 'StandUpComedy',
    'boxing', 'mma', 'wrestling', 'soccer', 'baseball', 'basketball',
    'hockey', 'lacrosse', 'rugby', 'esports', 'nfl',
    'cfb', 'wnba', 'nwsl', 'minorleaguebaseball', 'indycar', 'nascar',
    'rodeo', 'rollerderby', 'pickleball', 'discgolf',
    'StubHub', 'EventTickets',
    // College sports (non-men's basketball)
    'NCAAW', 'collegehockey', 'collegebaseball', 'wrestling',
    'gymnastics', 'Rowing', 'trackandfield', 'swimming',
    'volleyball', 'lacrosse', 'fencing', 'waterpolo',
    'CollegeWrestling', 'collegesoftball',
    // Specific college team subs with hot ticket demand
    'OKState', 'PennStateUniversity', 'LSUTigers', 'OU',
    'Huskers', 'IowaHawkeyes', 'OhioStateFootball'
  ];

  const queries = [
    'sold out tickets',
    'can\'t get tickets',
    'sold out instantly',
    'need tickets',
    'sellout event',
    // College sports specific
    'college wrestling sold out',
    'college hockey sold out tickets',
    'college gymnastics sold out',
    'NCAAW tickets sold out',
    'women\'s basketball sold out',
    'college baseball tickets sold out',
    'college lacrosse tickets',
    'college volleyball sold out',
    'swimming championship tickets',
    'track and field championship tickets'
  ];

  const results = [];

  // Search across Reddit
  for (const query of queries) {
    try {
      const url = `https://www.reddit.com/search.json?q=${encodeURIComponent(query)}&sort=new&t=day&limit=50`;
      const res = await fetch(url);
      const json = JSON.parse(res.data);
      if (json?.data?.children) {
        for (const post of json.data.children) {
          const d = post.data;
          results.push({
            source: 'reddit',
            subreddit: d.subreddit,
            title: d.title,
            text: (d.selftext || '').substring(0, 500),
            url: `https://reddit.com${d.permalink}`,
            score: d.score,
            numComments: d.num_comments,
            created: d.created_utc,
            author: d.author
          });
        }
      }
      // Rate limit courtesy
      await new Promise(r => setTimeout(r, 1500));
    } catch (e) {
      console.error(`Reddit search error for "${query}":`, e.message);
    }
  }

  // Also check specific subreddits
  for (const sub of subreddits.slice(0, 10)) {
    try {
      const url = `https://www.reddit.com/r/${sub}/new.json?limit=25`;
      const res = await fetch(url);
      const json = JSON.parse(res.data);
      if (json?.data?.children) {
        for (const post of json.data.children) {
          const d = post.data;
          const combined = `${d.title} ${d.selftext}`.toLowerCase();
          const hasScarcity = SCARCITY_KEYWORDS.some(kw => combined.includes(kw));
          if (hasScarcity) {
            results.push({
              source: 'reddit',
              subreddit: d.subreddit,
              title: d.title,
              text: (d.selftext || '').substring(0, 500),
              url: `https://reddit.com${d.permalink}`,
              score: d.score,
              numComments: d.num_comments,
              created: d.created_utc,
              author: d.author
            });
          }
        }
      }
      await new Promise(r => setTimeout(r, 1200));
    } catch (e) {
      console.error(`Reddit sub /${sub} error:`, e.message);
    }
  }

  return dedup(results, 'url');
}

// --- Dedup helper ---
function dedup(arr, key) {
  const seen = new Set();
  return arr.filter(item => {
    if (seen.has(item[key])) return false;
    seen.add(item[key]);
    return true;
  });
}

// --- Scoring Engine ---
function scoreEvent(mentions) {
  if (!mentions.length) return null;

  const combined = mentions.map(m => `${m.title} ${m.text}`).join(' ').toLowerCase();

  // Volume score (0-40)
  const volume = Math.min(mentions.length * 5, 40);

  // Velocity: how recent are mentions? (0-20)
  const now = Date.now() / 1000;
  const recentCount = mentions.filter(m => m.created && (now - m.created) < 86400).length;
  const velocity = Math.min(recentCount * 4, 20);

  // Scarcity language intensity (0-25)
  let scarcityHits = 0;
  for (const kw of SCARCITY_KEYWORDS) {
    const regex = new RegExp(kw, 'gi');
    const matches = combined.match(regex);
    if (matches) scarcityHits += matches.length;
  }
  const scarcity = Math.min(scarcityHits * 2, 25);

  // Obscurity bonus (0-15): smaller/niche = higher bonus
  let obscurityBonus = 10; // default: assume somewhat niche
  for (const indicator of LARGE_VENUE_INDICATORS) {
    if (combined.includes(indicator)) {
      obscurityBonus = 0;
      break;
    }
  }
  // Extra bonus for obscure sports keywords
  for (const sport of EVENT_CATEGORIES.sports.slice(6)) {
    if (combined.includes(sport)) {
      obscurityBonus = 15;
      break;
    }
  }

  // Engagement bonus from Reddit scores/comments
  const totalEngagement = mentions.reduce((sum, m) => sum + (m.score || 0) + (m.numComments || 0) * 2, 0);
  const engagementBonus = Math.min(Math.floor(totalEngagement / 10), 10);

  const totalScore = volume + velocity + scarcity + obscurityBonus + engagementBonus;

  return {
    totalScore: Math.min(totalScore, 100),
    breakdown: { volume, velocity, scarcity, obscurityBonus, engagementBonus },
    mentionCount: mentions.length
  };
}

// --- Event Name Extraction ---
// Try to pull out the actual artist/team/show name from a mention
function extractCleanEventInfo(mentions) {
  const texts = mentions.map(m => `${m.title} ${m.text}`).join(' ');
  const lower = texts.toLowerCase();

  let eventName = null;
  let eventType = null; // 'artist', 'team', 'show', 'event'
  let venueName = null;

  // Try to extract from subreddit (often the artist/team name)
  const subs = [...new Set(mentions.map(m => m.subreddit))];
  const genericSubs = ['tickets', 'concerts', 'livemusic', 'comedy', 'Concerts',
    'EventTickets', 'StubHub', 'mma', 'boxing', 'esports', 'confession',
    'BostonSocialClub', 'boston', 'washdc', 'orangecounty', 'burlington',
    'CUA', 'SocialParis', 'ChennaiBuyAndSell', 'concerts_india', 'Broadway'];
  const specificSub = subs.find(s => !genericSubs.includes(s) && s.length > 2);

  // Known artist/band/team subreddits — subreddit IS the event name
  const artistSubs = [
    'TameImpala', 'JesseWelles', 'D4DJ',
    // Add more as discovered
  ];
  const teamSubs = [
    'NPBtickets', 'WorldCup2026Tickets', 'wnba', 'nwsl',
    'NCAAW', 'CollegeWrestling', 'collegehockey', 'collegebaseball',
    'OKState', 'PennStateUniversity',
  ];

  // If subreddit is a known artist/team, use it directly
  for (const s of subs) {
    if (artistSubs.includes(s)) {
      eventName = s.replace(/([a-z])([A-Z])/g, '$1 $2');
      eventType = 'artist';
      break;
    }
    if (teamSubs.includes(s)) {
      eventName = s.replace(/([a-z])([A-Z])/g, '$1 $2').replace('Tickets', '').replace('tickets', '').trim();
      eventType = 'team';
      break;
    }
  }

  if (!eventName) {
    // Pattern: "tickets to/for X" — the X is the event
    const patterns = [
      /tickets?\s+(?:to|for)\s+(?:the\s+)?([A-Z][A-Za-z0-9\s&\-'\.]{2,40}?)(?:\s*[-–—]|\s*concert|\s*show|\s*game|\s*match|\s*tour|\s*at\s|\s*[,.])/i,
      /(?:looking for|need|want|wtb).*?(?:tickets?\s+(?:to|for)\s+)?(?:the\s+)?([A-Z][A-Za-z0-9\s&\-'\.]{2,40}?)(?:\s+concert|\s+show|\s+game|\s+tour|\s+tickets)/i,
      /([A-Z][A-Za-z0-9\s&\-'\.]{2,40}?)\s+(?:tickets?|tix)\s+(?:sold|are|were)/i,
      /([A-Z][A-Za-z0-9\s&\-'\.]{2,40}?)\s+sold\s*out/i,
    ];

    for (const pat of patterns) {
      const match = texts.match(pat);
      if (match && match[1]) {
        const candidate = match[1].trim().replace(/\s+/g, ' ');
        // Filter out garbage: must look like a proper name (not a sentence)
        const wordCount = candidate.split(' ').length;
        if (wordCount <= 6 && wordCount >= 1 && candidate.length >= 3 && !/^(I|My|The|Its|This|That|And|But|So|For|In|On|At|It|A)\s/i.test(candidate)) {
          eventName = candidate;
          break;
        }
      }
    }
  }

  // Fall back to subreddit name ONLY if it looks like an artist/team name (not a city/generic sub)
  const citySubs = ['boston', 'BostonSocialClub', 'washdc', 'orangecounty', 'burlington',
    'CUA', 'SocialParis', 'ChennaiBuyAndSell', 'concerts_india', 'confession',
    'pcmasterrace', 'watercooling', 'Eve', 'indianbikes', 'thesidehustle',
    'SideHustleGold', 'OnlineIncomeHustle', 'AIDevelopmentSolution', 'AIAppInnovation',
    'TwoXIndia', 'AskIndianWomen', 'riftboundtcg'];
  if (!eventName && specificSub && !citySubs.includes(specificSub) && !genericSubs.includes(specificSub)) {
    const cleaned = specificSub.replace(/([a-z])([A-Z])/g, '$1 $2');
    if (cleaned.length >= 3 && cleaned.length <= 30) {
      eventName = cleaned;
    }
  }

  // Try to extract venue
  const venuePatterns = [
    /(?:at|@)\s+(?:the\s+)?([A-Z][A-Za-z0-9\s&\-'\.]{3,30}?)(?:\s*[-–—,\.]|\s+on\s|\s+in\s|$)/,
    /(?:House of Blues|Red Rocks|The Fillmore|Madison Square Garden|MSG|Ryman|Greek Theatre|Hollywood Bowl|Radio City|Carnegie Hall|Lincoln Center|Beacon Theatre|Apollo Theater|Bowery Ballroom|9:30 Club|The Anthem|Gorge Amphitheatre)/i
  ];
  for (const vp of venuePatterns) {
    const venueMatch = texts.match(vp);
    if (venueMatch) { venueName = (venueMatch[1] || venueMatch[0]).trim(); break; }
  }

  // Determine event type
  if (lower.match(/comedian|comedy|stand-?up|open mic/)) eventType = 'comedian';
  else if (lower.match(/concert|tour|album|band|singer|music|festival|gig/)) eventType = 'artist';
  else if (lower.match(/game|match|playoff|championship|derby|rivalry|team|league|vs\b/)) eventType = 'team';
  else if (lower.match(/broadway|theater|theatre|musical|play|show/)) eventType = 'show';
  else eventType = 'event';

  return {
    eventName: eventName || null,
    eventType,
    venueName,
    subredditHint: specificSub || null
  };
}

// Build Vivid Seats search URL
function vividSeatsUrl(eventName) {
  if (!eventName) return null;
  const q = encodeURIComponent(eventName);
  return `https://www.vividseats.com/search?searchTerm=${q}`;
}

// Build artist/team search URL (Google search as fallback, works for everything)
function artistPageUrl(eventName, eventType) {
  if (!eventName) return null;
  const q = encodeURIComponent(eventName);
  // Direct to likely pages based on type
  if (eventType === 'artist' || eventType === 'comedian') {
    return `https://www.google.com/search?q=${q}+official+site`;
  }
  if (eventType === 'team') {
    return `https://www.google.com/search?q=${q}+official+site`;
  }
  if (eventType === 'show') {
    return `https://www.google.com/search?q=${q}+broadway+tickets`;
  }
  return `https://www.google.com/search?q=${q}`;
}

// --- Relevance Filter ---
const EVENT_SIGNALS = [
  'ticket', 'tickets', 'tix', 'sold out', 'sell out', 'sellout', 'sold-out',
  'show', 'concert', 'tour', 'gig', 'festival', 'game', 'match', 'bout',
  'fight', 'event', 'performance', 'venue', 'arena', 'theater', 'theatre',
  'presale', 'on sale', 'box office', 'stubhub', 'ticketmaster', 'seatgeek',
  'vivid seats', 'face value', 'scalp', 'resale', 'waitlist', 'lottery',
  'standing room', 'general admission', 'pit tickets', 'floor seats',
  'nosebleeds', 'section', 'row', 'seat', 'barricade',
  'comedy', 'comedian', 'stand-up', 'standup', 'open mic',
  'playoff', 'championship', 'finals', 'derby', 'rivalry',
  'rodeo', 'wrestling', 'boxing', 'mma', 'ufc', 'pfl',
  'lacrosse', 'rugby', 'cricket', 'esports'
];

const HARD_EVENT_SIGNALS = [
  'ticket', 'tickets', 'tix', 'sold out', 'sell out', 'sellout', 'sold-out',
  'presale', 'on sale', 'box office', 'stubhub', 'ticketmaster', 'seatgeek',
  'vivid seats', 'face value', 'scalp', 'resale', 'waitlist',
  'general admission', 'pit tickets', 'floor seats', 'standing room'
];

function isEventRelated(mention) {
  const text = `${mention.title} ${mention.text}`.toLowerCase();

  // Must have at least one HARD signal (ticket-specific language)
  const hasHardSignal = HARD_EVENT_SIGNALS.some(kw => text.includes(kw));
  if (!hasHardSignal) return false;

  // Plus at least one soft signal
  let softSignals = 0;
  for (const kw of EVENT_SIGNALS) {
    if (text.includes(kw)) softSignals++;
  }
  return softSignals >= 2;
}

// --- Event Extraction & Grouping ---
function extractEventName(mention) {
  const text = `${mention.title} ${mention.text}`.toLowerCase();
  const quoted = text.match(/"([^"]+)"/);
  if (quoted) return quoted[1].substring(0, 80);
  return mention.title.substring(0, 80);
}

function categorizeEvent(text) {
  const lower = text.toLowerCase();
  for (const [cat, keywords] of Object.entries(EVENT_CATEGORIES)) {
    for (const kw of keywords) {
      if (lower.includes(kw)) return cat;
    }
  }
  return 'other';
}

function groupMentions(mentions) {
  // Filter to event-related only
  const relevant = mentions.filter(isEventRelated);

  const groups = {};
  for (const m of relevant) {
    const key = extractEventName(m).toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
    const shortKey = key.split(' ').slice(0, 4).join(' ');
    if (!groups[shortKey]) groups[shortKey] = [];
    groups[shortKey].push(m);
  }
  return groups;
}

// --- Main Scanner ---
async function runScan() {
  console.log('🏴‍☠️ Blackbeard scanning for treasure...');
  const startTime = Date.now();

  const redditResults = await scanReddit();
  console.log(`  Reddit: ${redditResults.length} mentions found`);

  const allMentions = [...redditResults];

  // Group by event
  const groups = groupMentions(allMentions);

  // Score each group
  const scoredEvents = [];
  for (const [eventKey, mentions] of Object.entries(groups)) {
    const scoring = scoreEvent(mentions);
    if (!scoring) continue;

    const category = categorizeEvent(mentions.map(m => `${m.title} ${m.text}`).join(' '));

    const info = extractCleanEventInfo(mentions);
    const cleanName = info.eventName || mentions[0].title.substring(0, 100);
    const displayTitle = info.eventName
      ? `${info.eventName}${info.venueName ? ` @ ${info.venueName}` : ''}`
      : mentions[0].title.substring(0, 100);

    scoredEvents.push({
      eventKey,
      displayName: displayTitle,
      rawTitle: mentions[0].title.substring(0, 100),
      category,
      eventName: info.eventName,
      eventType: info.eventType,
      venueName: info.venueName,
      artistUrl: artistPageUrl(info.eventName, info.eventType),
      vividSeatsUrl: vividSeatsUrl(info.eventName),
      ...scoring,
      mentions: mentions.slice(0, 5),
      sources: [...new Set(mentions.map(m => m.source))]
    });
  }

  // Sort by score descending
  scoredEvents.sort((a, b) => b.totalScore - a.totalScore);

  const report = {
    timestamp: new Date().toISOString(),
    scanDurationMs: Date.now() - startTime,
    totalMentionsFound: allMentions.length,
    eventsScored: scoredEvents.length,
    events: scoredEvents.slice(0, 25) // Top 25
  };

  return report;
}

// --- Report Formatter (Discord-friendly) ---
function formatReport(report) {
  if (!report.events.length) {
    return '🏴‍☠️ **Blackbeard Daily Report**\n\nNo treasure found today. The seas were quiet. Will scan again tomorrow.';
  }

  const categoryEmoji = { comedy: '🎤', concerts: '🎵', sports: '🏆', other: '🎟️' };

  let msg = `🏴‍☠️ **BLACKBEARD DAILY REPORT**\n`;
  msg += `*${new Date(report.timestamp).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}*\n`;
  msg += `Found **${report.totalMentionsFound}** mentions across **${report.eventsScored}** events\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

  const top = report.events.slice(0, 15);
  for (let i = 0; i < top.length; i++) {
    const e = top[i];
    const emoji = categoryEmoji[e.category] || '🎟️';
    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `**#${i + 1}**`;

    msg += `${medal} ${emoji} **${e.displayName}**\n`;
    if (e.rawTitle && e.eventName && e.rawTitle !== e.displayName) {
      msg += `*"${e.rawTitle.substring(0, 80)}"*\n`;
    }
    msg += `Score: **${e.totalScore}/100** · ${e.mentionCount} mentions · ${e.category}\n`;

    // Artist/team + Vivid Seats links
    if (e.artistUrl) msg += `🔍 [Official Page](${e.artistUrl})\n`;
    if (e.vividSeatsUrl) msg += `🎟️ [Vivid Seats Resale](${e.vividSeatsUrl})\n`;

    // Source links
    for (const m of e.mentions.slice(0, 2)) {
      msg += `💬 <${m.url}>\n`;
    }
    msg += '\n';
  }

  msg += `━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `*Scanned in ${(report.scanDurationMs / 1000).toFixed(1)}s · Excludes venues >10k capacity*`;

  return msg;
}

module.exports = { runScan, formatReport, scoreEvent };

// CLI mode
if (require.main === module) {
  runScan().then(report => {
    const fs = require('fs');
    const dateStr = new Date().toISOString().split('T')[0];
    const reportPath = `${__dirname}/../reports/${dateStr}.json`;
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(formatReport(report));
    console.log(`\nReport saved to ${reportPath}`);
  }).catch(err => {
    console.error('Scan failed:', err);
    process.exit(1);
  });
}
