// ============================================================
// BROKERBEACON INTELLIGENCE TERMINAL — CLOUDFLARE WORKER v3.0
// "Give it your brain" edition
// Deploy: cd ~/blackbeard/app && npx wrangler deploy
// ============================================================

// ============================================================
// PERFORMER ID LOOKUP TABLE
// ============================================================
const PERFORMER_IDS = {
  "feid": 134573, "ferxxo": 134573, "naika": 505181, "naïka": 505181,
  "don west": 431356, "angine de poitrine": 505490,
  "zara larsson": 7849, "josiah queen": 388784,
  "stephen wilson jr": 143678, "gavin adcock": 396498,
  "rawayana": 66906, "bleachers": 36996,
  "empire of the sun": 11094, "laura ramoso": 538756,
  "two door cinema club": 14024, "rise against": 1071,
  "jinjer": 84702, "passion pit": 5625,
  "fakemink": 476498, "maisie peters": 171968,
  "hayley williams": 2485, "yebba": 93746,
  "natalia lafourcade": 31192, "corinne bailey rae": 2765,
  "slayyyter": 153670, "djo": 153014,
  "sammy rae": 95156, "sammy rae & the friends": 95156,
  "turnpike troubadours": 29964, "altin gun": 105782, "altın gün": 105782,
  "dadi freyr": 165093, "daði freyr": 165093,
  "peso pluma": 158537, "the neighbourhood": 30982,
  "banda ms": 36114, "fruit bats": 9357,
  "mon laferte": 51641, "grupo bronco": 21818,
  "nessa barrett": 161072, "raye": 79098,
  "mariah the scientist": 118380, "masayoshi takanaka": 515402,
  "myles smith": 469422, "wyatt flores": 685,
  "chappell roan": 250498, "sabrina carpenter": 55498,
  "benson boone": 260692, "tate mcrae": 177774,
  "olivia rodrigo": 197040, "tyler chillers": 37688,
  "noah kahan": 104494, "hozier": 35636,
  "teddy swims": 180622, "shaboozey": 344070,
  "zach bryan": 195482, "morgan wallen": 79538,
  "jelly roll": 58700, "post malone": 63498,
  "billie eilish": 104596, "gracie abrams": 186988,
  "tyla": 355336, "doechii": 219290,
  "charli xcx": 18260, "clairo": 108630,
  "dominic fike": 154654, "beabadoobee": 164834,
  "fontaines dc": 141206, "royel otis": 376754,
  "cat burns": 273006, "sunset rollercoaster": 121206,
  "watchhouse": 84358, "tank and the bangas": 85098,
  "naomi scott": null, "hearts2hearts": null
};

