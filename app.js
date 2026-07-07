"use strict";

/* ============================================================
   Log Nikki — offline-first moment logger + daily streak
   Storage: IndexedDB (entries) + localStorage (streak)
   No location, no tags, no required network calls.
   Deployable as a static site (Netlify) — 100% client-side.
   ============================================================ */

const DB_NAME = "log-nikki-db";
const DB_VERSION = 1;
const STORE = "entries";
const LS_STREAK_KEY = "log-nikki-streak";

const BADGE_INTERVAL = 10;
const BADGE_TIERS = [
  { days: 10,  name: "First Spark" },
  { days: 20,  name: "Steady Flame" },
  { days: 30,  name: "Rooted" },
  { days: 40,  name: "Resilient" },
  { days: 50,  name: "Grounded" },
  { days: 60,  name: "Unshaken" },
  { days: 70,  name: "Enduring" },
  { days: 80,  name: "Anchored" },
];

/* Entry types */
const TYPE_CHECKIN = "checkin";   // "Checking In" — daily log
const TYPE_URGE    = "urge";      // "Shit happens" — moment of urge/attack
const TYPE_RELAPSE = "relapse";   // logged by Mark Relapse action

/* ---------------- Date helpers ---------------- */

function dayKey(ts = Date.now()) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

function daysBetween(keyA, keyB) {
  return Math.round((new Date(keyB+"T00:00:00") - new Date(keyA+"T00:00:00")) / 86400000);
}

/* ---------------- Streak state ---------------- */

function defaultStreak() {
  return {
    current: 0,
    longest: 0,
    lastDay: null,
    totalDays: 0,
    totalCheckins: 0,   // distinct "Checking In" type entries (all time)
    totalUrges: 0,      // distinct "urge" type entries (all time)
    badges: [],
  };
}

function loadStreak() {
  try {
    const raw = localStorage.getItem(LS_STREAK_KEY);
    if (!raw) return defaultStreak();
    return { ...defaultStreak(), ...JSON.parse(raw) };
  } catch { return defaultStreak(); }
}
function saveStreak(s) { localStorage.setItem(LS_STREAK_KEY, JSON.stringify(s)); }
let streak = loadStreak();

/* Advance the streak for today. Returns { counted, newBadges }. */
function recordActivity() {
  const today = dayKey();
  if (streak.lastDay === today) return { counted: false, newBadges: [] };

  if (streak.lastDay === null) {
    streak.current = 1;
  } else {
    const gap = daysBetween(streak.lastDay, today);
    streak.current = gap === 1 ? streak.current + 1 : 1;
  }
  streak.lastDay = today;
  streak.totalDays += 1;
  streak.longest = Math.max(streak.longest, streak.current);

  const newBadges = [];
  for (const tier of BADGE_TIERS) {
    if (streak.current >= tier.days && !streak.badges.includes(tier.days)) {
      streak.badges.push(tier.days);
      newBadges.push(tier);
    }
  }
  saveStreak(streak);
  return { counted: true, newBadges };
}

function displayStreak() {
  if (!streak.lastDay) return 0;
  const gap = daysBetween(streak.lastDay, dayKey());
  return (gap === 0 || gap === 1) ? streak.current : 0;
}

function checkedInToday() { return streak.lastDay === dayKey(); }

/* Handle any user activity: advance streak, update UI, show reward if earned.
   entryType is used to increment per-type tallies when called from logMoment. */
function handleActivity(opts = {}) {
  const result = recordActivity();
  if (opts.entryType === TYPE_CHECKIN) streak.totalCheckins += 1;
  if (opts.entryType === TYPE_URGE)    streak.totalUrges    += 1;
  if (opts.entryType === TYPE_CHECKIN || opts.entryType === TYPE_URGE) saveStreak(streak);

  renderStreak({ pop: result.counted });
  if (result.newBadges.length) {
    showReward(result.newBadges[result.newBadges.length - 1]);
  } else if (result.counted && opts.toastOnCheckin) {
    toast(`Day ${displayStreak()} — keep going`);
  }
  return result;
}

