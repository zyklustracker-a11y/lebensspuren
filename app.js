// Lebensspuren – App-Logik
// Reine Client-Anwendung: alles läuft lokal, die Cloud (firebase.js) ist optional.

import { CATEGORIES as BASE_CATEGORIES } from './questions.js';
import {
  isConfigured, initCloud, onUserChanged, signInWithGoogle, signOutUser,
  uploadRecording, extensionForMime, getDriveToken, resumeRedirectSignIn,
  deleteCloudAccount, shareDriveFolderWithEmail, removeDriveFolderShare,
  pushFamilyState, fetchOwnCatalogDoc, queryFamilyMembers, fetchMemberData,
  writeMemberCatalog, fetchOwnRecordingDocs, markOwnRecordingDeleted,
  trashDriveFiles, trashDriveFilesByTitle, deleteMemberRecording,
} from './firebase.js';

const APP_VERSION = '2.0.1';

// ---------------------------------------------------------------------------
// Kleine Helfer
// ---------------------------------------------------------------------------

const $ = (sel) => document.querySelector(sel);

// Feine Linien-Icons (Inline-SVG) statt Emojis – einheitlicher Stil überall.
const ICONS = {
  mic: '<rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><path d="M12 18v3"/>',
  video: '<rect x="3" y="7" width="12" height="10" rx="2.5"/><path d="m15 10.5 6-3.5v10l-6-3.5"/>',
  feather: '<path d="M19 4c-6 1-10 5-11.5 11L6 20l5-1.5C17 17 20.5 12 21 6z"/>',
  photo: '<rect x="4" y="4" width="16" height="16" rx="2"/><circle cx="9.5" cy="9.5" r="1.6"/><path d="m5 17 4.5-4.5 3 3L16 12l3 3"/>',
  users: '<circle cx="9" cy="8.5" r="3.2"/><path d="M3.5 19c.6-3 2.8-4.7 5.5-4.7s4.9 1.7 5.5 4.7"/><circle cx="16.8" cy="9.5" r="2.5"/><path d="M15.5 14.6c2.4.2 4.2 1.7 4.9 4.4"/>',
  user: '<circle cx="12" cy="8" r="3.6"/><path d="M5.5 19.5c.8-3.6 3.3-5.5 6.5-5.5s5.7 1.9 6.5 5.5"/>',
  sliders: '<path d="M5 7h14M5 12h14M5 17h14"/><circle cx="9" cy="7" r="1.8" fill="currentColor" stroke="none"/><circle cx="15" cy="12" r="1.8" fill="currentColor" stroke="none"/><circle cx="8" cy="17" r="1.8" fill="currentColor" stroke="none"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1"/>',
  cloud: '<path d="M7 18a4.5 4.5 0 1 1 .8-8.9A6 6 0 0 1 19 10a4 4 0 0 1-1 7.9z"/>',
  cloudCheck: '<path d="M7 18a4.5 4.5 0 1 1 .8-8.9A6 6 0 0 1 19 10a4 4 0 0 1-1 7.9z"/><path d="m9 14 2 2 4-4"/>',
  phone: '<rect x="7" y="3" width="10" height="18" rx="2.5"/><path d="M11 17.5h2"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 8v.5"/>',
  play: '<path d="M8 5.5v13l11-6.5z"/>',
  pauseIc: '<path d="M9 5v14M15 5v14"/>',
  share: '<path d="M12 15V4"/><path d="m8 8 4-4 4 4"/><path d="M5 13v6h14v-6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
  trash: '<path d="M4 7h16M9 7V5h6v2M6.5 7l1 13h9l1-13"/><path d="M10 11v5M14 11v5"/>',
  x: '<path d="m7 7 10 10M17 7 7 17"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  star: '<path d="m12 3 2.7 5.8 6.3.7-4.7 4.3 1.3 6.2L12 16.9 6.4 20l1.3-6.2L3 9.5l6.3-.7z"/>',
};

function svgIcon(name, { fill = false } = {}) {
  const body = ICONS[name] || '';
  return fill
    ? `<svg class="ic" viewBox="0 0 24 24" fill="currentColor" stroke="none">${body}</svg>`
    : `<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
}

// Römische Kapitel-Nummern (Kapitel I, II, III …)
function romanNumeral(n) {
  const table = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'],
    [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  let out = '';
  for (const [v, s] of table) { while (n >= v) { out += s; n -= v; } }
  return out;
}

function formatClock(ms) {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

function formatDateTime(iso) {
  const d = new Date(iso);
  return `${d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })}, `
    + `${d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} Uhr`;
}

function isoDateStamp(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function sanitizeFilename(name) {
  return name.replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim().slice(0, 120);
}

let toastTimer = null;
function showToast(message, kind = '', durationMs = 2600) {
  const el = $('#toast');
  el.textContent = message;
  el.className = `toast show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast'; }, durationMs);
}

// Knopf, der beim ersten Tipp um Bestätigung bittet und erst beim zweiten
// Tipp handelt – verzeihlich, ohne Dialogfenster.
function armButton(btn, armedLabel, action) {
  let armed = false;
  let timer = null;
  const original = btn.innerHTML; // Icons überleben den Bestätigungs-Wechsel
  btn.addEventListener('click', async () => {
    if (!armed) {
      armed = true;
      btn.textContent = armedLabel;
      btn.classList.add('armed-look');
      timer = setTimeout(() => {
        armed = false;
        btn.innerHTML = original;
        btn.classList.remove('armed-look');
      }, 4000);
      return;
    }
    clearTimeout(timer);
    armed = false;
    btn.innerHTML = original;
    btn.classList.remove('armed-look');
    await action();
  });
}

// ---------------------------------------------------------------------------
// IndexedDB – lokale Ablage für Aufnahmen (Blobs), Fortschritt und Einstellungen
// ---------------------------------------------------------------------------

const DB_NAME = 'lebensspuren-db';
const DB_VERSION = 1;
let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('recordings')) {
        const store = db.createObjectStore('recordings', { keyPath: 'id' });
        store.createIndex('createdAt', 'createdAt');
      }
      if (!db.objectStoreNames.contains('progress')) {
        db.createObjectStore('progress', { keyPath: 'qid' });
      }
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta', { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function idbRequest(storeName, mode, fn) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    const req = fn(store);
    tx.oncomplete = () => resolve(req ? req.result : undefined);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  }));
}

const idb = {
  put: (store, value) => idbRequest(store, 'readwrite', (s) => s.put(value)),
  get: (store, key) => idbRequest(store, 'readonly', (s) => s.get(key)),
  getAll: (store) => idbRequest(store, 'readonly', (s) => s.getAll()),
  delete: (store, key) => idbRequest(store, 'readwrite', (s) => s.delete(key)),
};

async function getMeta(key, fallback) {
  const row = await idb.get('meta', key);
  return row ? row.value : fallback;
}

function setMeta(key, value) {
  return idb.put('meta', { key, value });
}

// ---------------------------------------------------------------------------
// Zustand
// ---------------------------------------------------------------------------

const state = {
  view: 'home',
  questionIndex: 0,          // aktuelle Frage (gemeinsam für alle Modi)
  catalog: [],               // Kategorien inkl. eigener Fragen/Kategorien
  allQuestions: [],          // flache Liste über den ganzen Katalog
  progress: new Map(),       // qid → { starred, answered }
  cloud: null,               // Firebase-Handle oder null
  user: null,                // angemeldeter Google-Nutzer oder null
  syncing: false,
  uploadingIds: new Set(),   // Aufnahmen, die gerade hochgeladen werden
  familySyncing: false,
  settingsSection: null,     // geöffneter Einstellungs-Bereich (null = Übersicht)
  familyMembers: null,       // Personen, die mich als Familie eingetragen haben
  memberUid: null,           // aktuell geöffnete Person in der Familien-Ansicht
  memberCache: new Map(),    // uid → { info, catalog, progress, recordings }
};

function currentQuestion() {
  return state.allQuestions[state.questionIndex];
}

// Findet ab einer Position (einschließlich) die nächste noch unbeantwortete
// Frage, mit Umlauf ans Listenende. Sind alle beantwortet, bleibt es bei from.
function nextUnansweredIndex(from) {
  const len = state.allQuestions.length;
  for (let i = 0; i < len; i++) {
    const idx = (from + i) % len;
    if (!progressFor(state.allQuestions[idx].qid).answered) return idx;
  }
  return from;
}

// Beim Start einer Erzähl-Sitzung von der Startseite aus: dort weitermachen,
// wo noch nichts aufgenommen wurde – niemand soll versehentlich doppelt erzählen.
function continueAtNextUnanswered() {
  const idx = nextUnansweredIndex(state.questionIndex);
  if (idx !== state.questionIndex) {
    state.questionIndex = idx;
    setMeta('questionIndex', idx);
  }
}

async function loadProgress() {
  const rows = await idb.getAll('progress');
  state.progress = new Map(rows.map((r) => [r.qid, r]));
}

function progressFor(qid) {
  return state.progress.get(qid) || { qid, starred: false, answered: false };
}

async function updateProgress(qid, patch) {
  const row = { ...progressFor(qid), ...patch };
  state.progress.set(qid, row);
  await idb.put('progress', row);
  scheduleFamilySync();
}

// ---------------------------------------------------------------------------
// Fragenkatalog: fest eingebaute Fragen + eigene Fragen und Kategorien
// ---------------------------------------------------------------------------

const EMPTY_CUSTOM = { questions: {}, categories: [], removedQuestions: [], removedCategories: [] };

// Bringt gespeicherte Katalog-Anpassungen (auch aus älteren App-Versionen
// ohne Ausblende-Listen) auf die vollständige Struktur – als neues Objekt,
// damit nie versehentlich EMPTY_CUSTOM verändert wird.
function normalizeCustom(custom) {
  const src = custom || {};
  return {
    questions: src.questions || {},
    categories: src.categories || [],
    removedQuestions: src.removedQuestions || [],
    removedCategories: src.removedCategories || [],
  };
}

// Setzt aus dem festen Katalog und eigenen Fragen/Kategorien die
// vollständige Struktur zusammen – auch für die Familien-Ansicht nutzbar.
// Eingebaute Fragen/Kategorien auf den Ausblende-Listen werden übersprungen.
function composeCatalog(custom) {
  const c = normalizeCustom(custom);
  const removedQ = new Set(c.removedQuestions);
  const removedC = new Set(c.removedCategories);
  const cats = [];
  for (const base of BASE_CATEGORIES) {
    if (removedC.has(base.id)) continue;
    const questions = base.questions
      .map((text, i) => ({ qid: `${base.id}-${i + 1}`, text, custom: false }))
      .filter((q) => !removedQ.has(q.qid));
    for (const q of c.questions[base.id] || []) {
      questions.push({ qid: q.qid, text: q.text, custom: true });
    }
    cats.push({ id: base.id, title: base.title, icon: base.icon, custom: false, questions });
  }
  for (const cc of c.categories || []) {
    const questions = (c.questions[cc.id] || []).map((q) => ({
      qid: q.qid, text: q.text, custom: true,
    }));
    cats.push({ id: cc.id, title: cc.title, icon: cc.icon || '💬', custom: true, questions });
  }
  const allQuestions = cats.flatMap((cat) => cat.questions.map((q) => ({
    ...q, categoryId: cat.id, categoryTitle: cat.title, categoryIcon: cat.icon,
  })));
  return { catalog: cats, allQuestions };
}

async function buildCatalog() {
  const custom = await getMeta('customCatalog', EMPTY_CUSTOM);
  const { catalog, allQuestions } = composeCatalog(custom);
  state.catalog = catalog;
  state.allQuestions = allQuestions;
  state.questionIndex = Math.min(state.questionIndex, Math.max(0, state.allQuestions.length - 1));
}

async function mutateCustomCatalog(fn) {
  const custom = normalizeCustom(await getMeta('customCatalog', null));
  fn(custom);
  await setMeta('customCatalog', custom);
  await setMeta('catalogUpdatedAt', Date.now());
  await buildCatalog();
  scheduleFamilySync();
}

