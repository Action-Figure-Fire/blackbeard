#!/usr/bin/env node
// Artist Intelligence Scraper v1
// Scrapes artist websites via ScrapingBee for:
// 1. Social metrics (Spotify, YouTube, IG, X, TikTok links + follower counts)
// 2. Tour announcements (dates, venues, cities)
// 3. Presale signup links (Seated, Laylo, Bandsintown, Mailchimp, fan clubs)
// 4. Newsletter/fan club registration URLs
// 5. Ticket purchase links

require('dotenv').config();
const https = require('https');
const fs = require('fs');
const path = require('path');

const SCRAPINGBEE_KEY = process.env.SCRAPINGBEE_KEY;
const DATA_PATH = path.join(__dirname, '..', 'docs', 'data', 'rising-stars.json');
const INTEL_CACHE = path.join(__dirname, '..', 'data', 'artist-intel-cache.json');
const MAX_CALLS = parseInt(process.env.INTEL_LIMIT) || 15;

let callsUsed = 0;
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function httpGet(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const opts = { hostname: u.hostname, path: u.pathname + u.search, timeout: 30000 };
    https.get(opts, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => resolve(d));
    }).on('error', reject).on('timeout', () => reject(new Error('timeout')));
  });
}

async function scrapeArtistSite(url) {
  if (!SCRAPINGBEE_KEY || callsUsed >= MAX_CALLS) return null;
  callsUsed++;
  try {
    const params = new URLSearchParams({
      api_key: SCRAPINGBEE_KEY,
      url: url,
      render_js: 'true',
      premium_proxy: 'false',
      wait: '3000' // Wait 3s for JS to render tour dates
    });
    const html = await httpGet(`https://app.scrapingbee.com/api/v1?${params.toString()}`);
    return typeof html === 'string' ? html : null;
  } catch (e) {
    console.error(`  ScrapingBee error: ${e.message}`);
    return null;
  }
}

// ── Extract Links ──
function extractLinks(html) {
  const linkRegex = /href=["']([^"']+)["']/gi;
  const links = [];
  let m;
  while ((m = linkRegex.exec(html)) !== null) {
    links.push(m[1].replace(/&amp;/g, '&'));
  }
  return [...new Set(links)];
}