/* ---------------- IndexedDB layer ---------------- */

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex("createdAt", "createdAt");
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
let dbPromise = ("indexedDB" in window) ? openDB() : null;
function txStore(mode) { return dbPromise.then((db) => db.transaction(STORE, mode).objectStore(STORE)); }

async function dbPutEntry(e) {
  if (!dbPromise) return lsPutEntry(e);
  const store = await txStore("readwrite");
  return new Promise((res, rej) => { const r = store.put(e); r.onsuccess = () => res(e); r.onerror = () => rej(r.error); });
}
async function dbGetAll() {
  if (!dbPromise) return lsGetAll();
  const store = await txStore("readonly");
  return new Promise((res, rej) => { const r = store.getAll(); r.onsuccess = () => res(r.result || []); r.onerror = () => rej(r.error); });
}
async function dbDeleteEntry(id) {
  if (!dbPromise) return lsDeleteEntry(id);
  const store = await txStore("readwrite");
  return new Promise((res, rej) => { const r = store.delete(id); r.onsuccess = () => res(); r.onerror = () => rej(r.error); });
}
async function dbClearAll() {
  if (!dbPromise) return lsClearAll();
  const store = await txStore("readwrite");
  return new Promise((res, rej) => { const r = store.clear(); r.onsuccess = () => res(); r.onerror = () => rej(r.error); });
}

const LS_ENTRIES_KEY = "log-nikki-entries";
function lsGetAll() { try { return JSON.parse(localStorage.getItem(LS_ENTRIES_KEY) || "[]"); } catch { return []; } }
function lsPutEntry(e) { const all = lsGetAll(); const i = all.findIndex(x => x.id === e.id); if (i >= 0) all[i] = e; else all.push(e); localStorage.setItem(LS_ENTRIES_KEY, JSON.stringify(all)); return e; }
function lsDeleteEntry(id) { localStorage.setItem(LS_ENTRIES_KEY, JSON.stringify(lsGetAll().filter(e => e.id !== id))); }
function lsClearAll() { localStorage.setItem(LS_ENTRIES_KEY, "[]"); }

/* ---------------- Utilities ---------------- */

function uid() { return `${Date.now()}-${Math.random().toString(36).slice(2,9)}`; }
function formatTime(d) { return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }); }
function formatDate(d) { return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }); }
function escapeHtml(str) { const d = document.createElement("div"); d.textContent = str ?? ""; return d.innerHTML; }

function toast(msg, ms = 2200) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove("show"), ms);
}

/* ---------------- App state ---------------- */

let entries = [];
let searchTerm = "";

/* ---------------- Streak rendering ---------------- */

function nextBadgeThreshold(current) {
  return Math.floor(current / BADGE_INTERVAL) * BADGE_INTERVAL + BADGE_INTERVAL;
}

function renderStreak(opts = {}) {
  const shown = displayStreak();
  document.getElementById("streakNum").textContent = shown;

  const flame = document.getElementById("streakFlame");
  flame.classList.toggle("active", shown > 0);
  if (opts.pop) {
    flame.classList.remove("pop");
    void flame.offsetWidth;
    flame.classList.add("pop");
  }

  const sub = document.getElementById("streakSub");
  if (shown === 0) {
    sub.textContent = streak.lastDay ? "Streak reset — check in to begin again." : "Show up today to start your streak.";
  } else if (checkedInToday()) {
    sub.textContent = `Longest: ${streak.longest} days · ${streak.totalDays} total days`;
  } else {
    sub.textContent = "Check in today to keep your streak alive.";
  }

  // Stat pills
  document.getElementById("statCheckins").textContent = streak.totalCheckins;
  document.getElementById("statUrges").textContent    = streak.totalUrges;
  document.getElementById("statLongest").textContent  = streak.longest;

  // Progress bar
  const next = nextBadgeThreshold(shown);
  const base = next - BADGE_INTERVAL;
  const into = shown - base;
  const pct  = Math.round((into / BADGE_INTERVAL) * 100);
  document.getElementById("progressFill").style.width = pct + "%";
  document.getElementById("progressPct").textContent  = pct + "%";
  document.getElementById("progressLabel").textContent = `${into} / ${BADGE_INTERVAL} days to next reward`;

  const dots = document.getElementById("progressDots");
  dots.innerHTML = "";
  for (let i = 0; i < BADGE_INTERVAL; i++) {
    const dot = document.createElement("span");
    dot.className = "dot" + (i < into ? " filled" : "");
    dots.appendChild(dot);
  }

  const btn = document.getElementById("checkInBtn");
  if (checkedInToday()) {
    btn.textContent = "Checked in today ✓";
    btn.classList.add("done");
    btn.disabled = true;
  } else {
    btn.textContent = "Check in for today";
    btn.classList.remove("done");
    btn.disabled = false;
  }
}