async function addCustomQuestion(categoryId, text) {
  const qid = `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  await mutateCustomCatalog((c) => {
    if (!c.questions[categoryId]) c.questions[categoryId] = [];
    c.questions[categoryId].push({ qid, text });
  });
}

// Nimmt eine Frage aus einem Katalog-Anpassungsobjekt heraus: eigene Fragen
// werden gelöscht, eingebaute nur ausgeblendet. Aufnahmen bleiben in beiden
// Fällen unangetastet – sie liegen getrennt vom Katalog.
// Wird sowohl für das eigene Konto als auch in der Familien-Ansicht genutzt.
function applyQuestionRemoval(c, q) {
  if (q.custom) {
    for (const catId of Object.keys(c.questions)) {
      c.questions[catId] = c.questions[catId].filter((x) => x.qid !== q.qid);
    }
  } else if (!c.removedQuestions.includes(q.qid)) {
    c.removedQuestions.push(q.qid);
  }
}

// Entsprechend für Kategorien: eigene löschen, eingebaute ausblenden.
// Eigene Fragen der Kategorie verschwinden mit; Aufnahmen bleiben erhalten.
function applyCategoryRemoval(c, cat) {
  if (cat.custom) {
    c.categories = c.categories.filter((x) => x.id !== cat.id);
  } else if (!c.removedCategories.includes(cat.id)) {
    c.removedCategories.push(cat.id);
  }
  delete c.questions[cat.id];
}

async function removeQuestion(q) {
  await mutateCustomCatalog((c) => applyQuestionRemoval(c, q));
  if (q.custom) {
    await idb.delete('progress', q.qid).catch(() => {});
    state.progress.delete(q.qid);
  }
}

async function addCustomCategory(title) {
  await mutateCustomCatalog((c) => {
    c.categories.push({ id: `cc-${Date.now().toString(36)}`, title });
  });
}

async function removeCategory(cat) {
  await mutateCustomCatalog((c) => applyCategoryRemoval(c, cat));
}

// ---------------------------------------------------------------------------
// Design (drei Designs, jeweils hell und dunkel)
// ---------------------------------------------------------------------------

const DESIGNS = [
  { id: 'warm', name: 'Bernstein', hint: 'Warmes Papier', colors: ['#a8402c', '#f2e8d5', '#1e1811'] },
  { id: 'natur', name: 'Salbei', hint: 'Ruhig und natürlich', colors: ['#47714b', '#e9eee2', '#141a13'] },
  { id: 'modern', name: 'Indigo', hint: 'Klar und modern', colors: ['#4f46e5', '#ecebf3', '#131120'] },
];
const MODES = [
  { id: 'auto', name: 'Automatisch' },
  { id: 'light', name: 'Hell' },
  { id: 'dark', name: 'Dunkel' },
];

function themeSetting() {
  return {
    design: localStorage.getItem('ls-design') || 'warm',
    mode: localStorage.getItem('ls-mode') || 'light',
  };
}

function applyTheme() {
  const { design, mode } = themeSetting();
  const dark = mode === 'dark'
    || (mode === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.design = design;
  document.documentElement.dataset.mode = dark ? 'dark' : 'light';
  requestAnimationFrame(() => {
    const bg = getComputedStyle(document.body).getPropertyValue('--bg').trim();
    if (bg) $('meta[name="theme-color"]').setAttribute('content', bg);
  });
}

window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (themeSetting().mode === 'auto') applyTheme();
});

// ---------------------------------------------------------------------------
// Ansichten-Wechsel
// ---------------------------------------------------------------------------

const VIEWS = ['home', 'audio', 'video', 'browse', 'recordings', 'settings', 'family', 'member'];

// Welche Ansicht welchen Tab in der Leiste unten hervorhebt.
const TAB_FOR_VIEW = { home: 'home', browse: 'browse', recordings: 'recordings' };

function updateTabbar(name) {
  const tabbar = $('#tabbar');
  // Beim Erzählen (Ton/Video) bleibt der Blick frei – keine Leiste.
  tabbar.classList.toggle('hidden', name === 'audio' || name === 'video');
  const current = TAB_FOR_VIEW[name] || '';
  tabbar.querySelectorAll('button').forEach((b) => {
    b.classList.toggle('current', b.dataset.tab === current);
  });
}

async function showView(name) {
  // Laufende Aufnahme beim Verlassen immer sichern, nie verwerfen.
  if (rec.active) await stopRecording('navigation');
  if (state.view === 'video' && name !== 'video') stopCameraPreview();
  if (state.view === 'recordings' && name !== 'recordings') { closePlayer(); releaseThumbUrls(); }

  hideAnsweredDialog();
  $('#mode-dialog').classList.add('hidden');
  state.view = name;
  for (const v of VIEWS) {
    $(`#view-${v}`).classList.toggle('active', v === name);
  }
  updateTabbar(name);
  window.scrollTo(0, 0);

  if (name === 'home') renderHome();
  if (name === 'audio') renderQuestionDisplays();
  if (name === 'video') { renderQuestionDisplays(); startCameraPreview(); }
  if (name === 'browse') renderBrowse();
  if (name === 'recordings') renderRecordings();
  if (name === 'settings') renderSettings();
  if (name === 'family') renderFamily();
  if (name === 'member') renderMember();
}

// ---------------------------------------------------------------------------
// Fragen-Navigation (in Audio- und Video-Modus)
// ---------------------------------------------------------------------------

function renderQuestionDisplays() {
  const q = currentQuestion();
  if (!q) return;
  const answered = progressFor(q.qid).answered;
  $('#audio-category').textContent = q.categoryTitle;
  $('#audio-question').textContent = q.text;
  $('#audio-counter').textContent = `Frage ${state.questionIndex + 1} von ${state.allQuestions.length}`;
  $('#audio-answered').classList.toggle('hidden', !answered);
  $('#video-category').textContent = q.categoryTitle;
  $('#video-question').textContent = q.text;
  $('#video-answered').classList.toggle('hidden', !answered);
}

async function goToQuestion(index) {
  const len = state.allQuestions.length;
  if (len === 0) return;
  state.questionIndex = ((index % len) + len) % len;
  renderQuestionDisplays();
  setMeta('questionIndex', state.questionIndex);
  // Läuft gerade eine Aufnahme, wird der Fragenwechsel mit Zeitstempel protokolliert.
  if (rec.active) {
    const q = currentQuestion();
    rec.timestamps.push({
      offsetMs: recElapsed(),
      qid: q.qid,
      text: q.text,
      category: q.categoryTitle,
    });
    noteTranscriptQuestionChange(q);
  }
}

// ---------------------------------------------------------------------------
// Aufnahme-Engine (Audio und Video)
// ---------------------------------------------------------------------------

// MP4 (AAC bzw. H.264) zuerst: Diese Dateien spielt wirklich jedes Gerät ab –
// auch die Google-Drive-Vorschau auf dem iPhone, die mit WebM/Opus nichts
// anfangen kann. WebM bleibt als Reserve für Browser ohne MP4-Aufnahme
// (z. B. Firefox oder älteres Chrome).
const AUDIO_MIME_CANDIDATES = [
  'audio/mp4;codecs=mp4a.40.2',
  'audio/mp4',
  'audio/webm;codecs=opus',
  'audio/webm',
];

const VIDEO_MIME_CANDIDATES = [
  'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
  'video/mp4',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
];

function pickMimeType(candidates) {
  if (typeof MediaRecorder === 'undefined') return '';
  for (const type of candidates) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return '';
}

const rec = {
  active: false,
  mode: null,          // 'audio' | 'video'
  stream: null,        // Stream, der aufgenommen wird
  ownsStream: false,   // true = Stream wurde nur für die Aufnahme geholt (Audio-Modus)
  recorder: null,
  chunks: [],
  startTime: 0,
  timestamps: [],
  timerInterval: null,
  wakeLock: null,
  finalized: false,
  paused: false,
  pausedTotal: 0,      // Summe aller Pausen in ms
  pauseStartedAt: 0,
};

// Ab dieser Redezeit pro Frage gilt sie automatisch als beantwortet.
const ANSWERED_MIN_MS = 60000;

// Summiert je Frage, wie lange sie während der Aufnahme zu sehen war.
function computeDwellMap(timestamps, durationMs) {
  const map = new Map();
  for (let i = 0; i < timestamps.length; i++) {
    const start = timestamps[i].offsetMs || 0;
    const end = i + 1 < timestamps.length ? (timestamps[i + 1].offsetMs || 0) : durationMs;
    map.set(timestamps[i].qid, (map.get(timestamps[i].qid) || 0) + Math.max(0, end - start));
  }
  return map;
}

// Nachfrage-Dialog für kurze Aufnahmen: beantwortet oder später weiter?
let pendingAnsweredQid = null;

function askAnsweredDialog(qid, questionText) {
  pendingAnsweredQid = qid;
  $('#answered-dialog-question').textContent = questionText;
  $('#answered-dialog').classList.remove('hidden');
}

function hideAnsweredDialog() {
  pendingAnsweredQid = null;
  $('#answered-dialog').classList.add('hidden');
}

// ---------------------------------------------------------------------------
// Live-Transkription (kostenlos über die Spracherkennung des Browsers).
// Läuft nur mit, wo sie die Aufnahme nicht stört – auf iOS bewusst aus,
// dort übernimmt später z. B. NotebookLM das Transkribieren.
// ---------------------------------------------------------------------------

const speech = { engine: null, active: false, text: '' };

function transcriptionSupported() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return false;
  const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  return !isIos;
}

function startTranscription() {
  if (!transcriptionSupported()) return;
  try {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const engine = new SR();
    engine.lang = 'de-DE';
    engine.continuous = true;
    engine.interimResults = false;
    speech.engine = engine;
    speech.active = true;
    const q = currentQuestion();
    speech.text = `[00:00] Frage: ${q.text}\n`;
    let failures = 0;
    engine.onresult = (e) => {
      failures = 0;
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) {
          const part = (e.results[i][0].transcript || '').trim();
          if (part) speech.text += `${part} `;
        }
      }
    };
    // Chrome beendet die Erkennung nach Sprechpausen von selbst –
    // solange die Aufnahme läuft, einfach wieder starten. Schlägt sie
    // mehrfach hintereinander fehl (z. B. offline), aufgeben statt loopen.
    engine.onend = () => {
      if (speech.active && rec.active && !rec.paused && failures < 3) {
        try { engine.start(); } catch { /* schon gestartet */ }
      }
    };
    engine.onerror = () => { failures += 1; };
    engine.start();
  } catch (err) {
    console.warn('Transkription nicht verfügbar:', err);
    speech.engine = null;
    speech.active = false;
  }
}

function pauseTranscription() {
  if (speech.engine) { try { speech.engine.stop(); } catch { /* egal */ } }
}

function resumeTranscription() {
  if (speech.active && speech.engine) {
    try { speech.engine.start(); } catch { /* läuft evtl. schon */ }
  }
}

function noteTranscriptQuestionChange(question) {
  if (speech.active) {
    speech.text += `\n\n[${formatClock(recElapsed())}] Frage: ${question.text}\n`;
  }
}

// Beendet die Erkennung und liefert das Transkript (oder '').
function stopTranscription() {
  if (!speech.active) return '';
  speech.active = false;
  pauseTranscription();
  speech.engine = null;
  const body = speech.text.trim();
  speech.text = '';
  // Nur die Fragen-Marker ohne gesprochenen Text zählen nicht als Transkript.
  const spoken = body.replace(/\[[0-9:]+\] Frage: [^\n]*\n?/g, '').trim();
  return spoken ? body : '';
}

// Verstrichene Aufnahmezeit ohne Pausen – entspricht der Zeit in der
// fertigen Datei (MediaRecorder.pause hält auch die Medienzeit an).
function recElapsed() {
  let t = Date.now() - rec.startTime - rec.pausedTotal;
  if (rec.paused) t -= Date.now() - rec.pauseStartedAt;
  return Math.max(0, t);
}