// ── Categorize Links ──
function categorizeLinks(links) {
  const result = {
    signupLinks: [],    // Presale registration, newsletter, fan club
    ticketLinks: [],    // Direct ticket purchase
    socialLinks: {},    // Platform → URL
    tourPageLink: null  // Link to tour/dates page
  };

  for (const link of links) {
    const l = link.toLowerCase();

    // Presale signup platforms
    if (l.includes('laylo.com') && !l.includes('.css') && !l.includes('.js')) {
      result.signupLinks.push({ url: link, type: 'Laylo Presale Signup', platform: 'laylo' });
    }
    if (l.includes('go.seated.com/notifications') || (l.includes('link.seated.com') && !l.includes('.css'))) {
      result.signupLinks.push({ url: link, type: 'Seated Presale Signup', platform: 'seated' });
    }
    if (l.includes('found.ee') || l.includes('fanlink') || l.includes('lnk.to')) {
      result.signupLinks.push({ url: link, type: 'Fan Link / Signup', platform: 'fanlink' });
    }
    if (l.includes('mailchimp') || l.includes('newsletter') || l.includes('subscribe') || l.includes('signup') || l.includes('sign-up')) {
      if (!l.includes('.css') && !l.includes('.js') && !l.includes('.png'))
        result.signupLinks.push({ url: link, type: 'Newsletter Signup', platform: 'newsletter' });
    }
    if (l.includes('bandsintown.com/artist') || l.includes('bandsintown.com/a/')) {
      result.signupLinks.push({ url: link, type: 'Bandsintown Track Artist', platform: 'bandsintown' });
    }

    // Direct ticket links
    if (l.includes('ticketmaster.com') || l.includes('axs.com') || l.includes('dice.fm') ||
        l.includes('seetickets.com') || l.includes('eventbrite.com') || l.includes('tixr.com')) {
      result.ticketLinks.push({ url: link, platform: l.includes('ticketmaster') ? 'ticketmaster' : l.includes('axs') ? 'axs' : l.includes('dice') ? 'dice' : 'other' });
    }

    // Social profiles
    if (l.includes('open.spotify.com/artist/')) result.socialLinks.spotify = link;
    if ((l.includes('youtube.com/channel/') || l.includes('youtube.com/@')) && !l.includes('watch')) result.socialLinks.youtube = link;
    if (l.includes('instagram.com/') && !l.includes('/p/') && !l.includes('/reel/')) result.socialLinks.instagram = link;
    if ((l.includes('twitter.com/') || l.includes('x.com/')) && !l.includes('/status/')) result.socialLinks.twitter = link;
    if (l.includes('tiktok.com/@')) result.socialLinks.tiktok = link;

    // Tour page
    if (l.includes('/tour') || l.includes('/dates') || l.includes('/shows') || l.includes('/events') || l.includes('/live')) {
      if (!l.includes('.css') && !l.includes('.js')) result.tourPageLink = link;
    }
  }

  // Dedupe signup links by platform
  const seen = new Set();
  result.signupLinks = result.signupLinks.filter(s => {
    // Keep first Laylo and first Seated notification link, skip duplicate seated event links
    if (s.platform === 'seated' && s.url.includes('link.seated.com')) {
      if (seen.has('seated-event')) return false;
      seen.add('seated-event');
      return true;
    }
    const key = s.platform;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Dedupe ticket links by platform
  const seenTickets = new Set();
  result.ticketLinks = result.ticketLinks.filter(t => {
    if (seenTickets.has(t.platform)) return false;
    seenTickets.add(t.platform);
    return true;
  });

  return result;
}

// ── Extract Tour Dates from HTML ──
function extractTourDates(html) {
  const dates = [];
  // Common patterns: "Mar 15, 2026", "March 15 2026", "2026-03-15", "15 Mar 2026"
  const dateRegex = /(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2}(?:\s*,?\s*20\d{2})?/gi;
  const matches = html.match(dateRegex) || [];

  // Look for venue/city text near dates — simplified extraction
  // Most sites structure dates in containers with venue info nearby
  return matches.slice(0, 30).map(m => m.trim()); // Return raw date strings
}

// ── Extract Metrics from Page Text ──
function extractMetrics(html) {
  const metrics = {};
  const lower = html.toLowerCase();

  // Newsletter subscriber count (rare but some artists brag about it)
  const subMatch = lower.match(/(\d[\d,]+)\s*(?:subscribers?|members?|fans?\s*(?:on\s*)?(?:the\s*)?list)/);
  if (subMatch) metrics.newsletterSubscribers = parseInt(subMatch[1].replace(/,/g, ''));

  // Follower counts sometimes embedded in meta/text
  const spotifyMatch = lower.match(/(\d[\d,.]*)\s*m(?:illion)?\s*(?:monthly\s*)?(?:spotify\s*)?listeners/);
  if (spotifyMatch) metrics.spotifyListenersFromSite = parseFloat(spotifyMatch[1].replace(/,/g, '')) * 1000000;

  return metrics;
}

// ── Find Artist Website ──
function getArtistUrl(artist) {
  // Use known website if available
  if (artist.artistWebsite && artist.artistWebsite.startsWith('http')) return artist.artistWebsite;
  // Common patterns
  const name = artist.name.toLowerCase().replace(/[^a-z0-9]+/g, '');
  return null; // Don't guess — only scrape known URLs
}

// ── Main ──
async function run() {
  console.log('🕵️ Artist Intelligence Scraper v1');
  console.log(`   Budget: ${MAX_CALLS} ScrapingBee calls (5 credits each = ${MAX_CALLS * 5} credits)\n`);

  if (!SCRAPINGBEE_KEY) {
    console.log('   ❌ No SCRAPINGBEE_KEY in .env');
    return null;
  }

  const data = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
  const artists = data.artists || [];

  // Load existing cache
  let cache = {};
  try { cache = JSON.parse(fs.readFileSync(INTEL_CACHE, 'utf8')); } catch {}

  // Prioritize: artists with known websites, then by verification tier
  const withSites = artists.filter(a => {
    const url = getArtistUrl(a);
    if (!url) return false;
    // Skip if scraped in last 7 days
    const cached = cache[a.name];
    if (cached && (Date.now() - new Date(cached.scrapedAt).getTime()) < 7 * 86400000) return false;
    return true;
  }).sort((a, b) => {
    const tierOrder = { RED_HOT: 3, WARM: 2, WATCH: 1 };
    return (tierOrder[b.verificationTier] || 0) - (tierOrder[a.verificationTier] || 0);
  });

  console.log(`   ${withSites.length} artists with known websites to scrape\n`);

  const results = [];

  for (const artist of withSites) {
    if (callsUsed >= MAX_CALLS) {
      console.log(`\n   ⚠️  Budget exhausted (${callsUsed}/${MAX_CALLS})`);
      break;
    }

    const url = getArtistUrl(artist);
    process.stdout.write(`  ${artist.name} (${url})...`);

    const html = await scrapeArtistSite(url);
    await sleep(1000);

    if (!html || html.length < 500) {
      console.log(' ❌ empty/blocked');
      continue;
    }

    const links = extractLinks(html);
    const categorized = categorizeLinks(links);
    const tourDates = extractTourDates(html);
    const metrics = extractMetrics(html);

    // Update artist data
    if (categorized.signupLinks.length) {
      artist.signupLinks = categorized.signupLinks;
    }
    if (categorized.ticketLinks.length) {
      artist.ticketLinks = categorized.ticketLinks;
    }
    if (Object.keys(categorized.socialLinks).length) {
      artist.socialProfiles = { ...artist.socialProfiles, ...categorized.socialLinks };
    }
    if (categorized.tourPageLink) {
      artist.tourPageLink = categorized.tourPageLink;
    }
    if (Object.keys(metrics).length) {
      Object.assign(artist, metrics);
    }

    // Cache result
    cache[artist.name] = {
      scrapedAt: new Date().toISOString(),
      url,
      signupLinks: categorized.signupLinks,
      ticketLinks: categorized.ticketLinks,
      socialLinks: categorized.socialLinks,
      tourDatesFound: tourDates.length,
      pageSize: html.length
    };

    const signupCount = categorized.signupLinks.length;
    const ticketCount = categorized.ticketLinks.length;
    console.log(` ✅ ${signupCount} signup${signupCount !== 1 ? 's' : ''}, ${ticketCount} ticket link${ticketCount !== 1 ? 's' : ''}, ${Object.keys(categorized.socialLinks).length} socials`);

    results.push({
      name: artist.name,
      signupLinks: categorized.signupLinks,
      ticketLinks: categorized.ticketLinks,
      tourDatesFound: tourDates.length
    });
  }

  // Save
  fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));
  fs.writeFileSync(INTEL_CACHE, JSON.stringify(cache, null, 2));

  // Summary
  console.log(`\n✅ Artist Intel Scrape complete`);
  console.log(`   ${callsUsed} ScrapingBee calls used`);
  console.log(`   ${results.length} artists scraped`);

  const withSignups = results.filter(r => r.signupLinks.length);
  if (withSignups.length) {
    console.log(`\n🔗 SIGNUP LINKS FOUND:`);
    withSignups.forEach(r => {
      r.signupLinks.forEach(s => {
        console.log(`   ${r.name} → ${s.type}: ${s.url.substring(0, 80)}`);
      });
    });
  }

  return results;
}

function formatDiscordAlert(results) {
  if (!results || !results.length) return '';
  const withSignups = results.filter(r => r.signupLinks.length);
  if (!withSignups.length) return `🕵️ **Artist Intel**: Scraped ${results.length} sites, no new signup links found.`;

  let msg = `🕵️ **Artist Intel**: ${withSignups.length} presale signup links found!\n`;
  withSignups.slice(0, 5).forEach(r => {
    r.signupLinks.forEach(s => {
      msg += `• **${r.name}** → [${s.type}](${s.url.substring(0, 100)})\n`;
    });
  });
  return msg;
}

module.exports = { run, formatDiscordAlert };
if (require.main === module) run().catch(console.error);