/* ---------------- Reward overlay ---------------- */

function fireConfetti() {
  const burst = document.getElementById("rewardBurst");
  burst.innerHTML = "";
  const colors = ["#d9b877","#d98555","#8fae83","#f5efe7"];
  for (let i = 0; i < 28; i++) {
    const s = document.createElement("span");
    const angle = Math.random() * Math.PI * 2;
    const dist  = 90 + Math.random() * 130;
    s.style.setProperty("--dx", `${Math.cos(angle)*dist}px`);
    s.style.setProperty("--dy", `${Math.sin(angle)*dist+40}px`);
    s.style.background = colors[i % colors.length];
    s.style.animationDelay = `${Math.random()*0.15}s`;
    burst.appendChild(s);
  }
}

function showReward(tier) {
  document.getElementById("rewardBadgeIcon").textContent = tier.days;
  document.getElementById("rewardTitle").textContent = `${tier.name}!`;
  document.getElementById("rewardDesc").textContent =
    `You've shown up ${tier.days} days in a row. That's real, quiet strength. Badge unlocked.`;
  document.getElementById("rewardModal").classList.remove("hidden");
  fireConfetti();
}

/* ---------------- Entry rendering ---------------- */

function typeDotClass(type) {
  if (type === TYPE_CHECKIN) return "entry-dot type-checkin";
  if (type === TYPE_URGE)    return "entry-dot type-urge";
  if (type === TYPE_RELAPSE) return "entry-dot type-relapse";
  return "entry-dot type-unknown";
}

function typeBadgeHtml(type) {
  if (type === TYPE_CHECKIN) return `<span class="entry-type-badge badge-checkin">Checking In</span>`;
  if (type === TYPE_URGE)    return `<span class="entry-type-badge badge-urge">Shit happens</span>`;
  if (type === TYPE_RELAPSE) return `<span class="entry-type-badge badge-relapse">Relapse</span>`;
  return "";
}

function renderEntries() {
  const list  = document.getElementById("entryList");
  const empty = document.getElementById("emptyState");
  const sorted   = [...entries].sort((a, b) => b.createdAt - a.createdAt);
  const filtered = sorted.filter(e => !searchTerm || (e.note || "").toLowerCase().includes(searchTerm.toLowerCase()));

  if (filtered.length === 0) {
    list.innerHTML = "";
    empty.classList.remove("hidden");
    empty.textContent = entries.length === 0
      ? "Nothing logged yet. Tap the button above whenever you need to."
      : "No entries match your search.";
    return;
  }
  empty.classList.add("hidden");

  list.innerHTML = filtered.map(e => {
    const d = new Date(e.createdAt);
    return `
      <div class="entry-card" data-id="${e.id}">
        <span class="${typeDotClass(e.type)}"></span>
        <div class="entry-body">
          <div class="entry-top">
            <span class="entry-time">${formatTime(d)}</span>
            <span class="entry-date">${formatDate(d)}</span>
          </div>
          ${typeBadgeHtml(e.type)}
          <div class="entry-note ${e.note ? "" : "empty"}">${e.note ? escapeHtml(e.note) : "No notes yet — tap to add."}</div>
        </div>
      </div>`;
  }).join("");

  list.querySelectorAll(".entry-card").forEach(card => {
    card.addEventListener("click", () => openEditor(card.dataset.id));
  });
}

