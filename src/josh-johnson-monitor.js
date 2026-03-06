const https = require('https');
const fs = require('fs');
const path = require('path');

// Load .env
try {
  const envPath = path.join(__dirname, '..', '.env');
  const lines = fs.readFileSync(envPath, 'utf8').split('\n');
  for (const l of lines) { const [k,...v] = l.split('='); if(k&&v.length) process.env[k.trim()]=v.join('=').trim(); }
} catch(e){}

const BEARER = process.env.TWITTER_BEARER_TOKEN;
const STATE_FILE = path.join(__dirname, '..', 'data', 'jj-monitor-state.json');

function loadState() { try { return JSON.parse(fs.readFileSync(STATE_FILE,'utf8')); } catch(e) { return { seenIds: [] }; } }
function saveState(s) { fs.writeFileSync(STATE_FILE, JSON.stringify(s,null,2)); }

async function check() {
  const state = loadState();
  
  const url = `https://api.twitter.com/2/tweets/search/recent?query=%22Josh+Johnson%22+(tickets+OR+%22sold+out%22+OR+%22added%22+OR+%22new+date%22+OR+%22just+announced%22+OR+%22on+sale%22+OR+%22second+show%22)+-is:retweet+lang:en&max_results=20&tweet.fields=created_at,public_metrics`;
  
  const res = await new Promise((resolve, reject) => {
    https.get(url, { headers: { 'Authorization': `Bearer ${BEARER}`, 'User-Agent': 'BB/1.0' } }, r => {
      let d = ''; r.on('data', c => d += c); r.on('end', () => resolve({ status: r.statusCode, data: d }));
    }).on('error', reject);
  });

  const data = JSON.parse(res.data);
  const tweets = data.data || [];
  
  const newTweets = tweets.filter(t => !state.seenIds.includes(t.id));
  
  if (newTweets.length > 0) {
    console.log(`🎤 JOSH JOHNSON MONITOR — ${newTweets.length} new tweets:\n`);
    for (const t of newTweets) {
      console.log(`${t.created_at}`);
      console.log(`${t.text.substring(0, 280)}`);
      console.log(`❤️ ${t.public_metrics?.like_count || 0} | 🔄 ${t.public_metrics?.retweet_count || 0}`);
      console.log('---');
      state.seenIds.push(t.id);
    }
    
    // Check for added show signals
    const addedShows = newTweets.filter(t => 
      /added|second show|new date|just announced|due to demand/i.test(t.text)
    );
    if (addedShows.length > 0) {
      console.log('\n🚨 ADDED SHOW SIGNAL DETECTED:');
      addedShows.forEach(t => console.log(t.text.substring(0, 280)));
    }
  } else {
    console.log('✅ Josh Johnson: No new tweets since last check.');
  }
  
  // Keep only last 100 IDs
  state.seenIds = state.seenIds.slice(-100);
  state.lastCheck = new Date().toISOString();
  saveState(state);
}

check().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