async function acquireWakeLock() {
  try {
    if ('wakeLock' in navigator) {
      rec.wakeLock = await navigator.wakeLock.request('screen');
    }
  } catch {
    // Kein Wake Lock verfügbar – die Aufnahme läuft trotzdem.
  }
}

function releaseWakeLock() {
  if (rec.wakeLock) {
    rec.wakeLock.release().catch(() => {});
    rec.wakeLock = null;
  }
}

function recordButton(mode) {
  return $(mode === 'audio' ? '#audio-record' : '#video-record');
}

function timerElement(mode) {
  return $(mode === 'audio' ? '#audio-timer' : '#video-timer');
}

function updateTimer() {
  if (!rec.active) return;
  timerElement(rec.mode).textContent = formatClock(recElapsed());
}

async function startRecording(mode) {
  if (rec.active) return;
  try {
    let stream;
    let ownsStream;
    if (mode === 'audio') {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      ownsStream = true;
    } else {
      // Video: den bereits laufenden Vorschau-Stream mit aufnehmen.
      if (!camera.stream) await startCameraPreview();
      if (!camera.stream) throw new Error('Kamera nicht verfügbar');
      stream = camera.stream;
      ownsStream = false;
    }

    const mimeType = pickMimeType(mode === 'audio' ? AUDIO_MIME_CANDIDATES : VIDEO_MIME_CANDIDATES);
    const recorder = mimeType
      ? new MediaRecorder(stream, { mimeType })
      : new MediaRecorder(stream);

    rec.active = true;
    rec.mode = mode;
    rec.stream = stream;
    rec.ownsStream = ownsStream;
    rec.recorder = recorder;
    rec.chunks = [];
    rec.startTime = Date.now();
    rec.finalized = false;
    rec.paused = false;
    rec.pausedTotal = 0;
    rec.pauseStartedAt = 0;
    const q = currentQuestion();
    rec.timestamps = [{ offsetMs: 0, qid: q.qid, text: q.text, category: q.categoryTitle }];

    // Alle Rückrufe prüfen, ob sie noch zur aktuellen Aufnahme gehören –
    // sonst könnte ein verspäteter Rückruf eine neue Aufnahme beenden.
    recorder.ondataavailable = (e) => {
      if (rec.recorder === recorder && e.data && e.data.size > 0) rec.chunks.push(e.data);
    };
    recorder.onstop = () => { if (rec.recorder === recorder) finalizeRecording(); };
    recorder.onerror = () => { if (rec.recorder === recorder) stopRecording('fehler'); };

    // Jede Sekunde ein Datenpaket: bei Unterbrechungen geht fast nichts verloren.
    recorder.start(1000);

    await acquireWakeLock();
    rec.timerInterval = setInterval(updateTimer, 500);

    recordButton(mode).classList.add('recording');
    const timerEl = timerElement(mode);
    timerEl.classList.remove('idle');
    timerEl.textContent = '00:00';
    // Pause-Knopf nur zeigen, wenn der Browser Pausieren unterstützt.
    if (typeof recorder.pause === 'function') {
      pauseButton(mode).classList.remove('hidden');
      updatePauseUi();
    }
    if (mode === 'audio') {
      $('#audio-hint').textContent = 'Aufnahme läuft – erzähl einfach. Zum Beenden erneut tippen.';
      startWaveform(stream);
    } else {
      $('#video-flip').classList.add('hidden');
    }
    startTranscription();
  } catch (err) {
    console.warn('Aufnahme konnte nicht starten:', err);
    resetRecordingUi(mode);
    const device = mode === 'audio' ? 'das Mikrofon' : 'Kamera und Mikrofon';
    showToast(`Bitte erlaube der App den Zugriff auf ${device}.`, 'error', 5000);
  }
}

// Beendet die Aufnahme. Das Speichern übernimmt finalizeRecording –
// auch bei Fehlern oder wenn die App in den Hintergrund geht.
async function stopRecording(reason = 'stop') {
  if (!rec.active) return;
  rec.active = false;
  clearInterval(rec.timerInterval);
  try {
    if (rec.recorder && rec.recorder.state !== 'inactive') rec.recorder.stop();
    else finalizeRecording();
  } catch {
    finalizeRecording();
  }
  // Sicherheitsnetz: falls onstop nicht feuert, trotzdem speichern – aber nur,
  // solange nicht längst eine neue Aufnahme läuft.
  const recorderAtStop = rec.recorder;
  setTimeout(() => {
    if (rec.recorder === recorderAtStop) finalizeRecording();
  }, 2000);
  if (reason === 'fehler') {
    showToast('Die Aufnahme wurde unterbrochen – alles bisher Gesagte ist gespeichert.', '', 4000);
  }
}