async function refreshEntries() {
  entries = await dbGetAll();
  renderEntries();
}

/* ---------------- Log a moment (big button) ---------------- */

async function logMoment() {
  const btn = document.getElementById("bigButton");
  btn.disabled = true;

  const entry = { id: uid(), createdAt: Date.now(), note: "", type: TYPE_URGE };
  await dbPutEntry(entry);
  entries.push(entry);
  renderEntries();

  openEditor(entry.id, true);
  btn.disabled = false;
}

/* ---------------- Editor modal ---------------- */

function openEditor(id, isNew = false) {
  const entry = entries.find(e => e.id === id);
  if (!entry) return;

  const modal = document.getElementById("editorModal");
  const body  = document.getElementById("editorBody");
  const d = new Date(entry.createdAt);
  const localDatetime = new Date(entry.createdAt - d.getTimezoneOffset()*60000).toISOString().slice(0,16);

  document.getElementById("editorTitle").textContent = isNew ? "What's this?" : "Edit Entry";

  // Determine current type for initial selection
  const currentType = entry.type || TYPE_URGE;

  body.innerHTML = `
    <div class="field-group">
      <label class="field-label">Type</label>
      <div class="log-type-row">
        <button type="button" class="log-type-chip ${currentType === TYPE_CHECKIN ? "selected-checkin" : ""}" data-type="${TYPE_CHECKIN}">Checking In</button>
        <button type="button" class="log-type-chip ${currentType === TYPE_URGE    ? "selected-urge"    : ""}" data-type="${TYPE_URGE}">Shit happens</button>
      </div>
    </div>
    <div class="field-group">
      <label class="field-label">Notes</label>
      <textarea id="edNote" placeholder="${currentType === TYPE_CHECKIN ? "How are you doing today?" : "What happened? What triggered it, how did it feel, what did you do next..."}">${escapeHtml(entry.note || "")}</textarea>
    </div>
    <div class="field-group">
      <label class="field-label">When</label>
      <input type="datetime-local" id="edDatetime" value="${localDatetime}">
    </div>
    <div class="qe-actions">
      <button id="edDelete" class="btn danger">${isNew ? "Discard" : "Delete"}</button>
      <button id="edSave"   class="btn primary">${isNew ? "Save" : "Save changes"}</button>
    </div>
  `;

  // Track selected type
  let selectedType = currentType;
  body.querySelectorAll(".log-type-chip").forEach(chip => {
    chip.addEventListener("click", () => {
      selectedType = chip.dataset.type;
      body.querySelectorAll(".log-type-chip").forEach(c => c.className = "log-type-chip");
      chip.classList.add(selectedType === TYPE_CHECKIN ? "selected-checkin" : "selected-urge");
      // update placeholder live
      document.getElementById("edNote").placeholder =
        selectedType === TYPE_CHECKIN ? "How are you doing today?" : "What happened? What triggered it, how did it feel, what did you do next...";
    });
  });

  const noteEl = document.getElementById("edNote");

  document.getElementById("edSave").addEventListener("click", async () => {
    const prevType = entry.type;
    entry.type     = selectedType;
    const dtVal    = document.getElementById("edDatetime").value;
    if (dtVal) entry.createdAt = new Date(dtVal).getTime();
    entry.note = noteEl.value.trim();
    await dbPutEntry(entry);
    closeModal(modal);

    // Advance streak + tally on first save of a new entry only
    if (isNew) {
      handleActivity({ entryType: entry.type, toastOnCheckin: false });
      toast(entry.type === TYPE_CHECKIN ? "Checked in" : "Logged");
    } else {
      // If type changed, adjust tallies
      if (prevType !== entry.type) {
        if (prevType === TYPE_CHECKIN) streak.totalCheckins = Math.max(0, streak.totalCheckins - 1);
        if (prevType === TYPE_URGE)    streak.totalUrges    = Math.max(0, streak.totalUrges    - 1);
        if (entry.type === TYPE_CHECKIN) streak.totalCheckins += 1;
        if (entry.type === TYPE_URGE)    streak.totalUrges    += 1;
        saveStreak(streak);
        renderStreak();
      }
      toast("Saved");
    }
    refreshEntries();
  });

  document.getElementById("edDelete").addEventListener("click", async () => {
    if (!isNew && !confirm("Delete this entry? This cannot be undone.")) return;

    // Adjust tallies when deleting a saved entry
    if (!isNew) {
      if (entry.type === TYPE_CHECKIN) streak.totalCheckins = Math.max(0, streak.totalCheckins - 1);
      if (entry.type === TYPE_URGE)    streak.totalUrges    = Math.max(0, streak.totalUrges    - 1);
      saveStreak(streak);
      renderStreak();
    }
    await dbDeleteEntry(entry.id);
    // Remove from in-memory list
    entries = entries.filter(e => e.id !== id);
    closeModal(modal);
    toast(isNew ? "Discarded" : "Deleted");
    refreshEntries();
  });

  modal.classList.remove("hidden");
  setTimeout(() => noteEl.focus(), 50);
}

