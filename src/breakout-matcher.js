#!/usr/bin/env node
/**
 * Blackbeard 🏴‍☠️ — Breakout Pattern Matcher
 * 
 * Compares emerging artists against a database of confirmed breakouts
 * (Chappell Roan, Zach Bryan, Noah Kahan, etc.) to find artists
 * following similar trajectories.
 * 
 * "This artist has metrics similar to what Chappell Roan had
 *  6 months before she exploded."
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const REFERENCE_DB = path.join(DATA_DIR, 'breakout-reference-db.json');

// ---- Load reference database ----

function loadReferenceDB() {
  try {
    const data = JSON.parse(fs.readFileSync(REFERENCE_DB, 'utf8'));
    return Array.isArray(data) ? data : data.artists || [];
  } catch (e) {
    console.log('  ⚠️ No breakout reference database found. Run breakout-research first.');
    return [];
  }
}

function loadRisingStars() {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'docs', 'data', 'rising-stars.json'), 'utf8'));
  } catch (e) { return { artists: [] }; }
}

function loadVelocity() {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'velocity-snapshots.json'), 'utf8'));
  } catch (e) { return {}; }
}

// ---- Breakout Stage Definitions ----
// Each confirmed breakout has stages. We compare current artists to these stages.

const BREAKOUT_STAGES = {
  // Approximate metrics at each stage (normalized ranges)
  PRE_BREAKOUT: {
    label: '12-6 months before breakout',
    monthlyListeners: [100000, 2000000],   // 100K - 2M
    venueSize: [200, 1500],                 // clubs
    festivalTier: 'small print / not booked',
  },
  EARLY_BREAKOUT: {
    label: '6-3 months before breakout',
    monthlyListeners: [1000000, 8000000],   // 1M - 8M
    venueSize: [1000, 5000],                // theaters
    festivalTier: 'mid-tier',
  },
  MID_BREAKOUT: {
    label: '3-1 months before breakout',
    monthlyListeners: [5000000, 25000000],  // 5M - 25M
    venueSize: [3000, 10000],               // amphitheaters
    festivalTier: 'upper mid / sub-headliner',
  },
  PEAK_BREAKOUT: {
    label: 'breakout moment',
    monthlyListeners: [15000000, 100000000], // 15M+
    venueSize: [8000, 50000],                // arenas/stadiums
    festivalTier: 'headliner',
  },
};

// ---- Pattern Matching ----

/**
 * Compare a candidate artist against all reference breakouts.
 * Returns similarity scores and the closest match with stage.
 */
