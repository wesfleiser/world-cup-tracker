/* ============================================================
   WORLD CUP TRACKER — RENDERING
   ============================================================ */

function pickChip(detail) {
  const cls = statusClass(detail.status);
  return `<span class="chip ${cls}" title="${detail.stage}">${detail.team}<b>${detail.points}</b></span>`;
}

// ---------------- HEADER ----------------
function renderHeader() {
  document.getElementById("siteTitle").textContent = CONFIG.title;
  document.getElementById("siteSubtitle").textContent = CONFIG.subtitle;
  document.getElementById("lastUpdated").textContent = fmtDate(CONFIG.lastUpdated);
  document.getElementById("prizeMain").textContent = `$${CONFIG.prizes.main}`;
  document.getElementById("prizeRandom").textContent = `$${CONFIG.prizes.random}`;
}

// ---------------- LADDER ----------------
function renderLadder(ctx) {
  const scored = ENTRANTS.map((e) => ({ entrant: e, ...computeEntrantScore(e, ctx) }));
  const { mainOdds, randomOdds } = computeWinOdds();
  const fmtOdds = (p) => (p * 100 < 0.1 && p > 0 ? "<0.1%" : (p * 100).toFixed(1) + "%");

  const mainSorted = [...scored].sort((a, b) => b.total - a.total);
  const mainRows = mainSorted
    .map(
      (s, i) => `
    <tr>
      <td class="rank">${i + 1}</td>
      <td class="entrant-cell">
        <div class="entrant-name">${s.entrant.name} ${s.entrant.paid ? '<span class="paid-tick" title="Paid">✓</span>' : '<span class="paid-tick unpaid" title="Not paid">○</span>'}</div>
        <div class="chips">${s.details.map(pickChip).join("")}</div>
      </td>
      <td class="win-pct">${fmtOdds(mainOdds[s.entrant.name])}</td>
      <td class="pts">${s.total}</td>
    </tr>`
    )
    .join("");
  document.getElementById("ladderBody").innerHTML = mainRows;

  const randSorted = [...scored].sort((a, b) => b.randomDetail.points - a.randomDetail.points);
  const randRows = randSorted
    .map(
      (s, i) => `
    <tr>
      <td class="rank">${i + 1}</td>
      <td class="entrant-cell">
        <div class="entrant-name">${s.entrant.name}</div>
        <div class="chips">${pickChip(s.randomDetail)}</div>
      </td>
      <td class="win-pct">${fmtOdds(randomOdds[s.entrant.name])}</td>
      <td class="pts">${s.randomDetail.points}</td>
    </tr>`
    )
    .join("");
  document.getElementById("randomLadderBody").innerHTML = randRows;
}

// ---------------- DRAW ----------------
function renderDraw(ctx) {
  let html = "";
  Object.keys(GROUPS).forEach((letter) => {
    const matches = MATCHES.filter((m) => m.group === letter).sort((a, b) => a.md - b.md);
    html += `<div class="draw-group"><h4>Group ${letter}</h4><table class="draw-table">`;
    matches.forEach((m) => {
      const played = !!m.score;
      html += `<tr class="${played ? "played" : "upcoming"}">
        <td class="draw-date">${fmtDate(m.date)}</td>
        <td class="draw-team home">${m.team1}</td>
        <td class="draw-score">${fmtScore(m.score)}</td>
        <td class="draw-team away">${m.team2}</td>
        <td class="draw-venue">${m.venue}</td>
      </tr>`;
    });
    html += `</table></div>`;
  });
  document.getElementById("drawGroups").innerHTML = html;

  const koRounds = ["R32", "R16", "QF", "SF", "3rd", "Final"];
  let koHtml = "";
  koRounds.forEach((round) => {
    const matches = ctx.bracket.filter((m) => m.round === round).sort((a, b) => a.num - b.num);
    if (!matches.length) return;
    koHtml += `<div class="draw-group"><h4>${ROUND_LABELS[round]}</h4><table class="draw-table">`;
    matches.forEach((m) => {
      const t1 = m.team1Resolved === false ? `<span class="tbd">${m.team1}</span>` : m.team1;
      const t2 = m.team2Resolved === false ? `<span class="tbd">${m.team2}</span>` : m.team2;
      koHtml += `<tr class="${m.score ? "played" : "upcoming"}">
        <td class="draw-date">${fmtDate(m.date)}</td>
        <td class="draw-team home">${t1}</td>
        <td class="draw-score">${fmtScore(m.score)}</td>
        <td class="draw-team away">${t2}</td>
        <td class="draw-venue">${m.venue}</td>
      </tr>`;
    });
    koHtml += `</table></div>`;
  });
  document.getElementById("drawKnockout").innerHTML = koHtml;
}