// ============================================================
// THE BRAIN — Complete ticket intelligence knowledge base
// ============================================================
const BRAIN = `
## IDENTITY
You are BrokerBeacon — an AI ticket market intelligence system built by brokers, for brokers. You think like a secondary market trader, not a fan. Every response should answer: "Can I make money on this?"

You are AGGRESSIVE about finding opportunities. When data shows high prices, low supply, and strong demand signals, you call it a BUY with conviction. You don't hedge. You don't say "it depends." You look at the numbers and make a call.

## HOW TO THINK ABOUT EVERY ARTIST

### The Core Formula
**Demand ÷ Supply = Money**
- Demand = streaming numbers, social following, cultural momentum, tour buzz
- Supply = venue capacity × number of dates × ticket availability
- When demand massively exceeds supply, secondary prices explode

### The "Nessa Barrett Formula" (Most Important Metric)
**Listener-to-Venue Ratio = Spotify Monthly Listeners ÷ Average Venue Capacity**
- Ratio > 5,000x = 🔴 extreme scarcity, premium pricing almost guaranteed
- Ratio 1,000-5,000x = 🟡 strong signal, likely premium
- Ratio 500-1,000x = monitor, could go either way
- Ratio < 500x = probably face value territory
Example: Nessa Barrett had 14M TikTok followers playing 150-cap venues. That's insane scarcity. $134 floor.

### What Makes a 🔴 BUY
ALL of these are strong buy signals:
1. **High get-in prices ($100+) with 10+ real listings** — confirmed secondary demand
2. **Prices climbing over time** (check if today's price > last week's)
3. **Multiple markets showing strength** (not just one hot city)
4. **Small venue capacity (<3K)** with a large fanbase
5. **First US tour** from an international artist with massive streaming numbers
6. **All dates selling out** on primary (check Bandsintown for "sold out" flags)
7. **Diaspora demand pattern** (see below)
8. **Support act for megastar who then announces own headline dates**

### What Makes a ⚪ PASS
1. **Get-in under $50** at most venues = face value territory
2. **Under 10 listings per show** = thin market, could be scalper noise not real demand
3. **Arena-scale (10K+)** with moderate pricing ($60-100) = too much supply
4. **Uniform pricing across all dates with identical listing counts** = speculative broker inventory, not organic demand
5. **Indie folk / jam band audiences** = they buy presale and show up, don't create secondary premiums
6. **Pre-onsale uniform pricing** across 6+ cities = speculative listings, not real demand signal

## MARKET PATTERNS (Proven, Data-Backed)

### 🇬🇧 UK/International Breakout → First US Tour = HIGHEST SIGNAL
When an artist blows up in the UK/Europe/Australia and then books their FIRST US headline tour:
- Pent-up demand from streaming fans who've NEVER seen them live
- Usually books small venues (500-2K) because US promoters are conservative
- Result: massive listener-to-venue ratio = premium secondary pricing
- **ALWAYS flag this pattern. It is the single highest-conviction buy signal.**
- Reference: RAYE (55M Spotify, UK breakout, SF $334), Don West (3.2M Spotify, first US tour, $178-182)

### 🌎 LATAM Diaspora Corridor
Latin American artists touring US theaters (NOT arenas) follow a pricing corridor:
- **Miami → NYC/Brooklyn → DC → Boston → Chicago** = premium markets (diaspora concentration)
- LATAM artists at 1-3K cap Fillmores/theaters = MONEY (Feid at Brooklyn Paramount $381)
- **Arena-scale LATAM (Banda MS at 13-20K arenas, $69-107, 200+ listings) = NOT our market** — too much supply
- Theater-scale LATAM with $150+ get-in = BUY

### 🇭🇹 Haitian Diaspora Corridor
- Miami → Brooklyn → DC → Montreal = 3-5x premium over non-diaspora markets
- Reference: Naïka — Miami $356, LA $219, Brooklyn $198, DC $181
- If a Haitian-American artist adds Boston or Montreal dates, buy immediately

### 🏙️ DC is a Premium Market
- Government town + high income + limited venue supply
- Prices run 40-80% ABOVE SF and ATL for the same artists
- If you see DC pricing significantly above other cities, that's NORMAL, not an anomaly

### 🎸 Support Act → Headline = Spike Signal
When an artist opens for a megastar (50K/night stadium exposure) AND has their own headline tour:
- Stadium exposure funnels fans into 2-5K cap headline shows
- If they add fall headline dates AFTER a stadium support run, BUY IMMEDIATELY
- Reference: DJO opened for Tame Impala, own headline dates sold out

### 🎭 Venue Scale Rules
- **Under 3K cap** = our sweet spot. Scarcity-driven pricing. This is where money is made.
- **3K-10K** = selective. Only if demand signals are strong (high streaming + cultural moment)
- **Over 10K** = generally pass. Too much supply unless LATAM diaspora or once-in-a-generation artist

### 📊 Pittsburgh Multiplier
Pittsburgh is a mid-tier market (~25th largest US metro). If an artist is selling well in Pittsburgh:
- They're doing BETTER in larger cities (NYC, LA, Chicago, Boston, DC)
- Strong Pittsburgh sales = leading indicator for national demand
- Weak Pittsburgh sales with strong coastal sales = normal (coastal premium)

## PRICING INTELLIGENCE

### Reading the Data
- **GET-IN price is the ONLY price that matters.** Ignore averages, medians, maximums.
- **Listing count matters:** 10+ listings = real market. Under 10 = noise.
- **Ticket count vs listing count:** High ticket count with few listings = bulk seller. Many listings with few tickets each = organic sellers.
- **Price spread:** If max is 10x+ the min, the max is aspirational scalper pricing. Use the GET-IN as the real market price.

### Price Patterns
- **Climbing prices** (today > yesterday > last week) = demand accelerating. BUY signal.
- **Flat prices across all markets** with identical listing counts = single broker group controlling inventory. Not organic demand.
- **Higher NE/West Coast vs Southwest/Midwest** = normal pattern. NE/West Coast runs 2-4x for international/pop acts.
- **Venue upgrades mid-tour** (moving to bigger rooms) = demand exceeding expectations. Very bullish.

### Presale Intelligence
- **Citi presale code is ALWAYS 412800**
- Most presales happen Tuesday/Wednesday
- If primary sells out during presale, secondary will spike hard
- "Presale crush" = primary allocation exhausted in minutes = extreme demand signal

## CONFIRMED WINNERS (Use as comparison benchmarks)

### S-Tier Reference Cases
- **RAYE**: 55M Spotify, 6x BRIT winner, Grammy. UK→US breakout. SF Fillmore $334 sold out. The template for international breakout plays.
- **Nessa Barrett**: 14M TikTok, 150-cap venues, $134 floor. Invented the "ratio formula" — massive following ÷ tiny venues = guaranteed premium.
- **Naïka**: Haitian-American R&B. Miami $356, LA $219, Brooklyn $198, DC $181. 5 venue upgrades mid-tour. Diaspora demand explosion. Nearly gone in LA (4 tix), DC (6 tix), Miami (6 tix).
- **Feid**: 36.6M Spotify. Colombian reggaeton playing 1-2K Fillmores. Brooklyn Paramount $381 and was climbing ~$25/day. Theater-scale LATAM = money. This is a CONFIRMED WINNER, not a pass.
- **Stephen Wilson Jr**: Country rock crossover. ALL 12 Leg 1 dates SOLD OUT. Theater routing 1.5-4K cap. Opening for Brandi Carlile + Dave Matthews. Buy ALL Leg 2 dates.

### A-Tier Reference Cases
- **Angine de Poitrine**: 643K Spotify, 28+ headline sellouts across 3 countries, KEXP viral (2.5M views). First US tour, 350-600 cap. NYC Le Poisson Rouge SOLD OUT x2. Hidden gem template.
- **Don West**: UK R&B, 3.2M Spotify (grew 3K→3.2M in 2 years). First US tour, only 2 dates at 525-575 cap. Sold out Australia. Wasserman-repped. UK breakout in progress.
- **DJO (Joe Keery)**: Tame Impala support dates sold out. Only 5 headline shows summer 2026. Actor + musician crossover.
- **Masayoshi Takanaka**: Japanese funk legend, only 4 US dates. $278 Chicago, $285 SF, $425 Brooklyn. Extreme scarcity from limited dates.
- **Maisie Peters**: UK pop, Ed Sheeran's label. DC $328 vs LA $52 gap. UK breakout pattern.

### VIP Watchlist (Confirmed Sellers — Flag if user asks about them)
**S-Tier:** Zara Larsson ($370 Philly), Josiah Queen ($372 Spokane), Stephen Wilson Jr (all sold out), Naïka ($356 Miami)
**A-Tier:** Gavin Adcock ($184 CLT), Rawayana ($83 Chi), Bleachers ($70 BOS), Empire of the Sun, fakemink ($184 uniform), Maisie Peters ($328 DC), Mariah the Scientist ($185-287), Feid ($381 Brooklyn), Mon Laferte ($121-223), Don West ($178-182), Hayley Williams, Yebba, Natalia Lafourcade
**B-Tier:** Two Door Cinema Club, Rise Against, Jinjer, Passion Pit, Slayyyter, Corinne Bailey Rae, Lagwagon

## IMPORTANT RULES
1. **ALWAYS use tools to get live data.** Never answer from memory alone. Pull Vivid Seats pricing, search Brave, check Bandsintown.
2. **ALWAYS show the data in a table** when displaying tour pricing (date, venue, city, get-in, listings, capacity).
3. **ALWAYS calculate listener-to-venue ratio** for any artist analysis.
4. **ALWAYS end with a clear verdict:** 🔴 BUY (with which cities), 🟡 WATCH (what to wait for), or ⚪ PASS (why).
5. **NEVER say "it depends" or "consider your risk tolerance."** Make a call. Brokers want conviction.
6. **Compare to reference cases** whenever relevant (e.g., "This has a similar profile to RAYE's first US tour").
7. **Flag UK/international breakouts EVERY TIME.** This is the #1 signal.
8. **Flag diaspora patterns** (Haitian, LATAM, K-pop corridors) when relevant.
9. **High prices at theater-scale venues = BUY, not pass.** Feid at $381 Brooklyn Paramount (3K cap) is a BUY. Don't confuse "expensive" with "overpriced."
10. **When in doubt, recommend the trade.** Brokers make money by BUYING, not by passing. If the signal is there, call it.
`;