function matchBreakoutPattern(artist, referenceDB, velocityData) {
  const matches = [];
  
  const ml = artist.monthlyListeners || 0;
  const spFollowers = artist.spotifyFollowers || 0;
  const ttFollowers = artist.tiktokFollowers || 0;
  const igFollowers = artist.instagramFollowers || 0;
  const ytSubs = artist.youtubeSubscribers || 0;
  const soldOut = artist.soldOutMentions || 0;
  const velocity = velocityData?.[artist.name]?.velocity;
  
  for (const ref of referenceDB) {
    if (!ref.timeline) continue;
    
    const stages = [
      { key: 'preBreakout', stage: 'PRE_BREAKOUT', label: `${ref.name} 12-6mo before breakout` },
      { key: 'earlyBreakout', stage: 'EARLY_BREAKOUT', label: `${ref.name} 6-3mo before breakout` },
      { key: 'midBreakout', stage: 'MID_BREAKOUT', label: `${ref.name} 3-1mo before breakout` },
      { key: 'peakBreakout', stage: 'PEAK_BREAKOUT', label: `${ref.name} at peak breakout` },
    ];
    
    for (const { key, stage, label } of stages) {
      const refData = ref.timeline[key];
      if (!refData || !refData.monthlyListeners) continue;
      
      // Calculate similarity score (0-100)
      let similarity = 0;
      let matchedDimensions = 0;
      let totalDimensions = 0;
      const reasons = [];
      
      // Monthly listeners comparison (most important)
      if (ml > 0 && refData.monthlyListeners > 0) {
        totalDimensions++;
        const ratio = ml / refData.monthlyListeners;
        // Perfect match = 1.0, within 2x = good, within 5x = okay
        if (ratio >= 0.5 && ratio <= 2.0) {
          const closeness = 1 - Math.abs(Math.log2(ratio));
          similarity += 35 * Math.max(0, closeness);
          matchedDimensions++;
          reasons.push(`listeners ${(ml/1e6).toFixed(1)}M vs ${(refData.monthlyListeners/1e6).toFixed(1)}M`);
        } else if (ratio >= 0.2 && ratio <= 5.0) {
          similarity += 15;
          reasons.push(`listeners in range (${(ml/1e6).toFixed(1)}M vs ${(refData.monthlyListeners/1e6).toFixed(1)}M)`);
        }
      }
      
      // Spotify followers comparison
      if (spFollowers > 0 && refData.spotifyFollowers) {
        totalDimensions++;
        const ratio = spFollowers / refData.spotifyFollowers;
        if (ratio >= 0.5 && ratio <= 2.0) {
          similarity += 15;
          matchedDimensions++;
          reasons.push(`Spotify followers aligned`);
        }
      }
      
      // Social reach comparison (TikTok + Instagram combined)
      const candidateSocial = (ttFollowers || 0) + (igFollowers || 0);
      const refSocial = (refData.tiktokFollowers || 0) + (refData.instagramFollowers || 0);
      if (candidateSocial > 0 && refSocial > 0) {
        totalDimensions++;
        const ratio = candidateSocial / refSocial;
        if (ratio >= 0.3 && ratio <= 3.0) {
          similarity += 15;
          matchedDimensions++;
          reasons.push(`social reach comparable`);
        }
      }
      
      // Venue size comparison
      if (artist.avgVenueCapacity && refData.venueSize) {
        totalDimensions++;
        const refVenue = typeof refData.venueSize === 'number' ? refData.venueSize :
          (typeof refData.venueSize === 'string' ? parseInt(refData.venueSize.match(/\d+/)?.[0] || '0') : 0);
        if (refVenue > 0) {
          const ratio = artist.avgVenueCapacity / refVenue;
          if (ratio >= 0.5 && ratio <= 2.0) {
            similarity += 15;
            matchedDimensions++;
            reasons.push(`venue size similar (${artist.avgVenueCapacity} vs ${refVenue} cap)`);
          }
        }
      }
      
      // Sold-out signal comparison
      if (soldOut > 0) {
        similarity += Math.min(10, soldOut * 2);
        reasons.push(`${soldOut} sold-out signals`);
      }
      
      // Velocity bonus (growing at same rate as reference pre-breakout)
      if (velocity?.overallVelocity && velocity.overallVelocity > 20) {
        similarity += 10;
        reasons.push(`velocity ${velocity.overallVelocity.toFixed(0)}% — growth trajectory active`);
      }
      
      // Genre match bonus
      if (artist.genre && ref.genre) {
        const aGenre = (artist.genre || '').toLowerCase();
        const rGenre = (ref.genre || '').toLowerCase();
        if (aGenre.includes(rGenre) || rGenre.includes(aGenre) || aGenre === rGenre) {
          similarity += 5;
          reasons.push(`same genre (${ref.genre})`);
        }
      }
      
      // Only include if meaningful similarity
      if (similarity >= 25 && matchedDimensions >= 1) {
        matches.push({
          referenceArtist: ref.name,
          referenceGenre: ref.genre,
          breakoutYear: ref.breakoutYear,
          stage,
          stageLabel: label,
          similarity: Math.min(100, Math.round(similarity)),
          matchedDimensions,
          totalDimensions,
          reasons,
          prediction: getPredictionFromStage(stage, ref),
        });
      }
    }
  }
  
  // Sort by similarity descending
  matches.sort((a, b) => b.similarity - a.similarity);
  
  return matches;
}

function getPredictionFromStage(stage, ref) {
  switch (stage) {
    case 'PRE_BREAKOUT':
      return `If following ${ref.name}'s path, sellouts likely in 6-12 months. ${ref.name} went from this stage to selling out ${ref.firstSoldOutTour?.venueSize || 'theaters'} within a year.`;
    case 'EARLY_BREAKOUT':
      return `Tracking ${ref.name}'s early breakout pattern. ${ref.name} was selling out theaters 3-6 months after this stage. This is the BUY window.`;
    case 'MID_BREAKOUT':
      return `Very close to ${ref.name}'s mid-breakout metrics. ${ref.name} was headlining amphitheaters within months. Sellouts are imminent.`;
    case 'PEAK_BREAKOUT':
      return `Already at ${ref.name}'s breakout level. Should be selling out venues at or above this tier.`;
    default:
      return '';
  }
}

