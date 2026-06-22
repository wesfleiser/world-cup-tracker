/* ============================================================
   WORLD CUP TRACKER — BOOTSTRAP
   Loads data.json at runtime (so the daily auto-update script
   can edit a plain JSON file) and kicks off rendering.
   ============================================================ */

async function start() {
  let data;
  try {
    const res = await fetch("data.json", { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    data = await res.json();
  } catch (err) {
    document.querySelector("main").innerHTML =
      `<div class="card" style="padding:20px;"><strong>Couldn't load data.json.</strong><br/>` +
      `If you're opening this file directly (file://), run a local server instead — see README.md.<br/>` +
      `<span class="muted">${err.message}</span></div>`;
    return;
  }
  window.CONFIG = data.config;
  window.GROUPS = data.groups;
  window.MATCHES = data.matches;
  window.ENTRANTS = data.entrants;
  window.ROUND_OF_32_OVERRIDES = data.roundOf32Overrides || {};
  init();
}

document.addEventListener("DOMContentLoaded", start);
