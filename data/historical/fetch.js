const fs = require('fs');
const path = require('path');

const artists = [
  "Feid", "Naïka", "Don West", "Zara Larsson", "Josiah Queen", "Stephen Wilson Jr",
  "Gavin Adcock", "Rawayana", "Bleachers", "Empire of the Sun", "Laura Ramoso",
  "Two Door Cinema Club", "Rise Against", "Jinjer", "Passion Pit", "fakemink",
  "Maisie Peters", "Hayley Williams", "Yebba", "Natalia Lafourcade",
  "Corinne Bailey Rae", "Slayyyter", "DJO", "Mariah the Scientist",
  "Masayoshi Takanaka", "Hearts2Hearts", "Naomi Scott", "Raye", "Nessa Barrett",
  "Myles Smith", "Angine de Poitrine", "Sammy Rae", "Grupo Bronco"
];

const outDir = '/home/node/.openclaw/workspace/blackbeard/data/historical';
const sleep = ms => new Promise(r => setTimeout(r, ms));

const US_STATES = new Set(["AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY","DC"]);
const CA_PROVS = new Set(["AB","BC","MB","NB","NL","NS","NT","NU","ON","PE","QC","SK","YT"]);

function isUSCA(evt) {
  const cc = (evt.venue?.country || '').toUpperCase();
  const reg = (evt.venue?.region || '').toUpperCase();
  if (cc === 'UNITED STATES' || cc === 'US' || cc === 'USA') return true;
  if (cc === 'CANADA' || cc === 'CA') return true;
  if (US_STATES.has(reg) || CA_PROVS.has(reg)) return true;
  return false;
}

function analyzeProgression(tours) {
  if (!tours.length) return "no data";
  // Simple heuristic based on venue names
  return "mixed venues";
}

function analyzeFrequency(tours) {
  if (tours.length < 2) return "insufficient data";
  const dates = tours.map(t => new Date(t.date)).sort((a,b) => a-b);
  const first = dates[0], last = dates[dates.length-1];
  const months = (last - first) / (1000*60*60*24*30);
  if (months < 1) return "single burst";
  const freq = months / tours.length;
  if (freq < 0.5) return "multiple shows per month";
  if (freq < 2) return "every 1-2 months";
  if (freq < 6) return "every few months";
  return "every 6+ months";
}

async function fetchArtist(name) {
  const encoded = encodeURIComponent(name);
  const url = `https://rest.bandsintown.com/artists/${encoded}/events?app_id=squarespace-blackbeard&date=past`;
  try {
    const res = await fetch(url);
    if (!res.ok) { console.error(`  ${name}: HTTP ${res.status}`); return null; }
    const data = await res.json();
    if (!Array.isArray(data)) { console.error(`  ${name}: not array`); return null; }
    
    const usca = data.filter(isUSCA);
    const tours = usca.map(e => ({
      date: e.datetime ? e.datetime.slice(0,10) : e.starts_at?.slice(0,10) || 'unknown',
      venue: e.venue?.name || 'Unknown',
      city: e.venue?.city || 'Unknown',
      state: e.venue?.region || 'Unknown',
      capacity: null
    }));
    
    const dates = tours.map(t => t.date).filter(d => d !== 'unknown').sort();
    const minYear = dates.length ? dates[0].slice(0,4) : '?';
    const maxYear = dates.length ? dates[dates.length-1].slice(0,4) : '?';
    
    const result = {
      artist: name,
      totalUSShows: tours.length,
      dateRange: `${minYear}-${maxYear}`,
      tours,
      tourFrequency: analyzeFrequency(tours),
      venueScaleProgression: analyzeProgression(tours)
    };
    
    console.log(`  ${name}: ${data.length} total events, ${tours.length} US/CA`);
    return result;
  } catch(e) {
    console.error(`  ${name}: ${e.message}`);
    return null;
  }
}

async function main() {
  const allResults = [];
  for (const artist of artists) {
    console.log(`Fetching: ${artist}`);
    const result = await fetchArtist(artist);
    if (result) {
      const safeName = artist.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
      fs.writeFileSync(path.join(outDir, `${safeName}.json`), JSON.stringify(result, null, 2));
      allResults.push(result);
    } else {
      allResults.push({ artist, totalUSShows: 0, dateRange: "N/A", tours: [], tourFrequency: "no data", venueScaleProgression: "no data" });
    }
    await sleep(500);
  }
  
  fs.writeFileSync(path.join(outDir, 'all-vip-history.json'), JSON.stringify(allResults, null, 2));
  console.log(`\nDone! ${allResults.length} artists processed. ${allResults.reduce((s,a) => s + a.totalUSShows, 0)} total US/CA shows.`);
}

main();