async function finalizeRecording() {
  if (rec.finalized) return;
  rec.finalized = true;

  const mode = rec.mode;
  const durationMs = recElapsed();
  const transcript = stopTranscription();
  const mimeType = (rec.recorder && rec.recorder.mimeType)
    || (rec.chunks[0] && rec.chunks[0].type)
    || (mode === 'audio' ? 'audio/webm' : 'video/webm');
  const blob = new Blob(rec.chunks, { type: mimeType });

  releaseWakeLock();
  stopWaveform();
  if (rec.ownsStream && rec.stream) {
    rec.stream.getTracks().forEach((t) => t.stop());
  }
  rec.stream = null;
  resetRecordingUi(mode);

  // Extrem kurze „Aufnahmen" (versehentliches Doppeltippen) ohne Daten überspringen.
  if (blob.size === 0) return;

  const started = new Date(rec.startTime);
  const firstQuestion = rec.timestamps[0];

  // Mehrere Aufnahmen zur selben Startfrage werden durchnummeriert
  // („Teil 2", „Teil 3" …), damit die Reihenfolge in der Übersicht und
  // im Drive-Ordner sofort erkennbar ist.
  let partSuffix = '';
  try {
    const existing = (await idb.getAll('recordings')).filter((r) => {
      const startQid = r.startQid || (r.timestamps && r.timestamps[0] && r.timestamps[0].qid);
      return startQid === firstQuestion.qid;
    }).length;
    if (existing > 0) partSuffix = ` (Teil ${existing + 1})`;
  } catch {
    // Nummerierung ist Komfort – das Speichern geht immer vor.
  }

  const recording = {
    id: `rec-${rec.startTime}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: started.toISOString(),
    mode,
    mimeType,
    blob,
    size: blob.size,
    durationMs,
    startQid: firstQuestion.qid,
    title: `${isoDateStamp(started)} – ${firstQuestion.text}${partSuffix}`,
    timestamps: rec.timestamps,
    transcript,
    uploaded: false,
    driveFileId: null,
  };

  try {
    await idb.put('recordings', recording);
  } catch (err) {
    console.error('Speichern fehlgeschlagen:', err);
    showToast('Das Speichern hat leider nicht geklappt. Bitte versuch es noch einmal.', 'error', 5000);
    return;
  }

  // Haken nur für echtes Erzählen: Eine Frage gilt als beantwortet, wenn
  // während der Aufnahme mindestens eine Minute zu ihr gesprochen wurde.
  const dwell = computeDwellMap(recording.timestamps, durationMs);
  let answeredAny = false;
  for (const [qid, ms] of dwell) {
    if (ms >= ANSWERED_MIN_MS) {
      await updateProgress(qid, { answered: true });
      answeredAny = true;
    }
  }
  renderQuestionDisplays(); // „Schon beantwortet"-Hinweis sofort anzeigen

  if (answeredAny) {
    showToast('✓ Deine Erinnerung ist gespeichert', 'success', 3200);
  } else {
    // Kurze Aufnahme: freundlich nachfragen statt automatisch abhaken.
    let bestQid = recording.timestamps[0].qid;
    let bestMs = -1;
    for (const [qid, ms] of dwell) {
      if (ms > bestMs) { bestMs = ms; bestQid = qid; }
    }
    const q = state.allQuestions.find((x) => x.qid === bestQid);
    askAnsweredDialog(bestQid, q ? q.text : recording.timestamps[0].text);
  }

  // Speicher gegen automatisches Aufräumen des Browsers schützen.
  if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persist().catch(() => {});
  }

  syncAll(); // Im Hintergrund in die Cloud sichern, falls angemeldet.
}

function resetRecordingUi(mode) {
  recordButton(mode).classList.remove('recording', 'paused');
  pauseButton(mode).classList.add('hidden');
  const timerEl = timerElement(mode);
  timerEl.classList.add('idle');
  timerEl.textContent = '';
  if (mode === 'audio') {
    $('#audio-hint').textContent = 'Tippe auf das Siegel und erzähl einfach los.';
  } else {
    $('#video-flip').classList.remove('hidden');
  }
}

function toggleRecording(mode) {
  if (rec.active) stopRecording('stop');
  else startRecording(mode);
}

// ---------------------------------------------------------------------------
// Pause: kurz nachdenken, dann in derselben Aufnahme weitererzählen
// ---------------------------------------------------------------------------

function pauseButton(mode) {
  return $(mode === 'audio' ? '#audio-pause' : '#video-pause');
}

function togglePause() {
  if (!rec.active || !rec.recorder || typeof rec.recorder.pause !== 'function') return;
  try {
    if (rec.paused) {
      rec.recorder.resume();
      rec.pausedTotal += Date.now() - rec.pauseStartedAt;
      rec.paused = false;
      resumeTranscription();
      if (rec.mode === 'audio') {
        $('#audio-hint').textContent = 'Aufnahme läuft – erzähl einfach. Zum Beenden erneut tippen.';
        drawWaveform();
      }
    } else {
      rec.recorder.pause();
      rec.paused = true;
      rec.pauseStartedAt = Date.now();
      pauseTranscription();
      if (rec.mode === 'audio') {
        $('#audio-hint').textContent = 'Pause – nimm dir Zeit zum Nachdenken. Es geht in derselben Aufnahme weiter.';
        cancelAnimationFrame(wave.raf);
      }
    }
  } catch (err) {
    console.warn('Pausieren nicht möglich:', err);
  }
  updatePauseUi();
}

function updatePauseUi() {
  if (!rec.active) return;
  const btn = pauseButton(rec.mode);
  btn.textContent = rec.paused ? '▶ Weiter erzählen' : '⏸ Pause';
  btn.classList.toggle('resumed', rec.paused);
  recordButton(rec.mode).classList.toggle('paused', rec.paused);
  updateTimer();
}

// Geht die App in den Hintergrund (Anruf, Bildschirmsperre, App-Wechsel),
// wird sofort gespeichert – auf dem iPhone würde die Aufnahme ohnehin stoppen.
document.addEventListener('visibilitychange', () => {
  if (document.hidden && rec.active) stopRecording('hintergrund');
  // Zurück in der App: liegengebliebene Sicherungen erneut anstoßen.
  if (!document.hidden) { syncAll(); syncFamilyData(); }
});
window.addEventListener('pagehide', () => {
  if (rec.active) stopRecording('hintergrund');
});

// ---------------------------------------------------------------------------
// Wellenform-Animation (Audio-Modus)
// ---------------------------------------------------------------------------

const wave = { ctx: null, analyser: null, raf: null, data: null };

function startWaveform(stream) {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    wave.ctx = new AudioCtx();
    const source = wave.ctx.createMediaStreamSource(stream);
    wave.analyser = wave.ctx.createAnalyser();
    wave.analyser.fftSize = 128;
    source.connect(wave.analyser);
    wave.data = new Uint8Array(wave.analyser.frequencyBinCount);
    drawWaveform();
  } catch {
    // Ohne Wellenform geht es auch – der Timer zeigt, dass es läuft.
  }
}

function drawWaveform() {
  const canvas = $('#waveform');
  const g = canvas.getContext('2d');
  const accent = getComputedStyle(document.body).getPropertyValue('--record').trim() || '#d32f2f';
  const render = () => {
    if (!wave.analyser) return;
    wave.analyser.getByteFrequencyData(wave.data);
    g.clearRect(0, 0, canvas.width, canvas.height);
    const bars = 32;
    const step = Math.floor(wave.data.length / bars);
    const barWidth = canvas.width / bars;
    g.fillStyle = accent;
    for (let i = 0; i < bars; i++) {
      const v = wave.data[i * step] / 255;
      const h = Math.max(4, v * canvas.height * 0.9);
      g.beginPath();
      g.roundRect(i * barWidth + barWidth * 0.2, (canvas.height - h) / 2, barWidth * 0.6, h, 3);
      g.fill();
    }
    wave.raf = requestAnimationFrame(render);
  };
  render();
}

function stopWaveform() {
  cancelAnimationFrame(wave.raf);
  if (wave.ctx) wave.ctx.close().catch(() => {});
  wave.ctx = null;
  wave.analyser = null;
  const canvas = $('#waveform');
  canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
}

// ---------------------------------------------------------------------------
// Kamera-Vorschau (Video-Modus)
// ---------------------------------------------------------------------------

const camera = { stream: null, facing: 'user' };

async function startCameraPreview() {
  if (camera.stream) return;
  try {
    camera.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: camera.facing, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: true,
    });
    const video = $('#camera-preview');
    video.srcObject = camera.stream;
    video.classList.toggle('mirrored', camera.facing === 'user');
    await video.play().catch(() => {});
  } catch (err) {
    console.warn('Kamera nicht verfügbar:', err);
    showToast('Bitte erlaube der App den Zugriff auf Kamera und Mikrofon.', 'error', 5000);
  }
}

function stopCameraPreview() {
  if (camera.stream) {
    camera.stream.getTracks().forEach((t) => t.stop());
    camera.stream = null;
  }
  $('#camera-preview').srcObject = null;
}

async function flipCamera() {
  if (rec.active) return; // Während der Aufnahme nicht wechseln
  camera.facing = camera.facing === 'user' ? 'environment' : 'user';
  stopCameraPreview();
  await startCameraPreview();
}

// ---------------------------------------------------------------------------
// Startseite
// ---------------------------------------------------------------------------

async function renderHome() {
  const recordings = await idb.getAll('recordings');
  const count = recordings.length;
  $('#home-rec-count').textContent = count === 0
    ? 'Noch keine Aufnahmen'
    : count === 1 ? '1 Aufnahme' : `${count} Aufnahmen`;

  // Buchdeckel: Name aus dem Profil, Untertitel aus den echten Aufnahmen.
  const name = ((await getMeta('profileName', '')) || '').trim();
  if (name) {
    $('#home-cover-over').textContent = 'Das Lebensbuch von';
    $('#home-cover-name').textContent = name;
  } else {
    $('#home-cover-over').textContent = 'Dein';
    $('#home-cover-name').textContent = 'Lebensbuch';
  }
  if (count === 0) {
    $('#home-cover-sub').textContent = 'Schlag das erste Kapitel auf und erzähl einfach los.';
  } else {
    const earliest = recordings.reduce((a, r) => (r.createdAt < a ? r.createdAt : a), recordings[0].createdAt);
    const started = new Date(earliest).toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
    $('#home-cover-sub').textContent = `Begonnen im ${started} · ${count === 1 ? '1 Geschichte' : `${count} Geschichten`}`;
  }

  // „Hier geht es weiter": die nächste unbeantwortete Frage.
  const total = state.allQuestions.length;
  const answered = state.allQuestions.filter((q) => progressFor(q.qid).answered).length;
  if (total === 0) {
    $('#home-question-label').textContent = 'Dein Buch wartet';
    $('#home-question').textContent = 'Füge unter „Fragen stöbern“ eigene Fragen hinzu.';
  } else {
    const next = state.allQuestions[nextUnansweredIndex(state.questionIndex)];
    $('#home-question-label').textContent = answered >= total
      ? 'Alle Fragen erzählt – weiter so!'
      : 'Hier geht es weiter';
    $('#home-question').textContent = next.text;
  }

  // Fortschrittslinie – zählt immer den aktuellen Stand.
  $('#home-progress-label').textContent = `${answered} von ${total} erzählt`;
  $('#home-progress-fill').style.width = total > 0 ? `${Math.round((answered / total) * 100)}%` : '0%';
}

// ---------------------------------------------------------------------------
// Fragen-Modus (Stöbern, eigene Fragen und Kategorien)
// ---------------------------------------------------------------------------

function buildQuestionRow(q) {
  const p = progressFor(q.qid);
  const row = document.createElement('div');
  row.className = 'question-row';

  const main = document.createElement('button');
  main.className = 'question-row-main';
  const check = document.createElement('span');
  check.className = `check${p.answered ? '' : ' open'}`;
  check.innerHTML = svgIcon('feather', { fill: p.answered });
  if (p.answered) check.setAttribute('title', 'Schon beantwortet');
  const label = document.createElement('span');
  label.textContent = q.text;
  main.append(check, label);
  main.addEventListener('click', async () => {
    const idx = state.allQuestions.findIndex((item) => item.qid === q.qid);
    if (idx < 0) return;
    await goToQuestion(idx);
    showView('audio');
  });
  row.appendChild(main);

  const remove = document.createElement('button');
  remove.className = 'row-remove-btn';
  remove.innerHTML = svgIcon('x');
  remove.setAttribute('aria-label', 'Frage löschen');
  armButton(remove, 'Löschen?', async () => {
    const wasAnswered = progressFor(q.qid).answered;
    await removeQuestion(q);
    renderBrowse();
    showToast(wasAnswered
      ? 'Frage entfernt – deine Aufnahme dazu bleibt erhalten'
      : 'Frage entfernt');
  });
  row.appendChild(remove);

  const star = document.createElement('button');
  star.className = `star-btn${p.starred ? ' starred' : ''}`;
  star.innerHTML = svgIcon('star', { fill: p.starred });
  star.setAttribute('aria-label', p.starred ? 'Merken aufheben' : 'Frage merken');
  star.addEventListener('click', async () => {
    await updateProgress(q.qid, { starred: !progressFor(q.qid).starred });
    renderBrowse();
  });
  row.appendChild(star);

  return row;
}

// Kleines Eingabeformular (eine Zeile + Speichern/Abbrechen), das einen
// „Hinzufügen"-Knopf ersetzt, solange es offen ist.
function buildInlineForm(placeholder, onSave, onCancel) {
  const wrap = document.createElement('div');
  wrap.className = 'inline-form';
  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = placeholder;
  input.maxLength = 200;
  const buttons = document.createElement('div');
  buttons.className = 'inline-form-buttons';
  const save = document.createElement('button');
  save.className = 'action-btn primary-action';
  save.textContent = 'Speichern';
  const cancel = document.createElement('button');
  cancel.className = 'action-btn';
  cancel.textContent = 'Abbrechen';
  save.addEventListener('click', async () => {
    const text = input.value.trim();
    if (!text) { input.focus(); return; }
    await onSave(text);
  });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') save.click(); });
  cancel.addEventListener('click', () => onCancel());
  buttons.append(save, cancel);
  wrap.append(input, buttons);
  return { wrap, input };
}

function buildAddButton(label, placeholder, onSave, onCancel = () => renderBrowse()) {
  const btn = document.createElement('button');
  btn.className = 'add-btn';
  btn.innerHTML = `${svgIcon('plus')} ${label}`;
  btn.addEventListener('click', () => {
    const { wrap, input } = buildInlineForm(placeholder, onSave, onCancel);
    btn.replaceWith(wrap);
    input.focus();
  });
  return btn;
}

function renderBrowse() {
  const list = $('#browse-list');
  list.textContent = '';

  // Gemerkte Fragen zuerst – das ist die Bedeutung des Sterns.
  const starred = state.allQuestions.filter((q) => progressFor(q.qid).starred);
  if (starred.length > 0) {
    const heading = document.createElement('h2');
    heading.className = 'browse-category';
    heading.innerHTML = `<span style="color:var(--star)">${svgIcon('star', { fill: true })}</span> Deine gemerkten Fragen`;
    list.appendChild(heading);
    const card = document.createElement('div');
    card.className = 'chapter-card';
    for (const q of starred) card.appendChild(buildQuestionRow(q));
    list.appendChild(card);
  }

  let chapterNo = 0;
  for (const cat of state.catalog) {
    chapterNo += 1;
    const heading = document.createElement('h2');
    heading.className = 'browse-category';
    const no = document.createElement('span');
    no.className = 'chapter-no';
    no.textContent = `Kapitel ${romanNumeral(chapterNo)}`;
    const t = document.createElement('span');
    t.textContent = cat.title;
    heading.append(no, t);
    const answeredCount = cat.questions.filter((q) => progressFor(q.qid).answered).length;
    if (answeredCount > 0) {
      const prog = document.createElement('span');
      prog.className = 'browse-category-progress';
      prog.textContent = `${answeredCount} von ${cat.questions.length} erzählt`;
      heading.appendChild(prog);
    }
    // Schutz vor Fehlklicks: Ein ganzes Kapitel lässt sich erst löschen,
    // wenn alle seine Fragen einzeln entfernt wurden.
    if (cat.questions.length === 0) {
      const removeCat = document.createElement('button');
      removeCat.className = 'row-remove-btn category-remove';
      removeCat.innerHTML = svgIcon('x');
      removeCat.setAttribute('aria-label', `Kapitel „${cat.title}" löschen`);
      armButton(removeCat, 'Löschen?', async () => {
        await removeCategory(cat);
        renderBrowse();
        showToast('Kapitel entfernt – vorhandene Aufnahmen bleiben erhalten');
      });
      heading.appendChild(removeCat);
    }
    list.appendChild(heading);

    const card = document.createElement('div');
    card.className = 'chapter-card';
    for (const q of cat.questions) {
      card.appendChild(buildQuestionRow(q));
    }
    card.appendChild(buildAddButton('Eigene Frage hinzufügen', 'Deine Frage …', async (text) => {
      await addCustomQuestion(cat.id, text);
      renderBrowse();
      showToast('✓ Frage hinzugefügt', 'success');
    }));
    list.appendChild(card);
  }

  const catHeading = document.createElement('h2');
  catHeading.className = 'browse-category';
  catHeading.textContent = 'Neues Kapitel';
  list.appendChild(catHeading);
  const addCard = document.createElement('div');
  addCard.className = 'chapter-card';
  addCard.appendChild(buildAddButton('Eigenes Kapitel hinzufügen', 'Name des Kapitels …', async (text) => {
    await addCustomCategory(text);
    renderBrowse();
    showToast('✓ Kapitel hinzugefügt – füge ihm jetzt Fragen hinzu', 'success', 3500);
  }));
  list.appendChild(addCard);
}

// ---------------------------------------------------------------------------
// Meine Erinnerungen (Übersicht, Abspielen, Teilen, Export, Löschen)
// ---------------------------------------------------------------------------

let playerUrl = null;

function closePlayer() {
  if (playerUrl) {
    URL.revokeObjectURL(playerUrl);
    playerUrl = null;
  }
}

// Objekt-Adressen der Video-Vorschaubilder – werden beim nächsten
// Neuaufbau der Liste bzw. beim Verlassen der Ansicht freigegeben.
let thumbUrls = [];

function releaseThumbUrls() {
  thumbUrls.forEach((u) => URL.revokeObjectURL(u));
  thumbUrls = [];
}