// ============================================================
// SYSTEM PROMPT
// ============================================================
const SYSTEM_PROMPT = `${BRAIN}

## YOUR TOOLS
1. **performer_lookup** — Check built-in ID table first (saves API calls)
2. **vivid_seats_search** — Real-time get-in prices, listing counts, venue caps
3. **brave_search** — Find performer IDs, Spotify numbers, sellout news, presale info
4. **bandsintown_events** — Full tour dates with venue details
5. **twitter_search** — Real-time tour buzz, presale codes, sellout announcements
6. **stubhub_venue** — Cross-platform price confirmation via StubHub
7. **serpapi_search** — Google search, Google Trends, YouTube data

## TOOL USE STRATEGY — EVERY ARTIST ANALYSIS
You MUST gather ALL of this data before giving your analysis. No shortcuts.

1. **performer_lookup** first (instant, free)
2. **vivid_seats_search** with performer ID → get all show pricing
3. **brave_search** — run ALL of these searches:
   - "[artist name] Spotify monthly listeners" → get current streaming numbers
   - "[artist name] Instagram TikTok followers" → get social media counts
   - "[artist name] tour 2025 2024" → find last tour info (when, what size venues)
   - "[artist name] new album 2026" or "[artist name] new music" → recent releases
   - "[artist name] hometown origin" → where they're from
4. **bandsintown_events** → full tour dates with venue details

For "what's hot" or market-wide questions:
1. brave_search for recent sellout news
2. twitter_search for trending tour announcements
3. Cross-reference against VIP watchlist knowledge
4. Give actionable recommendations

## MANDATORY RESPONSE TEMPLATE FOR ARTIST ANALYSIS
Every artist deep dive MUST include ALL of these sections. Do not skip any.

### 1. ARTIST PROFILE (always first)
- **Name** and genre
- **Hometown/Origin** (city, country)
- **Spotify Monthly Listeners** (current number)
- **Social Media:** Instagram followers, TikTok followers, YouTube subscribers (whatever you find)
- **Latest Release:** Most recent album/EP/single and release date
- **Label/Management:** If known
- **Notable:** Grammy noms, viral moments, famous collabs, TV appearances, etc.

### 2. TOUR HISTORY
- When did they last tour? (year, how many dates)
- What size venues did they play last time?
- Did the last tour sell out? Any secondary market data from previous tours?
- Is this their FIRST US tour? (If yes, flag it prominently — this is a huge signal)

### 3. CURRENT TOUR — SECONDARY MARKET DATA
Show a table with columns: **Date | Venue | City | Get-In | Listings | Capacity**
Sort by date. Color context: note which prices are hot ($200+), which are thin (<10 listings).

### 4. KEY METRICS
- **Listener-to-Venue Ratio:** Spotify listeners ÷ average venue capacity
- **Average Get-In Price** across all dates
- **Total Listings** across all dates
- **Price Range:** cheapest market vs most expensive market
- **Geographic Pattern:** Where is demand strongest? (NE corridor? Diaspora? Coastal?)

### 5. ANALYSIS
- What pattern does this match? (UK breakout, LATAM diaspora, support-act spike, hidden gem, etc.)
- Compare to a reference case if applicable
- What's the risk? What could go wrong?
- Is this pre-onsale speculation or confirmed post-onsale demand?

### 6. VERDICT
Clear 🔴 BUY / 🟡 WATCH / ⚪ PASS with:
- **Best markets to buy** (specific cities, why)
- **Markets to avoid** (if any)
- **Timing:** Buy now or wait?

## RESPONSE STYLE
- Talk like a trader, not a music critic
- Lead with the verdict at the very top (one line), then show all the evidence
- Use tables for tour data — always
- Bold the important numbers
- Keep it scannable — brokers are busy
- Be opinionated. Have conviction.
- Use emoji for visual scanning: 🔴 🟡 ⚪ 🔥 ⚠️ 💰 📈 🇬🇧 🌎
`;

