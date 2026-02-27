/**
 * Blackbeard 🏴‍☠️ — Email Inbox Scanner
 * Checks Gmail for comedy venue newsletters and show announcements
 * Alerts on new show drops from tracked venues
 */

const Imap = require('imap');
const { simpleParser } = require('mailparser');
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

// Keywords that indicate a show announcement
const SHOW_KEYWORDS = [
  'just added', 'just announced', 'new show', 'on sale now',
  'tickets available', 'secret show', 'surprise show', 'pop-up',
  'extra show', 'added show', 'limited tickets', 'selling fast',
  'almost sold out', 'sold out', 'don\'t miss', 'presale',
  'this weekend', 'tonight', 'tomorrow night', 'live at',
  'comedy show', 'standup', 'stand-up', 'special guest'
];

// Tracked comedians (lowercase for matching)
const COMEDIAN_NAMES = [
  'shane gillis', 'theo von', 'mark normand', 'sam morril',
  'stavros halkias', 'taylor tomlinson', 'matt rife', 'nate bargatze',
  'andrew schulz', 'donnell rawlings', 'joe list', 'ari shaffir',
  'tim dillon', 'whitney cummings', 'bert kreischer', 'tom segura',
  'nikki glaser', 'dan soder', 'luis j gomez', 'big jay oakerson',
  'bobby lee', 'neal brennan', 'rachel feinstein', 'dave attell',
  'jessica kirson', 'sal vulcano', 'brian simpson', 'tony hinchcliffe',
  'kill tony', 'protect our parks', 'christina p'
];

// Venue email domains we expect newsletters from
const VENUE_DOMAINS = [
  'comedycellar.com', 'thecomedystore.com', 'zanies.com',
  'heliumcomedy.com', 'laughfactory.com', 'improv.com',
  'gothamcomedyclub.com', 'thestandnyc.com', 'stressfactory.com',
  'comedyworks.com', 'comedymothership.com', 'capcitycomedy.com',
  'funnybone.com', 'wiseguyscomedy.com', 'punchlinecomedyclub.com',
  'eventbrite.com', 'ticketweb.com', 'axs.com', 'ticketmaster.com',
  'seatgeek.com', 'dice.fm'
];

function connectImap() {
  return new Imap({
    user: process.env.EMAIL_ADDRESS,
    password: process.env.EMAIL_APP_PASSWORD,
    host: process.env.EMAIL_IMAP_HOST || 'imap.gmail.com',
    port: parseInt(process.env.EMAIL_IMAP_PORT || '993'),
    tls: true,
    tlsOptions: { rejectUnauthorized: false }
  });
}

function getRecentEmails(hours = 24) {
  return new Promise((resolve, reject) => {
    const imap = connectImap();
    const emails = [];

    imap.once('ready', () => {
      imap.openBox('INBOX', true, (err, box) => {
        if (err) { reject(err); return; }

        const since = new Date();
        since.setHours(since.getHours() - hours);
        const dateStr = since.toISOString().split('T')[0];

        imap.search(['ALL', ['SINCE', dateStr]], (err, results) => {
          if (err) { reject(err); return; }
          if (!results || results.length === 0) {
            imap.end();
            resolve([]);
            return;
          }

          const f = imap.fetch(results, { bodies: '' });
          let pending = results.length;

          f.on('message', (msg) => {
            msg.on('body', (stream) => {
              simpleParser(stream, (err, parsed) => {
                if (!err && parsed) {
                  emails.push({
                    from: parsed.from?.text || '',
                    subject: parsed.subject || '',
                    date: parsed.date,
                    text: (parsed.text || '').substring(0, 2000),
                    html: (parsed.html || '').substring(0, 5000)
                  });
                }
                pending--;
                if (pending === 0) imap.end();
              });
            });
          });

          f.once('error', (err) => reject(err));
          f.once('end', () => {
            // Wait for parsing to complete
            setTimeout(() => { if (pending > 0) imap.end(); }, 10000);
          });
        });
      });
    });

    imap.once('error', reject);
    imap.once('end', () => resolve(emails));
    imap.connect();
  });
}