// ---- Score contribution for predictor ----

function getPatternMatchScore(artistName, artistData) {
  const referenceDB = loadReferenceDB();
  const velocityData = loadVelocity();
  
  if (referenceDB.length === 0) return { score: 0, factors: [], matches: [] };
  
  const matches = matchBreakoutPattern(artistData, referenceDB, velocityData);
  
  let score = 0;
  const factors = [];
  
  if (matches.length === 0) return { score: 0, factors: [], matches: [] };
  
  const best = matches[0];
  
  // Early stage matches are MORE valuable (catching it early = more money)
  if (best.stage === 'PRE_BREAKOUT' && best.similarity >= 50) {
    score += 20;
    factors.push(`🔮 Matches ${best.referenceArtist}'s pre-breakout pattern (${best.similarity}% similar) — BIG upside if trajectory holds`);
  } else if (best.stage === 'EARLY_BREAKOUT' && best.similarity >= 40) {
    score += 18;
    factors.push(`⚡ Similar to ${best.referenceArtist} 6mo before breakout (${best.similarity}% match) — window closing`);
  } else if (best.stage === 'MID_BREAKOUT' && best.similarity >= 40) {
    score += 15;
    factors.push(`🎯 Tracking ${best.referenceArtist}'s mid-breakout (${best.similarity}% match) — sellouts imminent`);
  } else if (best.stage === 'PEAK_BREAKOUT' && best.similarity >= 40) {
    score += 10;
    factors.push(`Already at ${best.referenceArtist}'s peak level (${best.similarity}% match)`);
  } else if (best.similarity >= 30) {
    score += 5;
    factors.push(`Some similarity to ${best.referenceArtist}'s ${best.stage.replace('_', ' ').toLowerCase()} (${best.similarity}%)`);
  }
  
  // Multiple strong matches = pattern is real
  const strongMatches = matches.filter(m => m.similarity >= 40);
  if (strongMatches.length >= 3) {
    score += 5;
    const names = [...new Set(strongMatches.slice(0, 3).map(m => m.referenceArtist))].join(', ');
    factors.push(`Matches multiple breakout patterns: ${names}`);
  }
  
  // Add prediction text from best match
  if (best.prediction) {
    factors.push(best.prediction);
  }
  
  return { score: Math.min(score, 25), factors, matches: matches.slice(0, 5) };
}

// ---- Format for Discord ----

function formatMatchReport(artistName, matches) {
  if (matches.length === 0) return `No breakout pattern matches found for **${artistName}**.`;
  
  let msg = `🔮 **BREAKOUT PATTERN MATCH: ${artistName}** 🏴‍☠️\n\n`;
  
  for (const m of matches.slice(0, 3)) {
    msg += `**${m.similarity}% match → ${m.stageLabel}**\n`;
    for (const r of m.reasons) msg += `  • ${r}\n`;
    if (m.prediction) msg += `  📊 _${m.prediction}_\n`;
    msg += '\n';
  }
  
  return msg;
}

module.exports = { matchBreakoutPattern, getPatternMatchScore, formatMatchReport, loadReferenceDB };

// CLI
if (require.main === module) {
  const rs = loadRisingStars();
  const referenceDB = loadReferenceDB();
  const velocityData = loadVelocity();
  
  if (referenceDB.length === 0) {
    console.log('No reference database found. Build it first.');
    process.exit(1);
  }
  
  console.log(`🔮 Breakout Pattern Matcher — ${referenceDB.length} references loaded\n`);
  
  // Run against all rising stars
  const results = [];
  for (const artist of (rs.artists || []).slice(0, 50)) {
    const matches = matchBreakoutPattern(artist, referenceDB, velocityData);
    if (matches.length > 0 && matches[0].similarity >= 35) {
      results.push({ artist: artist.name, topMatch: matches[0] });
    }
  }
  
  results.sort((a, b) => b.topMatch.similarity - a.topMatch.similarity);
  
  console.log(`Found ${results.length} artists with breakout pattern matches:\n`);
  for (const r of results.slice(0, 20)) {
    console.log(`${r.topMatch.similarity}% | ${r.artist.padEnd(25)} → ${r.topMatch.stageLabel}`);
  }
}
