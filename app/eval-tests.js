#!/usr/bin/env node
// ============================================================
// BROKERBEACON EVALUATION FRAMEWORK
// Run: node eval-tests.js <API_URL> <API_SECRET>
// Tests 15 standard queries and scores responses
// ============================================================

const TESTS = [
  {
    id: 1,
    query: "Scan Feid",
    mustContain: ["Brooklyn", "Fillmore", "LATAM", "theater", "ratio"],
    mustNotContain: ["PASS", "skip this", "not worth"],
    expectedVerdict: "ELEVATED DEMAND",
    description: "Should recognize Feid as LATAM theater play with high pricing"
  },
  {
    id: 2,
    query: "Fruit Bats",
    mustContain: ["indie folk", "face value", "listings"],
    mustNotContain: ["BUY", "ELEVATED"],
    expectedVerdict: "PASS",
    description: "Should recognize indie folk with no secondary market as a pass"
  },
  {
    id: 3,
    query: "Deep dive on Don West",
    mustContain: ["UK", "breakout", "first US", "Sinclair", "Bowery", "ratio"],
    mustNotContain: ["PASS"],
    expectedVerdict: "ELEVATED DEMAND",
    description: "Should flag UK breakout pattern with extreme scarcity"
  },
  {
    id: 4,
    query: "Naïka",
    mustContain: ["Haitian", "diaspora", "Miami", "venue upgrade"],
    mustNotContain: ["PASS"],
    expectedVerdict: "ELEVATED DEMAND",
    description: "Should identify Haitian diaspora corridor pricing"
  },
  {
    id: 5,
    query: "Show me the VIP watchlist",
    mustContain: ["Zara Larsson", "Naïka", "Feid", "S-Tier", "A-Tier"],
    mustNotContain: [],
    expectedVerdict: null,
    description: "Should show full VIP watchlist with tiers"
  },
  {
    id: 6,
    query: "Banda MS",
    mustContain: ["arena", "listings", "supply"],
    mustNotContain: ["BUY", "ELEVATED"],
    expectedVerdict: "PASS",
    description: "Should recognize arena-scale LATAM as not our market"
  },
  {
    id: 7,
    query: "Compare Don West to RAYE",
    mustContain: ["UK", "breakout", "Spotify", "ratio", "first US"],
    mustNotContain: [],
    expectedVerdict: null,
    description: "Should compare two UK breakout artists with data"
  },
  {
    id: 8,
    query: "Stephen Wilson Jr",
    mustContain: ["sold out", "country", "Brandi Carlile", "Leg"],
    mustNotContain: ["PASS", "INSUFFICIENT"],
    expectedVerdict: "ELEVATED DEMAND",
    description: "Should flag all Leg 1 dates sold out as strong signal"
  },
  {
    id: 9,
    query: "Masayoshi Takanaka",
    mustContain: ["Japanese", "4 US dates", "scarcity"],
    mustNotContain: ["PASS"],
    expectedVerdict: "ELEVATED DEMAND",
    description: "Should flag extreme scarcity from limited dates"
  },
  {
    id: 10,
    query: "Is DC a good market?",
    mustContain: ["premium", "40-80%", "above"],
    mustNotContain: [],
    expectedVerdict: null,
    description: "Should explain DC premium market dynamics"
  },
  {
    id: 11,
    query: "What patterns should I look for in LATAM artists?",
    mustContain: ["diaspora", "theater", "arena", "Miami", "corridor"],
    mustNotContain: [],
    expectedVerdict: null,
    description: "Should explain LATAM diaspora corridor and theater vs arena distinction"
  },
  {
    id: 12,
    query: "Angine de Poitrine",
    mustContain: ["Quebec", "sold out", "first US", "KEXP"],
    mustNotContain: ["PASS"],
    expectedVerdict: "ELEVATED DEMAND",
    description: "Should identify hidden gem with 28+ sellouts"
  },
  {
    id: 13,
    query: "fakemink",
    mustContain: ["$184", "uniform", "broker"],
    mustNotContain: [],
    expectedVerdict: null,
    description: "Should flag uniform pricing as broker-controlled inventory"
  },
  {
    id: 14,
    query: "What's the Citi presale code?",
    mustContain: ["412800"],
    mustNotContain: [],
    expectedVerdict: null,
    description: "Should know Citi presale code"
  },
  {
    id: 15,
    query: "Maisie Peters",
    mustContain: ["UK", "Ed Sheeran", "DC", "$328"],
    mustNotContain: ["PASS"],
    expectedVerdict: "ELEVATED DEMAND",
    description: "Should flag UK breakout with DC premium"
  }
];

async function runTest(test, apiUrl, apiSecret) {
  try {
    const resp = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiSecret}`
      },
      body: JSON.stringify({ message: test.query, history: [] })
    });
    
    if (!resp.ok) {
      return { id: test.id, pass: false, reason: `HTTP ${resp.status}` };
    }
    
    const data = await resp.json();
    const response = data.response.toLowerCase();
    const issues = [];
    
    // Check must-contain
    for (const term of test.mustContain) {
      if (!response.includes(term.toLowerCase())) {
        issues.push(`Missing: "${term}"`);
      }
    }
    
    // Check must-not-contain
    for (const term of test.mustNotContain) {
      if (response.includes(term.toLowerCase())) {
        issues.push(`Should NOT contain: "${term}"`);
      }
    }
    
    // Check verdict
    if (test.expectedVerdict) {
      if (!response.includes(test.expectedVerdict.toLowerCase())) {
        issues.push(`Wrong verdict (expected: ${test.expectedVerdict})`);
      }
    }
    
    return {
      id: test.id,
      query: test.query,
      pass: issues.length === 0,
      issues,
      toolsUsed: data.toolLog?.length || 0,
      responseLength: data.response.length,
      description: test.description
    };
  } catch (e) {
    return { id: test.id, pass: false, reason: e.message };
  }
}

async function main() {
  const apiUrl = process.argv[2] || 'https://blackbeard-api.brokerbeacon.workers.dev';
  const apiSecret = process.argv[3] || '';
  
  console.log('🧪 BrokerBeacon Evaluation Suite');
  console.log(`API: ${apiUrl}`);
  console.log(`Tests: ${TESTS.length}`);
  console.log('---');
  
  let passed = 0;
  let failed = 0;
  
  for (const test of TESTS) {
    process.stdout.write(`Test ${test.id}: "${test.query}" ... `);
    const result = await runTest(test, apiUrl, apiSecret);
    
    if (result.pass) {
      console.log(`✅ PASS (${result.toolsUsed} tools, ${result.responseLength} chars)`);
      passed++;
    } else {
      console.log(`❌ FAIL`);
      (result.issues || [result.reason]).forEach(i => console.log(`   → ${i}`));
      failed++;
    }
    
    // Rate limit: wait 2s between tests
    await new Promise(r => setTimeout(r, 2000));
  }
  
  console.log('---');
  console.log(`Results: ${passed}/${TESTS.length} passed (${Math.round(passed/TESTS.length*100)}%)`);
  if (failed > 0) console.log(`⚠️ ${failed} tests need attention`);
}

main().catch(console.error);
