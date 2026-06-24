/* ============================================================
   WIN-ODDS SIMULATOR
   Monte Carlo estimate of each entrant's chance of winning the
   competition, based on a simple Poisson goal model built from
   each team's actual scoring record so far this tournament.
   This is a fun estimate, not a prediction service — sample
   sizes are small early on, so it sharpens up as more games
   are played. Reuses the real scoring engine (resolveCode,
   getTeamGroupStatus, getTeamProgress, computeEntrantScore) so
   the simulated future is judged by the exact same rules as
   the real ladder.
   ============================================================ */

const SIM_COUNT = 3000;

// Bookmaker "to win group" American odds — one-time snapshot, NOT auto-updated.
// Source: FanDuel/DraftKings via Fox Sports and CBS Sports, as of June 24, 2026.
// Re-fetch and replace this table manually as the tournament moves on; it will get stale.
const GROUP_WIN_ODDS = {
  Mexico: -155, "South Korea": 160, Czechia: 1600, "South Africa": 8000,  // Group A settled (Mexico won)
  Switzerland: -125, Canada: 300, "Bosnia & Herzegovina": 720, Qatar: 2500,
  Brazil: -190, Morocco: 155, Scotland: 4000, Haiti: 17500,
  USA: -210, Australia: 310, Turkey: 750, Paraguay: 3000,                   // Group D settled (USA won)
  Germany: -280, "Ivory Coast": 280, Ecuador: 1700, "Curaçao": 50000,      // Group E settled (Germany clinched)
  Netherlands: -380, Japan: 360, Sweden: 2700, Tunisia: 8000,
  Belgium: 240, Egypt: -175, Iran: 650, "New Zealand": 2200,
  Spain: -750, Uruguay: 750, "Cape Verde": 3000, "Saudi Arabia": 1800,
  France: -340, Norway: 290, Senegal: 5000, Iraq: 35000,
  Argentina: -650, Austria: 500, Algeria: 6500, Jordan: 20000,              // Group J settled (Argentina clinched)
  Portugal: 115, Colombia: -110, "DR Congo": 1200, Uzbekistan: 12500,
  England: -1500, Croatia: 4000, Ghana: 1800, Panama: 8000,
};

function americanToProb(odds) {
  return odds < 0 ? -odds / (-odds + 100) : 100 / (odds + 100);
}

// De-vig each group's odds (they sum to >1 due to bookmaker margin) and scale
// so the group average sits at 1.0 — a multiplier above 1 means the market
// rates that team stronger than the average team in its group.
function marketMultipliers() {
  const mult = {};
  Object.entries(GROUPS).forEach(([letter, teams]) => {
    const raw = teams.map((t) => americanToProb(GROUP_WIN_ODDS[t]));
    const sum = raw.reduce((a, b) => a + b, 0);
    teams.forEach((t, i) => (mult[t] = (raw[i] / sum) * teams.length));
  });
  return mult;
}

function poissonRandom(lambda) {
  const L = Math.exp(-lambda);
  let k = 0,
    p = 1;
  do {
    k++;
    p *= Math.random();
  } while (p > L);
  return k - 1;
}

function buildStrengthModel() {
  const stats = {};
  Object.values(GROUPS)
    .flat()
    .forEach((team) => (stats[team] = { gf: 0, ga: 0, played: 0 }));
  let totalGoals = 0,
    totalGames = 0;
  MATCHES.forEach((m) => {
    if (!m.score || m.round !== "Group") return;
    const [s1, s2] = m.score;
    stats[m.team1].gf += s1;
    stats[m.team1].ga += s2;
    stats[m.team1].played++;
    stats[m.team2].gf += s2;
    stats[m.team2].ga += s1;
    stats[m.team2].played++;
    totalGoals += s1 + s2;
    totalGames += 2;
  });
  const leagueAvg = totalGames ? totalGoals / totalGames : 1.3;
  const marketMult = marketMultipliers();
  const strengths = {};
  Object.entries(stats).forEach(([team, s]) => {
    const prior = 3; // pseudo-games of "average" strength blended in, biggest early on
    const weight = s.played / (s.played + prior);
    const attack = s.played ? s.gf / s.played : leagueAvg;
    const defense = s.played ? s.ga / s.played : leagueAvg;
    const formAttack = weight * attack + (1 - weight) * leagueAvg;
    const formDefense = weight * defense + (1 - weight) * leagueAvg;
    // Nudge form-based rates using the bookmaker's group-winner odds — a
    // team the market rates highly scores a bit more / concedes a bit less
    // than its in-tournament numbers alone would suggest, and vice versa.
    // Note: "to win group" odds compound probability across 3 matches, so
    // a 4th-root (not square-root) keeps the per-match adjustment realistic
    // rather than implying absurd single-game blowouts for big underdogs.
    const m = marketMult[team] || 1;
    const adj = Math.pow(Math.min(Math.max(m, 0.05), 6), 0.25);
    strengths[team] = {
      attack: formAttack * adj,
      defense: formDefense / adj,
    };
  });
  return { strengths, leagueAvg };
}