function closeModal(modal) { modal.classList.add("hidden"); }

/* ---------------- Settings ---------------- */

function renderSettings() {
  const body   = document.getElementById("settingsBody");
  const earned = new Set(streak.badges);

  const badgesHtml = BADGE_TIERS.map(t => {
    const has = earned.has(t.days);
    return `
      <div class="badge-cell ${has ? "earned" : ""}">
        <div class="badge-medal ${has ? "earned" : ""}">${t.days}</div>
        <div class="badge-name">${has ? t.name : "Locked"}</div>
      </div>`;
  }).join("");

  body.innerHTML = `
    <p class="settings-section-title">Badges (${streak.badges.length}/${BADGE_TIERS.length})</p>
    <div class="badge-grid">${badgesHtml}</div>

    <p class="settings-section-title">Stats</p>
    <div class="settings-row">
      <div class="settings-row-text">
        <div class="settings-row-title">Longest streak</div>
        <div class="settings-row-desc">Your best consecutive run.</div>
      </div>
      <div style="font-weight:700;color:var(--gold)">${streak.longest} days</div>
    </div>
    <div class="settings-row">
      <div class="settings-row-text">
        <div class="settings-row-title">Total check-ins</div>
        <div class="settings-row-desc">Days you logged "Checking In".</div>
      </div>
      <div style="font-weight:700;color:var(--type-checkin)">${streak.totalCheckins}</div>
    </div>
    <div class="settings-row">
      <div class="settings-row-text">
        <div class="settings-row-title">Urges logged</div>
        <div class="settings-row-desc">Times you logged "Shit happens".</div>
      </div>
      <div style="font-weight:700;color:var(--type-urge)">${streak.totalUrges}</div>
    </div>

    <p class="settings-section-title">Data</p>
    <div class="settings-row">
      <div class="settings-row-text">
        <div class="settings-row-title">Export</div>
        <div class="settings-row-desc">Download all entries + streak as JSON.</div>
      </div>
      <button id="btnExport" class="btn">Export</button>
    </div>
    <div class="settings-row">
      <div class="settings-row-text">
        <div class="settings-row-title">Import</div>
        <div class="settings-row-desc">Restore from a previous export.</div>
      </div>
      <button id="btnImport" class="btn">Import</button>
    </div>

    <p class="settings-section-title">Reset</p>
    <div class="settings-row">
      <div class="settings-row-text">
        <div class="settings-row-title">Mark relapse</div>
        <div class="settings-row-desc">Logs a relapse entry with timestamp, then resets your streak and badges to zero. Your moment history stays intact.</div>
      </div>
      <button id="btnRelapse" class="btn danger">Mark relapse</button>
    </div>
    <div class="settings-row">
      <div class="settings-row-text">
        <div class="settings-row-title">Clear all data</div>
        <div class="settings-row-desc">Permanently delete every entry, streak and badge.</div>
      </div>
      <button id="btnClear" class="btn danger">Clear all</button>
    </div>
    <input type="file" id="importFile" accept="application/json" class="hidden">
  `;

  document.getElementById("btnExport").addEventListener("click", exportData);
  document.getElementById("btnImport").addEventListener("click", () => document.getElementById("importFile").click());
  document.getElementById("importFile").addEventListener("change", importData);

  document.getElementById("btnRelapse").addEventListener("click", async () => {
    if (!confirm("Mark a relapse?\n\nThis will:\n• Log a timestamped relapse entry in your history\n• Reset your streak and all badges to zero\n\nYour moment notes stay intact.")) return;
    const entry = { id: uid(), createdAt: Date.now(), note: "", type: TYPE_RELAPSE };
    await dbPutEntry(entry);
    entries.push(entry);

    streak.current = 0;
    streak.lastDay = null;
    streak.badges  = [];
    // Keep totalDays, totalCheckins, totalUrges, longest — they're historical
    saveStreak(streak);

    closeModal(document.getElementById("settingsModal"));
    renderStreak();
    refreshEntries();
    toast("Relapse logged. Streak reset. You can start again.");
  });

  document.getElementById("btnClear").addEventListener("click", async () => {
    if (!confirm("Delete ALL data (every entry, streak, badges)? This cannot be undone.")) return;
    await dbClearAll();
    streak = defaultStreak();
    saveStreak(streak);
    entries = [];
    closeModal(document.getElementById("settingsModal"));
    renderStreak();
    renderEntries();
    toast("All data cleared");
  });
}

