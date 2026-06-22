// ============================================================
// Daily auto-update: pulls match results from the free, public,
// no-API-key openfootball dataset and patches data.json in place.
// Run by .github/workflows/update.yml on a schedule, or manually:
//   node scripts/update-data.mjs
// ============================================================

import { readFile, writeFile } from "fs/promises";

const FEED_URL = "https://raw.githubusercontent.com/openfootball/worldcup.json/master/2026/worldcup.json";
const DATA_PATH = new URL("../data.json", import.meta.url);

// Names the feed uses that differ from the names in our data.json.
const ALIASES = {
  "Czech Republic": "Czechia",
  "Cabo Verde": "Cape Verde",
  "Türkiye": "Turkey",
  "Bosnia and Herzegovina": "Bosnia & Herzegovina",
};
const norm = (name) => ALIASES[name] || name;

// Codes that mean "not resolved to a real team yet" (group position or
// best-third-place pool codes, or W##/L## bracket references).
const isPlaceholder = (s) => /^[1-4][A-L]$/.test(s) || /^3[A-L](\/[A-L])*$/.test(s) || /^[WL]\d+$/.test(s);

async function main() {
  console.log("Fetching feed:", FEED_URL);
  const feedRes = await fetch(FEED_URL);
  if (!feedRes.ok) throw new Error(`Feed fetch failed: HTTP ${feedRes.status}`);
  const feed = await feedRes.json();

  const dataRaw = await readFile(DATA_PATH, "utf8");
  const data = JSON.parse(dataRaw);

  let changed = 0;

  // ---- group stage: match by unordered team pair + group letter ----
  const feedGroupMatches = feed.matches.filter((m) => m.group);
  const feedKey = (m) => {
    const teams = [norm(m.team1), norm(m.team2)].sort();
    const letter = m.group.replace("Group ", "");
    return `${letter}|${teams.join("|")}`;
  };
  const feedByKey = new Map();
  feedGroupMatches.forEach((m) => feedByKey.set(feedKey(m), m));

  data.matches
    .filter((m) => m.round === "Group")
    .forEach((m) => {
      const teams = [norm(m.team1), norm(m.team2)].sort();
      const key = `${m.group}|${teams.join("|")}`;
      const fm = feedByKey.get(key);
      if (!fm || !fm.score || !fm.score.ft) return;
      const [fs1, fs2] = fm.score.ft;
      // make sure scores line up with OUR team1/team2 order, not the feed's
      const sameOrder = norm(fm.team1) === norm(m.team1);
      const newScore = sameOrder ? [fs1, fs2] : [fs2, fs1];
      if (JSON.stringify(newScore) !== JSON.stringify(m.score)) {
        m.score = newScore;
        changed++;
      }
    });

  // ---- knockout stage: match by official FIFA match number ----
  const feedKoByNum = new Map();
  feed.matches.filter((m) => m.num).forEach((m) => feedKoByNum.set(m.num, m));

  data.matches
    .filter((m) => m.num >= 73)
    .forEach((m) => {
      const fm = feedKoByNum.get(m.num);
      if (!fm) return;

      // If the feed has resolved a placeholder slot to a real team name
      // (e.g. the "best third place" draw has happened), adopt it.
      if (fm.team1 && !isPlaceholder(fm.team1) && norm(fm.team1) !== m.team1) {
        m.team1 = norm(fm.team1);
        changed++;
      }
      if (fm.team2 && !isPlaceholder(fm.team2) && norm(fm.team2) !== m.team2) {
        m.team2 = norm(fm.team2);
        changed++;
      }

      if (fm.score) {
        const ft = fm.score.et || fm.score.ft;
        if (ft && JSON.stringify(ft) !== JSON.stringify(m.score)) {
          m.score = ft;
          changed++;
        }
        if (fm.score.ps) {
          const wonOnPens = fm.score.ps[0] > fm.score.ps[1] ? "team1" : "team2";
          if (m.wonOnPens !== wonOnPens) {
            m.wonOnPens = wonOnPens;
            changed++;
          }
        }
      }
    });

  data.config.lastUpdated = new Date().toISOString().slice(0, 10);

  await writeFile(DATA_PATH, JSON.stringify(data, null, 2) + "\n");
  console.log(`Done. ${changed} field(s) updated. lastUpdated -> ${data.config.lastUpdated}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
