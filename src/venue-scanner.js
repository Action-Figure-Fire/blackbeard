/**
 * Blackbeard 🏴‍☠️ — Venue Price Alert Scanner
 * Monitors tracked GA venues for ANY artist with strong resale pricing
 * Alerts when high-value shows appear or new dates are added at key venues
 * 
 * Runs as part of the daily watchlist scan cycle
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
      headers: { 'User-Agent': 'Blackbeard-Venue-Scanner/1.0', ...options.headers },
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

function loadTrackedVenues() {
  const p = path.join(__dirname, '..', 'data', 'watchlist.json');
  const data = JSON.parse(fs.readFileSync(p, 'utf8'));
  return data.trackedVenues || [];
}

function loadPrevVenueEvents() {
  const p = path.join(__dirname, '..', 'reports', 'venue-prev.json');
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return { events: {}, lastScan: null }; }
}

function savePrevVenueEvents(data) {
  const dir = path.join(__dirname, '..', 'reports');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'venue-prev.json'), JSON.stringify(data, null, 2));
}

// Price thresholds for alerting
const PRICE_THRESHOLDS = {
  HOT: 100,      // avg get-in >= $100 → 🔥 HOT alert
  STRONG: 60,    // avg get-in >= $60 → 💪 Strong demand  
  MODERATE: 35,  // avg get-in >= $35 → 📈 Worth watching
};

async function searchVenueSeatGeek(venueName, city) {
  const sgId = process.env.SEATGEEK_CLIENT_ID;
  const sgSecret = process.env.SEATGEEK_SECRET;
  if (!sgId) return [];

  try {
    // Search for venue by name
    const vq = encodeURIComponent(venueName);
    const venueUrl = `https://api.seatgeek.com/2/venues?q=${vq}&client_id=${sgId}&client_secret=${sgSecret}&per_page=3`;
    const venueRes = await fetch(venueUrl);
    if (venueRes.status !== 200) return [];
    
    const venueData = JSON.parse(venueRes.data);
    const venues = venueData.venues || [];
    
    // Find best match (name + city)
    let venueId = null;
    const cityLower = (city || '').toLowerCase();
    for (const v of venues) {
      const vCity = (v.city || '').toLowerCase();
      if (vCity.includes(cityLower) || cityLower.includes(vCity)) {
        venueId = v.id;
        break;
      }
    }
    if (!venueId && venues.length > 0) venueId = venues[0].id;
    if (!venueId) return [];

    // Get upcoming events at this venue
    const evUrl = `https://api.seatgeek.com/2/events?venue.id=${venueId}&client_id=${sgId}&client_secret=${sgSecret}&per_page=25&sort=datetime_utc.asc&datetime_utc.gte=${new Date().toISOString().split('T')[0]}`;
    const evRes = await fetch(evUrl);
    if (evRes.status !== 200) return [];

    const evData = JSON.parse(evRes.data);
    return (evData.events || []).map(e => ({
      title: e.title,
      shortTitle: e.short_title,
      performer: e.performers?.[0]?.name || e.title,
      venue: e.venue?.name || venueName,
      city: e.venue?.city || city,
      state: e.venue?.state || '',
      capacity: e.venue?.capacity || 0,
      date: e.datetime_local,
      url: e.url,
      sgScore: e.score || 0,
      lowestPrice: e.stats?.lowest_sg_base_price || e.stats?.lowest_price || null,
      avgPrice: e.stats?.average_price || null,
      highestPrice: e.stats?.highest_price || null,
      listingCount: e.stats?.listing_count || null,
      type: e.type,
    }));
  } catch (e) {
    console.log(`  ⚠️ Error checking ${venueName}: ${e.message}`);
    return [];
  }
}

function classifyPrice(avgPrice, lowestPrice) {
  const ref = avgPrice || lowestPrice || 0;
  if (ref >= PRICE_THRESHOLDS.HOT) return { tier: '🔥 HOT', level: 'hot' };
  if (ref >= PRICE_THRESHOLDS.STRONG) return { tier: '💪 STRONG', level: 'strong' };
  if (ref >= PRICE_THRESHOLDS.MODERATE) return { tier: '📈 WATCH', level: 'moderate' };
  return { tier: '', level: 'low' };
}

async function runVenueScan() {
  console.log('🏢 Blackbeard Venue Price Scanner running...');
  
  const venues = loadTrackedVenues();
  const prev = loadPrevVenueEvents();
  const alerts = [];
  const allEvents = [];
  let apiCalls = 0;

  // Check each venue (2 SeatGeek calls per venue: venue lookup + events)
  // Budget: ~100 SeatGeek calls. With 49 venues = 98 calls
  for (const venue of venues) {
    console.log(`  Checking: ${venue.name} (${venue.city}, ${venue.state})...`);
    
    const events = await searchVenueSeatGeek(venue.name, venue.city);
    apiCalls += 2;
    
    for (const event of events) {
      const key = `${event.performer}-${event.date}-${event.venue}`;
      const price = classifyPrice(event.avgPrice, event.lowestPrice);
      
      // Track all events for data
      allEvents.push({ ...event, priceTier: price });
      
      const isNew = !prev.events[key];
      const wasLower = prev.events[key] && event.avgPrice && prev.events[key].avgPrice && 
                       event.avgPrice > prev.events[key].avgPrice * 1.2; // 20%+ price jump
      
      if (isNew && price.level !== 'low') {
        // New event at a tracked venue with meaningful pricing
        alerts.push({
          type: 'new',
          ...event,
          priceTier: price,
          venueCap: venue.cap,
        });
      } else if (wasLower && price.level !== 'low') {
        // Price jumped 20%+ since last scan
        alerts.push({
          type: 'price_jump',
          ...event,
          priceTier: price,
          venueCap: venue.cap,
          prevAvg: prev.events[key].avgPrice,
        });
      }
      
      // Update prev tracking
      prev.events[key] = {
        firstSeen: prev.events[key]?.firstSeen || new Date().toISOString(),
        lastSeen: new Date().toISOString(),
        avgPrice: event.avgPrice,
        lowestPrice: event.lowestPrice,
        listingCount: event.listingCount,
      };
    }
    
    // Rate limit: 400ms between venue checks
    await new Promise(r => setTimeout(r, 400));
  }

  prev.lastScan = new Date().toISOString();
  savePrevVenueEvents(prev);

  // Sort alerts: HOT first, then by price
  alerts.sort((a, b) => {
    const tierOrder = { hot: 0, strong: 1, moderate: 2 };
    const aTier = tierOrder[a.priceTier.level] ?? 3;
    const bTier = tierOrder[b.priceTier.level] ?? 3;
    if (aTier !== bTier) return aTier - bTier;
    return (b.avgPrice || 0) - (a.avgPrice || 0);
  });

  // Build Discord alert
  let alertMsg = null;
  if (alerts.length > 0) {
    alertMsg = '🏢 **VENUE PRICE ALERT** 🏴‍☠️\n\n';
    
    const hotAlerts = alerts.filter(a => a.priceTier.level === 'hot');
    const strongAlerts = alerts.filter(a => a.priceTier.level === 'strong');
    const watchAlerts = alerts.filter(a => a.priceTier.level === 'moderate');

    if (hotAlerts.length > 0) {
      alertMsg += '**🔥 HIGH-VALUE SHOWS:**\n';
      for (const a of hotAlerts.slice(0, 10)) {
        const priceStr = a.avgPrice ? `avg $${a.avgPrice}` : `from $${a.lowestPrice}`;
        const jumpStr = a.type === 'price_jump' ? ` ⬆️ was $${a.prevAvg}` : '';
        const newStr = a.type === 'new' ? ' 🆕' : '';
        alertMsg += `- **${a.performer}** @ ${a.venue} (${a.city})${newStr}\n`;
        alertMsg += `  💰 ${priceStr}${jumpStr} | ${a.listingCount || '?'} listings | ${a.venueCap.toLocaleString()} cap\n`;
        alertMsg += `  📅 ${a.date}\n`;
        if (a.url) alertMsg += `  <${a.url}>\n`;
      }
      alertMsg += '\n';
    }

    if (strongAlerts.length > 0) {
      alertMsg += '**💪 STRONG DEMAND:**\n';
      for (const a of strongAlerts.slice(0, 8)) {
        const priceStr = a.avgPrice ? `avg $${a.avgPrice}` : `from $${a.lowestPrice}`;
        const newStr = a.type === 'new' ? ' 🆕' : '';
        alertMsg += `- **${a.performer}** @ ${a.venue} (${a.city})${newStr} — ${priceStr}\n`;
        alertMsg += `  📅 ${a.date}\n`;
      }
      alertMsg += '\n';
    }

    if (watchAlerts.length > 0) {
      alertMsg += '**📈 WORTH WATCHING:**\n';
      for (const a of watchAlerts.slice(0, 6)) {
        const priceStr = a.avgPrice ? `avg $${a.avgPrice}` : `from $${a.lowestPrice}`;
        alertMsg += `- ${a.performer} @ ${a.venue} — ${priceStr}\n`;
      }
    }

    alertMsg += `\n_Scanned ${venues.length} venues, ${apiCalls} API calls, ${allEvents.length} total events found_`;
  }

  // Save report
  const reportDir = path.join(__dirname, '..', 'reports');
  fs.writeFileSync(
    path.join(reportDir, 'venue-latest.json'),
    JSON.stringify({
      timestamp: new Date().toISOString(),
      venuesScanned: venues.length,
      totalEvents: allEvents.length,
      alerts: alerts.length,
      hotEvents: allEvents.filter(e => e.priceTier.level === 'hot').length,
      topEvents: allEvents
        .filter(e => e.priceTier.level !== 'low')
        .sort((a, b) => (b.avgPrice || 0) - (a.avgPrice || 0))
        .slice(0, 50),
    }, null, 2)
  );

  console.log(`  ✅ Scanned ${venues.length} venues: ${allEvents.length} events, ${alerts.length} alerts (${apiCalls} API calls)`);
  
  return { alerts, alertMsg, allEvents };
}

module.exports = { runVenueScan };

if (require.main === module) {
  runVenueScan().then(({ alerts, alertMsg, allEvents }) => {
    if (alertMsg) console.log('\n' + alertMsg);
    else console.log(`No price alerts. Scanned ${allEvents.length} events across all venues.`);
    process.exit(0);
  }).catch(e => { console.error(e); process.exit(1); });
}
