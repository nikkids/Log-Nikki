"use strict";

/* ============================================================
   Moment Aware — offline-first moment logger + daily streak
   Storage: IndexedDB (entries) + localStorage (streak/settings)
   No location, no tags, no required network calls.
   Deployable as a static site (Netlify) — 100% client-side.
   ============================================================ */

const DB_NAME = "moment-aware-db";
const DB_VERSION = 1;
const STORE = "entries";
const LS_STREAK_KEY = "moment-aware-streak";
const LS_SETTINGS_KEY = "moment-aware-settings";

const BADGE_INTERVAL = 10; // reward every 10 days
const BADGE_TIERS = [
  { days: 10, name: "First Spark" },
  { days: 20, name: "Steady Flame" },
  { days: 30, name: "Rooted" },
  { days: 40, name: "Resilient" },
  { days: 50, name: "Grounded" },
  { days: 60, name: "Unshaken" },
  { days: 70, name: "Enduring" },
  { days: 80, name: "Anchored" },
];

/* ---------------- Date helpers (local-day based) ---------------- */

function dayKey(ts = Date.now()) {
  const d = new Date(ts);
  // YYYY-MM-DD in local time
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function daysBetween(keyA, keyB) {
  // difference in whole local days between two YYYY-MM-DD keys
  const a = new Date(keyA + "T00:00:00");
  const b = new Date(keyB + "T00:00:00");
  return Math.round((b - a) / 86400000);
}

/* ---------------- Streak state ---------------- */

function defaultStreak() {
  return {
    current: 0,
    longest: 0,
    lastDay: null,     // YYYY-MM-DD of last counted day
    totalDays: 0,      // total distinct days checked in
    badges: [],        // list of earned badge day-thresholds, e.g. [10,20]
  };
}

function loadStreak() {
  try {
    const raw = localStorage.getItem(LS_STREAK_KEY);
    if (!raw) return defaultStreak();
    return { ...defaultStreak(), ...JSON.parse(raw) };
  } catch {
    return defaultStreak();
  }
}
function saveStreak(s) {
  localStorage.setItem(LS_STREAK_KEY, JSON.stringify(s));
}
let streak = loadStreak();

function loadSettings() {
  try {
    return { showTips: true, ...(JSON.parse(localStorage.getItem(LS_SETTINGS_KEY)) || {}) };
  } catch {
    return { showTips: true };
  }
}
function saveSettings(s) { localStorage.setItem(LS_SETTINGS_KEY, JSON.stringify(s)); }
let settings = loadSettings();

/* Records "activity today". Any activity (open app OR log moment) counts.
   Returns { counted, newBadges: [tier,...] } describing what changed. */
function recordActivity() {
  const today = dayKey();
  if (streak.lastDay === today) {
    return { counted: false, newBadges: [] }; // already counted today
  }

  if (streak.lastDay === null) {
    streak.current = 1;
  } else {
    const gap = daysBetween(streak.lastDay, today);
    if (gap === 1) streak.current += 1;      // consecutive day
    else if (gap > 1) streak.current = 1;    // streak broken, restart
    else streak.current = Math.max(1, streak.current); // clock weirdness safety
  }

  streak.lastDay = today;
  streak.totalDays += 1;
  streak.longest = Math.max(streak.longest, streak.current);

  // Award any newly-crossed 10-day badge(s) based on current streak.
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

/* If the last check-in was before yesterday, the on-screen streak should
   read as broken (0) until the user shows up again today. We don't mutate
   stored state here—just compute the display value. */
function displayStreak() {
  if (streak.lastDay === null) return 0;
  const today = dayKey();
  const gap = daysBetween(streak.lastDay, today);
  if (gap === 0 || gap === 1) return streak.current; // today or eligible to continue
  return 0; // missed a day -> shown as broken
}

function checkedInToday() {
  return streak.lastDay === dayKey();
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

async function dbPutEntry(entry) {
  if (!dbPromise) return lsPutEntry(entry);
  const store = await txStore("readwrite");
  return new Promise((res, rej) => { const r = store.put(entry); r.onsuccess = () => res(entry); r.onerror = () => rej(r.error); });
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

/* localStorage fallback */
const LS_ENTRIES_KEY = "moment-aware-entries";
function lsGetAll() { try { return JSON.parse(localStorage.getItem(LS_ENTRIES_KEY) || "[]"); } catch { return []; } }
function lsPutEntry(e) { const all = lsGetAll(); const i = all.findIndex((x) => x.id === e.id); if (i >= 0) all[i] = e; else all.push(e); localStorage.setItem(LS_ENTRIES_KEY, JSON.stringify(all)); return e; }
function lsDeleteEntry(id) { localStorage.setItem(LS_ENTRIES_KEY, JSON.stringify(lsGetAll().filter((e) => e.id !== id))); }
function lsClearAll() { localStorage.setItem(LS_ENTRIES_KEY, "[]"); }

/* ---------------- Utilities ---------------- */

function uid() { return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`; }
function formatTime(d) { return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }); }
function formatDate(d) { return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }); }
function escapeHtml(str) { const div = document.createElement("div"); div.textContent = str ?? ""; return div.innerHTML; }

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
let pendingQuickEditId = null;

/* ---------------- Streak rendering ---------------- */

function nextBadgeThreshold(current) {
  // next multiple of BADGE_INTERVAL strictly greater than current
  return Math.floor(current / BADGE_INTERVAL) * BADGE_INTERVAL + BADGE_INTERVAL;
}

function renderStreak(opts = {}) {
  const shown = displayStreak();
  document.getElementById("streakNum").textContent = shown;

  const flame = document.getElementById("streakFlame");
  flame.classList.toggle("active", shown > 0);
  if (opts.pop) {
    flame.classList.remove("pop");
    void flame.offsetWidth; // reflow to restart animation
    flame.classList.add("pop");
  }

  const sub = document.getElementById("streakSub");
  if (shown === 0) {
    sub.textContent = streak.lastDay ? "Streak reset — check in to begin again." : "Show up today to start your streak.";
  } else if (checkedInToday()) {
    sub.textContent = `Longest: ${streak.longest} days · ${streak.totalDays} total check-ins`;
  } else {
    sub.textContent = "Check in today to keep your streak alive.";
  }

  // Progress toward next 10-day reward
  const next = nextBadgeThreshold(shown);
  const base = next - BADGE_INTERVAL;
  const into = shown - base; // 0..10
  const pct = Math.round((into / BADGE_INTERVAL) * 100);
  document.getElementById("progressFill").style.width = pct + "%";
  document.getElementById("progressPct").textContent = pct + "%";
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

function fireConfetti() {
  const burst = document.getElementById("rewardBurst");
  burst.innerHTML = "";
  const colors = ["#d9b877", "#d98555", "#8fae83", "#f5efe7"];
  for (let i = 0; i < 28; i++) {
    const s = document.createElement("span");
    const angle = Math.random() * Math.PI * 2;
    const dist = 90 + Math.random() * 130;
    s.style.setProperty("--dx", `${Math.cos(angle) * dist}px`);
    s.style.setProperty("--dy", `${Math.sin(angle) * dist + 40}px`);
    s.style.background = colors[i % colors.length];
    s.style.animationDelay = `${Math.random() * 0.15}s`;
    burst.appendChild(s);
  }
}

function showReward(tier) {
  document.getElementById("rewardBadgeIcon").textContent = tier.days;
  document.getElementById("rewardTitle").textContent = `${tier.name}!`;
  document.getElementById("rewardDesc").textContent =
    `You've shown up ${tier.days} days. That's real, quiet strength. Badge unlocked.`;
  document.getElementById("rewardModal").classList.remove("hidden");
  fireConfetti();
}

/* Handle any activity, update UI, surface reward for the highest new badge. */
function handleActivity(opts = {}) {
  const result = recordActivity();
  renderStreak({ pop: result.counted });
  if (result.newBadges.length) {
    // show the highest tier crossed
    showReward(result.newBadges[result.newBadges.length - 1]);
  } else if (result.counted && opts.toastOnCheckin) {
    toast(`Checked in — ${displayStreak()} day streak 🔥`);
  }
  return result;
}

/* ---------------- Entry rendering ---------------- */

function matchesSearch(entry) {
  if (!searchTerm) return true;
  return (entry.note || "").toLowerCase().includes(searchTerm.toLowerCase());
}

function renderEntries() {
  const list = document.getElementById("entryList");
  const empty = document.getElementById("emptyState");
  const sorted = [...entries].sort((a, b) => b.createdAt - a.createdAt);
  const filtered = sorted.filter(matchesSearch);

  if (filtered.length === 0) {
    list.innerHTML = "";
    empty.classList.remove("hidden");
    empty.textContent = entries.length === 0
      ? "No moments logged yet. When a hard moment hits, tap the button above — it only takes a second."
      : "No moments match your search.";
    return;
  }
  empty.classList.add("hidden");

  list.innerHTML = filtered.map((e) => {
    const d = new Date(e.createdAt);
    return `
      <div class="entry-card" data-id="${e.id}">
        <span class="entry-dot"></span>
        <div class="entry-body">
          <div class="entry-top">
            <span class="entry-time">${formatTime(d)}</span>
            <span class="entry-date">${formatDate(d)}</span>
          </div>
          <div class="entry-note ${e.note ? "" : "empty"}">${e.note ? escapeHtml(e.note) : "No notes yet — tap to describe what happened."}</div>
        </div>
      </div>`;
  }).join("");

  list.querySelectorAll(".entry-card").forEach((card) => {
    card.addEventListener("click", () => openEditor(card.dataset.id));
  });
}

async function refreshEntries() {
  entries = await dbGetAll();
  renderEntries();
}

/* ---------------- Log a moment ---------------- */

async function logMoment() {
  const btn = document.getElementById("bigButton");
  btn.disabled = true;

  const now = Date.now();
  const entry = { id: uid(), createdAt: now, note: "" };
  await dbPutEntry(entry);
  entries.push(entry);
  renderEntries();
  pendingQuickEditId = entry.id;

  // Logging counts as showing up today.
  handleActivity();

  openEditor(entry.id, true);
  toast("Moment logged");
  btn.disabled = false;
}

/* ---------------- Editor modal (also used as quick-edit) ---------------- */

function openEditor(id, isNew = false) {
  const entry = entries.find((e) => e.id === id);
  if (!entry) return;
  const modal = document.getElementById("editorModal");
  const body = document.getElementById("editorBody");
  const d = new Date(entry.createdAt);
  const localDatetime = new Date(entry.createdAt - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

  document.querySelector("#editorModal .modal-header h3").textContent = isNew ? "What happened?" : "Edit Moment";

  body.innerHTML = `
    <div class="field-group">
      <label class="field-label">What happened / notes</label>
      <textarea id="edNote" placeholder="Describe the moment: what triggered it, how it felt, what you did next...">${escapeHtml(entry.note || "")}</textarea>
    </div>
    <div class="field-group">
      <label class="field-label">When</label>
      <input type="datetime-local" id="edDatetime" value="${localDatetime}">
    </div>
    <div class="qe-actions">
      <button id="edDelete" class="btn danger">${isNew ? "Discard" : "Delete"}</button>
      <button id="edSave" class="btn primary">${isNew ? "Save" : "Save changes"}</button>
    </div>
  `;

  const noteEl = document.getElementById("edNote");

  document.getElementById("edSave").addEventListener("click", async () => {
    const dtVal = document.getElementById("edDatetime").value;
    if (dtVal) entry.createdAt = new Date(dtVal).getTime();
    entry.note = noteEl.value.trim();
    await dbPutEntry(entry);
    closeModal(modal);
    pendingQuickEditId = null;
    toast("Saved");
    refreshEntries();
  });

  document.getElementById("edDelete").addEventListener("click", async () => {
    if (!isNew && !confirm("Delete this moment? This cannot be undone.")) return;
    await dbDeleteEntry(entry.id);
    closeModal(modal);
    pendingQuickEditId = null;
    toast(isNew ? "Discarded" : "Deleted");
    refreshEntries();
  });

  modal.classList.remove("hidden");
  setTimeout(() => noteEl.focus(), 50);
}

function closeModal(modal) { modal.classList.add("hidden"); }

/* ---------------- Settings ---------------- */

function renderSettings() {
  const body = document.getElementById("settingsBody");
  const earned = new Set(streak.badges);
  const badgesHtml = BADGE_TIERS.map((t) => {
    const has = earned.has(t.days);
    return `
      <div class="badge-cell ${has ? "earned" : ""}">
        <div class="badge-medal ${has ? "earned" : ""}">${t.days}</div>
        <div class="badge-name">${has ? t.name : "Locked"}</div>
      </div>`;
  }).join("");

  body.innerHTML = `
    <div class="field-group">
      <label class="field-label">Badges (${streak.badges.length}/${BADGE_TIERS.length})</label>
      <div class="badge-grid">${badgesHtml}</div>
    </div>
    <div class="settings-row">
      <div class="settings-row-text">
        <div class="settings-row-title">Longest streak</div>
        <div class="settings-row-desc">Your best run of consecutive days.</div>
      </div>
      <div style="font-weight:700;color:var(--ember)">${streak.longest} days</div>
    </div>
    <div class="settings-row">
      <div class="settings-row-text">
        <div class="settings-row-title">Total check-ins</div>
        <div class="settings-row-desc">Every distinct day you've shown up.</div>
      </div>
      <div style="font-weight:700;color:var(--sage)">${streak.totalDays} days</div>
    </div>
    <div class="settings-row">
      <div class="settings-row-text">
        <div class="settings-row-title">Export data</div>
        <div class="settings-row-desc">Download all moments + streak as a JSON backup.</div>
      </div>
      <button id="btnExport" class="btn">Export</button>
    </div>
    <div class="settings-row">
      <div class="settings-row-text">
        <div class="settings-row-title">Import data</div>
        <div class="settings-row-desc">Restore from a previously exported JSON file.</div>
      </div>
      <button id="btnImport" class="btn">Import</button>
    </div>
    <div class="settings-row">
      <div class="settings-row-text">
        <div class="settings-row-title">Clear all data</div>
        <div class="settings-row-desc">Permanently delete moments, streak and badges.</div>
      </div>
      <button id="btnClear" class="btn danger">Clear</button>
    </div>
    <input type="file" id="importFile" accept="application/json" class="hidden">
  `;

  document.getElementById("btnExport").addEventListener("click", exportData);
  document.getElementById("btnImport").addEventListener("click", () => document.getElementById("importFile").click());
  document.getElementById("importFile").addEventListener("change", importData);
  document.getElementById("btnClear").addEventListener("click", async () => {
    if (!confirm("Delete ALL data (moments, streak, badges)? This cannot be undone.")) return;
    await dbClearAll();
    streak = defaultStreak();
    saveStreak(streak);
    toast("All data cleared");
    renderStreak();
    renderSettings();
    refreshEntries();
  });
}

async function exportData() {
  const all = await dbGetAll();
  const payload = { exportedAt: Date.now(), version: 2, streak, entries: all };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `moment-aware-backup-${dayKey()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  toast("Exported");
}

function importData(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const data = JSON.parse(reader.result);
      const imported = Array.isArray(data) ? data : data.entries;
      if (!Array.isArray(imported)) throw new Error("bad format");
      for (const entry of imported) {
        if (!entry.id) entry.id = uid();
        delete entry.tags; delete entry.place; delete entry.coords; // strip legacy fields
        await dbPutEntry(entry);
      }
      if (data.streak && typeof data.streak === "object") {
        streak = { ...defaultStreak(), ...data.streak };
        saveStreak(streak);
      }
      toast(`Imported ${imported.length} moments`);
      renderStreak();
      renderSettings();
      refreshEntries();
    } catch {
      toast("Import failed — invalid file");
    }
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

  document.getElementById("searchInput").addEventListener("input", (e) => {
    searchTerm = e.target.value;
    renderEntries();
  });

  document.getElementById("settingsBtn").addEventListener("click", () => {
    renderSettings();
    document.getElementById("settingsModal").classList.remove("hidden");
  });
  document.getElementById("closeSettings").addEventListener("click", () => closeModal(document.getElementById("settingsModal")));
  document.getElementById("closeEditor").addEventListener("click", () => closeModal(document.getElementById("editorModal")));
  document.getElementById("rewardClose").addEventListener("click", () => closeModal(document.getElementById("rewardModal")));

  document.querySelectorAll(".modal").forEach((modal) => {
    modal.addEventListener("click", (e) => { if (e.target === modal) closeModal(modal); });
  });

  // First paint of streak (reflects broken streak if a day was missed).
  renderStreak();
  refreshEntries();

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
}

document.addEventListener("DOMContentLoaded", init);
