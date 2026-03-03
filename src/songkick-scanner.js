#!/usr/bin/env node
// Songkick Email Scanner
// Parses Songkick concert alert emails and extracts new show announcements
// Integrates with existing email scanner infrastructure

const Imap = require('imap');
const { simpleParser } = require('mailparser');
const fs = require('fs');
const path = require('path');

const GMAIL_USER = process.env.GMAIL_USER || 'ovojohnnym@gmail.com';
const GMAIL_PASS = process.env.GMAIL_PASS || 'bgsdahtphsfjjlrp';
const PREV_FILE = path.join(__dirname, '..', 'reports', 'songkick-prev.json');

function loadPrev() {
  try { return JSON.parse(fs.readFileSync(PREV_FILE, 'utf8')); }
  catch { return { seenIds: [], lastScan: null }; }
}
function savePrev(data) {
  const dir = path.dirname(PREV_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(PREV_FILE, JSON.stringify(data, null, 2));
}

function connectImap() {
  return new Promise((resolve, reject) => {
    const imap = new Imap({
      user: GMAIL_USER,
      password: GMAIL_PASS,
      host: 'imap.gmail.com',
      port: 993,
      tls: true,
      tlsOptions: { rejectUnauthorized: false }
    });
    imap.once('ready', () => resolve(imap));
    imap.once('error', reject);
    imap.connect();
  });
}

function searchEmails(imap, criteria) {
  return new Promise((resolve, reject) => {
    imap.openBox('INBOX', true, (err) => {
      if (err) { reject(err); return; }
      imap.search(criteria, (err, results) => {
        if (err) reject(err);
        else resolve(results || []);
      });
    });
  });
}

function fetchEmails(imap, ids) {
  return new Promise((resolve) => {
    if (!ids.length) { resolve([]); return; }
    const emails = [];
    const f = imap.fetch(ids, { bodies: '', struct: true });
    f.on('message', (msg, seqno) => {
      msg.on('body', (stream) => {
        simpleParser(stream, (err, parsed) => {
          if (!err && parsed) {
            emails.push({
              id: seqno,
              messageId: parsed.messageId,
              from: parsed.from?.text || '',
              subject: parsed.subject || '',
              date: parsed.date,
              text: parsed.text || '',
              html: parsed.html || '',
            });
          }
        });
      });
    });
    f.once('end', () => {
      // Small delay to let parsers finish
      setTimeout(() => resolve(emails), 1000);
    });
    f.once('error', () => resolve(emails));
  });
}

// Parse Songkick alert email for concert details
function parseSongkickAlert(email) {
  const events = [];
  const text = email.text || '';
  const html = email.html || '';
  const content = text + ' ' + html;

  // Songkick alert patterns:
  // "Artist Name is coming to Venue Name, City on Date"
  // "Artist Name just announced a concert at Venue on Date"
  // "New concert: Artist at Venue"
  
  // Pattern 1: "Artist is coming to Venue, City"
  const comingTo = content.match(/([A-Z][^.!?\n]+?)\s+(?:is coming to|just announced|new concert at)\s+([^,\n]+),\s*([^.\n]+)/gi);
  if (comingTo) {
    for (const match of comingTo) {
      const parts = match.match(/(.+?)\s+(?:is coming to|just announced|new concert at)\s+(.+)/i);
      if (parts) {
        events.push({
          artist: parts[1].trim(),
          venueInfo: parts[2].trim(),
          source: 'songkick-email',
          rawMatch: match
        });
      }
    }
  }

  // Pattern 2: Extract from HTML links (songkick.com/concerts/...)
  const concertLinks = html.match(/href="https?:\/\/www\.songkick\.com\/concerts\/[^"]+"/g) || [];
  
  // Pattern 3: Line-by-line parsing for structured alerts
  const lines = text.split('\n').filter(l => l.trim());
  let currentArtist = '';
  for (const line of lines) {
    const trimmed = line.trim();
    
    // Skip boilerplate
    if (trimmed.includes('Songkick') && trimmed.includes('©')) continue;
    if (trimmed.includes('Privacy Policy')) continue;
    if (trimmed.includes('Unsubscribe')) continue;
    if (trimmed.includes('verify your')) continue;
    
    // Look for date patterns near artist/venue info
    const dateMatch = trimmed.match(/(\w+ \d{1,2},?\s*\d{4}|\d{1,2}\/\d{1,2}\/\d{2,4})/);
    const venueMatch = trimmed.match(/(?:at|@)\s+(.+)/i);
    
    if (venueMatch && currentArtist) {
      events.push({
        artist: currentArtist,
        venueInfo: venueMatch[1].trim(),
        date: dateMatch ? dateMatch[1] : null,
        source: 'songkick-email'
      });
    }
    
    // Track potential artist names (lines that are short and capitalized)
    if (trimmed.length < 50 && trimmed.length > 2 && !trimmed.includes('http') && !dateMatch) {
      currentArtist = trimmed;
    }
  }

  // Extract any Songkick concert URLs
  const urls = content.match(/https?:\/\/www\.songkick\.com\/concerts\/\S+/g) || [];
  
  return {
    subject: email.subject,
    date: email.date,
    events,
    urls: [...new Set(urls)],
    rawLength: text.length
  };
}

async function runScan() {
  console.log('🎵 Songkick Email Scanner starting...');
  const prev = loadPrev();
  const seenIds = new Set(prev.seenIds || []);

  let imap;
  try {
    imap = await connectImap();
  } catch (e) {
    console.log('IMAP connection failed:', e.message);
    return 'Songkick scanner: email connection failed';
  }

  // Search for Songkick emails (exclude welcome/verify emails)
  const results = await searchEmails(imap, [
    ['FROM', 'songkick.com'],
    ['SINCE', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toDateString()], // last 7 days
  ]);

  console.log(`Found ${results.length} Songkick emails in last 7 days`);

  if (results.length === 0) {
    imap.end();
    savePrev({ seenIds: [...seenIds], lastScan: new Date().toISOString() });
    return '🎵 Songkick Scanner: No new alert emails. (Artist alerts will arrive once tracked artists announce shows.)';
  }

  const emails = await fetchEmails(imap, results);
  imap.end();

  // Filter to new emails only
  const newEmails = emails.filter(e => !seenIds.has(e.messageId));
  console.log(`New emails: ${newEmails.length}`);

  // Parse each email
  const allEvents = [];
  for (const email of newEmails) {
    // Skip welcome/verify emails
    if (email.subject.toLowerCase().includes('welcome') || email.subject.toLowerCase().includes('verify')) {
      console.log(`  Skipping: ${email.subject}`);
      seenIds.add(email.messageId);
      continue;
    }

    console.log(`  Parsing: ${email.subject}`);
    const parsed = parseSongkickAlert(email);
    if (parsed.events.length > 0 || parsed.urls.length > 0) {
      allEvents.push(parsed);
    }
    seenIds.add(email.messageId);
  }

  // Build alert
  let alert = '';
  if (allEvents.length > 0) {
    alert = '🎵 **SONGKICK ALERT — New Shows Announced**\n\n';
    for (const ea of allEvents) {
      alert += `📧 **${ea.subject}** (${ea.date?.toLocaleDateString() || 'recent'})\n`;
      for (const ev of ea.events) {
        alert += `  🎤 **${ev.artist}** — ${ev.venueInfo}`;
        if (ev.date) alert += ` (${ev.date})`;
        alert += '\n';
      }
      for (const url of ea.urls.slice(0, 5)) {
        alert += `  🔗 <${url}>\n`;
      }
      alert += '\n';
    }
    alert += `_Source: Songkick email alerts (${newEmails.length} new emails parsed)_`;
  } else {
    alert = '🎵 Songkick Scanner: ' + newEmails.length + ' new emails checked, no concert alerts yet. (Welcome/verify emails skipped.)';
  }

  // Save state
  savePrev({ seenIds: [...seenIds], lastScan: new Date().toISOString() });

  console.log('\n--- ALERT ---');
  console.log(alert);
  console.log('--- END ---');

  return alert;
}

module.exports = { runScan, parseSongkickAlert };

if (require.main === module) {
  runScan().catch(console.error);
}