function analyzeEmails(emails) {
  const alerts = [];

  for (const email of emails) {
    const combined = `${email.subject} ${email.text}`.toLowerCase();
    const fromDomain = email.from.match(/@([^\s>]+)/)?.[1] || '';

    // Check if from a tracked venue
    const isVenueEmail = VENUE_DOMAINS.some(d => fromDomain.includes(d));

    // Check for show keywords
    const hasShowKeyword = SHOW_KEYWORDS.some(kw => combined.includes(kw));

    // Check for comedian names
    const mentionedComedians = COMEDIAN_NAMES.filter(name => combined.includes(name));

    // Score relevance
    let score = 0;
    if (isVenueEmail) score += 3;
    if (hasShowKeyword) score += 2;
    if (mentionedComedians.length > 0) score += 3;

    // Extract ticket URLs from HTML
    const ticketUrls = [];
    const urlRegex = /href=["'](https?:\/\/[^"']*(?:ticket|buy|eventbrite|ticketweb|axs|dice\.fm)[^"']*)/gi;
    let match;
    while ((match = urlRegex.exec(email.html || '')) !== null) {
      ticketUrls.push(match[1]);
    }

    if (score >= 3) {
      alerts.push({
        subject: email.subject,
        from: email.from,
        date: email.date,
        comedians: mentionedComedians,
        isVenueEmail,
        hasShowKeyword,
        ticketUrls: ticketUrls.slice(0, 3),
        score,
        snippet: email.text.substring(0, 300)
      });
    }
  }

  // Sort by score descending
  alerts.sort((a, b) => b.score - a.score);
  return alerts;
}

function formatEmailAlert(alerts) {
  if (alerts.length === 0) return null;

  let msg = '📧 **INBOX ALERT — Comedy Show Drops** 🏴‍☠️\n\n';

  for (const a of alerts.slice(0, 10)) {
    msg += `**${a.subject}**\n`;
    msg += `From: ${a.from}\n`;
    if (a.comedians.length > 0) {
      msg += `🎤 Comedians: ${a.comedians.map(c => c.split(' ').map(w => w[0].toUpperCase() + w.slice(1)).join(' ')).join(', ')}\n`;
    }
    if (a.ticketUrls.length > 0) {
      msg += `🎟️ ${a.ticketUrls.map(u => `<${u}>`).join(' ')}\n`;
    }
    msg += `${a.snippet.substring(0, 150)}...\n\n`;
  }

  return msg;
}

async function runEmailScan(hours = 12) {
  console.log('📧 Scanning inbox for comedy show alerts...');

  if (!process.env.EMAIL_ADDRESS || !process.env.EMAIL_APP_PASSWORD) {
    console.log('  Email: skipped (no credentials)');
    return { alerts: [], message: null };
  }

  try {
    const emails = await getRecentEmails(hours);
    console.log(`  Found ${emails.length} emails in last ${hours}h`);

    const alerts = analyzeEmails(emails);
    console.log(`  ${alerts.length} comedy-related alerts`);

    const message = formatEmailAlert(alerts);

    // Save results
    const reportDir = path.join(__dirname, '..', 'reports');
    if (!fs.existsSync(reportDir)) fs.mkdirSync(reportDir, { recursive: true });
    fs.writeFileSync(
      path.join(reportDir, 'email-latest.json'),
      JSON.stringify({ timestamp: new Date().toISOString(), alerts }, null, 2)
    );

    return { alerts, message };
  } catch (e) {
    console.error('  Email scan error:', e.message);
    return { alerts: [], message: null };
  }
}

module.exports = { runEmailScan };

if (require.main === module) {
  runEmailScan(24).then(({ alerts, message }) => {
    if (message) console.log('\n' + message);
    else console.log('No comedy alerts in inbox.');
    process.exit(0);
  }).catch(e => { console.error(e); process.exit(1); });
}
