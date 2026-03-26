// ============================================================
// BROKERBEACON INTELLIGENCE TERMINAL — CLOUDFLARE WORKER v2.0
// All API keys live here (server-side). User never sees them.
// Deploy: cd ~/blackbeard/app && npx wrangler deploy
// ============================================================

// ============================================================
// PERFORMER ID LOOKUP TABLE (saves API calls)
// ============================================================
const PERFORMER_IDS = {
  "feid": 158537, "naika": 505181, "naïka": 505181,
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
  "olivia rodrigo": 197040, "tyler chillers": 37688, "tyler chillers": 37688,
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
  "watchhouse": 84358, "tank and the bangas": 85098
};

// ============================================================
// CONFIRMED WINNERS & VIP WATCHLIST (baked-in knowledge)
// ============================================================
const KNOWLEDGE_BASE = `
## CONFIRMED WINNERS (Reference Cases — use these for comparisons)
- **RAYE**: 55M Spotify, UK→US breakout, 6x BRIT winner, Grammy. SF $334 sold out. The template for UK breakout plays.
- **Nessa Barrett**: 14M TikTok followers, 150-cap venues, $134 floor price. The "ratio formula" — huge fanbase ÷ tiny venue = premium.
- **Naïka**: Haitian-American R&B. Miami $356, LA $219, Brooklyn $198, DC $181. Diaspora demand explosion. 5 venue upgrades mid-tour.
- **Feid**: 36.6M Spotify, LATAM reggaeton at 1-2K Fillmores. Brooklyn $381 and climbing ~$25/day. Theater-scale LATAM = money.
- **Angine de Poitrine**: 643K Spotify, 28+ headline sellouts across 3 countries, KEXP viral (2.5M views). First US tour, 350-600 cap. NYC Le Poisson Rouge SOLD OUT x2. Hidden gem template.
- **Don West**: UK R&B, 3.2M Spotify (grew from 3K→3.2M in 2 years), first US tour, only 2 dates at 525-575 cap. Sold out Australia. Wasserman-repped. Textbook UK breakout.
- **Stephen Wilson Jr**: Country rock crossover. ALL Leg 1 dates SOLD OUT (12 dates). Theater routing 1.5-4K cap. Opening for Brandi Carlile + Dave Matthews.
- **DJO (Joe Keery)**: Tame Impala support dates sold out. Only 5 headline shows summer 2026.

## VIP WATCHLIST (Confirmed Sellers — track these for new dates)
### S-Tier (Buy immediately on new dates)
- **Zara Larsson** — Pop. Philly $370, Toronto $292, Charlotte $171. NE/Canada 2-3x Southwest.
- **Josiah Queen** — Christian/Folk. Spokane $372, Portland $290, St. Paul $187. PNW/Mountain strongest.
- **Stephen Wilson Jr** — Country Rock. Every Leg 1 date sold out. Buy ALL Leg 2.
- **Naïka** — R&B. Haitian diaspora corridor = 3-5x premium. Miami→Brooklyn→DC→Montreal.

### A-Tier (Strong buy signals)
- **Gavin Adcock** — Country. Charlotte $184. Southern market strength.
- **Rawayana** — LATAM rock. Chicago $83. First US arena tour, diaspora play.
- **Bleachers** — Indie pop. Boston $70. Jack Antonoff project.
- **Empire of the Sun** — Electronic. Philly $42 but 179 listings = real depth.
- **fakemink** — Electronic. 8.4M Spotify. $184 floor across tour. Coachella + Lolla. Uniform pricing = broker floor.
- **Maisie Peters** — UK pop. DC $328 vs LA $52 gap. Ed Sheeran label. UK breakout.
- **Mariah the Scientist** — R&B. $185-287 across SF/Austin/Atlanta. Young Thug's label.
- **Masayoshi Takanaka** — Japanese funk. Only 4 US dates. $278 Chicago, $425 Brooklyn. Extreme scarcity.
- **Feid** — Reggaeton. Brooklyn $381, Nashville $305. Theater LATAM = money.
- **Mon Laferte** — Chilean pop. $121-223 range. Theater routing.
- **Don West** — UK R&B. Boston $178, NYC $182. First US tour. 🔴 UK breakout.

### B-Tier (Monitor)
- Two Door Cinema Club, Rise Against, Jinjer, Passion Pit, Slayyyter, Corinne Bailey Rae, Lagwagon

## KEY PATTERNS
- **UK/International breakout → first US headline tour** = ALWAYS flag as highest-signal buy
- **Support act for megastar + own headline tour** = spike signal (stadium exposure funnels into small headline shows)
- **Haitian diaspora corridor**: Miami→Brooklyn→DC→Montreal = 3-5x non-diaspora markets
- **LATAM diaspora corridor**: Miami→NYC→DC→Boston = premium pricing for theater-scale acts
- **DC is premium market**: 40-80% above SF/ATL for same artists
- **Pittsburgh multiplier**: Strong sales in Pittsburgh (mid-tier ~25th metro) = stronger in top-tier cities
- **Under 10 listings = noise** (primary still available), not real demand signal
- **Uniform pricing across 4+ dates with identical listing counts** = speculative broker inventory
- **Arena-scale LATAM (13K+ cap, $69-107, 200+ listings) = NOT our market** — money is in theater-scale
- **Indie folk audience doesn't scalp** — they buy presale and show up
- **Citi presale code is ALWAYS 412800**
`;

