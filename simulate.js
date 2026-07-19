/* ============================================================
   WIN-ODDS SIMULATOR  (knockout-stage edition)
   Monte Carlo estimate of each entrant's chance of winning the
   competition, based on a Poisson goal model built from each
   team's group-stage record, calibrated by two layers of
   bookmaker data:

   1. OUTRIGHT_WIN_ODDS — "to win the World Cup" — sets the
      long-range strength of every team via a de-vigged market
      multiplier on their Poisson attack/defence rates. Update
      this table after each round as new odds are published.

   2. NEXT_ROUND_ODDS  — head-to-head "to advance" lines for the
      CURRENT round's specific fixtures. This is a much stronger
      signal than outright odds for the very next match: the
      market already knows the matchup, recent form, injuries,
      and venue. Both sides of each fixture are stored so the
      model can de-vig properly, then binary-search for the
      exact Poisson lambda scaling factor k that makes
        P(team A advances | λA·k, λB/k) = market implied prob.
      Once a round is complete, clear this table and fill it
      with the next round's lines.
      IMPORTANT: keys must exactly match the team names in
      data.json (GROUPS / MATCHES). Lookup checks both orderings
      so key order doesn't matter.

   Reuses the real scoring engine (resolveCode, getTeamGroup-
   Status, getTeamProgress, computeEntrantScore) so the
   simulated future is judged by the exact same rules as the
   real ladder.
   ============================================================ */

const SIM_COUNT = 3000;

/* ── 1. OUTRIGHT WIN ODDS ──────────────────────────────────────
   DraftKings, July 19 2026 — pre-kickoff, final field set.
   Line unchanged since Jul 17: Spain -164, Argentina +134 to
   lift the Cup. Final is Spain vs Argentina, Jul 19, East
   Rutherford. Eliminated teams → 250000 (board floor).        */
const OUTRIGHT_WIN_ODDS = {
  France: 250000, Spain: -164, Argentina: 134,
  England: 250000, Norway: 250000, Morocco: 250000,
  Belgium: 250000, Switzerland: 250000,
  // Eliminated in group stage
  "Curaçao": 250000, Czechia: 250000, Haiti: 250000, Iraq: 250000,
  Jordan: 250000, "New Zealand": 250000, Panama: 250000, Qatar: 250000,
  "Saudi Arabia": 250000, Scotland: 250000,
  "South Korea": 250000, Tunisia: 250000, Turkey: 250000, Uruguay: 250000,
  Iran: 250000, Uzbekistan: 250000,
  // Eliminated in R32
  Germany: 250000, Japan: 250000, Netherlands: 250000, "South Africa": 250000,
  "Ivory Coast": 250000, Sweden: 250000, Ecuador: 250000,
  "Bosnia & Herzegovina": 250000, "DR Congo": 250000, Senegal: 250000,
  Croatia: 250000, Austria: 250000, Algeria: 250000,
  "Cape Verde": 250000, Ghana: 250000, Australia: 250000,
  // Eliminated in R16
  Paraguay: 250000, Canada: 250000, Brazil: 250000,
  Mexico: 250000, Portugal: 250000, USA: 250000,
  Egypt: 250000, Colombia: 250000,
};

/* ── 2. NEXT ROUND ODDS ────────────────────────────────────────
   Final "to win the Cup" line — DraftKings, July 19 2026 (pre-kickoff).
   Key: "team1|team2"  (either order — lookup handles both).
   Value: [team1_odds, team2_odds].
   Both semifinals complete: Spain beat France 2-0 (Jul 14) and
   Argentina beat England 2-1 (Jul 15). Final kicks off Jul 19
   in East Rutherford.                                           */
const NEXT_ROUND_ODDS = {
  // Jul 19 — East Rutherford
  "Spain|Argentina":            [-164, 134],
};

/* ── PROBABILITY UTILITIES ────────────────────────────────────── */

function americanToProb(odds) {
  return odds < 0 ? -odds / (-odds + 100) : 100 / (odds + 100);
}

