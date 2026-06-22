/* ============================================================
   WORLD CUP TRACKER — APP LOGIC
   You shouldn't need to edit this file. All the content lives
   in data.js. This file reads data.js and does the maths.
   ============================================================ */

const ROUND_LABELS = {
  Group: "Group stage",
  R32: "Round of 32",
  R16: "Round of 16",
  QF: "Quarter-final",
  SF: "Semi-final",
  "3rd": "3rd place playoff",
  Final: "Final",
};
const STAGE_ORDER = ["R32", "R16", "QF", "SF", "Final"];

// ---------- basic lookups ----------
function teamGroup(team) {
  for (const [letter, teams] of Object.entries(GROUPS)) {
    if (teams.includes(team)) return letter;
  }
  return null;
}
function isRealTeam(code) {
  return Object.values(GROUPS).some((teams) => teams.includes(code));
}

// ---------- group standings ----------
function computeGroupStandings(letter) {
  const teams = GROUPS[letter];
  const table = {};
  teams.forEach((t) => (table[t] = { team: t, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, gd: 0, pts: 0 }));
  const groupMatches = MATCHES.filter((m) => m.group === letter);
  let played = 0;
  groupMatches.forEach((m) => {
    if (!m.score) return;
    played++;
    const [s1, s2] = m.score;
    const r1 = table[m.team1];
    const r2 = table[m.team2];
    r1.p++; r2.p++;
    r1.gf += s1; r1.ga += s2;
    r2.gf += s2; r2.ga += s1;
    if (s1 > s2) { r1.w++; r1.pts += 3; r2.l++; }
    else if (s2 > s1) { r2.w++; r2.pts += 3; r1.l++; }
    else { r1.d++; r2.d++; r1.pts += 1; r2.pts += 1; }
  });
  Object.values(table).forEach((r) => (r.gd = r.gf - r.ga));
  const rows = Object.values(table).sort(
    (a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf || a.team.localeCompare(b.team)
  );
  return { rows, decided: played === groupMatches.length, played, total: groupMatches.length };
}

function getAllStandings() {
  const out = {};
  Object.keys(GROUPS).forEach((letter) => (out[letter] = computeGroupStandings(letter)));
  return out;
}

// ---------- third-place race ----------
function getThirdPlaceRace(standings) {
  const rows = [];
  Object.entries(standings).forEach(([letter, data]) => {
    const row = data.rows[2];
    if (row) rows.push({ ...row, group: letter, groupDecided: data.decided });
  });
  rows.sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf);
  rows.forEach((r, i) => (r.rank = i + 1));
  return rows;
}

// ---------- mathematical clinch / elimination (before a group fully finishes) ----------
// Each team plays 3 group matches total; max possible points assumes they win every
// remaining game. This is the standard "can anyone still catch/be caught" bound used
// by most trackers — it doesn't model goal difference or head-to-head, just points.
function teamMaxPoints(row) {
  return row.pts + 3 * (3 - row.p);
}
function clinchedTop2(team, data) {
  const me = data.rows.find((r) => r.team === team);
  if (!me) return false;
  const threats = data.rows.filter((r) => r.team !== team && teamMaxPoints(r) > me.pts).length;
  return threats <= 1; // at most one rival could still finish above me -> top 2 is safe
}
function guaranteedLast(team, data) {
  const me = data.rows.find((r) => r.team === team);
  if (!me) return false;
  const myMax = teamMaxPoints(me);
  const aheadLocked = data.rows.filter((r) => r.team !== team && r.pts > myMax).length;
  return aheadLocked >= 3; // all 3 rivals already have more points than my ceiling -> guaranteed 4th
}

// ---------- team group-stage status ----------
function getTeamGroupStatus(team, standings, thirdRace, allDecided) {
  const grp = teamGroup(team);
  const data = standings[grp];
  if (!data) return { status: "unknown" };
  const idx = data.rows.findIndex((r) => r.team === team);
  if (!data.decided) {
    if (clinchedTop2(team, data)) return { status: "qualified" };
    if (guaranteedLast(team, data)) return { status: "eliminated" };
    return { status: "playing" };
  }
  if (idx === 0 || idx === 1) return { status: "qualified" };
  if (idx === 3) return { status: "eliminated" };
  // idx === 2 -> sitting third
  if (!allDecided) return { status: "pending" };
  const tr = thirdRace.find((r) => r.team === team);
  return { status: tr && tr.rank <= 8 ? "qualified" : "eliminated" };
}