async function exportData() {
  const all = await dbGetAll();
  const blob = new Blob([JSON.stringify({ exportedAt: Date.now(), version: 3, streak, entries: all }, null, 2)], { type: "application/json" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url;
  a.download = `log-nikki-backup-${dayKey()}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
  toast("Exported");
}

function importData(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const data     = JSON.parse(reader.result);
      const imported = Array.isArray(data) ? data : data.entries;
      if (!Array.isArray(imported)) throw new Error("bad format");
      for (const entry of imported) {
        if (!entry.id) entry.id = uid();
        // Migrate legacy entries: no type -> urge (old behaviour was always a moment log)
        if (!entry.type) entry.type = TYPE_URGE;
        delete entry.tags; delete entry.place; delete entry.coords;
        await dbPutEntry(entry);
      }
      if (data.streak && typeof data.streak === "object") {
        streak = { ...defaultStreak(), ...data.streak };
        saveStreak(streak);
      }
      toast(`Imported ${imported.length} entries`);
      renderStreak();
      renderSettings();
      refreshEntries();
    } catch { toast("Import failed — invalid file"); }
    e.target.value = "";
  };
  reader.readAsText(file);
}

/* ---------------- Init ---------------- */

function init() {
  document.getElementById("bigButton").addEventListener("click", logMoment);

  document.getElementById("checkInBtn").addEventListener("click", () => {
    if (checkedInToday()) return;
    handleActivity({ toastOnCheckin: true });
  });

  document.getElementById("searchInput").addEventListener("input", e => {
    searchTerm = e.target.value;
    renderEntries();
  });

  document.getElementById("settingsBtn").addEventListener("click", () => {
    renderSettings();
    document.getElementById("settingsModal").classList.remove("hidden");
  });
  document.getElementById("closeSettings").addEventListener("click", () => closeModal(document.getElementById("settingsModal")));
  document.getElementById("closeEditor").addEventListener("click",   () => {
    const modal = document.getElementById("editorModal");
    // If there's a pending new entry (user closed without saving), discard it
    const pendingCard = document.querySelector(".entry-card[data-id]");
    closeModal(modal);
  });
  document.getElementById("rewardClose").addEventListener("click",   () => closeModal(document.getElementById("rewardModal")));

  document.querySelectorAll(".modal").forEach(modal => {
    modal.addEventListener("click", e => { if (e.target === modal) closeModal(modal); });
  });

  renderStreak();
  refreshEntries();

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
}

document.addEventListener("DOMContentLoaded", init);