// De-vig a two-sided market; return P(team1 advances).
function deVigProb(odds1, odds2) {
  const r1 = americanToProb(odds1);
  const r2 = americanToProb(odds2);
  return r1 / (r1 + r2);
}

// Look up NEXT_ROUND_ODDS for a specific pairing.
// Returns the de-vigged P(teamA advances), or null if no entry exists.
// Handles both key orderings so callers don't have to worry about order.
function matchupAdvanceProb(teamA, teamB) {
  const keyAB = `${teamA}|${teamB}`;
  const keyBA = `${teamB}|${teamA}`;
  if (NEXT_ROUND_ODDS.hasOwnProperty(keyAB)) {
    const [o1, o2] = NEXT_ROUND_ODDS[keyAB];
    return deVigProb(o1, o2);   // team1 in key = teamA
  }
  if (NEXT_ROUND_ODDS.hasOwnProperty(keyBA)) {
    const [o1, o2] = NEXT_ROUND_ODDS[keyBA];
    return deVigProb(o2, o1);   // team1 in key = teamB, so flip
  }
  return null;
}

// P(Poisson(lambda) = k) — computed in log-space for stability.
function poissonPMF(lambda, k) {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  let lp = -lambda + k * Math.log(lambda);
  for (let i = 1; i <= k; i++) lp -= Math.log(i);
  return Math.exp(lp);
}

// Analytical P(teamA advances | Poisson(expA) vs Poisson(expB)).
// "Advances" = scores more in regulation, OR draws → 50/50 in extra time/pens.
// Truncated at MAX goals (> 99.9% of mass for typical lambdas ≤ 4.5).
function poissonAdvanceProb(expA, expB) {
  const MAX = 9;
  let pWin = 0, pDraw = 0;
  for (let i = 0; i <= MAX; i++) {
    const pA = poissonPMF(expA, i);
    for (let j = 0; j <= MAX; j++) {
      const pB = poissonPMF(expB, j);
      if (i > j) pWin += pA * pB;
      else if (i === j) pDraw += pA * pB;
    }
  }
  return pWin + 0.5 * pDraw;
}

// Binary-search for scale k such that:
//   poissonAdvanceProb(expA * k, expB / k) ≈ targetP
// k > 1 → teamA stronger relative to model; k < 1 → weaker.
function calibrateK(expA, expB, targetP) {
  let lo = 0.01, hi = 100;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    poissonAdvanceProb(expA * mid, expB / mid) < targetP
      ? (lo = mid)
      : (hi = mid);
  }
  return (lo + hi) / 2;
}

/* ── MARKET STRENGTH MODEL ───────────────────────────────────── */

// De-vig OUTRIGHT_WIN_ODDS across all 48 teams, then scale so the
// average team sits at a multiplier of 1.0. Used to adjust Poisson
// attack/defence rates proportionally.
function marketMultipliers() {
  const teams = Object.keys(OUTRIGHT_WIN_ODDS);
  const raw = {};
  let sum = 0;
  teams.forEach((t) => { raw[t] = americanToProb(OUTRIGHT_WIN_ODDS[t]); sum += raw[t]; });
  const mult = {};
  teams.forEach((t) => { mult[t] = (raw[t] / sum) * teams.length; });
  return mult;
}