async function renderRecordings() {
  closePlayer();
  releaseThumbUrls();
  const list = $('#recordings-list');
  list.textContent = '';

  const recordings = (await idb.getAll('recordings'))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  $('#recordings-toolbar').classList.toggle('hidden', recordings.length === 0);

  if (recordings.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'recordings-empty';
    empty.textContent = 'Hier erscheinen deine Erinnerungen, sobald du etwas erzählt hast. Tippe unten auf „Erzählen" und leg einfach los!';
    list.appendChild(empty);
    return;
  }

  // Freundliche Erinnerung, ungesicherte Aufnahmen zu teilen bzw. zu sichern.
  const unsecured = recordings.filter((r) => !r.uploaded).length;
  if (unsecured > 0) {
    const reminder = document.createElement('p');
    reminder.className = 'share-reminder';
    const countText = unsecured === 1 ? '1 Aufnahme ist' : `${unsecured} Aufnahmen sind`;
    if (state.user) {
      reminder.textContent = `${countText} noch nicht in Google Drive gesichert. `;
      const syncBtn = document.createElement('button');
      syncBtn.className = 'action-btn';
      syncBtn.innerHTML = `${svgIcon('cloud')} Jetzt sichern`;
      syncBtn.addEventListener('click', async () => {
        syncBtn.disabled = true;
        const token = await getDriveToken({ interactive: true });
        if (token) {
          showToast('Die Sicherung läuft im Hintergrund.');
          syncAll();
        } else {
          showToast('Die Sicherung hat nicht geklappt. Versuch es später noch einmal.', 'error', 4000);
        }
        syncBtn.disabled = false;
      });
      reminder.appendChild(syncBtn);
    } else {
      reminder.textContent = `Tipp: ${countText} bisher nur auf diesem Gerät. Teile sie mit deiner Familie, damit nichts verloren geht.`;
    }
    list.appendChild(reminder);
  }

  for (const recording of recordings) {
    list.appendChild(buildRecordingCard(recording));
  }
}

function buildRecordingCard(recording) {
  const card = document.createElement('article');
  card.className = 'recording-card';
  card.dataset.id = recording.id;

  // Polaroid-Kopf mit Klebestreifen, echtem Vorschaubild und Abspiel-Knopf.
  // Hier läuft später auch die Wiedergabe – direkt im Rahmen.
  const img = document.createElement('div');
  img.className = `pol-img${recording.mode === 'video' ? ' video' : ''}`;
  const tape = document.createElement('span');
  tape.className = 'pol-tape';

  if (recording.mode === 'video') {
    // Titelbild: das erste Bild des Videos, direkt aus der Aufnahme.
    const thumb = document.createElement('video');
    thumb.className = 'pol-thumb';
    thumb.muted = true;
    thumb.setAttribute('playsinline', '');
    thumb.preload = 'metadata';
    const url = URL.createObjectURL(recording.blob);
    thumbUrls.push(url);
    thumb.src = url;
    // Manche Browser zeigen erst nach einem Mini-Sprung ein Bild.
    thumb.addEventListener('loadedmetadata', () => {
      try { thumb.currentTime = 0.1; } catch { /* dann eben Bild 0 */ }
    }, { once: true });
    img.appendChild(thumb);
  } else {
    // Sprachmemo: Mikrofon und Klangwellen als Erkennungsbild.
    const deco = document.createElement('div');
    deco.className = 'pol-audio-deco';
    const bars = Array.from({ length: 26 }, (_, i) => {
      const seed = (recording.id.charCodeAt((i * 7) % recording.id.length) || 65) % 60;
      return `<i style="height:${28 + seed}%"></i>`;
    }).join('');
    deco.innerHTML = `${svgIcon('mic')}<span class="pol-bars">${bars}</span>`;
    img.appendChild(deco);
  }

  const playBtn = document.createElement('button');
  playBtn.className = 'play-btn';
  playBtn.innerHTML = svgIcon('play', { fill: true });
  playBtn.setAttribute('aria-label', 'Abspielen');
  playBtn.addEventListener('click', () => togglePlayback(recording, card, playBtn));
  img.append(tape, playBtn);

  const title = document.createElement('h3');
  title.className = 'recording-title';
  title.textContent = recording.title;

  const meta = document.createElement('p');
  meta.className = 'recording-meta';
  const sizeMb = (recording.size / (1024 * 1024)).toFixed(1);
  meta.textContent = `${formatDateTime(recording.createdAt)} · ${formatClock(recording.durationMs)} Minuten · ${sizeMb} MB`;

  const badge = document.createElement('span');
  badge.className = 'sync-badge';
  applySyncBadge(badge, recording);
  meta.appendChild(document.createElement('br'));
  meta.appendChild(badge);

  const actions = document.createElement('div');
  actions.className = 'recording-actions';

  const shareBtn = document.createElement('button');
  shareBtn.className = 'action-btn';
  shareBtn.innerHTML = `${svgIcon('share')} Teilen`;
  shareBtn.addEventListener('click', () => shareRecording(recording));

  const tsBtn = document.createElement('button');
  tsBtn.className = 'action-btn';
  tsBtn.innerHTML = `${svgIcon('clock')} Zeitstempel`;
  tsBtn.addEventListener('click', () => exportTimestamps(recording));

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'action-btn danger';
  deleteBtn.innerHTML = `${svgIcon('trash')} Löschen`;
  armButton(deleteBtn, 'Wirklich löschen?', async () => {
    await idb.delete('recordings', recording.id);
    closePlayer();
    showToast('Aufnahme gelöscht');
    renderRecordings();
    scheduleFamilySync(); // Drive-Papierkorb und Familien-Ansicht nachziehen
  });

  actions.append(shareBtn, tsBtn, deleteBtn);
  card.append(img, title, meta, actions);
  return card;
}

function applySyncBadge(badge, recording) {
  if (recording.uploaded) {
    badge.className = 'sync-badge synced';
    badge.innerHTML = `${svgIcon('cloudCheck')} In Google Drive gesichert`;
  } else if (state.uploadingIds.has(recording.id)) {
    badge.className = 'sync-badge pending';
    badge.innerHTML = `${svgIcon('cloud')} Wird gerade gesichert …`;
  } else {
    badge.className = 'sync-badge local';
    badge.innerHTML = `${svgIcon('phone')} Nur auf diesem Gerät`;
  }
}

// Spielt die Aufnahme direkt im Polaroid-Rahmen ab: Videos ziehen den
// Rahmen auf ihre echte Größe auf, Sprachmemos behalten ihr Erkennungsbild
// und bekommen die Abspiel-Leiste unten in den Rahmen gelegt.
function togglePlayback(recording, card, playBtn) {
  const frame = card.querySelector('.pol-img');
  const existing = card.querySelector('.recording-player');
  if (existing) {
    existing.remove();
    frame.classList.remove('playing');
    closePlayer();
    playBtn.innerHTML = svgIcon('play', { fill: true });
    playBtn.setAttribute('aria-label', 'Abspielen');
    return;
  }
  // Nur ein Player gleichzeitig
  document.querySelectorAll('.recording-player').forEach((el) => el.remove());
  document.querySelectorAll('.pol-img.playing').forEach((f) => f.classList.remove('playing'));
  document.querySelectorAll('.play-btn').forEach((b) => {
    b.innerHTML = svgIcon('play', { fill: true });
    b.setAttribute('aria-label', 'Abspielen');
  });
  closePlayer();

  const el = document.createElement(recording.mode === 'video' ? 'video' : 'audio');
  el.className = 'recording-player';
  el.controls = true;
  el.setAttribute('playsinline', '');
  playerUrl = URL.createObjectURL(recording.blob);
  el.src = playerUrl;
  frame.appendChild(el);
  frame.classList.add('playing');
  playBtn.innerHTML = svgIcon('x');
  playBtn.setAttribute('aria-label', 'Schließen');
  el.play().catch(() => {});
}

// ---------------------------------------------------------------------------
// Teilen und Export
// ---------------------------------------------------------------------------

function fileForRecording(recording) {
  const ext = extensionForMime(recording.mimeType);
  const name = `${sanitizeFilename(recording.title)}.${ext}`;
  return new File([recording.blob], name, { type: recording.mimeType });
}

function timestampsText(recording) {
  const lines = [];
  lines.push(`Aufnahme: ${recording.title}`);
  lines.push(`Datum: ${formatDateTime(recording.createdAt)}`);
  lines.push(`Dauer: ${formatClock(recording.durationMs)}`);
  lines.push('');
  lines.push('Zeitstempel der Fragen:');
  for (const ts of recording.timestamps) {
    lines.push(`[${formatClock(ts.offsetMs)}] ${ts.category} – ${ts.text}`);
  }
  return lines.join('\n');
}

function timestampsFile(recording) {
  const name = `${sanitizeFilename(recording.title)} – Zeitstempel.txt`;
  return new File([timestampsText(recording)], name, { type: 'text/plain' });
}

function transcriptText(recording) {
  if (!recording.transcript) return '';
  return [
    `Aufnahme: ${recording.title}`,
    `Datum: ${formatDateTime(recording.createdAt)}`,
    'Automatisches Transkript (Browser-Spracherkennung – kann Fehler enthalten):',
    '',
    recording.transcript,
  ].join('\n');
}

function transcriptFile(recording) {
  const name = `${sanitizeFilename(recording.title)} – Transkript.txt`;
  return new File([transcriptText(recording)], name, { type: 'text/plain' });
}

// Ordnername im Drive: „Kategorie – Frage" der Startfrage.
function questionFolderName(recording) {
  const first = recording.timestamps && recording.timestamps[0];
  if (!first) return '';
  return sanitizeFilename(`${first.category} – ${first.text}`).slice(0, 100);
}

