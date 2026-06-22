# Wes's World Cup Tracker

A static site that scores your group's World Cup tipping competition
automatically from match results — and now **updates itself daily** via a
free GitHub Actions job that pulls fresh scores into `data.json`. You don't
have to do anything for routine results; just check in and watch the ladder
move.

## Files

- `index.html` — the page structure
- `style.css` — all the styling
- `data.json` — the data: groups, fixtures/results, entrants & picks, prizes.
  Editable by hand *or* by the daily automation.
- `app.js` — the scoring engine (standings, qualification, bracket resolution)
- `render.js` — draws the four tabs from the data
- `main.js` — loads `data.json` at runtime and boots everything
- `scripts/update-data.mjs` — the script the daily job runs
- `.github/workflows/update.yml` — the schedule that runs it

## How the daily auto-update works

Once a day (13:00 UTC by default — see "Changing the schedule" below),
GitHub runs `scripts/update-data.mjs`, which:

1. Pulls the free, public, no-API-key [openfootball World Cup
   dataset](https://github.com/openfootball/worldcup.json) — the same one
   this tracker was originally seeded from.
2. Matches it against your fixtures (group matches by team pair, knockout
   matches by official FIFA match number) and copies across any new scores.
3. If the feed has resolved a "best third place" Round of 32 slot to a real
   team, that gets adopted automatically too — no manual override needed in
   most cases.
4. Commits `data.json` back to the repo if anything changed.

GitHub Pages then just serves whatever's in the repo, so the live site
reflects the new data within a minute or two of the commit.

**Worth knowing:** this pulls from a community-maintained public dataset,
not an official FIFA feed — it's typically right but can lag by a few hours,
and very occasionally a manual correction in `data.json` could get
overwritten by the next day's run if the feed disagrees. For a mates' comp
this is a fair trade for "I don't have to touch it every day."

**Trigger it manually:** repo → **Actions** tab → "Daily results update" →
**Run workflow**. Handy right after a match you're impatiently waiting on.

**Changing the schedule:** edit the `cron` line in
`.github/workflows/update.yml`. It's in UTC — `0 13 * * *` is 1pm UTC, which
is 9pm in Perth (AWST) outside daylight saving.

## Manual edits (for anything the automation won't catch)

You can still hand-edit `data.json` any time — it's just JSON, so quotes
around keys and no trailing commas. Find the match in the `matches` array
(grouped by Group A–L, then Round of 32 → Final):

```json
{ "num": 5, "round": "Group", "group": "A", "md": 14, "date": "2026-06-24", "team1": "Czechia", "team2": "Mexico", "score": null, "venue": "Mexico City" }
```

Fill in a score:

```json
"score": [1, 2]
```

Everything else — group tables, qualification, the third-place race, ladder
points, the bracket — recalculates automatically. If you hand-edit a result,
remember the next automated run will overwrite it again if the public feed
disagrees (see "Worth knowing" above).

**Knockout games decided on penalties:** add `"wonOnPens": "team1"` or
`"wonOnPens": "team2"` alongside the score:

```json
{ "num": 90, "round": "R16", "score": [1, 1], "wonOnPens": "team2" }
```

## Resolving the "best third place" Round of 32 slots manually

The automation usually picks these up on its own once they're announced
(see above). If you want to set one yourself in the meantime, add it to
`roundOf32Overrides` in `data.json`:

```json
"roundOf32Overrides": {
  "74": "Scotland"
}
```

The key is the `num` field on that fixture. Everything downstream (R16, QF,
etc.) resolves automatically from there.

## Editing entrants, picks, or prizes

Also in `data.json`:

```json
"entrants": [
  { "name": "Wes", "picks": ["France", "Netherlands", "Japan", "Czechia", "Australia"], "random": "Brazil", "paid": true }
]
```

`picks` is the 5 main picks, `random` is the wildcard for the $40 side comp,
`paid` toggles the little tick/circle next to their name on the ladder.

Prize amounts and the points-per-stage value are at the top, in `config`.

## Testing locally before you push

The page now loads `data.json` via `fetch`, which browsers block on `file://`
URLs — so run a tiny local server from this folder instead of double-clicking
`index.html`:

```
python3 -m http.server 8000
```

then visit `http://localhost:8000`.

## Putting it on GitHub Pages

1. Create a new repository on GitHub (e.g. `world-cup-tracker`).
2. Add everything in this folder — `index.html`, `style.css`, `data.json`,
   `app.js`, `render.js`, `main.js`, `scripts/`, `.github/` (yes, the
   dot-folder too, that's the automation) — to the repo root and push:
   ```
   git init
   git add .
   git commit -m "World Cup tracker"
   git branch -M main
   git remote add origin https://github.com/<your-username>/world-cup-tracker.git
   git push -u origin main
   ```
3. On GitHub: **Settings → Pages → Build and deployment → Source: Deploy
   from a branch → Branch: main / (root)** → Save.
4. Your site will be live in a minute or two at
   `https://<your-username>.github.io/world-cup-tracker/`.
5. The daily update job only runs on its schedule or when triggered — so
   right after your first push, go to **Actions → Daily results update →
   Run workflow** once to pull in anything that's happened since this
   snapshot was taken.

From then on it just runs itself once a day. You only need to touch the repo
for entrants/picks/prize changes, or the rare manual correction.

## Data snapshot

Match results were current as of **22 June 2026** (through Matchday 11).
Groups I, J, K and L are earlier in their schedule than the rest — that's
correct, not a bug; the 2026 format staggers matchdays across groups.