function buildStrengthModel() {
  const stats = {};
  Object.values(GROUPS).flat()
    .forEach((team) => (stats[team] = { gf: 0, ga: 0, played: 0 }));
  let totalGoals = 0, totalGames = 0;
  MATCHES.forEach((m) => {
    if (!m.score || m.round !== "Group") return;
    const [s1, s2] = m.score;
    stats[m.team1].gf += s1; stats[m.team1].ga += s2; stats[m.team1].played++;
    stats[m.team2].gf += s2; stats[m.team2].ga += s1; stats[m.team2].played++;
    totalGoals += s1 + s2; totalGames += 2;
  });
  const leagueAvg = totalGames ? totalGoals / totalGames : 1.3;
  const marketMult = marketMultipliers();
  const strengths = {};
  Object.entries(stats).forEach(([team, s]) => {
    const prior = 3; // pseudo-games of average strength blended in
    const weight = s.played / (s.played + prior);
    const attack  = s.played ? s.gf / s.played : leagueAvg;
    const defense = s.played ? s.ga / s.played : leagueAvg;
    const formAttack  = weight * attack  + (1 - weight) * leagueAvg;
    const formDefense = weight * defense + (1 - weight) * leagueAvg;
    // Outright odds span up to 5 remaining matches (R32→final).
    // Use 5th-root so the per-match multiplier stays realistic.
    // NEXT_ROUND_ODDS then overrides the immediate next match
    // independently via calibrateK, so this is purely a "beyond
    // next round" signal.
    const m = marketMult[team] || 1;
    const adj = Math.pow(Math.min(Math.max(m, 0.05), 6), 0.20);
    strengths[team] = { attack: formAttack * adj, defense: formDefense / adj };
  });
  return { strengths, leagueAvg };
}

/* ── MATCH SIMULATION ────────────────────────────────────────── */

function poissonRandom(lambda) {
  const L = Math.exp(-lambda);
  let k = 0, p = 1;
  do { k++; p *= Math.random(); } while (p > L);
  return k - 1;
}

// Simulate a single match score.
// If NEXT_ROUND_ODDS has an entry for this specific pairing, the Poisson
// lambdas are scaled so the model's advance probability exactly matches
// the market. For all other matches the base strength model drives things.
function simScore(teamA, teamB, model) {
  const { strengths, leagueAvg } = model;
  const a = strengths[teamA] || { attack: leagueAvg, defense: leagueAvg };
  const b = strengths[teamB] || { attack: leagueAvg, defense: leagueAvg };
  const clamp = (x) => Math.min(4.5, Math.max(0.2, x));
  let expA = clamp((a.attack / leagueAvg) * (b.defense / leagueAvg) * leagueAvg);
  let expB = clamp((b.attack / leagueAvg) * (a.defense / leagueAvg) * leagueAvg);

  // Market-calibrate if we have a head-to-head line for this matchup.
  const targetP = matchupAdvanceProb(teamA, teamB);
  if (targetP !== null) {
    const k = calibrateK(expA, expB, targetP);
    expA *= k;
    expB /= k;
  }

  return [poissonRandom(expA), poissonRandom(expB)];
}

/* ── GROUP STAGE SIMULATION ──────────────────────────────────── */

function simGroupStandings(letter, simMatches) {
  const teams = GROUPS[letter];
  const table = {};
  teams.forEach((t) => (table[t] = { team: t, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, gd: 0, pts: 0 }));
  simMatches
    .filter((m) => m.group === letter)
    .forEach((m) => {
      const [s1, s2] = m.score;
      const r1 = table[m.team1], r2 = table[m.team2];
      r1.p++; r2.p++;
      r1.gf += s1; r1.ga += s2;
      r2.gf += s2; r2.ga += s1;
      if (s1 > s2)      { r1.w++; r1.pts += 3; r2.l++; }
      else if (s2 > s1) { r2.w++; r2.pts += 3; r1.l++; }
      else              { r1.d++; r2.d++; r1.pts++; r2.pts++; }
    });
  Object.values(table).forEach((r) => (r.gd = r.gf - r.ga));
  const rows = Object.values(table).sort(
    (a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf || Math.random() - 0.5
  );
  return { rows, decided: true };
}

function simThirdPlaceRace(standings) {
  const rows = [];
  Object.entries(standings).forEach(([letter, data]) => {
    rows.push({ ...data.rows[2], group: letter });
  });
  rows.sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf || Math.random() - 0.5);
  rows.forEach((r, i) => (r.rank = i + 1));
  return rows;
}

/* ── KNOCKOUT SIMULATION ─────────────────────────────────────── */