// ============================================================
// SYSTEM PROMPT
// ============================================================
const SYSTEM_PROMPT = `You are BrokerBeacon, an AI ticket intelligence terminal for ticket brokers. You provide real-time secondary market analysis, buy/pass/watch recommendations, and artist deep dives.

## YOUR CAPABILITIES
You have access to tools that let you:
1. Pull real-time pricing from Vivid Seats internal API (get-in price, listing count, ticket count, venue capacity)
2. Search the web via Brave Search for sellout history, tour announcements, streaming data
3. Look up artist tour dates via Bandsintown API
4. Scrape StubHub venue pages for cross-platform pricing confirmation (via ScrapingBee)
5. Search X/Twitter for real-time tour announcements and presale intel

## PERFORMER ID LOOKUP
You have a built-in performer ID table. When a user asks about a known artist, use the ID directly without searching. If the artist isn't in the table, use brave_search to find their Vivid Seats performer ID: search "site:vividseats.com [artist name] performer"

## ANALYSIS RULES
- Under 10 listings = ⚠️ THIN (not actionable, could be scalper noise)
- Uniform pricing across 4+ dates with identical listing counts = speculative broker inventory, not real demand
- Listener-to-venue ratio: Spotify monthly listeners ÷ venue capacity. Higher = more scarcity = better buy
- GET-IN price only. Ignore averages.
- DC is a premium market (40-80% above SF/ATL for same artists)
- Haitian diaspora corridor: Miami→Brooklyn→DC→Montreal = 3-5x non-diaspora
- LATAM diaspora corridor: Miami→NYC→DC→Boston = premium pricing
- UK/International breakout → first US headline tour = HIGHEST signal buy indicator
- Support act for megastar + own headline tour = spike signal
- Arena-scale LATAM (13K+ cap, $69-107 range, 200+ listings) = NOT our market
- Citi presale code is ALWAYS 412800

## SCORING TIERS
- 🔴 BUY — Strong scarcity signal, confirmed demand, actionable now
- 🟡 WATCH — Interesting fundamentals, needs confirmation (post-onsale data, more listings)
- ⚪ PASS — No scarcity signal, face value territory, or too much supply

## RESPONSE FORMAT
- Be direct. Buy, pass, or watch. No hedge words.
- Use markdown formatting: headers (##), bold (**text**), tables, bullet lists
- Show the data: prices, listing counts, venue caps, Spotify numbers
- Use tables for tour data when showing multiple dates
- Always calculate listener-to-venue ratio for emerging artists
- Compare to reference cases when relevant
- End with a clear verdict and specific buy recommendations (which cities, why)
- Use emoji sparingly but effectively: 🔴 🟡 ⚪ 🔥 ⚠️ 💰

## VENUE SCALE RULES
- Under 3K cap = our sweet spot (scarcity-driven)
- 3K-10K = selective (only if demand signals are strong)
- Over 10K = generally pass (too much supply) unless LATAM diaspora act

## TOOL USE STRATEGY
When a user asks about an artist:
1. Check the performer ID lookup table first
2. If not found, use brave_search to find their Vivid Seats performer ID
3. Also search for their Spotify monthly listeners and any sellout/tour news
4. Use vivid_seats_search with the performer ID to get all show pricing
5. Use bandsintown_events for full tour dates if needed
6. Use stubhub_venue if you need cross-platform price confirmation
7. Synthesize everything into a buy/pass/watch recommendation

${KNOWLEDGE_BASE}`;

