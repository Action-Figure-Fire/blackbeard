#!/usr/bin/env node
// Mass Artist Discovery — builds a huge watchlist from multiple sources
// Sources: Spotify editorial playlists, Brave Search charts, genre-specific queries
// Then validates via Bandsintown API (has tour dates = worth tracking)

require('dotenv').config();
const https = require('https');
const fs = require('fs');
const path = require('path');

const WATCHLIST_PATH = path.join(__dirname, '..', 'data', 'watchlist.json');
const BRAVE_API_KEY = process.env.BRAVE_API_KEY;
const BIT_APP_ID = 'squarespace-blackbeard';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function httpGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith('https') ? https : require('http');
    const u = new URL(url);
    const opts = { hostname: u.hostname, path: u.pathname + u.search, headers: { 'User-Agent': 'BlackbeardDiscovery/1.0', ...headers }, timeout: 12000 };
    proto.get(opts, res => {
      if ([301, 302, 303, 307].includes(res.statusCode) && res.headers.location) {
        return httpGet(res.headers.location.startsWith('http') ? res.headers.location : new URL(res.headers.location, url).href, headers).then(resolve).catch(reject);
      }
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve(JSON.parse(d)); } catch { resolve(d); }
      });
    }).on('error', reject).on('timeout', function() { this.destroy(); reject(new Error('timeout')); });
  });
}

async function braveSearch(query) {
  const q = encodeURIComponent(query);
  try {
    const data = await httpGet(
      `https://api.search.brave.com/res/v1/web/search?q=${q}&count=10`,
      { 'X-Subscription-Token': BRAVE_API_KEY, 'Accept': 'application/json' }
    );
    return data.web ? data.web.results : [];
  } catch { return []; }
}

