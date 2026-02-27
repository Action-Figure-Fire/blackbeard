/**
 * Blackbeard 🏴‍☠️ — Comedy Venue Newsletter Signup
 * Signs up ovojohnnym@gmail.com for venue mailing lists
 */

const https = require('https');
const http = require('http');

const EMAIL = 'ovojohnnym@gmail.com';
const NAME = 'John M';

function post(url, data, headers = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const mod = parsed.protocol === 'https:' ? https : http;
    const body = typeof data === 'string' ? data : JSON.stringify(data);
    const opts = {
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: {
        'Content-Type': headers['Content-Type'] || 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
        ...headers
      }
    };
    const req = mod.request(opts, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve({ status: res.statusCode, data: d, headers: res.headers }));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function signup(name, url, formData, headers) {
  try {
    const res = await post(url, formData, headers);
    const ok = res.status >= 200 && res.status < 400;
    console.log(`${ok ? '✅' : '❌'} ${name} — HTTP ${res.status}`);
    return ok;
  } catch (e) {
    console.log(`❌ ${name} — ${e.message}`);
    return false;
  }
}

async function main() {
  console.log(`📧 Signing up ${EMAIL} for comedy venue newsletters...\n`);

  // Improv.com — uses Mailchimp-style form
  await signup('Improv.com', 
    'https://improv.com/newsletter/',
    `email=${encodeURIComponent(EMAIL)}&first_name=${encodeURIComponent(NAME)}`
  );

  // Eventbrite — follow comedians (manual, needs auth)
  console.log('\n📋 MANUAL SIGNUPS NEEDED (JavaScript forms):');
  console.log('These need to be done in a browser. Takes 2 min total:\n');

  const manualVenues = [
    { name: 'Comedy Cellar', url: 'https://www.comedycellar.com/new-york-line-up/' },
    { name: 'Comedy Store', url: 'https://thecomedystore.com/' },
    { name: 'Zanies Nashville', url: 'https://nashville.zanies.com/newsletter/' },
    { name: 'Zanies Chicago', url: 'https://chicago.zanies.com/newsletter/' },
    { name: 'Helium Philadelphia', url: 'https://philadelphia.heliumcomedy.com/' },
    { name: 'The Stand NYC', url: 'https://thestandnyc.com/' },
    { name: 'Stress Factory', url: 'https://www.stressfactory.com/' },
    { name: 'Comedy Works Denver', url: 'https://www.comedyworks.com/' },
    { name: 'Comedy Mothership Austin', url: 'https://comedymothership.com/' },
    { name: 'Gotham Comedy Club', url: 'https://www.gothamcomedyclub.com/' },
    { name: 'Punchline SF', url: 'https://www.punchlinecomedyclub.com/' },
    { name: 'Funny Bone', url: 'https://www.funnybone.com/' },
    { name: 'Wiseguys SLC', url: 'https://www.wiseguyscomedy.com/' },
    { name: 'Cap City Comedy Austin', url: 'https://www.capcitycomedy.com/' },
    { name: 'Acme Comedy Minneapolis', url: 'https://www.acmecomedycompany.com/' },
  ];

  for (const v of manualVenues) {
    console.log(`  - ${v.name}: ${v.url}`);
  }

  console.log(`\nUse email: ${EMAIL}`);
  console.log('Look for "Newsletter", "Mailing List", "Subscribe", or footer email signup on each page.');
}

main().catch(console.error);