// ---------- resolve a placeholder code to a team name ----------
function resolveCode(code, standings, resolved) {
  if (!code) return null;
  if (isRealTeam(code)) return code;
  let m = code.match(/^([1-4])([A-L])$/);
  if (m) {
    const pos = parseInt(m[1], 10);
    const grp = standings[m[2]];
    if (!grp || !grp.decided) return null;
    const row = grp.rows[pos - 1];
    return row ? row.team : null;
  }
  m = code.match(/^W(\d+)$/);
  if (m) {
    const prev = resolved[parseInt(m[1], 10)];
    return prev ? prev.winner : null;
  }
  m = code.match(/^L(\d+)$/);
  if (m) {
    const prev = resolved[parseInt(m[1], 10)];
    if (!prev || !prev.winner) return null;
    return prev.team1 === prev.winner ? prev.team2 : prev.team1;
  }
  return null; // unresolved "best third place" pool code, no override yet
}

// ---------- build the fully-resolved knockout bracket ----------
let _bracketCache = null;
function buildBracket(standings) {
  if (_bracketCache) return _bracketCache;
  const resolved = {};
  const koMatches = MATCHES.filter((m) => m.num >= 73).sort((a, b) => a.num - b.num);
  koMatches.forEach((m) => {
    let code1 = m.team1;
    let code2 = m.team2;
    if (ROUND_OF_32_OVERRIDES.hasOwnProperty(m.num)) {
      if (/^3[A-L]/.test(code1)) code1 = ROUND_OF_32_OVERRIDES[m.num];
      if (/^3[A-L]/.test(code2)) code2 = ROUND_OF_32_OVERRIDES[m.num];
    }
    const team1 = resolveCode(code1, standings, resolved);
    const team2 = resolveCode(code2, standings, resolved);
    let winner = null;
    if (m.score && team1 && team2) {
      if (m.wonOnPens) winner = m.wonOnPens === "team1" ? team1 : team2;
      else if (m.score[0] > m.score[1]) winner = team1;
      else if (m.score[1] > m.score[0]) winner = team2;
    }
    resolved[m.num] = { ...m, team1: team1 || code1, team2: team2 || code2, winner, team1Resolved: !!team1, team2Resolved: !!team2 };
  });
  _bracketCache = Object.values(resolved);
  return _bracketCache;
}

// ---------- build scoring context once per render ----------
function buildContext() {
  _bracketCache = null;
  const standings = getAllStandings();
  const allDecided = Object.values(standings).every((s) => s.decided);
  const thirdRace = getThirdPlaceRace(standings);
  const bracket = buildBracket(standings);
  return { standings, allDecided, thirdRace, bracket };
}

// ---------- progress / points for a single team pick ----------
function getTeamProgress(team, ctx) {
  const groupStat = getTeamGroupStatus(team, ctx.standings, ctx.thirdRace, ctx.allDecided);
  if (groupStat.status !== "qualified") {
    const labels = { playing: "Playing — group stage", eliminated: "Out — group stage", pending: "Pending — awaiting 3rd-place race", unknown: "Unknown" };
    return { points: 0, status: groupStat.status, stage: labels[groupStat.status] || "Unknown" };
  }
  let points = CONFIG.pointsPerStage;
  let stage = "Qualified (groups)";
  let status = "qualified";
  for (const round of STAGE_ORDER) {
    const match = ctx.bracket.find((m) => m.round === round && (m.team1 === team || m.team2 === team));
    if (!match) break; // hasn't reached / bracket slot not resolved yet
    if (match.winner == null) {
      stage = `Playing — ${ROUND_LABELS[round]}`;
      break;
    }
    if (match.winner === team) {
      points += CONFIG.pointsPerStage;
      stage = round === "Final" ? "🏆 Champion" : `Won ${ROUND_LABELS[round]}`;
      if (round === "Final") status = "champion";
      continue;
    } else {
      stage = `Out — lost ${ROUND_LABELS[round]}`;
      status = "eliminated-ko";
      break;
    }
  }
  return { points, status, stage };
}

function computeEntrantScore(entrant, ctx) {
  const details = entrant.picks.map((team) => ({ team, ...getTeamProgress(team, ctx) }));
  const total = details.reduce((s, d) => s + d.points, 0);
  const randomDetail = { team: entrant.random, ...getTeamProgress(entrant.random, ctx) };
  return { total, details, randomDetail };
}

// ---------- shared utilities for rendering ----------
function statusClass(status) {
  return { qualified: "st-qualified", champion: "st-qualified", playing: "st-playing", pending: "st-pending", eliminated: "st-eliminated", "eliminated-ko": "st-eliminated" }[status] || "st-playing";
}
function fmtScore(score) {
  return score ? `${score[0]}–${score[1]}` : "vs";
}
function fmtDate(d) {
  const date = new Date(d + "T12:00:00");
  return date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}
