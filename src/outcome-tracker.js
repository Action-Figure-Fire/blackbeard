#!/usr/bin/env node
/**
 * OUTCOME TRACKER — The foundation for Blackbeard's autoresearch loop
 * 
 * Purpose: Record every prediction with a snapshot of signals at prediction time,
 * then track actual market outcomes (get-in prices, sellouts, listing counts)
 * to build a labeled dataset for model self-optimization.
 * 
 * Data flow:
 *   1. record()    — snapshot a prediction + all signals at time of pick
 *   2. check()     — pull current market data and update outcomes
 *   3. evaluate()  — score the model's accuracy across all tracked predictions
 *   4. export()    — dump labeled dataset for the optimization loop
 * 
 * Usage:
 *   node outcome-tracker.js record              # Snapshot all current watchlist predictions
 *   node outcome-tracker.js check               # Update outcomes with latest market data
 *   node outcome-tracker.js evaluate            # Score model accuracy
 *   node outcome-tracker.js export              # Export labeled dataset for autoresearch
 *   node outcome-tracker.js report              # Human-readable accuracy report
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const OUTCOMES_FILE = path.join(DATA_DIR, 'outcome-ledger.json');
const EXPORT_FILE = path.join(DATA_DIR, 'autoresearch-dataset.json');
const WATCHLIST_FILE = path.join(DATA_DIR, 'watchlist.json');
const VIP_FILE = path.join(DATA_DIR, 'vip-watchlist.json');
const ACCURACY_FILE = path.join(DATA_DIR, 'accuracy-tracker.json');
const PREDICTIONS_FILE = path.join(DATA_DIR, 'predictions-latest.json');
const VIVID_DIR = path.join(DATA_DIR, 'vivid-snapshots');
const STUBHUB_DIR = path.join(DATA_DIR, 'stubhub-snapshots');

// ─── Outcome Classification ───────────────────────────────────────────────
// 
// Each prediction gets classified into one of these outcomes:
//   BIG_WIN    — get-in price 2x+ face value OR sold out across 3+ venues
//   WIN        — get-in price 1.3-2x face OR sold out at 1-2 venues
//   NEUTRAL    — traded near face value, no significant movement
//   MISS       — get-in dropped below face, excess inventory, no demand signal
//   PENDING    — not enough time/data to classify yet
//
const OUTCOME_THRESHOLDS = {
  BIG_WIN: {
    getInMultiple: 2.0,      // 2x face value
    soldOutVenues: 3,        // OR sold out at 3+ venues
    listingsDrop: 0.2,       // OR listings dropped 80%+ (near sellout)
  },
  WIN: {
    getInMultiple: 1.3,      // 1.3x face value
    soldOutVenues: 1,        // OR sold out at 1+ venue
    listingsDrop: 0.5,       // OR listings dropped 50%+
  },
  MIN_DAYS_TO_JUDGE: 14,     // Don't classify until 14 days after prediction
  MAX_DAYS_PENDING: 120,     // Auto-classify as MISS after 120 days with no signal
};

// ─── Helpers ──────────────────────────────────────────────────────────────

function loadJSON(filepath) {
  try {
    return JSON.parse(fs.readFileSync(filepath, 'utf8'));
  } catch {
    return null;
  }
}

function saveJSON(filepath, data) {
  fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
}

function loadLedger() {
  const existing = loadJSON(OUTCOMES_FILE);
  if (existing && existing.predictions) return existing;
  return {
    meta: {
      description: "Blackbeard Outcome Ledger — every prediction with signals + actual results",
      createdAt: new Date().toISOString(),
      version: 1,
      scoringWeights: {
        scarcity: 0.30,
        streaming: 0.25,
        social: 0.20,
        momentum: 0.15,
        marketGap: 0.10,
      },
      weightHistory: [],
    },
    predictions: [],
    modelStats: {
      totalPredictions: 0,
      bigWins: 0,
      wins: 0,
      neutrals: 0,
      misses: 0,
      pending: 0,
      accuracy: null,           // (bigWins + wins) / (total - pending)
      precisionByTier: {},      // { S: { correct: 5, total: 8, pct: 0.625 }, ... }
      lastEvaluated: null,
    },
  };
}

function getVividPriceData(artistName) {
  // Scan all vivid snapshots for this artist
  const prices = [];
  try {
    const files = fs.readdirSync(VIVID_DIR).filter(f => f.endsWith('.json'));
    for (const file of files) {
      const data = loadJSON(path.join(VIVID_DIR, file));
      if (!data) continue;
      const venues = data.venues || data.results || data;
      const venueList = Array.isArray(venues) ? venues : Object.values(venues);
      for (const venue of venueList) {
        const shows = venue.shows || venue.productions || [];
        for (const show of shows) {
          const name = (show.name || show.performer || show.title || '').toLowerCase();
          if (name.includes(artistName.toLowerCase())) {
            prices.push({
              venue: venue.venueName || venue.name || file,
              getIn: show.minPrice || show.getIn || show.price,
              listings: show.listingCount || show.listings,
              tickets: show.ticketCount || show.tickets,
              date: show.date || show.eventDate,
              snapshotDate: data.timestamp || data.scanDate || file,
            });
          }
        }
      }
    }
  } catch {}
  return prices;
}

function getStubhubPriceData(artistName) {
  const prices = [];
  try {
    const files = fs.readdirSync(STUBHUB_DIR).filter(f => f.endsWith('.json'));
    for (const file of files) {
      const data = loadJSON(path.join(STUBHUB_DIR, file));
      if (!data) continue;
      const shows = data.shows || data.events || [];
      for (const show of shows) {
        const name = (show.name || show.performer || show.title || '').toLowerCase();
        if (name.includes(artistName.toLowerCase())) {
          prices.push({
            source: 'stubhub',
            venue: show.venue,
            getIn: show.minPrice || show.price,
            listings: show.listingCount,
            date: show.date,
            snapshotDate: data.timestamp || file,
          });
        }
      }
    }
  } catch {}
  return prices;
}

function getVIPData(artistName) {
  const vip = loadJSON(VIP_FILE);
  if (!vip || !vip.confirmedSellers) return null;
  return vip.confirmedSellers.find(
    s => s.artist && s.artist.toLowerCase() === artistName.toLowerCase()
  );
}

function classifyOutcome(prediction) {
  const daysSince = (Date.now() - new Date(prediction.recordedAt).getTime()) / (1000 * 60 * 60 * 24);
  
  if (daysSince < OUTCOME_THRESHOLDS.MIN_DAYS_TO_JUDGE) {
    return { outcome: 'PENDING', reason: `Only ${Math.floor(daysSince)} days since prediction (need ${OUTCOME_THRESHOLDS.MIN_DAYS_TO_JUDGE})` };
  }

  const checks = prediction.outcomeChecks || [];
  if (checks.length === 0) {
    if (daysSince > OUTCOME_THRESHOLDS.MAX_DAYS_PENDING) {
      return { outcome: 'MISS', reason: `No market data after ${Math.floor(daysSince)} days` };
    }
    return { outcome: 'PENDING', reason: 'No market data collected yet' };
  }

  const latest = checks[checks.length - 1];
  const maxGetIn = Math.max(...checks.map(c => c.maxGetIn || 0).filter(x => x > 0), 0);
  const soldOutVenues = latest.soldOutVenues || 0;
  const initialListings = checks[0].totalListings || 0;
  const currentListings = latest.totalListings || 0;
  const listingsRatio = initialListings > 0 ? currentListings / initialListings : 1;

  // BIG_WIN checks
  if (maxGetIn >= 150 && soldOutVenues >= OUTCOME_THRESHOLDS.BIG_WIN.soldOutVenues) {
    return { outcome: 'BIG_WIN', reason: `$${maxGetIn} get-in, ${soldOutVenues} venues sold out` };
  }
  if (maxGetIn >= 200) {
    return { outcome: 'BIG_WIN', reason: `$${maxGetIn} peak get-in price` };
  }
  if (listingsRatio <= OUTCOME_THRESHOLDS.BIG_WIN.listingsDrop && initialListings > 20) {
    return { outcome: 'BIG_WIN', reason: `Listings dropped ${Math.round((1 - listingsRatio) * 100)}%` };
  }

  // WIN checks
  if (maxGetIn >= 80 && soldOutVenues >= OUTCOME_THRESHOLDS.WIN.soldOutVenues) {
    return { outcome: 'WIN', reason: `$${maxGetIn} get-in, ${soldOutVenues} venues sold out` };
  }
  if (maxGetIn >= 100) {
    return { outcome: 'WIN', reason: `$${maxGetIn} peak get-in price` };
  }
  if (listingsRatio <= OUTCOME_THRESHOLDS.WIN.listingsDrop && initialListings > 20) {
    return { outcome: 'WIN', reason: `Listings dropped ${Math.round((1 - listingsRatio) * 100)}%` };
  }

  // If enough time has passed and no strong signals, classify
  if (daysSince > 60) {
    if (maxGetIn > 0 && maxGetIn < 60) {
      return { outcome: 'MISS', reason: `Peak get-in only $${maxGetIn} after ${Math.floor(daysSince)} days` };
    }
    if (maxGetIn === 0 && soldOutVenues === 0) {
      return { outcome: 'NEUTRAL', reason: `No significant price or sellout data after ${Math.floor(daysSince)} days` };
    }
  }

  if (daysSince > OUTCOME_THRESHOLDS.MAX_DAYS_PENDING) {
    return { outcome: 'MISS', reason: `No strong signals after ${Math.floor(daysSince)} days` };
  }

  return { outcome: 'PENDING', reason: 'Monitoring — insufficient signal' };
}

// ─── Commands ─────────────────────────────────────────────────────────────

async function record() {
  const ledger = loadLedger();
  const watchlist = loadJSON(WATCHLIST_FILE);
  const accuracy = loadJSON(ACCURACY_FILE);
  const predictions = loadJSON(PREDICTIONS_FILE);
  
  if (!watchlist) {
    console.log('❌ No watchlist.json found');
    return;
  }

  const artists = watchlist.artists || watchlist;
  const artistList = Array.isArray(artists) ? artists : Object.values(artists);
  const existingNames = new Set(ledger.predictions.map(p => p.artist.toLowerCase()));
  
  let added = 0;
  
  for (const artist of artistList) {
    const name = artist.name || artist.artist;
    if (!name) continue;
    if (existingNames.has(name.toLowerCase())) continue;

    // Get any existing prediction data
    const predData = predictions?.predictions?.find(
      p => p.artist.toLowerCase() === name.toLowerCase()
    );
    
    // Get accuracy tracker data
    const accData = accuracy?.picks?.find(
      p => p.name.toLowerCase() === name.toLowerCase()
    );

    // Get VIP data
    const vipData = getVIPData(name);
    
    // Get any price snapshots
    const vividPrices = getVividPriceData(name);
    const stubhubPrices = getStubhubPriceData(name);

    const entry = {
      artist: name,
      recordedAt: new Date().toISOString(),
      
      // ── Prediction Snapshot ──
      prediction: {
        tier: artist.tier || (vipData ? vipData.tier : null) || (accData ? accData.tier : null),
        score: predData?.score || accData?.vetScore || null,
        verdict: predData?.verdict || null,
        confidence: predData?.confidence || null,
        category: artist.category || null,
        genre: artist.genre || null,
      },
      
      // ── Signals at Prediction Time ──
      signalsAtPrediction: {
        spotify: {
          monthlyListeners: predData?.data?.monthlyListeners || accData?.initialData?.monthlyListeners || null,
          followers: predData?.data?.spotifyFollowers || null,
        },
        social: {
          tiktokFollowers: predData?.data?.tiktokFollowers || null,
          instagramFollowers: predData?.data?.instagramFollowers || null,
          youtubeSubscribers: predData?.data?.youtubeSubscribers || null,
        },
        market: {
          upcomingShows: predData?.data?.upcomingShows || accData?.initialData?.upcomingShows || null,
          avgGetIn: predData?.data?.avgPrice || accData?.initialData?.avgGetIn || null,
          peakGetIn: predData?.data?.peakPrice || null,
          soldOutMentions: predData?.data?.soldOutMentions || accData?.initialData?.soldOutMentions || null,
        },
        patternMatches: predData?.data?.patternMatches?.map(pm => ({
          referenceArtist: pm.referenceArtist,
          similarity: pm.similarity,
          stage: pm.stage,
        })) || [],
        factors: predData?.factors || accData?.initialData?.signals || [],
        warnings: predData?.warnings || [],
      },
      
      // ── VIP Watchlist Data (if confirmed seller) ──
      vipData: vipData ? {
        tier: vipData.tier,
        evidence: vipData.evidence,
        pattern: vipData.pattern,
      } : null,
      
      // ── Initial Price Snapshots ──
      initialPrices: {
        vivid: vividPrices.slice(0, 10),
        stubhub: stubhubPrices.slice(0, 10),
      },
      
      // ── Outcome Tracking ──
      outcome: 'PENDING',
      outcomeReason: null,
      outcomeClassifiedAt: null,
      outcomeChecks: [],
      
      // ── For Autoresearch ──
      // These are the labeled features the optimization loop uses
      features: {
        monthlyListeners: predData?.data?.monthlyListeners || accData?.initialData?.monthlyListeners || 0,
        spotifyFollowers: predData?.data?.spotifyFollowers || 0,
        tiktokFollowers: predData?.data?.tiktokFollowers || 0,
        instagramFollowers: predData?.data?.instagramFollowers || 0,
        youtubeSubscribers: predData?.data?.youtubeSubscribers || 0,
        upcomingShows: predData?.data?.upcomingShows || accData?.initialData?.upcomingShows || 0,
        soldOutMentions: predData?.data?.soldOutMentions || accData?.initialData?.soldOutMentions || 0,
        avgGetIn: predData?.data?.avgPrice || accData?.initialData?.avgGetIn || 0,
        peakGetIn: predData?.data?.peakPrice || 0,
        patternMatchScore: predData?.data?.patternMatches?.[0]?.similarity || 0,
        vipTier: vipData ? ({ S: 3, A: 2, B: 1 }[vipData.tier] || 0) : 0,
        pricePoints: vividPrices.length + stubhubPrices.length,
        predictedTier: ({ S: 4, A: 3, B: 2, C: 1 }[artist.tier] || 0),
        predictedScore: predData?.score || accData?.vetScore || 0,
      },
    };

    ledger.predictions.push(entry);
    existingNames.add(name.toLowerCase());
    added++;
  }

  // Also import confirmed winners that might not be on watchlist
  const confirmedDir = path.join(DATA_DIR, 'confirmed-winners');
  try {
    const winnerFiles = fs.readdirSync(confirmedDir).filter(f => f.endsWith('.json'));
    for (const file of winnerFiles) {
      const winner = loadJSON(path.join(confirmedDir, file));
      if (!winner || !winner.artist) continue;
      if (existingNames.has(winner.artist.toLowerCase())) continue;
      
      ledger.predictions.push({
        artist: winner.artist,
        recordedAt: winner.confirmedDate || new Date().toISOString(),
        prediction: {
          tier: 'S',
          score: null,
          verdict: 'CONFIRMED_WINNER',
          confidence: 'Retrospective',
          category: winner.category,
          genre: null,
        },
        signalsAtPrediction: {
          spotify: { monthlyListeners: winner.metrics?.spotify?.monthlyListeners || null },
          social: {},
          market: {},
          patternMatches: [],
          factors: [],
          warnings: [],
        },
        vipData: null,
        initialPrices: { vivid: [], stubhub: [] },
        outcome: 'BIG_WIN',
        outcomeReason: 'Retrospectively confirmed winner',
        outcomeClassifiedAt: winner.confirmedDate || new Date().toISOString(),
        outcomeChecks: [],
        features: {
          monthlyListeners: winner.metrics?.spotify?.monthlyListeners || 0,
          predictedTier: 4,
          predictedScore: 0,
        },
      });
      existingNames.add(winner.artist.toLowerCase());
      added++;
    }
  } catch {}

  ledger.meta.lastRecordRun = new Date().toISOString();
  ledger.modelStats.totalPredictions = ledger.predictions.length;
  saveJSON(OUTCOMES_FILE, ledger);
  
  console.log(`✅ Recorded ${added} new predictions (${ledger.predictions.length} total in ledger)`);
}

async function check() {
  const ledger = loadLedger();
  if (ledger.predictions.length === 0) {
    console.log('❌ No predictions in ledger. Run "record" first.');
    return;
  }

  let updated = 0;
  let reclassified = 0;

  for (const pred of ledger.predictions) {
    if (pred.outcome === 'BIG_WIN' || pred.outcome === 'MISS') continue; // Final states (unless manual override)
    
    // Collect current market data
    const vividPrices = getVividPriceData(pred.artist);
    const stubhubPrices = getStubhubPriceData(pred.artist);
    const vipData = getVIPData(pred.artist);
    
    const allPrices = [...vividPrices, ...stubhubPrices];
    const getIns = allPrices.map(p => p.getIn).filter(x => x && x > 0);
    const listings = allPrices.map(p => p.listings).filter(x => x && x > 0);
    
    const checkEntry = {
      checkedAt: new Date().toISOString(),
      daysSincePrediction: Math.floor((Date.now() - new Date(pred.recordedAt).getTime()) / (1000 * 60 * 60 * 24)),
      maxGetIn: getIns.length > 0 ? Math.max(...getIns) : 0,
      avgGetIn: getIns.length > 0 ? Math.round(getIns.reduce((a, b) => a + b, 0) / getIns.length) : 0,
      minGetIn: getIns.length > 0 ? Math.min(...getIns) : 0,
      totalListings: listings.length > 0 ? listings.reduce((a, b) => a + b, 0) : 0,
      pricePoints: allPrices.length,
      soldOutVenues: vipData ? Object.values(vipData.evidence || {}).filter(v => v.status && v.status.includes('sold')).length : 0,
      vipTier: vipData?.tier || null,
      venues: allPrices.slice(0, 5).map(p => ({
        venue: p.venue,
        getIn: p.getIn,
        listings: p.listings,
      })),
    };

    pred.outcomeChecks.push(checkEntry);
    updated++;

    // Reclassify
    const prev = pred.outcome;
    const { outcome, reason } = classifyOutcome(pred);
    pred.outcome = outcome;
    pred.outcomeReason = reason;
    if (outcome !== 'PENDING') {
      pred.outcomeClassifiedAt = new Date().toISOString();
    }
    if (prev !== outcome) reclassified++;
  }

  ledger.meta.lastCheckRun = new Date().toISOString();
  saveJSON(OUTCOMES_FILE, ledger);
  
  console.log(`✅ Checked ${updated} predictions, ${reclassified} reclassified`);
}

function evaluate() {
  const ledger = loadLedger();
  const decided = ledger.predictions.filter(p => p.outcome !== 'PENDING');
  
  if (decided.length === 0) {
    console.log('⏳ No predictions have been classified yet. Need more time + market data.');
    return;
  }

  const counts = { BIG_WIN: 0, WIN: 0, NEUTRAL: 0, MISS: 0 };
  const tierAccuracy = {};

  for (const pred of decided) {
    counts[pred.outcome] = (counts[pred.outcome] || 0) + 1;
    
    const tier = pred.prediction?.tier || 'unknown';
    if (!tierAccuracy[tier]) tierAccuracy[tier] = { correct: 0, total: 0 };
    tierAccuracy[tier].total++;
    if (pred.outcome === 'BIG_WIN' || pred.outcome === 'WIN') {
      tierAccuracy[tier].correct++;
    }
  }

  for (const tier of Object.keys(tierAccuracy)) {
    tierAccuracy[tier].pct = Math.round((tierAccuracy[tier].correct / tierAccuracy[tier].total) * 100);
  }

  const totalDecided = decided.length;
  const totalCorrect = counts.BIG_WIN + counts.WIN;
  const accuracy = Math.round((totalCorrect / totalDecided) * 100);
  const pending = ledger.predictions.filter(p => p.outcome === 'PENDING').length;

  ledger.modelStats = {
    totalPredictions: ledger.predictions.length,
    bigWins: counts.BIG_WIN,
    wins: counts.WIN,
    neutrals: counts.NEUTRAL,
    misses: counts.MISS,
    pending,
    accuracy,
    precisionByTier: tierAccuracy,
    lastEvaluated: new Date().toISOString(),
  };

  saveJSON(OUTCOMES_FILE, ledger);

  // Print report
  console.log('\n📊 BLACKBEARD MODEL ACCURACY REPORT');
  console.log('═'.repeat(50));
  console.log(`Total predictions: ${ledger.predictions.length}`);
  console.log(`Decided: ${totalDecided} | Pending: ${pending}`);
  console.log(`\n🎯 Overall accuracy: ${accuracy}% (${totalCorrect}/${totalDecided})`);
  console.log(`   🏆 Big Wins: ${counts.BIG_WIN}`);
  console.log(`   ✅ Wins: ${counts.WIN}`);
  console.log(`   ➖ Neutral: ${counts.NEUTRAL}`);
  console.log(`   ❌ Misses: ${counts.MISS}`);
  console.log(`\n📈 Accuracy by Tier:`);
  for (const [tier, stats] of Object.entries(tierAccuracy).sort((a, b) => b[1].pct - a[1].pct)) {
    console.log(`   ${tier}: ${stats.pct}% (${stats.correct}/${stats.total})`);
  }
  console.log('═'.repeat(50));
}

function exportDataset() {
  const ledger = loadLedger();
  const decided = ledger.predictions.filter(p => p.outcome !== 'PENDING');
  
  if (decided.length === 0) {
    console.log('⏳ No decided predictions to export yet.');
    return;
  }

  // Export format optimized for the autoresearch loop
  const dataset = {
    meta: {
      exportedAt: new Date().toISOString(),
      totalSamples: decided.length,
      currentWeights: ledger.meta.scoringWeights,
      outcomeDistribution: {
        BIG_WIN: decided.filter(p => p.outcome === 'BIG_WIN').length,
        WIN: decided.filter(p => p.outcome === 'WIN').length,
        NEUTRAL: decided.filter(p => p.outcome === 'NEUTRAL').length,
        MISS: decided.filter(p => p.outcome === 'MISS').length,
      },
    },
    
    // Current scoring weights (what the autoresearch loop will modify)
    weights: { ...ledger.meta.scoringWeights },
    
    // Labeled samples: features → outcome
    samples: decided.map(pred => ({
      artist: pred.artist,
      
      // Input features (what the model sees at prediction time)
      features: pred.features || {},
      
      // The prediction the model made
      predictedTier: pred.prediction?.tier,
      predictedScore: pred.prediction?.score,
      
      // Ground truth (what actually happened)
      actualOutcome: pred.outcome,
      outcomeReason: pred.outcomeReason,
      
      // Numeric outcome for regression (BIG_WIN=3, WIN=2, NEUTRAL=1, MISS=0)
      outcomeScore: { BIG_WIN: 3, WIN: 2, NEUTRAL: 1, MISS: 0 }[pred.outcome] || 0,
      
      // Was the prediction correct? (for classification)
      correct: pred.outcome === 'BIG_WIN' || pred.outcome === 'WIN',
      
      // Peak market data observed
      peakGetIn: pred.outcomeChecks?.length > 0 
        ? Math.max(...pred.outcomeChecks.map(c => c.maxGetIn || 0)) 
        : 0,
    })),
    
    // Weight history for tracking optimization progress
    weightHistory: ledger.meta.weightHistory || [],
  };

  saveJSON(EXPORT_FILE, dataset);
  console.log(`✅ Exported ${decided.length} labeled samples to autoresearch-dataset.json`);
  console.log(`   Current weights: ${JSON.stringify(dataset.weights)}`);
  console.log(`   Outcomes: ${JSON.stringify(dataset.meta.outcomeDistribution)}`);
}

function report() {
  const ledger = loadLedger();
  
  console.log('\n🏴‍☠️ BLACKBEARD OUTCOME TRACKER STATUS');
  console.log('═'.repeat(50));
  console.log(`Total predictions tracked: ${ledger.predictions.length}`);
  console.log(`Last record run: ${ledger.meta.lastRecordRun || 'never'}`);
  console.log(`Last check run: ${ledger.meta.lastCheckRun || 'never'}`);
  
  const outcomes = {};
  for (const p of ledger.predictions) {
    outcomes[p.outcome] = (outcomes[p.outcome] || 0) + 1;
  }
  console.log(`\nOutcome distribution:`);
  for (const [k, v] of Object.entries(outcomes)) {
    console.log(`  ${k}: ${v}`);
  }

  // Show recent big wins
  const bigWins = ledger.predictions.filter(p => p.outcome === 'BIG_WIN');
  if (bigWins.length > 0) {
    console.log(`\n🏆 Big Wins (${bigWins.length}):`);
    for (const bw of bigWins.slice(-10)) {
      console.log(`  ${bw.artist} — ${bw.outcomeReason}`);
    }
  }

  // Show top pending by score
  const pending = ledger.predictions
    .filter(p => p.outcome === 'PENDING' && p.prediction?.score)
    .sort((a, b) => (b.prediction.score || 0) - (a.prediction.score || 0));
  
  if (pending.length > 0) {
    console.log(`\n⏳ Top Pending Predictions:`);
    for (const p of pending.slice(0, 10)) {
      const days = Math.floor((Date.now() - new Date(p.recordedAt).getTime()) / (1000 * 60 * 60 * 24));
      console.log(`  ${p.artist} — Tier ${p.prediction.tier}, Score ${p.prediction.score} (${days}d ago)`);
    }
  }
  
  console.log('\n═'.repeat(50));
}

// ─── Main ─────────────────────────────────────────────────────────────────

const command = process.argv[2];

switch (command) {
  case 'record':
    record().catch(console.error);
    break;
  case 'check':
    check().catch(console.error);
    break;
  case 'evaluate':
    evaluate();
    break;
  case 'export':
    exportDataset();
    break;
  case 'report':
    report();
    break;
  default:
    console.log(`
🏴‍☠️ Blackbeard Outcome Tracker — Autoresearch Foundation

Usage:
  node outcome-tracker.js record     Snapshot all watchlist predictions into ledger
  node outcome-tracker.js check      Update outcomes with latest market data
  node outcome-tracker.js evaluate   Score model accuracy
  node outcome-tracker.js export     Export labeled dataset for autoresearch loop
  node outcome-tracker.js report     Status overview
    `);
}