async function shareFiles(files, fallbackToastText) {
  if (navigator.share && navigator.canShare && navigator.canShare({ files })) {
    try {
      await navigator.share({ files, title: 'Lebensspuren' });
      return true;
    } catch (err) {
      if (err && err.name === 'AbortError') return false; // Nutzer hat abgebrochen
      console.warn('Teilen fehlgeschlagen, nutze Download:', err);
    }
  }
  // Fallback: Dateien als Download anbieten
  for (const file of files) {
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  if (fallbackToastText) showToast(fallbackToastText, '', 4000);
  return true;
}

async function shareRecording(recording) {
  const files = [fileForRecording(recording), timestampsFile(recording)];
  if (recording.transcript) files.push(transcriptFile(recording));
  await shareFiles(files, 'Die Dateien wurden heruntergeladen.');
}

async function exportTimestamps(recording) {
  await shareFiles([timestampsFile(recording)], 'Die Zeitstempel-Datei wurde heruntergeladen.');
}

async function shareAllRecordings() {
  const recordings = (await idb.getAll('recordings'))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  if (recordings.length === 0) return;
  const files = recordings.map(fileForRecording);
  await shareFiles(files, 'Alle Aufnahmen wurden heruntergeladen.');
}

async function exportAllTimestamps() {
  const recordings = (await idb.getAll('recordings'))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  if (recordings.length === 0) return;
  const text = recordings.map(timestampsText).join('\n\n————————————\n\n');
  const file = new File([text], 'Lebensspuren – Alle Zeitstempel.txt', { type: 'text/plain' });
  await shareFiles([file], 'Die Zeitstempel-Datei wurde heruntergeladen.');
}

// ---------------------------------------------------------------------------
// Einstellungen
// ---------------------------------------------------------------------------

function settingsSection(title) {
  const section = document.createElement('section');
  section.className = 'settings-section';
  const h = document.createElement('h2');
  h.textContent = title;
  section.appendChild(h);
  return section;
}

// Die Einstellungen zeigen zuerst nur die Bereichs-Überschriften;
// der Inhalt öffnet sich als Unterseite – aufgeräumt und für die
// Großeltern nicht versehentlich verstellbar.
const SETTINGS_SECTIONS = [
  { id: 'familie', icon: 'users', title: 'Familie' },
  { id: 'aussehen', icon: 'sun', title: 'Aussehen' },
  { id: 'konto', icon: 'cloudCheck', title: 'Konto & Sicherung' },
  { id: 'ueber', icon: 'info', title: 'Über die App' },
];

async function renderSettings() {
  const wrap = $('#settings-content');
  wrap.textContent = '';
  const section = state.settingsSection;
  $('#settings-title').textContent = section
    ? SETTINGS_SECTIONS.find((s) => s.id === section).title
    : 'Einstellungen';
  $('#settings-back-label').textContent = section ? 'Einstellungen' : 'Zum Buch';

  if (!section) {
    for (const s of SETTINGS_SECTIONS) {
      const row = document.createElement('button');
      row.className = 'settings-nav-row';
      const icon = document.createElement('span');
      icon.className = 'settings-nav-icon';
      icon.innerHTML = svgIcon(s.icon);
      const label = document.createElement('span');
      label.className = 'settings-nav-label';
      label.textContent = s.title;
      const chevron = document.createElement('span');
      chevron.className = 'settings-nav-chevron';
      chevron.textContent = '›';
      row.append(icon, label, chevron);
      row.addEventListener('click', () => {
        state.settingsSection = s.id;
        renderSettings();
      });
      wrap.appendChild(row);
    }
    return;
  }

  if (section === 'familie') await renderFamilySection(wrap);
  if (section === 'aussehen') renderDesignSection(wrap);
  if (section === 'konto') renderAccountSection(wrap);
  if (section === 'ueber') renderAboutSection(wrap);
}

function renderDesignSection(wrap) {
  const design = settingsSection('Aussehen');
  const { design: activeDesign, mode: activeMode } = themeSetting();

  const designRow = document.createElement('div');
  designRow.className = 'choice-row';
  for (const d of DESIGNS) {
    const btn = document.createElement('button');
    btn.className = `choice-btn${activeDesign === d.id ? ' selected' : ''}`;
    const dots = document.createElement('span');
    dots.className = 'swatches';
    for (const c of d.colors) {
      const dot = document.createElement('span');
      dot.className = 'swatch';
      dot.style.background = c;
      dots.appendChild(dot);
    }
    const name = document.createElement('span');
    name.className = 'choice-name';
    name.textContent = d.name;
    const hint = document.createElement('span');
    hint.className = 'choice-hint';
    hint.textContent = d.hint;
    btn.append(dots, name, hint);
    btn.addEventListener('click', () => {
      localStorage.setItem('ls-design', d.id);
      applyTheme();
      renderSettings();
    });
    designRow.appendChild(btn);
  }
  design.appendChild(designRow);

  const modeLabel = document.createElement('p');
  modeLabel.className = 'settings-note';
  modeLabel.textContent = 'Heller oder dunkler Modus:';
  design.appendChild(modeLabel);
  const modeRow = document.createElement('div');
  modeRow.className = 'choice-row segmented';
  for (const m of MODES) {
    const btn = document.createElement('button');
    btn.className = `choice-btn${activeMode === m.id ? ' selected' : ''}`;
    btn.textContent = m.name;
    btn.addEventListener('click', () => {
      localStorage.setItem('ls-mode', m.id);
      applyTheme();
      renderSettings();
    });
    modeRow.appendChild(btn);
  }
  design.appendChild(modeRow);
  wrap.appendChild(design);
}

function renderAccountSection(wrap) {
  const account = settingsSection('Konto & Sicherung');
  if (!isConfigured() || !state.cloud) {
    const note = document.createElement('p');
    note.className = 'settings-note';
    note.textContent = 'Die Cloud-Sicherung ist auf diesem Gerät nicht eingerichtet. Deine Aufnahmen werden lokal gespeichert – teile sie regelmäßig mit deiner Familie.';
    account.appendChild(note);
  } else if (state.user) {
    const note = document.createElement('p');
    note.className = 'settings-note';
    note.textContent = `Du bist angemeldet als ${state.user.displayName || ''} (${state.user.email}). Neue Aufnahmen werden automatisch in deinem Google Drive im Ordner „Lebensspuren" gesichert.`;
    account.appendChild(note);

    const signOutBtn = document.createElement('button');
    signOutBtn.className = 'action-btn settings-btn';
    signOutBtn.textContent = 'Abmelden';
    signOutBtn.addEventListener('click', async () => {
      await signOutUser();
      showToast('Du bist abgemeldet. Deine Aufnahmen bleiben auf dem Gerät.');
      renderSettings();
    });
    account.appendChild(signOutBtn);

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'action-btn danger settings-btn';
    deleteBtn.textContent = 'Konto in dieser App löschen';
    armButton(deleteBtn, 'Wirklich löschen? Nochmal tippen', async () => {
      try {
        await deleteCloudAccount();
        showToast('Konto gelöscht. Aufnahmen auf dem Gerät und in deinem Google Drive bleiben erhalten.', '', 5000);
      } catch (err) {
        console.warn('Konto löschen fehlgeschlagen:', err);
        showToast('Das hat nicht geklappt. Melde dich einmal neu an und versuch es dann erneut.', 'error', 5000);
      }
      renderSettings();
    });
    account.appendChild(deleteBtn);

    const hint = document.createElement('p');
    hint.className = 'settings-note small';
    hint.textContent = '„Konto löschen" entfernt deine Anmeldung und die Katalog-Einträge in der Cloud. Deine Aufnahmen bleiben auf dem Gerät und im Google-Drive-Ordner erhalten.';
    account.appendChild(hint);
  } else {
    const note = document.createElement('p');
    note.className = 'settings-note';
    note.textContent = 'Optional: Melde dich mit Google an, damit deine Aufnahmen zusätzlich in deinem Google Drive gesichert werden.';
    account.appendChild(note);
    const signInBtn = document.createElement('button');
    signInBtn.className = 'action-btn primary-action settings-btn';
    signInBtn.innerHTML = `${svgIcon('cloud')} Mit Google anmelden`;
    signInBtn.addEventListener('click', async () => {
      try {
        await signInWithGoogle();
      } catch (err) {
        console.warn('Anmeldung fehlgeschlagen:', err);
        showToast('Die Anmeldung hat nicht geklappt. Versuch es später noch einmal.', 'error', 4000);
      }
    });
    account.appendChild(signInBtn);
  }
  wrap.appendChild(account);
}

async function renderFamilySection(wrap) {
  const family = settingsSection('Familie');
  const famNote = document.createElement('p');
  famNote.className = 'settings-note';
  famNote.textContent = 'Hier legst du fest, wer aus der Familie mitschauen darf: Der Google-Drive-Ordner mit den Aufnahmen wird automatisch für die eingetragene Person freigegeben, und sie sieht Fortschritt und Aufnahmen in ihrer eigenen Lebensspuren-App.';
  family.appendChild(famNote);

  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.placeholder = 'Dein Name, z. B. „Oma Helga"';
  nameInput.maxLength = 60;
  nameInput.value = await getMeta('profileName', '');
  const nameSave = document.createElement('button');
  nameSave.className = 'action-btn settings-btn';
  nameSave.textContent = 'Namen speichern';
  nameSave.addEventListener('click', async () => {
    await setMeta('profileName', nameInput.value.trim());
    showToast('✓ Name gespeichert', 'success');
    syncFamilyData();
  });
  family.append(nameInput, nameSave);

  if (state.cloud && state.user) {
    const emails = await getMeta('familyEmails', []);
    for (const email of emails) {
      const row = document.createElement('div');
      row.className = 'family-email-row';
      const label = document.createElement('span');
      label.textContent = email;
      const remove = document.createElement('button');
      remove.className = 'row-remove-btn';
      remove.innerHTML = svgIcon('x');
      armButton(remove, 'Entfernen?', async () => {
        await removeFamilyEmail(email);
        showToast('Zugriff entfernt');
        renderSettings();
      });
      row.append(label, remove);
      family.appendChild(row);
    }
    family.appendChild(buildAddButton('Familien-Mitglied hinzufügen', 'E-Mail-Adresse (Google-Konto) …', async (text) => {
      const ok = await addFamilyEmail(text);
      if (ok !== false) renderSettings();
    }, () => renderSettings()));
  } else {
    const hint = document.createElement('p');
    hint.className = 'settings-note small';
    hint.textContent = state.cloud
      ? 'Melde dich zuerst oben unter „Konto & Sicherung" an – dann kannst du hier Familien-Mitglieder eintragen.'
      : 'Für den Familien-Zugriff muss die Cloud-Sicherung eingerichtet sein.';
    family.appendChild(hint);
  }
  wrap.appendChild(family);
}

function renderAboutSection(wrap) {
  const about = settingsSection('Über die App');
  const version = document.createElement('p');
  version.className = 'settings-note';
  version.textContent = `Lebensspuren, Version ${APP_VERSION}`;
  about.appendChild(version);
  wrap.appendChild(about);
}

// ---------------------------------------------------------------------------
// Familien-Zugriff, Seite der Großeltern: Profil, Freigaben, Katalog-Abgleich
// ---------------------------------------------------------------------------

// Bereits in dieser Sitzung bestätigte Ordner-Freigaben. Bewusst nicht
// dauerhaft gespeichert: So wird die Freigabe bei jedem App-Start einmal
// neu zugesichert und übersteht auch eine Ordner-Zusammenführung.
const sessionSharedEmails = new Set();

let familySyncTimer = null;
function scheduleFamilySync() {
  clearTimeout(familySyncTimer);
  familySyncTimer = setTimeout(() => syncFamilyData(), 2000);
}

// Stabile Kennung dieses Geräts – der Lösch-Abgleich fasst nur Aufnahmen
// an, die von diesem Gerät hochgeladen wurden.
async function getDeviceId() {
  let id = await getMeta('deviceId', null);
  if (!id) {
    id = crypto.randomUUID
      ? crypto.randomUUID()
      : `dev-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    await setMeta('deviceId', id);
  }
  return id;
}

// Aufnahmen, die auf diesem Gerät gelöscht wurden, auch in der Cloud
// nachziehen: Firestore-Eintrag als gelöscht markieren, Drive-Dateien in
// den Papierkorb. Klappt Drive gerade nicht, bleibt der Auftrag gemerkt.
async function reconcileDeletions() {
  const deviceId = await getDeviceId();
  const remoteDocs = await fetchOwnRecordingDocs();
  const localIds = new Set((await idb.getAll('recordings')).map((r) => r.id));
  const pendingTrash = await getMeta('pendingTrash', []);

  for (const docu of remoteDocs) {
    if (docu.deleted || localIds.has(docu.id)) continue;
    if (docu.deviceId && docu.deviceId !== deviceId) continue; // anderes Gerät
    await markOwnRecordingDeleted(docu.id);
    const ids = [docu.driveFileId, ...(docu.sidecarFileIds || [])].filter(Boolean);
    pendingTrash.push({
      ids,
      // Altbestände ohne gespeicherte Beiblatt-IDs: über den Titel aufräumen
      titleFallback: docu.sidecarFileIds ? '' : (docu.title || '').replace(/[\\/:*?"<>|]/g, '').slice(0, 120),
    });
  }

  const remaining = [];
  for (const job of pendingTrash) {
    try {
      if (job.ids && job.ids.length) await trashDriveFiles(job.ids);
      if (job.titleFallback) await trashDriveFilesByTitle(job.titleFallback);
    } catch (err) {
      console.warn('Drive-Papierkorb später erneut:', err);
      remaining.push(job);
    }
  }
  await setMeta('pendingTrash', remaining);
}

function progressAsObject() {
  const rows = {};
  for (const [qid, row] of state.progress) {
    rows[qid] = { starred: !!row.starred, answered: !!row.answered };
  }
  return rows;
}

// Gleicht Profil, Katalog und Fortschritt mit Firestore ab und holt
// ausstehende Drive-Ordner-Freigaben nach. Läuft still im Hintergrund;
// jeder Fehler wird beim nächsten Anlass automatisch erneut versucht.
async function syncFamilyData() {
  if (!state.cloud || !state.user || state.familySyncing || !navigator.onLine) return;
  state.familySyncing = true;
  try {
    const name = await getMeta('profileName', '');
    const familyEmails = await getMeta('familyEmails', []);
    const localUpdatedAt = await getMeta('catalogUpdatedAt', 0);

    // Katalog-Abgleich: die neuere Fassung gewinnt (Fern-Änderungen der
    // Familie kommen so aufs Gerät, lokale Änderungen in die Cloud).
    let pushCatalog = true;
    try {
      const remote = await fetchOwnCatalogDoc();
      if (remote && (remote.updatedAt || 0) > localUpdatedAt) {
        await setMeta('customCatalog', remote.data || EMPTY_CUSTOM);
        await setMeta('catalogUpdatedAt', remote.updatedAt);
        await buildCatalog();
        renderQuestionDisplays();
        if (state.view === 'browse') renderBrowse();
        if (state.view === 'home') renderHome();
        pushCatalog = false;
      }
    } catch (err) {
      console.warn('Katalog-Abgleich später erneut:', err);
      pushCatalog = false;
    }

    await pushFamilyState({
      name,
      familyEmails,
      catalog: await getMeta('customCatalog', EMPTY_CUSTOM),
      catalogUpdatedAt: await getMeta('catalogUpdatedAt', 0),
      progress: progressAsObject(),
      pushCatalog,
    });

    try {
      await reconcileDeletions();
    } catch (err) {
      console.warn('Lösch-Abgleich später erneut:', err);
    }

    // Drive-Freigaben sicherstellen – darf nie untergehen. Einmal pro
    // Sitzung wird jede Familien-E-Mail erneut bestätigt (die Drive-API
    // behandelt bestehende Freigaben dabei einfach als erledigt).
    const pending = familyEmails.filter((e) => !sessionSharedEmails.has(e));
    for (const email of pending) {
      try {
        await shareDriveFolderWithEmail(email);
        sessionSharedEmails.add(email);
      } catch (err) {
        console.warn(`Ordner-Freigabe für ${email} folgt beim nächsten Versuch:`, err);
        break;
      }
    }
  } catch (err) {
    console.warn('Familien-Abgleich später erneut:', err);
  } finally {
    state.familySyncing = false;
  }
}

async function addFamilyEmail(rawEmail) {
  const email = rawEmail.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    showToast('Das sieht nicht wie eine E-Mail-Adresse aus.', 'error');
    return false;
  }
  const familyEmails = await getMeta('familyEmails', []);
  if (!familyEmails.includes(email)) {
    familyEmails.push(email);
    await setMeta('familyEmails', familyEmails);
  }
  // Sofort versuchen, den Drive-Ordner freizugeben (mit Anmelde-Popup, falls
  // nötig). Klappt es nicht, holt syncFamilyData es automatisch nach.
  try {
    await shareDriveFolderWithEmail(email, { interactive: true });
    sessionSharedEmails.add(email);
    showToast('✓ Familien-Zugriff eingerichtet, Drive-Ordner ist freigegeben', 'success', 4000);
  } catch (err) {
    console.warn('Ordner-Freigabe wird automatisch nachgeholt:', err);
    showToast('Zugriff gespeichert – die Ordner-Freigabe wird bei der nächsten Sicherung automatisch erledigt.', '', 5000);
  }
  syncFamilyData();
  return true;
}

async function removeFamilyEmail(email) {
  const familyEmails = (await getMeta('familyEmails', [])).filter((e) => e !== email);
  await setMeta('familyEmails', familyEmails);
  sessionSharedEmails.delete(email);
  try {
    await removeDriveFolderShare(email);
  } catch (err) {
    console.warn('Drive-Freigabe konnte nicht entfernt werden:', err);
  }
  syncFamilyData();
}

// ---------------------------------------------------------------------------
// Familien-Zugriff, deine Seite: Übersicht und Fernverwaltung
// ---------------------------------------------------------------------------

async function loadFamilyMembers() {
  if (!state.cloud || !state.user || !state.user.email) return;
  try {
    const members = (await queryFamilyMembers(state.user.email))
      .filter((m) => m.uid !== state.user.uid);
    state.familyMembers = members;
    $('#btn-home-family').classList.toggle('hidden', members.length === 0);
  } catch (err) {
    console.warn('Familien-Abfrage fehlgeschlagen:', err);
  }
}

async function loadMemberData(uid, force = false) {
  if (!force && state.memberCache.has(uid)) return state.memberCache.get(uid);
  const info = (state.familyMembers || []).find((m) => m.uid === uid) || { name: '' };
  const data = await fetchMemberData(uid);
  const custom = (data.catalog && data.catalog.data) || EMPTY_CUSTOM;
  const composed = composeCatalog(custom);
  const entry = {
    info,
    custom,
    catalogUpdatedAt: (data.catalog && data.catalog.updatedAt) || 0,
    ...composed,
    progress: (data.progress && data.progress.rows) || {},
    recordings: (data.recordings || []).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')),
  };
  state.memberCache.set(uid, entry);
  return entry;
}

async function renderFamily() {
  const wrap = $('#family-list');
  wrap.textContent = '';
  const loading = document.createElement('p');
  loading.className = 'settings-note';
  loading.textContent = 'Lade Familien-Daten …';
  wrap.appendChild(loading);

  const members = state.familyMembers || [];
  const tiles = [];
  for (const m of members) {
    try {
      const data = await loadMemberData(m.uid);
      const answered = data.allQuestions.filter((q) => data.progress[q.qid] && data.progress[q.qid].answered).length;
      data.activeCount = data.recordings.filter((r) => !r.deleted).length;
      tiles.push({ m, data, answered });
    } catch (err) {
      console.warn('Person nicht ladbar:', err);
      tiles.push({ m, data: null, answered: 0 });
    }
  }

  wrap.textContent = '';
  if (tiles.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'recordings-empty';
    empty.textContent = 'Noch niemand hat dich als Familien-Mitglied eingetragen.';
    wrap.appendChild(empty);
    return;
  }

  for (const { m, data, answered } of tiles) {
    const tile = document.createElement('button');
    tile.className = 'big-btn';
    const icon = document.createElement('span');
    icon.className = 'btn-icon';
    icon.innerHTML = svgIcon('user');
    const label = document.createElement('span');
    label.textContent = m.name || 'Ohne Namen';
    const sub = document.createElement('span');
    sub.className = 'btn-sub';
    sub.textContent = data
      ? `${answered} von ${data.allQuestions.length} Fragen beantwortet · ${data.activeCount} Aufnahmen`
      : 'Daten gerade nicht erreichbar';
    label.appendChild(sub);
    tile.append(icon, label);
    tile.addEventListener('click', () => {
      state.memberUid = m.uid;
      showView('member');
    });
    wrap.appendChild(tile);
  }
}

function buildMemberRecordingCard(uid, r, isDeleted) {
  const card = document.createElement('article');
  card.className = 'recording-card';
  const h = document.createElement('h3');
  h.className = 'recording-title';
  h.innerHTML = `${svgIcon(r.mode === 'video' ? 'video' : 'mic')} `;
  h.appendChild(document.createTextNode(r.title || r.id));
  const meta = document.createElement('p');
  meta.className = 'recording-meta';
  meta.textContent = `${r.createdAt ? formatDateTime(r.createdAt) : ''} · ${formatClock(r.durationMs || 0)} Minuten`;
  if (isDeleted && r.deletedAt) {
    meta.textContent += ` · gelöscht am ${formatDateTime(new Date(r.deletedAt).toISOString())}`;
  }
  card.append(h, meta);
  if (r.driveFileId) {
    const open = document.createElement('button');
    open.className = 'action-btn';
    open.innerHTML = `${svgIcon('play', { fill: true })} ${isDeleted ? 'Im Papierkorb abspielen' : 'In Google Drive abspielen'}`;
    open.addEventListener('click', () => {
      window.open(`https://drive.google.com/file/d/${r.driveFileId}/view`, '_blank', 'noopener');
    });
    card.appendChild(open);
  }
  if (isDeleted) {
    const purge = document.createElement('button');
    purge.className = 'action-btn danger';
    purge.style.marginTop = '10px';
    purge.innerHTML = `${svgIcon('trash')} Endgültig entfernen`;
    armButton(purge, 'Wirklich endgültig?', async () => {
      try {
        await deleteMemberRecording(uid, r.id);
        state.memberCache.delete(uid);
        showToast('Eintrag endgültig entfernt');
        renderMember();
      } catch (err) {
        console.warn('Endgültiges Entfernen fehlgeschlagen:', err);
        if (err && err.code === 'permission-denied') {
          showToast('Firestore lehnt ab: Die aktuellen Security Rules (firestore.rules) müssen in der Firebase-Konsole veröffentlicht werden.', 'error', 7000);
        } else {
          showToast('Das hat nicht geklappt. Versuch es später noch einmal.', 'error', 4000);
        }
      }
    });
    card.appendChild(purge);
  }
  return card;
}

