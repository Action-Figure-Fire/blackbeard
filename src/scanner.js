/**
 * Blackbeard 🏴‍☠️ — Sold-Out Event Scanner
 * Searches Reddit, X, and web for buzz around sold-out events
 * Scores by chatter volume, velocity, scarcity language, and obscurity
 */

const https = require('https');
const http = require('http');
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
} catch (e) { /* ignore */ }

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
  'college-sports': [
    'college wrestling', 'ncaa wrestling', 'big ten wrestling', 'penn state wrestling',
    'oklahoma state wrestling', 'iowa wrestling', 'college gymnastics', 'ncaa gymnastics',
    'lsu gymnastics', 'college volleyball', 'nebraska volleyball', 'ncaaw',
    'women\'s basketball', 'women\'s final four', 'college softball', 'wcws',
    'women\'s college world series', 'college hockey', 'frozen four', 'beanpot',
    'college lacrosse', 'ncaa swimming', 'ncaa championship', 'college baseball',
    'college world series', 'regionals', 'super regional', 'sec tournament',
    'big ten tournament', 'acc tournament', 'big 12 tournament'
  ],
  'minor-league': [
    'minor league', 'milb', 'triple-a', 'double-a', 'single-a', 'aaa baseball',
    'ironpigs', 'durham bulls', 'sugar land', 'savannah bananas', 'banana ball',
    'jumbo shrimp', 'space cowboys', 'saints', 'sounds', 'aviators',
    'mud hens', 'railriders', 'clippers', 'red wings', 'tides', 'knights',
    'wind surge', 'yard goats', 'trash pandas', 'biscuits', 'grasshoppers',
    'river cats', 'chihuahuas', 'isotopes', 'aces', 'storm chasers',
    'omaha', 'worcester', 'hartford', 'st. paul saints',
    'bobblehead night', 'fireworks night', 'theme night', 'giveaway night',
    'jersey night', 'star wars night', 'dog day', 'bark in the park',
    'copa de la', 'marvel night', 'princess night'
  ],
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
    // College sports (non-men's basketball, non-football)
    'NCAAW', 'collegehockey', 'collegebaseball', 'wrestling',
    'gymnastics', 'Rowing', 'trackandfield', 'swimming',
    'volleyball', 'lacrosse', 'fencing', 'waterpolo',
    'CollegeWrestling', 'collegesoftball',
    'OKState', 'PennStateUniversity', 'LSUTigers', 'OU',
    'Huskers', 'IowaHawkeyes', 'OhioStateFootball',
    // Minor League Baseball
    'minorleaguebaseball', 'milb', 'SavannahBananas',
    'DurhamBulls', 'baseball',
    'nashville', 'RailRiders', 'IronPigs',
    // Premier Lacrosse League
    'PLL', 'lacrosse'
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
    'track and field championship tickets',
    // Minor league baseball
    'minor league baseball sold out',
    'milb sold out tickets',
    'savannah bananas tickets',
    'banana ball tickets',
    'bobblehead night sold out',
    'minor league sellout',
    'ironpigs tickets',
    'durham bulls sold out',
    'triple-a baseball tickets',
    'minor league fireworks night',
    'minor league giveaway night',
    'space cowboys tickets'
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
      // Rate limit courtesy — Reddit throttles hard
      await new Promise(r => setTimeout(r, 2500));
    } catch (e) {
      console.error(`Reddit search error for "${query}":`, e.message);
    }
  }

  // Also check specific subreddits (more of them now)
  for (const sub of subreddits.slice(0, 15)) {
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
      await new Promise(r => setTimeout(r, 2500));
    } catch (e) {
      console.error(`Reddit sub /${sub} error:`, e.message);
    }
  }

  return dedup(results, 'url');
}