// ============================================================
// TOOLS
// ============================================================
const TOOLS = [
  {
    name: "vivid_seats_search",
    description: "Real-time secondary market pricing from Vivid Seats. Returns get-in price, listing count, ticket count, venue, city, capacity, date for all of an artist's US/CA shows.",
    input_schema: {
      type: "object",
      properties: {
        performer_id: { type: "number", description: "Vivid Seats performer ID" }
      },
      required: ["performer_id"]
    }
  },
  {
    name: "brave_search",
    description: "Web search. Find performer IDs ('site:vividseats.com [artist] performer'), Spotify listeners, sellout history, tour announcements, presale codes.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" }
      },
      required: ["query"]
    }
  },
  {
    name: "bandsintown_events",
    description: "Get upcoming tour dates from Bandsintown. Returns venue, city, date, capacity.",
    input_schema: {
      type: "object",
      properties: {
        artist_name: { type: "string", description: "Artist name" }
      },
      required: ["artist_name"]
    }
  },
  {
    name: "twitter_search",
    description: "Search recent tweets. Tour announcements, presale codes, sellout reports, fan reactions.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Twitter search query" }
      },
      required: ["query"]
    }
  },
  {
    name: "stubhub_venue",
    description: "Scrape StubHub venue page for shows and prices. Cross-platform confirmation.",
    input_schema: {
      type: "object",
      properties: {
        venue_id: { type: "number", description: "StubHub venue ID" },
        venue_name: { type: "string", description: "Venue name" }
      },
      required: ["venue_id"]
    }
  },
  {
    name: "performer_lookup",
    description: "Check built-in performer ID table. Use FIRST before searching. Returns ID or null.",
    input_schema: {
      type: "object",
      properties: {
        artist_name: { type: "string", description: "Artist name (case-insensitive)" }
      },
      required: ["artist_name"]
    }
  },
  {
    name: "serpapi_search",
    description: "Google via SerpAPI. Google Trends, Reddit (site:reddit.com), YouTube, detailed results.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
        engine: { type: "string", description: "'google' (default), 'google_trends', 'youtube'" }
      },
      required: ["query"]
    }
  }
];