function simScore(teamA, teamB, model) {
  const { strengths, leagueAvg } = model;
  const a = strengths[teamA] || { attack: leagueAvg, defense: leagueAvg };
  const b = strengths[teamB] || { attack: leagueAvg, defense: leagueAvg };
  const clamp = (x) => Math.min(4.5, Math.max(0.2, x));
  const expA = clamp((a.attack / leagueAvg) * (b.defense / leagueAvg) * leagueAvg);
  const expB = clamp((b.attack / leagueAvg) * (a.defense / leagueAvg) * leagueAvg);
  return [poissonRandom(expA), poissonRandom(expB)];
}

function simGroupStandings(letter, simMatches) {
  const teams = GROUPS[letter];
  const table = {};
  teams.forEach((t) => (table[t] = { team: t, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, gd: 0, pts: 0 }));
  simMatches
    .filter((m) => m.group === letter)
    .forEach((m) => {
      const [s1, s2] = m.score;
      const r1 = table[m.team1],
        r2 = table[m.team2];
      r1.p++;
      r2.p++;
      r1.gf += s1;
      r1.ga += s2;
      r2.gf += s2;
      r2.ga += s1;
      if (s1 > s2) {
        r1.w++;
        r1.pts += 3;
        r2.l++;
      } else if (s2 > s1) {
        r2.w++;
        r2.pts += 3;
        r1.l++;
      } else {
        r1.d++;
        r2.d++;
        r1.pts += 1;
        r2.pts += 1;
      }
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

function simKnockout(standings, top8Teams, model) {
  // Note: which exact third-place team lands in which bracket slot is governed by a
  // fixed FIFA permutation table we don't replicate here — we just assign the 8
  // qualifiers to the open slots in a deterministic order. This doesn't bias which
  // *entrant* tends to win, just glosses over the precise placement.
  const overrides = {};
  const poolNums = MATCHES.filter((m) => m.num >= 73 && (/^3[A-L]/.test(m.team1) || /^3[A-L]/.test(m.team2)))
    .map((m) => m.num)
    .sort((a, b) => a - b);
  poolNums.forEach((num, i) => (overrides[num] = top8Teams[i]));

  const resolved = {};
  const koMatches = MATCHES.filter((m) => m.num >= 73).sort((a, b) => a.num - b.num);
  koMatches.forEach((m) => {
    let code1 = m.team1,
      code2 = m.team2;
    if (overrides.hasOwnProperty(m.num)) {
      if (/^3[A-L]/.test(code1)) code1 = overrides[m.num];
      if (/^3[A-L]/.test(code2)) code2 = overrides[m.num];
    }
    const team1 = resolveCode(code1, standings, resolved);
    const team2 = resolveCode(code2, standings, resolved);
    let score = m.score,
      wonOnPens = m.wonOnPens,
      winner = null;
    if (!score && team1 && team2) {
      score = simScore(team1, team2, model);
      if (score[0] === score[1]) wonOnPens = Math.random() < 0.5 ? "team1" : "team2";
    }
    if (score && team1 && team2) {
      if (wonOnPens) winner = wonOnPens === "team1" ? team1 : team2;
      else if (score[0] > score[1]) winner = team1;
      else if (score[1] > score[0]) winner = team2;
    }
    resolved[m.num] = { ...m, team1: team1 || code1, team2: team2 || code2, score, wonOnPens, winner };
  });
  return Object.values(resolved);
}

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
  const mainWins = {};
  ENTRANTS.forEach((e) => (mainWins[e.name] = 0));
  const randomWins = {};
  ENTRANTS.forEach((e) => (randomWins[e.name] = 0));
  let cutoffPtsSum = 0,
    cutoffGdSum = 0;

  for (let i = 0; i < SIM_COUNT; i++) {
    const ctx = runOneSimulation(model);
    const eighth = ctx.thirdRace[7]; // rank 8 -> index 7, the qualification cutoff line
    if (eighth) {
      cutoffPtsSum += eighth.pts;
      cutoffGdSum += eighth.gd;
    }
    let bestMain = -1,
      bestMainNames = [];
    let bestRandom = -1,
      bestRandomNames = [];
    ENTRANTS.forEach((e) => {
      const score = computeEntrantScore(e, ctx);
      if (score.total > bestMain) {
        bestMain = score.total;
        bestMainNames = [e.name];
      } else if (score.total === bestMain) bestMainNames.push(e.name);
      const rp = score.randomDetail.points;
      if (rp > bestRandom) {
        bestRandom = rp;
        bestRandomNames = [e.name];
      } else if (rp === bestRandom) bestRandomNames.push(e.name);
    });
    bestMainNames.forEach((n) => (mainWins[n] += 1 / bestMainNames.length));
    bestRandomNames.forEach((n) => (randomWins[n] += 1 / bestRandomNames.length));
  }

  const mainOdds = {},
    randomOdds = {};
  ENTRANTS.forEach((e) => {
    mainOdds[e.name] = mainWins[e.name] / SIM_COUNT;
    randomOdds[e.name] = randomWins[e.name] / SIM_COUNT;
  });
  return {
    mainOdds,
    randomOdds,
    expectedThirdCutoff: { pts: cutoffPtsSum / SIM_COUNT, gd: cutoffGdSum / SIM_COUNT },
  };
}