function simKnockout(standings, top8Teams, model) {
  // Note: which exact third-place team lands in which bracket slot is governed
  // by a fixed FIFA permutation table we don't replicate here — we assign the
  // 8 qualifiers to the open slots in a deterministic order.
  const teamsPool = [...top8Teams];
  const resolved = {};
  const koMatches = MATCHES.filter((m) => m.num >= 73).sort((a, b) => a.num - b.num);
  koMatches.forEach((m) => {
    let code1 = m.team1, code2 = m.team2;
    if (/^3[A-L]/.test(code1)) code1 = teamsPool.shift() || code1;
    if (/^3[A-L]/.test(code2)) code2 = teamsPool.shift() || code2;
    const team1 = resolveCode(code1, standings, resolved);
    const team2 = resolveCode(code2, standings, resolved);
    let score = m.score, wonOnPens = m.wonOnPens, winner = null;
    if (!score && team1 && team2) {
      score = simScore(team1, team2, model);
      if (score[0] === score[1]) wonOnPens = Math.random() < 0.5 ? "team1" : "team2";
    }
    if (score && team1 && team2) {
      if (wonOnPens)            winner = wonOnPens === "team1" ? team1 : team2;
      else if (score[0] > score[1]) winner = team1;
      else if (score[1] > score[0]) winner = team2;
    }
    resolved[m.num] = { ...m, team1: team1 || code1, team2: team2 || code2, score, wonOnPens, winner };
  });
  return Object.values(resolved);
}

/* ── TOP-LEVEL SIMULATION RUNNER ─────────────────────────────── */

function runOneSimulation(model) {
  const simGroupMatches = MATCHES.filter((m) => m.round === "Group").map((m) => {
    if (m.score) return m;
    return { ...m, score: simScore(m.team1, m.team2, model) };
  });
  const standings = {};
  Object.keys(GROUPS).forEach((letter) => (standings[letter] = simGroupStandings(letter, simGroupMatches)));
  const thirdRace = simThirdPlaceRace(standings);
  const top8 = thirdRace.slice(0, 8).map((r) => r.team);
  const bracket = simKnockout(standings, top8, model);
  return { standings, thirdRace, allDecided: true, bracket };
}

function computeWinOdds() {
  const model = buildStrengthModel();
  const mainWins = {}, randomWins = {};
  ENTRANTS.forEach((e) => { mainWins[e.name] = 0; randomWins[e.name] = 0; });
  let cutoffPtsSum = 0, cutoffGdSum = 0;

  for (let i = 0; i < SIM_COUNT; i++) {
    const ctx = runOneSimulation(model);
    const eighth = ctx.thirdRace[7];
    if (eighth) { cutoffPtsSum += eighth.pts; cutoffGdSum += eighth.gd; }

    let bestMain = -1, bestMainNames = [];
    let bestRandom = -1, bestRandomNames = [];
    ENTRANTS.forEach((e) => {
      const score = computeEntrantScore(e, ctx);
      if (score.total > bestMain)        { bestMain = score.total; bestMainNames = [e.name]; }
      else if (score.total === bestMain)   bestMainNames.push(e.name);
      const rp = score.randomDetail.points;
      if (rp > bestRandom)               { bestRandom = rp; bestRandomNames = [e.name]; }
      else if (rp === bestRandom)          bestRandomNames.push(e.name);
    });
    bestMainNames.forEach((n) => (mainWins[n] += 1 / bestMainNames.length));
    bestRandomNames.forEach((n) => (randomWins[n] += 1 / bestRandomNames.length));
  }

  const mainOdds = {}, randomOdds = {};
  ENTRANTS.forEach((e) => {
    mainOdds[e.name]   = mainWins[e.name]   / SIM_COUNT;
    randomOdds[e.name] = randomWins[e.name] / SIM_COUNT;
  });
  return {
    mainOdds,
    randomOdds,
    expectedThirdCutoff: { pts: cutoffPtsSum / SIM_COUNT, gd: cutoffGdSum / SIM_COUNT },
  };
}