// --- Twitter/X Scanner ---
async function scanTwitter() {
  const token = process.env.TWITTER_BEARER_TOKEN;
  if (!token) { console.log('  Twitter: skipped (no bearer token)'); return []; }

  const queries = [
    '"sold out" tickets -is:retweet lang:en',
    '"can\'t get tickets" -is:retweet lang:en',
    '"sold out in minutes" tickets -is:retweet lang:en',
    '"need tickets" "sold out" -is:retweet lang:en',
    '"sellout" concert OR show OR game -is:retweet lang:en',
    '"sold out" wrestling OR gymnastics OR volleyball OR softball -is:retweet lang:en',
    '"sold out" "minor league" OR milb OR "banana ball" OR ironpigs -is:retweet lang:en',
    '"sold out" comedy OR comedian -is:retweet lang:en',
    '"sold out" "college wrestling" OR "Penn State" OR "Oklahoma State" -is:retweet lang:en',
    '"sold out" "LSU gymnastics" OR "college gymnastics" -is:retweet lang:en',
    '"sold out" "savannah bananas" OR "durham bulls" -is:retweet lang:en',
    '"sold out" "women\'s basketball" OR WNBA OR "final four" -is:retweet lang:en'
  ];

  const results = [];

  for (const query of queries) {
    try {
      const url = `https://api.twitter.com/2/tweets/search/recent?query=${encodeURIComponent(query)}&max_results=20&tweet.fields=created_at,public_metrics,author_id`;
      const res = await fetch(url, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const json = JSON.parse(res.data);
      if (json?.data) {
        for (const tweet of json.data) {
          const metrics = tweet.public_metrics || {};
          results.push({
            source: 'twitter',
            subreddit: '',
            title: tweet.text.substring(0, 120),
            text: tweet.text.substring(0, 500),
            url: `https://x.com/i/status/${tweet.id}`,
            score: (metrics.like_count || 0) + (metrics.retweet_count || 0) * 3,
            numComments: metrics.reply_count || 0,
            created: tweet.created_at ? new Date(tweet.created_at).getTime() / 1000 : null,
            author: tweet.author_id || ''
          });
        }
      }
      await new Promise(r => setTimeout(r, 1500));
    } catch (e) {
      console.error(`Twitter search error for "${query.substring(0, 40)}...":`, e.message);
    }
  }

  return dedup(results, 'url');
}

// --- Brave Web Scanner ---
async function scanBrave() {
  const key = process.env.BRAVE_API_KEY;
  if (!key) { console.log('  Brave: skipped (no API key)'); return []; }

  const queries = [
    // Reddit via Brave (replaces Reddit API)
    'site:reddit.com "sold out" tickets',
    'site:reddit.com "can\'t get tickets"',
    'site:reddit.com "sold out" concert OR show 2026',
    'site:reddit.com "sold out" wrestling OR gymnastics tickets',
    'site:reddit.com "sold out" volleyball OR softball tickets',
    'site:reddit.com "sold out" minor league OR milb OR "banana ball"',
    'site:reddit.com "need tickets" "sold out"',
    'site:reddit.com "sold out" comedy OR comedian tickets',
    'site:reddit.com "sold out" college sports tickets',
    'site:reddit.com "sold out" hockey OR lacrosse tickets',
    // College sports deep dive
    'site:reddit.com "sold out" college wrestling gymnastics',
    'site:reddit.com "sold out" women\'s basketball volleyball',
    'site:reddit.com "sold out" college softball baseball',
    'site:reddit.com "sold out" Penn State Oklahoma State Iowa wrestling',
    'site:reddit.com "sold out" LSU gymnastics',
    'site:reddit.com "sold out" Nebraska volleyball',
    'site:reddit.com "sold out" Frozen Four college hockey',
    // Minor league baseball
    'site:reddit.com "sold out" minor league milb bobblehead',
    'site:reddit.com "sold out" savannah bananas banana ball',
    'site:reddit.com "sold out" ironpigs durham bulls',
    // General web
    '"sold out" tickets concert 2026',
    '"sold out" college wrestling tickets 2026',
    '"sold out" college gymnastics tickets 2026',
    '"sold out" minor league baseball sold out 2026',
    '"sold out" comedy show tickets 2026',
    '"sold out" Women\'s College World Series tickets 2026',
    '"sold out" Frozen Four NCAA tickets 2026',
    '"sold out" Women\'s Final Four tickets 2026',
    '"sold out" savannah bananas 2026',
    '"sold out" PLL lacrosse tickets 2026'
  ];

  const results = [];

  for (const query of queries) {
    try {
      const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=10&freshness=pw`;
      const res = await fetch(url, {
        headers: { 'X-Subscription-Token': key }
      });
      const json = JSON.parse(res.data);
      if (json?.web?.results) {
        for (const r of json.web.results) {
          // Only include results that look like real event chatter
          const text = `${r.title} ${r.description || ''}`.toLowerCase();
          const hasScarcity = SCARCITY_KEYWORDS.some(kw => text.includes(kw));
          if (hasScarcity) {
            results.push({
              source: 'brave',
              subreddit: '',
              title: (r.title || '').substring(0, 120),
              text: (r.description || '').substring(0, 500),
              url: r.url,
              score: 0,
              numComments: 0,
              created: r.age ? Date.now() / 1000 - 86400 : null,
              author: r.url ? new URL(r.url).hostname : ''
            });
          }
        }
      }
      await new Promise(r => setTimeout(r, 1000));
    } catch (e) {
      console.error(`Brave search error for "${query.substring(0, 40)}...":`, e.message);
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
// Pull out the actual artist/team/show name — NO raw post text
function extractCleanEventInfo(mentions) {
  const texts = mentions.map(m => `${m.title} ${m.text}`).join(' ');
  const lower = texts.toLowerCase();
  let eventName = null;
  let eventType = null;
  let venueName = null;

  const subs = [...new Set(mentions.map(m => m.subreddit).filter(Boolean))];
  const genericSubs = ['tickets', 'concerts', 'livemusic', 'comedy', 'Concerts',
    'EventTickets', 'StubHub', 'mma', 'boxing', 'esports',
    'BostonSocialClub', 'boston', 'washdc', 'orangecounty', 'burlington',
    'CUA', 'SocialParis', 'ChennaiBuyAndSell', 'concerts_india', 'Broadway',
    'SquaredCircle', 'askspain', 'GoingToSpain', 'qatar', 'rugbyunion'];
  const junkSubs = ['pcmasterrace', 'watercooling', 'indianbikes', 'thesidehustle',
    'SideHustleGold', 'OnlineIncomeHustle', 'AIDevelopmentSolution',
    'TwoXIndia', 'AskIndianWomen', 'riftboundtcg', 'relationships', 'confession',
    'TalesFromTheFrontDesk', 'AmItheAsshole', 'tifu', 'askreddit', 'TeenIndia',
    'PataHaiAajKyaHua', 'unpopularopinion', 'NoStupidQuestions'];

  // Known subreddit -> event name
  const subToEvent = {
    'TameImpala': { name: 'Tame Impala', type: 'artist' },
    'JesseWelles': { name: 'Jesse Welles', type: 'artist' },
    'WWE': { name: 'WWE', type: 'team' },
    'AEWOfficial': { name: 'AEW Wrestling', type: 'team' },
    'SquaredCircle': { name: 'Pro Wrestling', type: 'team' },
    'Jcole': { name: 'J. Cole', type: 'artist' },
    // NPBtickets removed — non-US
    // WorldCup2026Tickets removed — non-US event
    'NCAAW': { name: 'NCAA Womens Basketball', type: 'team' },
    'CollegeWrestling': { name: 'College Wrestling', type: 'team' },
    'collegehockey': { name: 'College Hockey', type: 'team' },
    'collegebaseball': { name: 'College Baseball', type: 'team' },
    'collegesoftball': { name: 'College Softball', type: 'team' },
    'OKState': { name: 'Oklahoma State', type: 'team' },
    'PennStateUniversity': { name: 'Penn State', type: 'team' },
    'LSUTigers': { name: 'LSU', type: 'team' },
    'Huskers': { name: 'Nebraska', type: 'team' },
    'IowaHawkeyes': { name: 'Iowa', type: 'team' },
    // FigureSkating removed — mostly non-US events
    'SavannahBananas': { name: 'Savannah Bananas', type: 'team' },
    'DurhamBulls': { name: 'Durham Bulls', type: 'team' },
    'minorleaguebaseball': { name: 'Minor League Baseball', type: 'team' },
    'milb': { name: 'Minor League Baseball', type: 'team' },
    'PLL': { name: 'Premier Lacrosse League', type: 'team' },
    'wnba': { name: 'WNBA', type: 'team' },
    'nwsl': { name: 'NWSL', type: 'team' },
    'gymnastics': { name: 'Gymnastics', type: 'team' },
    'volleyball': { name: 'Volleyball', type: 'team' },
    'swimming': { name: 'NCAA Swimming', type: 'team' },
    'trackandfield': { name: 'Track & Field', type: 'team' },
    'lacrosse': { name: 'Lacrosse', type: 'team' },
    'lvjy': { name: 'Lvjy', type: 'artist' },
    'Illenium': { name: 'Illenium', type: 'artist' },
    'ArchEnemy': { name: 'Arch Enemy', type: 'artist' },
    'ToolBand': { name: 'Tool', type: 'artist' },
    'katebush': { name: 'Kate Bush', type: 'artist' },
    'DojaCat': { name: 'Doja Cat', type: 'artist' },
    'MadisonBeer': { name: 'Madison Beer', type: 'artist' },
  };

  for (const s of subs) {
    if (subToEvent[s]) { eventName = subToEvent[s].name; eventType = subToEvent[s].type; break; }
  }

  // Pattern matching — strict: must look like a real event/artist/team name
  if (!eventName) {
    const patterns = [
      // "X Tour" / "X World Tour"
      /\b([A-Z][A-Za-z0-9\s&\-']{2,30}?)\s+(?:World\s+)?Tour\b/,
      // "tickets to/for [Event Name]" — Event must start with capital
      /tickets?\s+(?:to|for)\s+(?:the\s+)?([A-Z][A-Za-z0-9\s&\-']{2,30}?)(?:\s+concert|\s+show|\s+game|\s+tour)/i,
      // "[Event Name] tickets sold out"
      /\b([A-Z][A-Za-z0-9\s&\-']{2,30}?)\s+tickets?\s+(?:sold|are\s+sold)/,
      // "[Event Name] sold out" — strict: must be capitalized proper noun
      /\b([A-Z][A-Za-z][A-Za-z0-9\s&\-']{1,28}?)\s+(?:is\s+)?(?:SOLD OUT|sold out)/,
      // "sold out at/for [Event Name]"
      /sold\s*out\s+(?:at|for)\s+(?:the\s+)?([A-Z][A-Za-z][A-Za-z0-9\s&\-']{2,28})/,
      // "[Event Name]: SOLD OUT"
      /\b([A-Z][A-Za-z][A-Za-z0-9\s&\-']{2,28}?)\s*[:\-]\s*(?:SOLD OUT|Sold Out)/,
    ];
    for (const pat of patterns) {
      const match = texts.match(pat);
      if (match && match[1]) {
        let candidate = match[1].trim().replace(/\s+/g, ' ');
        const wc = candidate.split(' ').length;
        // Strict validation: 1-5 words, proper noun, no sentence starters
        const bad = /^(I |My |Its |This |That |And |But |So |For |In |On |At |It |A |If |We |He |She |They |You |Just |Only |Who |What |Why |How |All |Per |Some |Every |Now |The |@|RT |http|Has |Have |Been |Was |Were |Are |Is |Do |Did |Can |Will |Not |No |Yes )/;
        if (wc <= 5 && wc >= 1 && candidate.length >= 4 && candidate.length <= 40 && !bad.test(candidate)) {
          eventName = candidate; break;
        }
      }
    }
  }

  // NO subreddit fallback — only use known mappings or regex matches
  // Random subreddit names (r/Rochester, r/roadtrip) are NOT events

  // Venue extraction
  const venuePatterns = [
    /(House of Blues|Red Rocks|The Fillmore|Madison Square Garden|MSG|Ryman|Greek Theatre|Hollywood Bowl|Radio City|Carnegie Hall|Beacon Theatre|Apollo Theater|Bowery Ballroom|9:30 Club|The Anthem|Gorge Amphitheatre|Bryce Jordan Center|Gallagher-Iba Arena|Maravich Center|Bijou Theatre|T-Mobile Arena|Higher Ground)/i,
    /(?:at|@)\s+(?:the\s+)?([A-Z][A-Za-z0-9\s&\-'\.]{3,30}?)(?:\s*[-,\.]|\s+on\s|\s+in\s|$)/,
  ];
  for (const vp of venuePatterns) {
    const vm = texts.match(vp);
    if (vm) { venueName = (vm[1] || vm[0]).trim(); break; }
  }

  if (!eventType) {
    if (lower.match(/comedian|comedy|stand-?up|open mic/)) eventType = 'comedian';
    else if (lower.match(/concert|tour|album|band|singer|music|festival|gig/)) eventType = 'artist';
    else if (lower.match(/game|match|playoff|championship|derby|rivalry|wrestling|gymnastics|volleyball|softball|hockey|lacrosse|baseball|minor league|milb/)) eventType = 'team';
    else if (lower.match(/broadway|theater|theatre|musical|play/)) eventType = 'show';
    else eventType = 'event';
  }

  // Final quality filter
  if (eventName) {
    const en = eventName.toLowerCase().trim();
    // Must be 3+ chars, no @/http, no single common words
    const garbage = ['and', 'the', 'for', 'but', 'all', 'as all', 'sale', 'sold', 'tickets',
      'help', 'question', 'update', 'rant', 'advice', 'discussion', 'managers',
      'full-access', 'ios', 'crypto', 'app', 'reddit', 'psa', 'meta', 'mod',
      'autograph', 'rome', 'aruba', 'tax', 'july', 'june', 'march', 'april',
      'sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday',
      'derby', 'uktrains', 'confession', 'relationship', 'nearly', 'formuladank',
      'jurassic', 'moon shots', 'baseballcards', 'vintage', 'asheville',
      'bookmyshow', 'bms', 'dynamite', 'cole', 'sb19', 'february',
      'katebush', 'reason why', 'eve', 'productivityhq',
      'tales from', 'pata hai', 'front desk', 'guest',
      'downfall', 'girlfriend', 'boyfriend', 'london irish', 'finalissima',
      'ind vs', 'tncacricket', 'adamp', 'victoria0', 'amc prarie',
      'glimt', 'phoenix', 'each night', 'little miss', 'chattanooga',
      'ghosting', 'manipal', 'freiburg', 'palmeiras', 'kolkata',
      'sfgiants', 'fifacareer', 'xclusiveprompt', 'eden garden',
      'moon shot', 'meme coin', 'solana', 'baseballcard', 'vintage',
      'jurassic world', 'revels', 'apology', 'prompt',
      'mumbai', 'spain', 'hotels', 'witcher', 'officalpsl', 'karan',
      'rochester', 'hkfan', 'hell\'s kitchen', 'geico', 'roadtrip',
      'because', 'this', 'real', 'glasgow', 'charlotte shows',
      'nearly', 'aves la', 'sunday', 'monday', 'bangtan', 'sb19',
      'bookmyshow', 'bms it', 'hope we can', 'per wrestletix',
      'guest took', 'empty seats', 'not only this', 'feeling sour',
      'anything going', 'at what point', 'where should',
      'what is with', 'looking for', 'need help',
      'each night', 'little miss',
      'eden garden', 'ind vs', 'west indies',
      'victoria0', 'adamp', 'glimt', 'phoenix suns',
      'july 14th', 'february',
      'doja\'s', 'madison', 'sirat', 'jude dream home',
      'ulta beauty'];
    const isGarbage = garbage.some(g => en === g || en.includes(g));
    const isSentence = /^(I |My |His |Her |Its |This |That |We |He |She |They |You |Just |Only |At |Per |Nearly |After |Before |Those |These |When |Where |Some |No |Not |More |Most |Such |Each |If )/i.test(eventName);
    const hasVerbs = /\b(are|is|was|were|have|has|had|been|being|would|could|should|will|can|do|does|did|not|no|yes|but|yet|also|very|just|even|still|already|about|only|confirm|confirms|completely)\b/i.test(eventName);
    const isGeneric = en.split(' ').length > 5 || /^\d+/.test(en) || en.includes(' as ') || en.includes('_');
    const hasJunk = eventName.includes('@') || eventName.includes('http') || eventName.includes('...');
    if (en.length < 4 || isGarbage || isSentence || hasVerbs || isGeneric || hasJunk) {
      eventName = null;
    }
  }

  return { eventName: eventName || null, eventType, venueName, subredditHint: subs[0] || null };
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

// Posts that are clearly not events
const NOISE_KEYWORDS = [
  'build', 'pc build', 'first build', 'gpu', 'cpu', 'motherboard',
  'recipe', 'cooking', 'dating', 'date story', 'relationship',
  'train', 'railway', 'railroad', 'transit', 'bus pass',
  'movie theater', 'cinema', 'streaming', 'netflix',
  'parking', 'apartment', 'rent', 'mortgage',
  'credit card', 'bank account', 'loan',
  'good date', 'bad date', 'first date',
  'crypto', 'meme coin', 'solana', 'blockchain', 'nft', 'token launch',
  'baseball card', 'trading card', 'vintage card', 'collectible',
  'jurassic', 'app store', 'google play', 'mobile game',
  'ghosting', 'ghosted', 'confession', 'front desk', 'hotel guest',
  'empty desk', 'review', 'my school is giving',
  'donation drive', 'raffle', 'giveaway',
  'fantasy league', 'fantasy football', 'career mode', 'fifa career'
];

// Non-US location indicators — reject posts about events outside the US
const NON_US_INDICATORS = [
  'india', 'mumbai', 'chennai', 'kolkata', 'delhi', 'bangalore', 'hyderabad',
  'bookmyshow', 'bms', 'ipl', 'ind vs', 'chepuk',
  'uk ', 'london', 'manchester', 'birmingham uk', 'glasgow', 'edinburgh',
  'australia', 'melbourne', 'sydney', 'aus gp',
  'spain', 'madrid', 'barcelona', 'la liga',
  'germany', 'freiburg', 'bundesliga', 'dortmund',
  'brazil', 'palmeiras', 'são paulo', 'rio',
  'philippines', 'manila', 'pht', '12nn pht',
  'japan', 'tokyo', 'osaka', 'npb',
  'korea', 'seoul', 'kpop',
  'qatar', 'doha', 'dubai', 'abu dhabi',
  'paris', 'france',
  'canada', 'toronto', 'vancouver', 'montreal',
  'mexico', 'liga mx',
  'eden garden', 'wankhede', 'manipal', 'revels',
  'world cup 2026', 'fifa world cup',
  'prague', 'vienna', 'amsterdam', 'rome', 'milan', 'lisbon',
  'champions league', 'premier league', 'serie a'
];

function isEventRelated(mention) {
  const text = `${mention.title} ${mention.text}`.toLowerCase();
  const sub = (mention.subreddit || '').toLowerCase();

  // Reject non-US events
  if (NON_US_INDICATORS.some(kw => text.includes(kw))) return false;

  // Reject junk subreddits outright
  const junkSubs = ['pcmasterrace', 'watercooling', 'indianbikes', 'thesidehustle',
    'sidehustlegold', 'onlineincomehustle', 'aidevelopmentsolution',
    'twoxindia', 'askindianwomen', 'riftboundtcg', 'relationships', 'confession',
    'talesfromthefrontdesk', 'amitheasshole', 'tifu', 'askreddit', 'teenindia',
    'patahaikyahua', 'unpopularopinion', 'nostupidquestions', 'formuladank',
    'sfgiants', 'baseballcards', 'jurassicworld', 'cryptocurrency', 'cryptomoonshots',
    'wallstreetbets', 'memecoins', 'fifacareer', 'hkfan', 'officalpsl',
    'tncacricket', 'rugbyunion', 'askspain', 'goingtospain', 'qatar',
    'concerts_india', 'chennaibuyandsell', 'socialparis', 'uktrains',
    'bangtan', 'bts', 'kpop', 'xclusiveprompt', 'productivityhq',
    'worldcup2026tickets', 'npbtickets', 'figureskating'];
  if (junkSubs.includes(sub)) return false;

  // Reject obvious noise
  if (NOISE_KEYWORDS.some(kw => text.includes(kw))) {
    const strongEvent = ['sold out', 'sellout', 'sell out', 'sold-out', 'can\'t get tickets', 'tickets gone'];
    if (!strongEvent.some(kw => text.includes(kw))) return false;
  }

  // Must have at least one HARD signal (ticket-specific language)
  const hasHardSignal = HARD_EVENT_SIGNALS.some(kw => text.includes(kw));
  if (!hasHardSignal) return false;

  // Plus at least 2 soft signals
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

// --- Google Trends Verification (via SerpAPI) ---
async function checkGoogleTrends(eventName) {
  const key = process.env.SERPAPI_KEY;
  if (!key || !eventName) return null;

  try {
    const q = encodeURIComponent(eventName + ' tickets');
    const url = `https://serpapi.com/search.json?engine=google_trends&q=${q}&data_type=TIMESERIES&date=today+1-m&api_key=${key}`;
    const res = await fetch(url);
    const json = JSON.parse(res.data);

    if (json?.interest_over_time?.timeline_data) {
      const points = json.interest_over_time.timeline_data;
      if (points.length < 2) return null;

      const recent = points.slice(-2).map(p => p.values?.[0]?.extracted_value || 0);
      const older = points.slice(0, Math.max(1, points.length - 4)).map(p => p.values?.[0]?.extracted_value || 0);
      const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
      const olderAvg = older.reduce((a, b) => a + b, 0) / older.length || 1;

      const spike = recentAvg / olderAvg;
      const peak = Math.max(...points.map(p => p.values?.[0]?.extracted_value || 0));

      return {
        spike: Math.round(spike * 100) / 100,
        peak,
        recentAvg: Math.round(recentAvg),
        trending: spike >= 2, // 2x+ spike = trending
        hot: spike >= 5,      // 5x+ spike = on fire
      };
    }
  } catch (e) {
    // Don't fail the whole scan for trends errors
  }
  return null;
}

// --- Main Scanner ---
async function runScan() {
  console.log('🏴‍☠️ Blackbeard scanning for treasure...');
  const startTime = Date.now();

  const redditResults = await scanReddit();
  console.log(`  Reddit: ${redditResults.length} mentions found`);

  const twitterResults = await scanTwitter();
  console.log(`  Twitter: ${twitterResults.length} mentions found`);

  const braveResults = await scanBrave();
  console.log(`  Brave: ${braveResults.length} mentions found`);

  const allMentions = [...redditResults, ...twitterResults, ...braveResults];

  // Group by event
  const groups = groupMentions(allMentions);

  // Score each group
  const scoredEvents = [];
  for (const [eventKey, mentions] of Object.entries(groups)) {
    const scoring = scoreEvent(mentions);
    if (!scoring) continue;

    const category = categorizeEvent(mentions.map(m => `${m.title} ${m.text}`).join(' '));

    const info = extractCleanEventInfo(mentions);
    // SKIP events without a clean identifiable name
    if (!info.eventName) continue;
    const displayTitle = info.eventName + (info.venueName ? ' @ ' + info.venueName : '');

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

  // Google Trends verification for top candidates (limit to save API calls)
  scoredEvents.sort((a, b) => b.totalScore - a.totalScore);
  const trendsChecks = scoredEvents.slice(0, 15);
  for (const event of trendsChecks) {
    if (event.eventName) {
      const trends = await checkGoogleTrends(event.eventName);
      if (trends) {
        event.googleTrends = trends;
        // Boost score based on trends
        if (trends.hot) {
          event.totalScore = Math.min(event.totalScore + 20, 100);
          event.breakdown.trendsBonus = 20;
        } else if (trends.trending) {
          event.totalScore = Math.min(event.totalScore + 10, 100);
          event.breakdown.trendsBonus = 10;
        } else {
          event.breakdown.trendsBonus = 0;
        }
      }
      await new Promise(r => setTimeout(r, 800)); // rate limit courtesy
    }
  }

  // Re-sort after trends boost
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

  const categoryEmoji = { comedy: '🎤', concerts: '🎵', sports: '🏆', other: '🎟️', 'college-sports': '🎓', 'minor-league': '⚾' };

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

    // Google Trends indicator
    if (e.googleTrends?.hot) msg += `📈 **GOOGLE TRENDS: 🔥 ${e.googleTrends.spike}x spike** (peak: ${e.googleTrends.peak}/100)\n`;
    else if (e.googleTrends?.trending) msg += `📈 Google Trends: ↑ ${e.googleTrends.spike}x spike (peak: ${e.googleTrends.peak}/100)\n`;

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