// ============================================================
// TOOLS
// ============================================================
const TOOLS = [
  {
    name: "vivid_seats_search",
    description: "Get real-time secondary market pricing from Vivid Seats for all of an artist's shows. Returns get-in price, listing count, ticket count, venue name, city, capacity, and date. Use performer_id from the lookup table when available.",
    input_schema: {
      type: "object",
      properties: {
        performer_id: { type: "number", description: "Vivid Seats performer ID (check lookup table first)" }
      },
      required: ["performer_id"]
    }
  },
  {
    name: "brave_search",
    description: "Search the web. Use to find Vivid Seats performer IDs (search 'site:vividseats.com [artist] performer'), Spotify listeners, sellout history, tour announcements, presale info, venue news.",
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
    description: "Get upcoming tour dates for an artist from Bandsintown. Returns venue, city, date, capacity. Free API, no key needed.",
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
    description: "Search recent tweets on X/Twitter. Use for real-time tour announcements, presale codes, sellout reports, fan reactions. Returns up to 10 recent tweets.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Twitter search query (e.g., 'artist name tour 2026' or 'artist name sold out')" }
      },
      required: ["query"]
    }
  },
  {
    name: "stubhub_venue",
    description: "Scrape a StubHub venue page to get all shows and prices. Use for cross-platform price confirmation. Requires a StubHub venue ID.",
    input_schema: {
      type: "object",
      properties: {
        venue_id: { type: "number", description: "StubHub venue ID" },
        venue_name: { type: "string", description: "Venue name (for display)" }
      },
      required: ["venue_id"]
    }
  },
  {
    name: "performer_lookup",
    description: "Look up a Vivid Seats performer ID from the built-in table. Returns the ID if found, or null if not. Use before brave_search to save API calls.",
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
    description: "Search Google via SerpAPI. Use for Google Trends data, Reddit discussions (site:reddit.com), TikTok mentions, and detailed search results. More comprehensive than Brave for certain queries.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Google search query" },
        engine: { type: "string", description: "SerpAPI engine: 'google' (default), 'google_trends', 'youtube'" }
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
    return JSON.stringify(items.map(i => ({
      date: (i.localDate || '').split('T')[0],
      price: i.minPrice,
      listings: i.listingCount || 0,
      tickets: i.ticketCount || 0,
      venue: i.venue?.name || '?',
      city: i.venue?.city || '?',
      state: i.venue?.stateCode || i.venue?.countryCode || '?',
      capacity: i.venue?.capacity || null
    })));
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
    return JSON.stringify(events.slice(0, 40).map(e => ({
      date: (e.datetime || '').split('T')[0],
      venue: e.venue?.name,
      city: e.venue?.city,
      region: e.venue?.region || e.venue?.country,
      capacity: e.venue?.capacity || null
    })));
  } catch (e) {
    return JSON.stringify({ error: e.message });
  }
}