async function mutateMemberCatalog(uid, fn) {
  const entry = await loadMemberData(uid);
  const custom = normalizeCustom(JSON.parse(JSON.stringify(entry.custom)));
  fn(custom);
  const updatedAt = Date.now();
  await writeMemberCatalog(uid, custom, updatedAt);
  state.memberCache.delete(uid);
  renderMember();
}

async function renderMember() {
  const uid = state.memberUid;
  const wrap = $('#member-content');
  const title = $('#member-title');
  if (!uid) { showView('family'); return; }
  wrap.textContent = '';
  const loading = document.createElement('p');
  loading.className = 'settings-note';
  loading.textContent = 'Lade Daten …';
  wrap.appendChild(loading);

  let data;
  try {
    data = await loadMemberData(uid);
  } catch (err) {
    console.warn('Person nicht ladbar:', err);
    loading.textContent = 'Die Daten sind gerade nicht erreichbar. Versuch es später noch einmal.';
    return;
  }
  title.textContent = data.info.name || 'Familien-Mitglied';
  wrap.textContent = '';

  // --- Aufnahmen (aktueller Stand wie auf dem Gerät der Person) ---
  const active = data.recordings.filter((r) => !r.deleted);
  const deleted = data.recordings.filter((r) => r.deleted);

  const recHeading = document.createElement('h2');
  recHeading.className = 'browse-category';
  recHeading.textContent = `Aufnahmen (${active.length})`;
  wrap.appendChild(recHeading);
  if (active.length === 0) {
    const none = document.createElement('p');
    none.className = 'settings-note';
    none.textContent = 'Noch keine Aufnahmen in der Cloud.';
    wrap.appendChild(none);
  }
  for (const r of active) {
    wrap.appendChild(buildMemberRecordingCard(uid, r, false));
  }

  // --- Gelöschte Aufnahmen (nur für die Familie sichtbar) ---
  if (deleted.length > 0) {
    const delHeading = document.createElement('h2');
    delHeading.className = 'browse-category';
    delHeading.textContent = `Gelöschte Aufnahmen (${deleted.length})`;
    wrap.appendChild(delHeading);
    const delNote = document.createElement('p');
    delNote.className = 'settings-note small';
    delNote.textContent = 'Diese Aufnahmen wurden auf dem Gerät gelöscht. Sie liegen im Drive-Papierkorb und sind dort noch etwa 30 Tage abspielbar – falls etwas versehentlich gelöscht wurde.';
    wrap.appendChild(delNote);
    for (const r of deleted) {
      wrap.appendChild(buildMemberRecordingCard(uid, r, true));
    }
  }

  // --- Fragenkatalog mit Fernverwaltung ---
  let chapterNo = 0;
  for (const cat of data.catalog) {
    chapterNo += 1;
    const heading = document.createElement('h2');
    heading.className = 'browse-category';
    const no = document.createElement('span');
    no.className = 'chapter-no';
    no.textContent = `Kapitel ${romanNumeral(chapterNo)}`;
    const t = document.createElement('span');
    t.textContent = cat.title;
    heading.append(no, t);
    const answeredCount = cat.questions.filter((q) => data.progress[q.qid] && data.progress[q.qid].answered).length;
    if (answeredCount > 0) {
      const prog = document.createElement('span');
      prog.className = 'browse-category-progress';
      prog.textContent = `${answeredCount} von ${cat.questions.length} erzählt`;
      heading.appendChild(prog);
    }
    // Gleicher Schutz wie im eigenen Konto: Kapitel erst löschbar,
    // wenn alle Fragen einzeln entfernt wurden.
    if (cat.questions.length === 0) {
      const removeCat = document.createElement('button');
      removeCat.className = 'row-remove-btn category-remove';
      removeCat.innerHTML = svgIcon('x');
      removeCat.setAttribute('aria-label', `Kapitel „${cat.title}" löschen`);
      armButton(removeCat, 'Löschen?', async () => {
        await mutateMemberCatalog(uid, (c) => applyCategoryRemoval(c, cat));
        showToast('Kapitel entfernt – vorhandene Aufnahmen bleiben erhalten');
      });
      heading.appendChild(removeCat);
    }
    wrap.appendChild(heading);

    const chapterCard = document.createElement('div');
    chapterCard.className = 'chapter-card';
    for (const q of cat.questions) {
      const p = data.progress[q.qid] || {};
      const row = document.createElement('div');
      row.className = 'question-row';
      const main = document.createElement('div');
      main.className = 'question-row-main';
      const check = document.createElement('span');
      check.className = `check${p.answered ? '' : ' open'}`;
      check.innerHTML = svgIcon('feather', { fill: !!p.answered });
      const label = document.createElement('span');
      label.textContent = q.text;
      main.append(check, label);
      row.appendChild(main);
      const remove = document.createElement('button');
      remove.className = 'row-remove-btn';
      remove.innerHTML = svgIcon('x');
      remove.setAttribute('aria-label', 'Frage löschen');
      armButton(remove, 'Löschen?', async () => {
        await mutateMemberCatalog(uid, (c) => applyQuestionRemoval(c, q));
        showToast(p.answered
          ? 'Frage entfernt – die Aufnahme dazu bleibt erhalten'
          : 'Frage entfernt');
      });
      row.appendChild(remove);
      if (p.starred) {
        const star = document.createElement('span');
        star.className = 'star-btn starred';
        star.style.pointerEvents = 'none';
        star.innerHTML = svgIcon('star', { fill: true });
        row.appendChild(star);
      }
      chapterCard.appendChild(row);
    }

    chapterCard.appendChild(buildAddButton('Frage aus der Ferne hinzufügen', 'Deine Frage …', async (text) => {
      await mutateMemberCatalog(uid, (c) => {
        if (!c.questions[cat.id]) c.questions[cat.id] = [];
        c.questions[cat.id].push({
          qid: `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
          text,
        });
      });
      showToast('✓ Frage hinzugefügt – kommt beim nächsten App-Start an', 'success', 3500);
    }, () => renderMember()));
    wrap.appendChild(chapterCard);
  }

  const catHeading = document.createElement('h2');
  catHeading.className = 'browse-category';
  catHeading.textContent = 'Neues Kapitel';
  wrap.appendChild(catHeading);
  const addChapterCard = document.createElement('div');
  addChapterCard.className = 'chapter-card';
  addChapterCard.appendChild(buildAddButton('Kapitel aus der Ferne hinzufügen', 'Name des Kapitels …', async (text) => {
    await mutateMemberCatalog(uid, (c) => {
      if (!c.categories) c.categories = [];
      c.categories.push({ id: `cc-${Date.now().toString(36)}`, title: text });
    });
    showToast('✓ Kapitel hinzugefügt', 'success');
  }, () => renderMember()));
  wrap.appendChild(addChapterCard);

  const hint = document.createElement('p');
  hint.className = 'settings-note small';
  hint.textContent = 'Änderungen am Katalog kommen auf dem Gerät der Person an, sobald sie die App das nächste Mal mit Internet öffnet.';
  wrap.appendChild(hint);
}

// ---------------------------------------------------------------------------
// Cloud-Sicherung (optional, local-first)
// ---------------------------------------------------------------------------

async function initCloudFeatures() {
  if (!isConfigured()) return; // Ohne Konfiguration: rein lokale App, keine Login-UI.
  state.cloud = await initCloud();
  if (!state.cloud) return;
  resumeRedirectSignIn(); // iOS-Fallback: Drive-Token nach Redirect-Login einsammeln
  onUserChanged((user) => {
    state.user = user;
    if (user) {
      syncAll();
      syncFamilyData();
      loadFamilyMembers();
    } else {
      state.familyMembers = null;
      state.memberCache.clear();
      $('#btn-home-family').classList.add('hidden');
    }
    if (state.view === 'settings') renderSettings();
    if (state.view === 'recordings') renderRecordings();
  });
  if (state.view === 'settings') renderSettings();
}

// Bricht ein hängendes Versprechen nach einer Frist ab, damit die
// Sicherung nie dauerhaft blockiert.
function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(label)), ms)),
  ]);
}

// Lädt alle noch nicht gesicherten Aufnahmen hoch – nacheinander,
// im Hintergrund, mit automatischem neuen Versuch bei Netzproblemen.
// Ein einzelner fehlgeschlagener oder hängender Upload blockiert
// die übrigen Aufnahmen nicht.
async function syncAll() {
  if (!state.cloud || !state.user || state.syncing || !navigator.onLine) return;
  state.syncing = true;
  try {
    const recordings = (await idb.getAll('recordings'))
      .filter((r) => !r.uploaded)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    if (recordings.length === 0) return;

    // Erst das Drive-Token besorgen – klappt das nicht, gar nicht erst starten.
    const token = await getDriveToken();
    if (!token) {
      console.warn('Sicherung wartet: gerade kein Drive-Zugriff (nächster Versuch automatisch).');
      return;
    }

    const profileName = sanitizeFilename(await getMeta('profileName', ''));

    for (const recording of recordings) {
      if (!state.user || !navigator.onLine) break;
      state.uploadingIds.add(recording.id);
      refreshSyncBadge(recording);
      try {
        // Zeitlimit je nach Dateigröße (angenommene Mindestrate ~20 KB/s),
        // maximal 15 Minuten pro Aufnahme.
        const timeoutMs = Math.min(120000 + recording.size / 20, 15 * 60 * 1000);
        const driveFileId = await withTimeout(
          uploadRecording(recording, recording.blob, {
            timestampsText: timestampsText(recording),
            transcriptText: transcriptText(recording),
            profileName,
            questionFolder: questionFolderName(recording),
            deviceId: await getDeviceId(),
          }),
          timeoutMs,
          'upload-zeitlimit'
        );
        recording.uploaded = true;
        recording.driveFileId = driveFileId;
        await idb.put('recordings', recording);
      } catch (err) {
        console.warn(`Upload von "${recording.title}" später erneut versuchen:`, err);
      } finally {
        state.uploadingIds.delete(recording.id);
        refreshSyncBadge(recording);
      }
    }
  } finally {
    state.syncing = false;
  }
}

function refreshSyncBadge(recording) {
  if (state.view !== 'recordings') return;
  const card = document.querySelector(`.recording-card[data-id="${recording.id}"]`);
  if (!card) return;
  const badge = card.querySelector('.sync-badge');
  if (badge) applySyncBadge(badge, recording);
}

window.addEventListener('online', () => { syncAll(); syncFamilyData(); });

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

function wireEvents() {
  $('#btn-home-audio').addEventListener('click', () => { continueAtNextUnanswered(); showView('audio'); });
  $('#btn-home-video').addEventListener('click', () => { continueAtNextUnanswered(); showView('video'); });
  $('#btn-home-browse').addEventListener('click', () => showView('browse'));
  $('#btn-home-recordings').addEventListener('click', () => showView('recordings'));
  $('#btn-home-family').addEventListener('click', () => showView('family'));
  $('#btn-settings').addEventListener('click', () => {
    state.settingsSection = null;
    showView('settings');
  });
  $('#btn-home-settings-tile').addEventListener('click', () => {
    state.settingsSection = null;
    showView('settings');
  });

  // Feste Bereichs-Leiste unten
  $('#tab-home').addEventListener('click', () => showView('home'));
  $('#tab-browse').addEventListener('click', () => showView('browse'));
  $('#tab-recs').addEventListener('click', () => showView('recordings'));
  // „Erzählen" fragt erst: mit Ton oder mit Video?
  $('#tab-tell').addEventListener('click', () => $('#mode-dialog').classList.remove('hidden'));
  $('#mode-audio').addEventListener('click', () => {
    $('#mode-dialog').classList.add('hidden');
    continueAtNextUnanswered();
    showView('audio');
  });
  $('#mode-video').addEventListener('click', () => {
    $('#mode-dialog').classList.add('hidden');
    continueAtNextUnanswered();
    showView('video');
  });
  $('#mode-cancel').addEventListener('click', () => $('#mode-dialog').classList.add('hidden'));
  $('#settings-back').addEventListener('click', () => {
    if (state.settingsSection) {
      state.settingsSection = null;
      renderSettings();
    } else {
      showView('home');
    }
  });
  $('#member-back').addEventListener('click', () => showView('family'));

  document.querySelectorAll('[data-back]').forEach((btn) => {
    btn.addEventListener('click', () => showView('home'));
  });

  $('#audio-record').addEventListener('click', () => toggleRecording('audio'));
  $('#video-record').addEventListener('click', () => toggleRecording('video'));
  $('#audio-pause').addEventListener('click', () => togglePause());
  $('#video-pause').addEventListener('click', () => togglePause());
  $('#audio-prev').addEventListener('click', () => goToQuestion(state.questionIndex - 1));
  $('#audio-next').addEventListener('click', () => goToQuestion(state.questionIndex + 1));
  $('#video-prev').addEventListener('click', () => goToQuestion(state.questionIndex - 1));
  $('#video-next').addEventListener('click', () => goToQuestion(state.questionIndex + 1));
  $('#video-flip').addEventListener('click', () => flipCamera());

  $('#btn-share-all').addEventListener('click', () => shareAllRecordings());
  $('#btn-export-all-timestamps').addEventListener('click', () => exportAllTimestamps());

  $('#answered-yes').addEventListener('click', async () => {
    if (pendingAnsweredQid) await updateProgress(pendingAnsweredQid, { answered: true });
    hideAnsweredDialog();
    renderQuestionDisplays();
    showToast('✓ Frage als beantwortet markiert', 'success');
  });
  $('#answered-later').addEventListener('click', () => {
    hideAnsweredDialog();
    showToast('Alles klar – die Frage bleibt offen, die Aufnahme ist gespeichert.', '', 3500);
  });
}

// Einmalige Bereinigung: Haken aus den tatsächlich vorhandenen Aufnahmen
// neu berechnen (frühere Versionen hakten schon beim bloßen Anzeigen ab).
async function migrateAnsweredFlags() {
  if (await getMeta('answeredMigrationV2', false)) return;
  try {
    const recordings = await idb.getAll('recordings');
    const earned = new Set();
    for (const r of recordings) {
      const dwell = computeDwellMap(r.timestamps || [], r.durationMs || 0);
      for (const [qid, ms] of dwell) {
        if (ms >= ANSWERED_MIN_MS) earned.add(qid);
      }
    }
    for (const [qid, row] of [...state.progress]) {
      if (row.answered && !earned.has(qid)) {
        await updateProgress(qid, { answered: false });
      }
    }
    for (const qid of earned) {
      if (!progressFor(qid).answered) await updateProgress(qid, { answered: true });
    }
    await setMeta('answeredMigrationV2', true);
  } catch (err) {
    console.warn('Haken-Bereinigung später erneut:', err);
  }
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  try {
    await navigator.serviceWorker.register('sw.js');
  } catch (err) {
    console.warn('Service Worker konnte nicht registriert werden:', err);
  }
}

async function init() {
  console.info(`Lebensspuren ${APP_VERSION}`);
  applyTheme();
  wireEvents();
  await loadProgress();
  await migrateAnsweredFlags();
  await buildCatalog();
  state.questionIndex = Math.min(
    await getMeta('questionIndex', 0),
    Math.max(0, state.allQuestions.length - 1)
  );
  renderQuestionDisplays();
  renderHome();
  registerServiceWorker();
  initCloudFeatures(); // asynchron, blockiert den Start nicht
}

init();
