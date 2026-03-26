// ============================================================
// BLACKBEARD INTELLIGENCE TERMINAL — CLOUDFLARE WORKER
// All API keys live here (server-side). User never sees them.
// Deploy: npx wrangler deploy
// ============================================================

const SYSTEM_PROMPT = `You are Blackbeard, an AI ticket intelligence terminal for ticket brokers. You provide real-time secondary market analysis, buy/pass/watch recommendations, and artist deep dives.

## YOUR CAPABILITIES
You have access to tools that let you:
1. Pull real-time pricing from Vivid Seats internal API (get-in price, listing count, ticket count, venue capacity)
2. Search the web via Brave Search for sellout history, tour announcements, streaming data
3. Look up artist tour dates via Bandsintown API

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
- Citi presale code is ALWAYS 412800

## SCORING TIERS
- 🔴 BUY — Strong scarcity signal, confirmed demand, actionable now
- 🟡 WATCH — Interesting fundamentals, needs confirmation (post-onsale data, more listings)
- ⚪ PASS — No scarcity signal, face value territory, or too much supply

## RESPONSE FORMAT
- Be direct. Buy, pass, or watch. No hedge words.
- Show the data: prices, listing counts, venue caps, Spotify numbers
- Use tables for tour data when showing multiple dates
- Always calculate listener-to-venue ratio for emerging artists
- Compare to reference cases when relevant (RAYE, Nessa Barrett, Naïka, Feid)
- End with a clear verdict and specific buy recommendations (which cities, why)

## VENUE SCALE RULES
- Under 3K cap = our sweet spot (scarcity-driven)
- 3K-10K = selective (only if demand signals are strong)
- Over 10K = generally pass (too much supply) unless LATAM diaspora act

## TOOL USE STRATEGY
When a user asks about an artist:
1. First use brave_search to find their Vivid Seats performer ID: search "site:vividseats.com [artist name] performer"
2. Also search for their Spotify monthly listeners
3. Then use vivid_seats_search with the performer ID to get all show pricing
4. Use bandsintown_events for full tour dates if needed
5. Synthesize everything into a buy/pass/watch recommendation

## REFERENCE CASES
- RAYE: 55M Spotify, UK→US breakout, SF $334 sold out. The template.
- Nessa Barrett: 14M TikTok, 150-cap venues, $134 floor. The "ratio formula."
- Naïka: Haitian-American R&B, Miami $356, diaspora demand explosion.
- Feid: 36.6M Spotify at 1-2K Fillmores, $170-381. LATAM theater = money.
- Angine de Poitrine: 643K Spotify, 28 sold-out shows, 350-600 cap. Hidden gem template.
- Don West: 3.2M Spotify, first US tour, 2 dates at 525 cap. UK breakout in progress.`;

const TOOLS = [
  {
    name: "vivid_seats_search",
    description: "Get real-time secondary market pricing from Vivid Seats for all of an artist's shows. Returns get-in price, listing count, ticket count, venue name, city, capacity, and date.",
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
    description: "Search the web. Use to find Vivid Seats performer IDs (search 'site:vividseats.com [artist] performer'), Spotify listeners, sellout history, tour announcements, presale info.",
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
    description: "Get upcoming tour dates for an artist from Bandsintown. Returns venue, city, date, capacity.",
    input_schema: {
      type: "object",
      properties: {
        artist_name: { type: "string", description: "Artist name" }
      },
      required: ["artist_name"]
    }
  }
];

// ============================================================
// TOOL EXECUTION (server-side — no CORS issues)
// ============================================================

async function executeVividSeats(performerId) {
  try {
    const resp = await fetch(
      `https://www.vividseats.com/hermes/api/v1/productions?performerId=${performerId}&limit=50`,
      { headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' } }
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
      `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=5`,
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
    return JSON.stringify(events.slice(0, 30).map(e => ({
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

async function executeTool(name, input, env) {
  switch (name) {
    case 'vivid_seats_search': return await executeVividSeats(input.performer_id);
    case 'brave_search': return await executeBraveSearch(input.query, env.BRAVE_API_KEY);
    case 'bandsintown_events': return await executeBandsintown(input.artist_name);
    default: return JSON.stringify({ error: 'Unknown tool' });
  }
}

// ============================================================
// CLAUDE API WITH TOOL LOOP
// ============================================================

async function runConversation(userMessage, conversationHistory, env) {
  const messages = [...conversationHistory, { role: 'user', content: userMessage }];
  let maxLoops = 10;
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
      // Add assistant message with tool calls
      messages.push({ role: 'assistant', content: response.content });

      // Execute tools
      const toolResults = [];
      for (const tool of toolUseBlocks) {
        toolLog.push(`🔍 ${tool.name}(${JSON.stringify(tool.input).substring(0, 100)})`);
        const result = await executeTool(tool.name, tool.input, env);
        toolResults.push({
          type: 'tool_result',
          tool_use_id: tool.id,
          content: result
        });
      }

      messages.push({ role: 'user', content: toolResults });
    } else {
      // Final response
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
    // CORS headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'POST only' }), {
        status: 405,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Simple auth: check bearer token
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