// ---------------- ROAD TO 32 ----------------
function renderRoad32(ctx) {
  let qualified = 0, eliminated = 0, decidedCount = 0;
  Object.values(GROUPS)
    .flat()
    .forEach((team) => {
      const s = getTeamGroupStatus(team, ctx.standings, ctx.thirdRace, ctx.allDecided).status;
      if (s === "qualified") qualified++;
      if (s === "eliminated") eliminated++;
    });
  Object.values(ctx.standings).forEach((d) => { if (d.decided) decidedCount++; });

  document.getElementById("spotsClinched").textContent = `${qualified} / 32`;
  document.getElementById("statQualified").textContent = qualified;
  document.getElementById("statEliminated").textContent = eliminated;
  document.getElementById("groupsDecided").textContent = `${decidedCount} / 12`;

  let gridHtml = "";
  Object.entries(ctx.standings).forEach(([letter, data]) => {
    gridHtml += `<div class="group-card"><h4>Group ${letter}</h4><table class="group-table">
      <thead><tr><th>Team</th><th>P</th><th>Pts</th><th>GD</th><th>GF</th></tr></thead><tbody>`;
    data.rows.forEach((row, idx) => {
      const status = getTeamGroupStatus(row.team, ctx.standings, ctx.thirdRace, ctx.allDecided).status;
      gridHtml += `<tr class="${statusClass(status)}">
        <td class="team-cell">${row.team}</td>
        <td>${row.p}</td><td>${row.pts}</td><td>${row.gd > 0 ? "+" : ""}${row.gd}</td><td>${row.gf}</td>
      </tr>`;
    });
    gridHtml += `</tbody></table></div>`;
  });
  document.getElementById("groupGrid").innerHTML = gridHtml;

  const raceRows = ctx.thirdRace
    .map((r) => {
      const inCut = r.rank <= 8;
      return `<tr class="${inCut ? "st-qualified" : "st-eliminated"}">
        <td class="rank">${r.rank}</td>
        <td class="team-cell">${r.team}</td>
        <td>${r.group}</td>
        <td>$<r.pts}</td>
        <td>${r.gd > 0 ? "+" : ""}${r.gd}</td>
        <td>${r.gf}</td>
        <td class="race-status">${r.groupDecided ? (inCut ? "Advancing" : "Eliminated") : "Provisional"}</td>
      </tr>`;
    })
    .join("");
  document.getElementById("thirdPlaceBody").innerHTML = raceRows;
}

// ---------------- RIVALS ----------------
function renderRivals(ctx) {
  const select = document.getElementById("rivalsSelect");
  select.innerHTML =
    `<option value="">-- select --</option>` +
    ENTRANTS.map((e) => `<option value="${e.name}">${e.name}</option>`).join("");

  select.onchange = () => {
    const out = document.getElementById("rivalsOutput");
    if (!select.value) {
      out.innerHTML = `<p class="muted">Select your name to see who has 3 or more picks in common with you.</p>`;
      return;
    }
    const me = ENTRANTS.find((e) => e.name === select.value);
    const rivals = ENTRANTS.filter((e) => e.name !== me.name)
      .map((e) => ({ entrant: e, shared: me.picks.filter((p) => e.picks.includes(p)) }))
      .filter((r) => r.shared.length >= 3)
      .sort((a, b) => b.shared.length - a.shared.length);

    if (!rivals.length) {
      out.innerHTML = `<p class="muted">No one shares 3 or more picks with ${me.name}.</p>`;
      return;
    }
    out.innerHTML = rivals
      .map(
        (r) => `<div class="rival-card">
        <div class="rival-name">${r.entrant.name} <span class="muted">(${r.shared.length} shared)</span></div>
        <div class="chips">${r.shared.map((t) => `<span class="chip plain">${t}</span>`).join("")}</div>
      </div>`
      )
      .join("");
  };
}

// ---------------- TABS ----------------
function initTabs() {
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
      document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById(btn.dataset.tab).classList.add("active");
    });
  });
}

// ---------------- INIT ----------------
function init() {
  const ctx = buildContext();
  renderHeader();
  renderLadder(ctx);
  renderDraw(ctx);
  renderRoad32(ctx);
  renderRivals(ctx);
  initTabs();
}