function extractArtistNames(text) {
  // Extract artist names from text — look for capitalized words, quoted names, list patterns
  const names = new Set();
  
  // Pattern: "Artist Name" or 'Artist Name'
  const quoted = text.match(/["']([A-Z][^"']{2,30})["']/g);
  if (quoted) quoted.forEach(q => names.add(q.replace(/["']/g, '').trim()));
  
  // Pattern: bullet/numbered lists
  const lines = text.split('\n');
  for (const line of lines) {
    const cleaned = line.replace(/^\s*[-•*\d.)\]]+\s*/, '').trim();
    // If line looks like an artist name (2-40 chars, starts with capital or is all caps)
    if (cleaned.length >= 2 && cleaned.length <= 40 && /^[A-Z]/.test(cleaned)) {
      // Remove common suffixes
      const name = cleaned.replace(/\s*[-–—]\s.*$/, '').replace(/\s*\(.*\)$/, '').trim();
      if (name.length >= 2 && name.length <= 35) names.add(name);
    }
  }
  
  return [...names];
}

async function checkBandsintown(artistName) {
  const encoded = encodeURIComponent(artistName);
  try {
    const data = await httpGet(`https://rest.bandsintown.com/artists/${encoded}/events?app_id=${BIT_APP_ID}`);
    if (Array.isArray(data)) {
      const usEvents = data.filter(e => e.venue?.country === 'United States');
      return { hasEvents: usEvents.length > 0, usCount: usEvents.length, totalCount: data.length, soldOut: data.filter(e => e.sold_out).length };
    }
    return { hasEvents: false, usCount: 0, totalCount: 0, soldOut: 0 };
  } catch {
    return { hasEvents: false, usCount: 0, totalCount: 0, soldOut: 0 };
  }
}

// Massive seed lists of artists to check
const SEED_ARTISTS = {
  // TOP TOURING ACTS 2025-2026
  popular: [
    'Billie Eilish', 'Olivia Rodrigo', 'Sabrina Carpenter', 'Chappell Roan', 'Teddy Swims',
    'Hozier', 'Tyler Childers', 'Zach Bryan', 'Noah Kahan', 'Gracie Abrams',
    'Reneé Rapp', 'Benson Boone', 'Tate McRae', 'Post Malone', 'Morgan Wallen',
    'Luke Combs', 'Chris Stapleton', 'Jelly Roll', 'Bailey Zimmerman', 'Lainey Wilson',
    'Shaboozey', 'Tommy Richman', 'Charli XCX', 'Doja Cat', 'SZA',
    'Kendrick Lamar', 'Tyler The Creator', 'Deftones', 'Green Day', 'Weezer',
    'The Killers', 'Cage The Elephant', 'Twenty One Pilots', 'Fall Out Boy', 'Imagine Dragons',
    'Glass Animals', 'Tame Impala', 'Arctic Monkeys', 'The 1975', 'Bleachers',
    'Vampire Weekend', 'The National', 'Bon Iver', 'Fleet Foxes', 'Phoebe Bridgers',
    'Boygenius', 'Japanese Breakfast', 'Beach House', 'Khruangbin', 'Turnstile',
  ],
  
  // INDIE / ALT / RISING
  indie: [
    'Fontaines D.C.', 'Mannequin Pussy', 'IDLES', 'Alvvays', 'Snail Mail',
    'Soccer Mommy', 'Alex G', 'Hovvdy', 'Wednesday', 'MJ Lenderman',
    'Geese', 'Been Stellar', 'Bar Italia', 'Black Country New Road', 'Squid',
    'Dry Cleaning', 'Yard Act', 'Wet Leg', 'Beabadoobee', 'PinkPantheress',
    'Raye', 'Central Cee', 'FKA twigs', 'Clairo', 'Men I Trust',
    'Still Woozy', 'Wallows', 'Dayglow', 'Surfaces', 'Peach Pit',
    'Current Joys', 'Dijon', 'Daniel Caesar', 'Ravyn Lenae', 'Faye Webster',
    'Big Thief', 'Angel Olsen', 'Waxahatchee', 'Cat Power', 'Sharon Van Etten',
    'Adrianne Lenker', 'Julien Baker', 'Lucy Dacus', 'Mitski', 'Caroline Polachek',
    'Weyes Blood', 'Kim Gordon', 'St. Vincent', 'Perfume Genius', 'The Smile',
  ],
  
  // ELECTRONIC / DJ
  electronic: [
    'Fred Again', 'Skrillex', 'John Summit', 'Dom Dolla', 'Chris Lake',
    'Disclosure', 'RÜFÜS DU SOL', 'Odesza', 'Lane 8', 'Above & Beyond',
    'ZHU', 'Griz', 'CloZee', 'Elderbrook', 'Bonobo',
    'Four Tet', 'Jamie xx', 'Bicep', 'Floating Points', 'Moderat',
    'Tycho', 'Big Wild', 'Louis The Child', 'Madeon', 'Porter Robinson',
    'Illenium', 'Excision', 'Zeds Dead', 'GRiZ', 'Pretty Lights',
    'Tiesto', 'deadmau5', 'Eric Prydz', 'Peggy Gou', 'Charlotte De Witte',
    'Amelie Lens', 'I Hate Models', 'Indira Paganotto', 'HoneyLuv', 'LP Giobbi',
    'Moore Kismet', 'Of The Trees', 'Wreckno', 'G Jones', 'Eprom',
    'Noisia', 'Chase & Status', 'Dimension', 'Sub Focus', 'Netsky',
  ],
  
  // COMEDY
  comedy: [
    'Nate Bargatze', 'Shane Gillis', 'Mark Normand', 'Theo Von', 'Andrew Schulz',
    'John Mulaney', 'Ali Wong', 'Hasan Minhaj', 'Sebastian Maniscalco', 'Bert Kreischer',
    'Tom Segura', 'Christina P', 'Whitney Cummings', 'Iliza Shlesinger', 'Taylor Tomlinson',
    'Nikki Glaser', 'Matt Friend', 'Ronny Chieng', 'Deon Cole', 'Roy Wood Jr',
    'Michelle Wolf', 'Fortune Feimster', 'Matteo Lane', 'Rachel Bloom', 'Tim Dillon',
    'Kill Tony', 'Tony Hinchcliffe', 'Bobby Lee', 'Andrew Santino', 'Chris Distefano',
    'Sal Vulcano', 'Joe List', 'Dan Soder', 'Big Jay Oakerson', 'Luis J Gomez',
    'Yannis Pappas', 'Akaash Singh', 'Nimesh Patel', 'Moses Storm', 'Ramy Youssef',
    'Jerrod Carmichael', 'Neal Brennan', 'Michelle Buteau', 'Carmen Christopher', 'Sam Jay',
    'Dulce Sloan', 'Liza Treyger', 'Ian Fidance', 'Kate Berlant', 'Jacqueline Novak',
  ],
  
  // COUNTRY / AMERICANA
  country: [
    'Cody Johnson', 'Parker McCollum', 'Cody Jinks', 'Turnpike Troubadours', 'Caamp',
    'Sierra Ferrell', 'Charley Crockett', 'Colter Wall', 'Sturgill Simpson', 'Jason Isbell',
    'Billy Strings', 'Trampled by Turtles', 'Hailey Whitters', 'Megan Moroney', 'Ella Langley',
    'Nate Smith', 'Muscadine Bloodline', 'Flatland Cavalry', 'Read Southall Band', 'Koe Wetzel',
    'Whiskey Myers', 'Midland', 'Brothers Osborne', 'Old Crow Medicine Show', 'Greensky Bluegrass',
    'Railroad Earth', 'The Avett Brothers', 'Brandi Carlile', 'Marcus King', 'Larkin Poe',
    'Orville Peck', 'Tanya Tucker', 'Wynonna Judd', 'Ashley McBryde', 'Elle King',
    'Hardy', 'Ernest', 'Jessie Murph', 'Warren Zeiders', 'Kameron Marlowe',
  ],
  
  // HIP HOP / R&B
  hiphop: [
    'JID', 'Denzel Curry', 'Freddie Gibbs', 'Vince Staples', 'Earthgang',
    'Smino', 'Amine', 'Rico Nasty', 'IDK', 'Russ',
    'Curren$y', 'Larry June', 'Boldy James', 'Action Bronson', 'Danny Brown',
    'Armand Hammer', 'Jpegmafia', 'Injury Reserve', 'Noname', 'Saba',
    'Tierra Whack', 'Tkay Maidza', 'Little Simz', 'Loyle Carner', 'Sampha',
    'Jorja Smith', 'Cleo Sol', 'Kelela', 'Victoria Monét', 'Summer Walker',
    'Brent Faiyaz', 'Steve Lacy', 'Omar Apollo', 'Mk.gee', 'Dominic Fike',
    'Tyla', 'Ayra Starr', 'Burna Boy', 'Wizkid', 'Rema',
  ],
  
  // ROCK / PUNK / METAL
  rock: [
    'Greta Van Fleet', 'Rival Sons', 'Spiritbox', 'Knocked Loose', 'Turnover',
    'Title Fight', 'Touche Amore', 'Deafheaven', 'Show Me The Body', 'Drain',
    'Militarie Gun', 'Chat Pile', 'Model/Actriz', 'Crack Cloud', 'Mdou Moctar',
    'Osees', 'King Gizzard', 'Ty Segall', 'Thee Oh Sees', 'Frankie and the Witch Fingers',
    'Psychedelic Porn Crumpets', 'Viagra Boys', 'Shame', 'Tropical Fuck Storm', 'Civic',
    'Power Trip', 'High On Fire', 'Sleep', 'Boris', 'Melvins',
    'Queens of the Stone Age', 'Mastodon', 'Baroness', 'Devin Townsend', 'Opeth',
    'Meshuggah', 'Gojira', 'Polyphia', 'Chon', 'Intervals',
  ],
  
  // JAM / LIVE MUSIC
  jam: [
    'Widespread Panic', 'Umphrey\'s McGee', 'Lettuce', 'Lotus', 'STS9',
    'Disco Biscuits', 'moe.', 'Trey Anastasio Band', 'Joe Russo\'s Almost Dead', 'Dark Star Orchestra',
    'Pigeons Playing Ping Pong', 'Eggy', 'Neighbor', 'Dopapod', 'Aqueous',
    'Spafford', 'Twiddle', 'Ghost Light', 'Circles Around The Sun', 'Tauk',
    'Cory Wong', 'Snarky Puppy', 'Vulfpeck', 'Fearless Flyers', 'Theo Katzman',
    'Lake Street Dive', 'Lawrence', 'Sammy Rae', 'The Revivalists', 'Tank and the Bangas',
  ],

  // LATIN / REGGAETON
  latin: [
    'Peso Pluma', 'Fuerza Regida', 'Junior H', 'Natanael Cano', 'Xavi',
    'Ivan Cornejo', 'DannyLux', 'Eslabon Armado', 'Grupo Frontera', 'Marca MP',
    'Los Tigres del Norte', 'Banda MS', 'Calibre 50', 'Christian Nodal', 'Grupo Firme',
    'Carín León', 'Luis R Conriquez', 'Gabito Ballesteros', 'Yng Lvcas', 'Alemán',
  ],
};

async function run() {
  console.log('🏴‍☠️ Mass Artist Discovery\n');
  
  const watchlist = JSON.parse(fs.readFileSync(WATCHLIST_PATH, 'utf8'));
  const existing = new Set((watchlist.artists || []).map(a => a.name.toLowerCase()));
  
  console.log(`   Current watchlist: ${existing.size} artists\n`);
  
  // Collect all seed artists
  const allSeeds = new Map(); // name -> genre
  for (const [genre, artists] of Object.entries(SEED_ARTISTS)) {
    for (const name of artists) {
      if (!existing.has(name.toLowerCase())) {
        allSeeds.set(name, genre);
      }
    }
  }
  
  console.log(`   ${allSeeds.size} new candidates to check\n`);
  
  // Also discover via Brave Search
  const braveQueries = [
    'most anticipated concert tours 2026',
    'best live music acts touring 2026',
    'hottest new artists touring summer 2026',
    'sold out concert tours 2026',
    'trending artists adding tour dates 2026',
    'best comedy tours 2026',
    'electronic music festivals headliners 2026',
    'indie rock bands touring 2026',
    'country music tours 2026',
    'hip hop tours 2026',
  ];
  
  let braveCallsUsed = 0;
  for (const query of braveQueries) {
    if (braveCallsUsed >= 15) break;
    console.log(`  🔍 Searching: "${query}"`);
    const results = await braveSearch(query);
    braveCallsUsed++;
    
    for (const r of results) {
      const text = (r.title || '') + ' ' + (r.description || '');
      const names = extractArtistNames(text);
      for (const name of names) {
        if (!existing.has(name.toLowerCase()) && !allSeeds.has(name)) {
          allSeeds.set(name, 'discovered');
        }
      }
    }
    await sleep(400);
  }
  
  console.log(`\n   Total candidates: ${allSeeds.size}`);
  console.log(`   Checking Bandsintown for tour dates...\n`);
  
  // Check each artist via Bandsintown
  let added = 0;
  let checked = 0;
  let withTours = 0;
  let soldOutArtists = 0;
  const newArtists = [];
  
  for (const [name, genre] of allSeeds) {
    checked++;
    if (checked % 25 === 0) console.log(`   ... checked ${checked}/${allSeeds.size}`);
    
    const bit = await checkBandsintown(name);
    await sleep(150); // Rate limit
    
    if (bit.hasEvents) {
      withTours++;
      const artist = {
        name,
        genre: genre === 'discovered' ? 'Unknown' : genre.charAt(0).toUpperCase() + genre.slice(1),
        tier: bit.usCount >= 10 ? 'A' : 'B',
        source: 'auto-discovery',
        addedDate: new Date().toISOString().split('T')[0],
        bandsintownEvents: bit.usCount,
        totalEvents: bit.totalCount,
        soldOutEvents: bit.soldOut,
      };
      
      newArtists.push(artist);
      added++;
      
      const soldOutTag = bit.soldOut ? ` 🔥${bit.soldOut} SOLD OUT` : '';
      const tierTag = artist.tier === 'A' ? '⭐' : '';
      process.stdout.write(`  ✅ ${tierTag}${name} (${genre}) — ${bit.usCount} US shows${soldOutTag}\n`);
      
      if (bit.soldOut) soldOutArtists++;
    }
  }
  
  // Add to watchlist
  if (!watchlist.artists) watchlist.artists = [];
  watchlist.artists.push(...newArtists);
  watchlist.lastDiscovery = new Date().toISOString();
  watchlist.totalArtists = watchlist.artists.length;
  
  fs.writeFileSync(WATCHLIST_PATH, JSON.stringify(watchlist, null, 2));
  
  console.log(`\n✅ Discovery complete`);
  console.log(`   ${checked} candidates checked`);
  console.log(`   ${withTours} have US tour dates`);
  console.log(`   ${added} added to watchlist`);
  console.log(`   ${soldOutArtists} with sold-out shows`);
  console.log(`   ${braveCallsUsed} Brave calls used`);
  console.log(`   📊 Total watchlist: ${watchlist.artists.length} artists`);
  
  return { added, withTours, soldOutArtists, total: watchlist.artists.length };
}

run().catch(console.error);