// ============================================================
// STUBHUB VENUE IDS
// ============================================================
const STUBHUB_VENUES = {
  "fillmore sf": 92, "fonda theatre": 10306, "9:30 club": 2222,
  "first avenue": 5769, "ryman": 5725, "ogden theatre": 10585,
  "brooklyn paramount": 440672, "van buren": 102014268,
  "danforth music hall": 78684, "tabernacle": 4704,
  "stubbs": 102062406, "masonic sf": 222, "wiltern": 2041,
  "the anthem": 102019050, "radio city": 3962,
  "mgm fenway": 102589095, "aragon ballroom": 6723,
  "coca-cola roxy": 448870, "warfield": 94
};

// ============================================================
// TOOL EXECUTION
// ============================================================

async function executeVividSeats(performerId) {
  try {
    const resp = await fetch(
      `https://www.vividseats.com/hermes/api/v1/productions?performerId=${performerId}&limit=50`,
      { headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' } }
    );
    const data = await resp.json();
    const items = (data.items || [])
      .filter(i => i.minPrice)
      .filter(i => {
        const cc = i.venue?.countryCode;
        return !cc || cc === 'US' || cc === 'CA';
      });
    if (items.length === 0) return JSON.stringify({ shows: [], message: "No US/CA shows found with pricing data" });
    return JSON.stringify({
      total_shows: items.length,
      price_range: `$${Math.min(...items.map(i=>i.minPrice))} - $${Math.max(...items.map(i=>i.minPrice))}`,
      shows: items.map(i => ({
        date: (i.localDate || '').split('T')[0],
        getIn: i.minPrice,
        listings: i.listingCount || 0,
        tickets: i.ticketCount || 0,
        venue: i.venue?.name || '?',
        city: i.venue?.city || '?',
        state: i.venue?.stateCode || i.venue?.countryCode || '?',
        capacity: i.venue?.capacity || null
      }))
    });
  } catch (e) {
    return JSON.stringify({ error: e.message });
  }
}

async function executeBraveSearch(query, braveKey) {
  try {
    const resp = await fetch(
      `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=8`,
      { headers: { 'X-Subscription-Token': braveKey, 'Accept': 'application/json' } }
    );
    const data = await resp.json();
    return JSON.stringify((data.web?.results || []).map(r => ({
      title: r.title,
      url: r.url,
      description: r.description
    })));
  } catch (e) {
    return JSON.stringify({ error: e.message });
  }
}

async function executeBandsintown(artistName) {
  try {
    const resp = await fetch(
      `https://rest.bandsintown.com/artists/${encodeURIComponent(artistName)}/events?app_id=squarespace-blackbeard`
    );
    const events = await resp.json();
    if (!Array.isArray(events)) return JSON.stringify({ error: "No events found" });
    return JSON.stringify({
      total_dates: events.length,
      events: events.slice(0, 40).map(e => ({
        date: (e.datetime || '').split('T')[0],
        venue: e.venue?.name,
        city: e.venue?.city,
        region: e.venue?.region || e.venue?.country,
        capacity: e.venue?.capacity || null
      }))
    });
  } catch (e) {
    return JSON.stringify({ error: e.message });
  }
}

async function executeTwitterSearch(query, bearerToken) {
  try {
    if (!bearerToken) return JSON.stringify({ error: "Twitter API not configured — use brave_search as fallback" });
    const resp = await fetch(
      `https://api.twitter.com/2/tweets/search/recent?query=${encodeURIComponent(query)}&max_results=10&tweet.fields=created_at,public_metrics,author_id`,
      { headers: { 'Authorization': `Bearer ${bearerToken}` } }
    );
    const data = await resp.json();
    if (!data.data) return JSON.stringify({ tweets: [], message: "No recent tweets found" });
    return JSON.stringify(data.data.map(t => ({
      text: t.text,
      date: t.created_at,
      likes: t.public_metrics?.like_count || 0,
      retweets: t.public_metrics?.retweet_count || 0
    })));
  } catch (e) {
    return JSON.stringify({ error: e.message });
  }
}

async function executeStubHubVenue(venueId, scrapingBeeKey) {
  try {
    if (!scrapingBeeKey) return JSON.stringify({ error: "ScrapingBee not configured — cannot scrape StubHub" });
    const targetUrl = `https://www.stubhub.com/venue/${venueId}`;
    const resp = await fetch(
      `https://app.scrapingbee.com/api/v1/?api_key=${scrapingBeeKey}&url=${encodeURIComponent(targetUrl)}&render_js=true&premium_proxy=true&wait=8000&extract_rules=${encodeURIComponent(JSON.stringify({
        events: { selector: "script[type='application/ld+json']", output: "text", type: "list" }
      }))}`,
      { headers: { 'Accept': 'application/json' } }
    );
    const data = await resp.json();
    const events = [];
    for (const script of (data.events || [])) {
      try {
        const parsed = JSON.parse(script);
        const extract = (item) => {
          if (item['@type'] === 'Event' || item['@type'] === 'MusicEvent') {
            events.push({
              name: item.name, date: item.startDate, url: item.url,
              lowPrice: item.offers?.lowPrice, highPrice: item.offers?.highPrice,
              offerCount: item.offers?.offerCount
            });
          }
        };
        if (Array.isArray(parsed)) parsed.forEach(extract); else extract(parsed);
      } catch (e) {}
    }
    return JSON.stringify({ events: events.slice(0, 30) });
  } catch (e) {
    return JSON.stringify({ error: e.message });
  }
}

function executePerformerLookup(artistName) {
  const key = artistName.toLowerCase().trim();
  const id = PERFORMER_IDS[key];
  if (id) return JSON.stringify({ artist: artistName, performer_id: id, source: "lookup_table" });
  if (id === null) return JSON.stringify({ artist: artistName, performer_id: null, message: "Known artist but no Vivid Seats ID yet. Use brave_search: site:vividseats.com [artist]" });
  for (const [name, pid] of Object.entries(PERFORMER_IDS)) {
    if (pid && (key.includes(name) || name.includes(key))) {
      return JSON.stringify({ artist: artistName, performer_id: pid, matched: name, source: "fuzzy_match" });
    }
  }
  return JSON.stringify({ artist: artistName, performer_id: null, message: "Not in table. Search: site:vividseats.com [artist] performer" });
}

async function executeSerpApi(query, engine, serpApiKey) {
  try {
    if (!serpApiKey) return JSON.stringify({ error: "SerpAPI not configured — use brave_search as fallback" });
    const eng = engine || 'google';
    const url = `https://serpapi.com/search.json?engine=${eng}&q=${encodeURIComponent(query)}&api_key=${serpApiKey}&num=8`;
    const resp = await fetch(url);
    const data = await resp.json();
    if (eng === 'google') return JSON.stringify((data.organic_results || []).slice(0, 8).map(r => ({ title: r.title, url: r.link, snippet: r.snippet })));
    if (eng === 'google_trends') return JSON.stringify(data.interest_over_time?.timeline_data?.slice(-10) || []);
    if (eng === 'youtube') return JSON.stringify((data.video_results || []).slice(0, 8).map(r => ({ title: r.title, views: r.views, date: r.published_date, channel: r.channel?.name })));
    return JSON.stringify(data);
  } catch (e) {
    return JSON.stringify({ error: e.message });
  }
}

async function executeTool(name, input, env) {
  switch (name) {
    case 'vivid_seats_search': return await executeVividSeats(input.performer_id);
    case 'brave_search': return await executeBraveSearch(input.query, env.BRAVE_API_KEY);
    case 'bandsintown_events': return await executeBandsintown(input.artist_name);
    case 'twitter_search': return await executeTwitterSearch(input.query, env.TWITTER_BEARER);
    case 'stubhub_venue': return await executeStubHubVenue(input.venue_id, env.SCRAPINGBEE_KEY);
    case 'performer_lookup': return executePerformerLookup(input.artist_name);
    case 'serpapi_search': return await executeSerpApi(input.query, input.engine, env.SERPAPI_KEY);
    default: return JSON.stringify({ error: 'Unknown tool' });
  }
}

// ============================================================
// CLAUDE API WITH TOOL LOOP
// ============================================================

async function runConversation(userMessage, conversationHistory, env) {
  const messages = [...conversationHistory, { role: 'user', content: userMessage }];
  let maxLoops = 12;
  let toolLog = [];

  while (maxLoops-- > 0) {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: env.MODEL || 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        tools: TOOLS,
        messages: messages
      })
    });

    if (!resp.ok) {
      const err = await resp.text();
      throw new Error(`Claude API error ${resp.status}: ${err}`);
    }

    const response = await resp.json();
    const toolUseBlocks = (response.content || []).filter(b => b.type === 'tool_use');
    const textBlocks = (response.content || []).filter(b => b.type === 'text');

    if (toolUseBlocks.length > 0) {
      messages.push({ role: 'assistant', content: response.content });
      const toolResults = [];
      for (const tool of toolUseBlocks) {
        const shortInput = JSON.stringify(tool.input).substring(0, 80);
        toolLog.push(`🔍 ${tool.name}(${shortInput})`);
        const result = await executeTool(tool.name, tool.input, env);
        toolResults.push({ type: 'tool_result', tool_use_id: tool.id, content: result });
      }
      messages.push({ role: 'user', content: toolResults });
    } else {
      const fullText = textBlocks.map(b => b.text).join('\n');
      return { response: fullText, toolLog, messages };
    }
  }

  return { response: "⚠️ Max tool iterations reached.", toolLog, messages };
}

// ============================================================
// CLOUDFLARE WORKER HANDLER
// ============================================================

export default {
  async fetch(request, env) {
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

    if (request.method === 'GET') {
      return new Response(JSON.stringify({
        status: 'ok', version: '3.0',
        tools: ['vivid_seats', 'brave_search', 'bandsintown', 'twitter', 'stubhub', 'serpapi', 'performer_lookup'],
        performers_cached: Object.keys(PERFORMER_IDS).length,
        model: env.MODEL || 'claude-sonnet-4-20250514'
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'POST only' }), { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const authHeader = request.headers.get('Authorization') || '';
    const token = authHeader.replace('Bearer ', '');
    if (env.APP_SECRET && token !== env.APP_SECRET) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    try {
      const { message, history } = await request.json();
      if (!message) return new Response(JSON.stringify({ error: 'No message provided' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

      const result = await runConversation(message, history || [], env);
      return new Response(JSON.stringify({ response: result.response, toolLog: result.toolLog }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
  }
};