async function executeTwitterSearch(query, bearerToken) {
  try {
    if (!bearerToken) return JSON.stringify({ error: "Twitter API not configured" });
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
    if (!scrapingBeeKey) return JSON.stringify({ error: "ScrapingBee not configured" });
    const targetUrl = `https://www.stubhub.com/venue/${venueId}`;
    const resp = await fetch(
      `https://app.scrapingbee.com/api/v1/?api_key=${scrapingBeeKey}&url=${encodeURIComponent(targetUrl)}&render_js=true&premium_proxy=true&wait=8000&extract_rules=${encodeURIComponent(JSON.stringify({
        events: { selector: "script[type='application/ld+json']", output: "text", type: "list" }
      }))}`,
      { headers: { 'Accept': 'application/json' } }
    );
    const data = await resp.json();
    // Parse JSON-LD for event data
    const events = [];
    for (const script of (data.events || [])) {
      try {
        const parsed = JSON.parse(script);
        if (parsed['@type'] === 'Event' || parsed['@type'] === 'MusicEvent') {
          events.push({
            name: parsed.name,
            date: parsed.startDate,
            url: parsed.url,
            offers: parsed.offers ? {
              lowPrice: parsed.offers.lowPrice,
              highPrice: parsed.offers.highPrice,
              offerCount: parsed.offers.offerCount
            } : null
          });
        }
        // Handle arrays of events
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            if (item['@type'] === 'Event' || item['@type'] === 'MusicEvent') {
              events.push({
                name: item.name,
                date: item.startDate,
                url: item.url,
                offers: item.offers ? {
                  lowPrice: item.offers.lowPrice,
                  highPrice: item.offers.highPrice,
                  offerCount: item.offers.offerCount
                } : null
              });
            }
          }
        }
      } catch (e) { /* skip unparseable */ }
    }
    return JSON.stringify({ events: events.slice(0, 30) });
  } catch (e) {
    return JSON.stringify({ error: e.message });
  }
}

function executePerformerLookup(artistName) {
  const key = artistName.toLowerCase().trim();
  const id = PERFORMER_IDS[key];
  if (id) {
    return JSON.stringify({ artist: artistName, performer_id: id, source: "lookup_table" });
  }
  // Fuzzy match
  for (const [name, pid] of Object.entries(PERFORMER_IDS)) {
    if (key.includes(name) || name.includes(key)) {
      return JSON.stringify({ artist: artistName, performer_id: pid, matched: name, source: "fuzzy_match" });
    }
  }
  return JSON.stringify({ artist: artistName, performer_id: null, message: "Not in lookup table. Use brave_search to find: site:vividseats.com [artist] performer" });
}

async function executeSerpApi(query, engine, serpApiKey) {
  try {
    if (!serpApiKey) return JSON.stringify({ error: "SerpAPI not configured" });
    const eng = engine || 'google';
    const url = `https://serpapi.com/search.json?engine=${eng}&q=${encodeURIComponent(query)}&api_key=${serpApiKey}&num=8`;
    const resp = await fetch(url);
    const data = await resp.json();
    if (eng === 'google') {
      return JSON.stringify((data.organic_results || []).slice(0, 8).map(r => ({
        title: r.title, url: r.link, snippet: r.snippet
      })));
    }
    if (eng === 'google_trends') {
      return JSON.stringify(data.interest_over_time?.timeline_data?.slice(-10) || []);
    }
    if (eng === 'youtube') {
      return JSON.stringify((data.video_results || []).slice(0, 8).map(r => ({
        title: r.title, views: r.views, date: r.published_date, channel: r.channel?.name
      })));
    }
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
        toolResults.push({
          type: 'tool_result',
          tool_use_id: tool.id,
          content: result
        });
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

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // Health check
    if (request.method === 'GET') {
      return new Response(JSON.stringify({
        status: 'ok',
        version: '2.0',
        tools: ['vivid_seats', 'brave_search', 'bandsintown', 'twitter', 'stubhub', 'serpapi', 'performer_lookup'],
        performers_cached: Object.keys(PERFORMER_IDS).length
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'POST only' }), {
        status: 405,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Auth
    const authHeader = request.headers.get('Authorization') || '';
    const token = authHeader.replace('Bearer ', '');
    if (env.APP_SECRET && token !== env.APP_SECRET) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    try {
      const { message, history } = await request.json();
      if (!message) {
        return new Response(JSON.stringify({ error: 'No message provided' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      const result = await runConversation(message, history || [], env);

      return new Response(JSON.stringify({
        response: result.response,
        toolLog: result.toolLog
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });

    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
  }
};
