#!/usr/bin/env node
// Feed Generator — verified newsfeed of sold-out + new show events
// Sources: Bandsintown cache + hot show scan + rising-stars.json
// Outputs docs/data/feed.json

require('dotenv').config();
const fs = require('fs');
const path = require('path');

const CACHE_PATH = path.join(__dirname, '..', 'data', 'artist-sites-cache.json');
const RISING_STARS_PATH = path.join(__dirname, '..', 'docs', 'data', 'rising-stars.json');
const FEED_PATH = path.join(__dirname, '..', 'docs', 'data', 'feed.json');

function run() {
  let cache = {};
  try { cache = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8')); } catch {}
  
  let risingStars = {};
  try { risingStars = JSON.parse(fs.readFileSync(RISING_STARS_PATH, 'utf8')); } catch {}
  
  let feed = [];
  try { feed = JSON.parse(fs.readFileSync(FEED_PATH, 'utf8')).events || []; } catch {}
  
  const existingIds = new Set(feed.map(e => e.id));
  const now = new Date().toISOString();
  const artists = risingStars.artists || [];
  const artistMap = {};
  artists.forEach(a => { artistMap[a.name] = a; });
  
  // Source 1: Bandsintown cache — sold-out shows
  for (const [name, data] of Object.entries(cache)) {
    if (!data.events) continue;
    const artist = artistMap[name] || {};
    
    for (const ev of data.events) {
      if (ev.soldOut) {
        const id = `soldout-${name}-${ev.date}-${(ev.venue||'').slice(0,20)}`.replace(/[^a-z0-9-]/gi, '-').toLowerCase();
        if (!existingIds.has(id)) {
          feed.push({
            id,
            type: 'sold_out',
            artist: name,
            genre: artist.genre || data.genre || '',
            imageUrl: artist.imageUrl || '',
            venue: ev.venue || '',
            city: ev.city || '',
            date: ev.date || '',
            timestamp: data.lastScan || now,
            sources: ['Bandsintown API'],
            verified: true,
          });
          existingIds.add(id);
        }
      }
    }
  }
  
  // Source 2: Hot show scan data from rising-stars
  for (const artist of artists) {
    if (artist.hotShows) {
      for (const hs of artist.hotShows) {
        const id = `hot-${artist.name}-${hs.date||''}-${(hs.venue||'').slice(0,20)}`.replace(/[^a-z0-9-]/gi, '-').toLowerCase();
        if (!existingIds.has(id) && hs.soldOut) {
          feed.push({
            id,
            type: 'sold_out',
            artist: artist.name,
            genre: artist.genre || '',
            imageUrl: artist.imageUrl || '',
            venue: hs.venue || '',
            city: hs.city || '',
            date: hs.date || '',
            price: hs.price || null,
            timestamp: risingStars.hotShowScan || now,
            sources: hs.sources ? ['Brave Search', ...hs.sources.map(s => s.url).slice(0, 2)] : ['Brave Search'],
            verified: true,
          });
          existingIds.add(id);
        }
      }
    }
    
    // Source 3: Sold-out snippets from Brave enrichment
    if (artist.soldOutSnippets && artist.soldOutSnippets.length) {
      const id = `brave-${artist.name}`.replace(/[^a-z0-9-]/gi, '-').toLowerCase();
      if (!existingIds.has(id)) {
        feed.push({
          id,
          type: 'sold_out',
          artist: artist.name,
          genre: artist.genre || '',
          imageUrl: artist.imageUrl || '',
          venue: '',
          city: '',
          date: '',
          timestamp: artist.lastEnriched || now,
          sources: ['Brave Search'],
          sourceSnippet: artist.soldOutSnippets[0]?.snippet || artist.soldOutSnippets[0]?.title || '',
          verified: artist.soldOutMentions >= 2,
        });
        existingIds.add(id);
      }
    }
  }
  
  // Sort by timestamp descending
  feed.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  feed = feed.slice(0, 200);
  
  const output = {
    lastUpdated: now,
    totalEvents: feed.length,
    soldOutCount: feed.filter(e => e.type === 'sold_out').length,
    newShowCount: feed.filter(e => e.type === 'new_show').length,
    newTourCount: feed.filter(e => e.type === 'new_tour').length,
    events: feed,
  };
  
  fs.writeFileSync(FEED_PATH, JSON.stringify(output, null, 2));
  console.log(`✅ Feed: ${feed.length} events (${output.soldOutCount} sold-out, ${output.newShowCount} new shows)`);
  
  // Show top entries
  feed.slice(0, 10).forEach(e => {
    const badge = e.verified ? '✅' : '⚠️';
    console.log(`  ${badge} ${e.type} | ${e.artist} | ${e.venue} ${e.city} | ${e.date}`);
  });
}

run();
