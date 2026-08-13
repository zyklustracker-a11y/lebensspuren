// Lebensspuren – App-Logik
// Reine Client-Anwendung: alles läuft lokal, die Cloud (firebase.js) ist optional.

import { CATEGORIES as BASE_CATEGORIES } from './questions.js';
import {
  isConfigured, initCloud, onUserChanged, signInWithGoogle, signOutUser,
  uploadRecording, extensionForMime, getDriveToken, resumeRedirectSignIn,
  deleteCloudAccount,
} from './firebase.js';

const APP_VERSION = '1.2.1';

// ---------------------------------------------------------------------------
// Kleine Helfer
// ---------------------------------------------------------------------------

const $ = (sel) => document.querySelector(sel);

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
  const original = btn.textContent;
  btn.addEventListener('click', async () => {
    if (!armed) {
      armed = true;
      btn.textContent = armedLabel;
      timer = setTimeout(() => { armed = false; btn.textContent = original; }, 4000);
      return;
    }
    clearTimeout(timer);
    armed = false;
    btn.textContent = original;
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
};

function currentQuestion() {
  return state.allQuestions[state.questionIndex];
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
}

// ---------------------------------------------------------------------------
// Fragenkatalog: fest eingebaute Fragen + eigene Fragen und Kategorien
// ---------------------------------------------------------------------------

const EMPTY_CUSTOM = { questions: {}, categories: [] };

async function buildCatalog() {
  const custom = await getMeta('customCatalog', EMPTY_CUSTOM);
  const cats = [];
  for (const base of BASE_CATEGORIES) {
    const questions = base.questions.map((text, i) => ({
      qid: `${base.id}-${i + 1}`, text, custom: false,
    }));
    for (const q of custom.questions[base.id] || []) {
      questions.push({ qid: q.qid, text: q.text, custom: true });
    }
    cats.push({ id: base.id, title: base.title, icon: base.icon, custom: false, questions });
  }
  for (const cc of custom.categories) {
    const questions = (custom.questions[cc.id] || []).map((q) => ({
      qid: q.qid, text: q.text, custom: true,
    }));
    cats.push({ id: cc.id, title: cc.title, icon: cc.icon || '💬', custom: true, questions });
  }
  state.catalog = cats;
  state.allQuestions = cats.flatMap((c) => c.questions.map((q) => ({
    ...q, categoryId: c.id, categoryTitle: c.title, categoryIcon: c.icon,
  })));
  state.questionIndex = Math.min(state.questionIndex, Math.max(0, state.allQuestions.length - 1));
}

async function mutateCustomCatalog(fn) {
  const custom = await getMeta('customCatalog', EMPTY_CUSTOM);
  fn(custom);
  await setMeta('customCatalog', custom);
  await buildCatalog();
}

async function addCustomQuestion(categoryId, text) {
  const qid = `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  await mutateCustomCatalog((c) => {
    if (!c.questions[categoryId]) c.questions[categoryId] = [];
    c.questions[categoryId].push({ qid, text });
  });
}

async function removeCustomQuestion(qid) {
  await mutateCustomCatalog((c) => {
    for (const catId of Object.keys(c.questions)) {
      c.questions[catId] = c.questions[catId].filter((q) => q.qid !== qid);
    }
  });
  await idb.delete('progress', qid).catch(() => {});
  state.progress.delete(qid);
}

async function addCustomCategory(title) {
  await mutateCustomCatalog((c) => {
    c.categories.push({ id: `cc-${Date.now().toString(36)}`, title });
  });
}

async function removeCustomCategory(categoryId) {
  await mutateCustomCatalog((c) => {
    c.categories = c.categories.filter((cat) => cat.id !== categoryId);
    delete c.questions[categoryId];
  });
}

// ---------------------------------------------------------------------------
// Design (drei Designs, jeweils hell und dunkel)
// ---------------------------------------------------------------------------

const DESIGNS = [
  { id: 'natur', name: 'Salbei', hint: 'Ruhig und natürlich', colors: ['#3f7352', '#f6f7f4', '#131a16'] },
  { id: 'modern', name: 'Indigo', hint: 'Klar und modern', colors: ['#4f46e5', '#fafafa', '#15161a'] },
  { id: 'warm', name: 'Bernstein', hint: 'Warm und edel', colors: ['#b45309', '#faf6ef', '#1b1613'] },
];
const MODES = [
  { id: 'auto', name: 'Automatisch' },
  { id: 'light', name: 'Hell' },
  { id: 'dark', name: 'Dunkel' },
];

function themeSetting() {
  return {
    design: localStorage.getItem('ls-design') || 'natur',
    mode: localStorage.getItem('ls-mode') || 'dark',
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

const VIEWS = ['home', 'audio', 'video', 'browse', 'recordings', 'settings'];

async function showView(name) {
  // Laufende Aufnahme beim Verlassen immer sichern, nie verwerfen.
  if (rec.active) await stopRecording('navigation');
  if (state.view === 'video' && name !== 'video') stopCameraPreview();
  if (state.view === 'recordings' && name !== 'recordings') closePlayer();

  state.view = name;
  for (const v of VIEWS) {
    $(`#view-${v}`).classList.toggle('active', v === name);
  }
  window.scrollTo(0, 0);

  if (name === 'home') renderHome();
  if (name === 'audio') renderQuestionDisplays();
  if (name === 'video') { renderQuestionDisplays(); startCameraPreview(); }
  if (name === 'browse') renderBrowse();
  if (name === 'recordings') renderRecordings();
  if (name === 'settings') renderSettings();
}

// ---------------------------------------------------------------------------
// Fragen-Navigation (in Audio- und Video-Modus)
// ---------------------------------------------------------------------------

function renderQuestionDisplays() {
  const q = currentQuestion();
  if (!q) return;
  $('#audio-category').textContent = `${q.categoryIcon} ${q.categoryTitle}`;
  $('#audio-question').textContent = q.text;
  $('#audio-counter').textContent = `Frage ${state.questionIndex + 1} von ${state.allQuestions.length}`;
  $('#video-category').textContent = `${q.categoryIcon} ${q.categoryTitle}`;
  $('#video-question').textContent = q.text;
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
      offsetMs: Date.now() - rec.startTime,
      qid: q.qid,
      text: q.text,
      category: q.categoryTitle,
    });
  }
}

// ---------------------------------------------------------------------------
// Aufnahme-Engine (Audio und Video)
// ---------------------------------------------------------------------------

const AUDIO_MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4;codecs=mp4a.40.2',
  'audio/mp4',
];

const VIDEO_MIME_CANDIDATES = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
  'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
  'video/mp4',
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
};

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
  timerElement(rec.mode).textContent = formatClock(Date.now() - rec.startTime);
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
    const q = currentQuestion();
    rec.timestamps = [{ offsetMs: 0, qid: q.qid, text: q.text, category: q.categoryTitle }];

    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) rec.chunks.push(e.data);
    };
    recorder.onstop = () => finalizeRecording();
    recorder.onerror = () => stopRecording('fehler');

    // Jede Sekunde ein Datenpaket: bei Unterbrechungen geht fast nichts verloren.
    recorder.start(1000);

    await acquireWakeLock();
    rec.timerInterval = setInterval(updateTimer, 500);

    recordButton(mode).classList.add('recording');
    const timerEl = timerElement(mode);
    timerEl.classList.remove('idle');
    timerEl.textContent = '00:00';
    if (mode === 'audio') {
      $('#audio-hint').textContent = 'Aufnahme läuft – erzähl einfach. Zum Beenden erneut tippen.';
      startWaveform(stream);
    } else {
      $('#video-flip').classList.add('hidden');
    }
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
  // Sicherheitsnetz: falls onstop nicht feuert, trotzdem speichern.
  setTimeout(() => finalizeRecording(), 2000);
  if (reason === 'fehler') {
    showToast('Die Aufnahme wurde unterbrochen – alles bisher Gesagte ist gespeichert.', '', 4000);
  }
}

async function finalizeRecording() {
  if (rec.finalized) return;
  rec.finalized = true;

  const mode = rec.mode;
  const durationMs = Date.now() - rec.startTime;
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
  const recording = {
    id: `rec-${rec.startTime}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: started.toISOString(),
    mode,
    mimeType,
    blob,
    size: blob.size,
    durationMs,
    title: `${isoDateStamp(started)} – ${firstQuestion.text}`,
    timestamps: rec.timestamps,
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

  // Alle Fragen dieser Aufnahme als beantwortet markieren (grüner Haken).
  for (const ts of recording.timestamps) {
    await updateProgress(ts.qid, { answered: true });
  }

  showToast('✓ Deine Erinnerung ist gespeichert', 'success', 3200);

  // Speicher gegen automatisches Aufräumen des Browsers schützen.
  if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persist().catch(() => {});
  }

  syncAll(); // Im Hintergrund in die Cloud sichern, falls angemeldet.
}

function resetRecordingUi(mode) {
  recordButton(mode).classList.remove('recording');
  const timerEl = timerElement(mode);
  timerEl.classList.add('idle');
  timerEl.textContent = '';
  if (mode === 'audio') {
    $('#audio-hint').textContent = 'Tippe auf den roten Knopf, um zu starten';
  } else {
    $('#video-flip').classList.remove('hidden');
  }
}

function toggleRecording(mode) {
  if (rec.active) stopRecording('stop');
  else startRecording(mode);
}

// Geht die App in den Hintergrund (Anruf, Bildschirmsperre, App-Wechsel),
// wird sofort gespeichert – auf dem iPhone würde die Aufnahme ohnehin stoppen.
document.addEventListener('visibilitychange', () => {
  if (document.hidden && rec.active) stopRecording('hintergrund');
  // Zurück in der App: liegengebliebene Sicherungen erneut anstoßen.
  if (!document.hidden) syncAll();
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

  const answered = state.allQuestions.filter((q) => progressFor(q.qid).answered).length;
  $('#home-progress').textContent = answered > 0
    ? `Du hast schon ${answered} von ${state.allQuestions.length} Fragen beantwortet. Weiter so!`
    : 'Such dir eine Frage aus und erzähl einfach los.';
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
  check.className = 'check';
  check.textContent = p.answered ? '✓' : '';
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

  if (q.custom) {
    const remove = document.createElement('button');
    remove.className = 'row-remove-btn';
    remove.textContent = '✕';
    remove.setAttribute('aria-label', 'Eigene Frage entfernen');
    armButton(remove, 'Löschen?', async () => {
      await removeCustomQuestion(q.qid);
      renderBrowse();
      showToast('Frage entfernt');
    });
    row.appendChild(remove);
  }

  const star = document.createElement('button');
  star.className = `star-btn${p.starred ? ' starred' : ''}`;
  star.textContent = p.starred ? '★' : '☆';
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
function buildInlineForm(placeholder, onSave) {
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
  cancel.addEventListener('click', () => renderBrowse());
  buttons.append(save, cancel);
  wrap.append(input, buttons);
  return { wrap, input };
}

function buildAddButton(label, placeholder, onSave) {
  const btn = document.createElement('button');
  btn.className = 'add-btn';
  btn.textContent = label;
  btn.addEventListener('click', () => {
    const { wrap, input } = buildInlineForm(placeholder, onSave);
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
    heading.textContent = '⭐ Deine gemerkten Fragen';
    list.appendChild(heading);
    for (const q of starred) list.appendChild(buildQuestionRow(q));
  }

  for (const cat of state.catalog) {
    const heading = document.createElement('h2');
    heading.className = 'browse-category';
    heading.textContent = `${cat.icon} ${cat.title}`;
    const answeredCount = cat.questions.filter((q) => progressFor(q.qid).answered).length;
    if (answeredCount > 0) {
      const prog = document.createElement('span');
      prog.className = 'browse-category-progress';
      prog.textContent = `${answeredCount} von ${cat.questions.length} beantwortet`;
      heading.appendChild(prog);
    }
    if (cat.custom) {
      const removeCat = document.createElement('button');
      removeCat.className = 'row-remove-btn category-remove';
      removeCat.textContent = '✕';
      removeCat.setAttribute('aria-label', 'Kategorie entfernen');
      armButton(removeCat, 'Löschen?', async () => {
        await removeCustomCategory(cat.id);
        renderBrowse();
        showToast('Kategorie entfernt');
      });
      heading.appendChild(removeCat);
    }
    list.appendChild(heading);

    for (const q of cat.questions) {
      list.appendChild(buildQuestionRow(q));
    }

    list.appendChild(buildAddButton('＋ Eigene Frage hinzufügen', 'Deine Frage …', async (text) => {
      await addCustomQuestion(cat.id, text);
      renderBrowse();
      showToast('✓ Frage hinzugefügt', 'success');
    }));
  }

  const catHeading = document.createElement('h2');
  catHeading.className = 'browse-category';
  catHeading.textContent = '🗂️ Neue Kategorie';
  list.appendChild(catHeading);
  list.appendChild(buildAddButton('＋ Eigene Kategorie hinzufügen', 'Name der Kategorie …', async (text) => {
    await addCustomCategory(text);
    renderBrowse();
    showToast('✓ Kategorie hinzugefügt – füge ihr jetzt Fragen hinzu', 'success', 3500);
  }));
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

async function renderRecordings() {
  closePlayer();
  const list = $('#recordings-list');
  list.textContent = '';

  const recordings = (await idb.getAll('recordings'))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  $('#recordings-toolbar').classList.toggle('hidden', recordings.length === 0);

  if (recordings.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'recordings-empty';
    empty.textContent = 'Hier erscheinen deine Aufnahmen, sobald du etwas erzählt hast. Tipp auf „Erzählen mit Ton" und leg einfach los!';
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
      reminder.textContent = `💡 ${countText} noch nicht in Google Drive gesichert. `;
      const syncBtn = document.createElement('button');
      syncBtn.className = 'action-btn';
      syncBtn.textContent = '☁️ Jetzt sichern';
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
      reminder.textContent = `💡 Tipp: ${countText} bisher nur auf diesem Gerät. Teile sie mit deiner Familie, damit nichts verloren geht.`;
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

  const title = document.createElement('h3');
  title.className = 'recording-title';
  title.textContent = `${recording.mode === 'video' ? '🎥' : '🎙️'} ${recording.title}`;

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

  const playBtn = document.createElement('button');
  playBtn.className = 'action-btn play';
  playBtn.textContent = '▶ Abspielen';
  playBtn.addEventListener('click', () => togglePlayback(recording, card, playBtn));

  const shareBtn = document.createElement('button');
  shareBtn.className = 'action-btn';
  shareBtn.textContent = '📤 Teilen';
  shareBtn.addEventListener('click', () => shareRecording(recording));

  const tsBtn = document.createElement('button');
  tsBtn.className = 'action-btn';
  tsBtn.textContent = '📝 Zeitstempel';
  tsBtn.addEventListener('click', () => exportTimestamps(recording));

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'action-btn danger';
  deleteBtn.textContent = '🗑️ Löschen';
  armButton(deleteBtn, 'Wirklich löschen?', async () => {
    await idb.delete('recordings', recording.id);
    closePlayer();
    showToast('Aufnahme gelöscht');
    renderRecordings();
  });

  actions.append(playBtn, shareBtn, tsBtn, deleteBtn);
  card.append(title, meta, actions);
  return card;
}

function applySyncBadge(badge, recording) {
  if (recording.uploaded) {
    badge.className = 'sync-badge synced';
    badge.textContent = '☁️ In Google Drive gesichert';
  } else if (state.uploadingIds.has(recording.id)) {
    badge.className = 'sync-badge pending';
    badge.textContent = '⏳ Wird gerade gesichert …';
  } else {
    badge.className = 'sync-badge local';
    badge.textContent = '📱 Nur auf diesem Gerät';
  }
}

function togglePlayback(recording, card, playBtn) {
  const existing = card.querySelector('.recording-player');
  if (existing) {
    existing.remove();
    closePlayer();
    playBtn.textContent = '▶ Abspielen';
    return;
  }
  // Nur ein Player gleichzeitig
  document.querySelectorAll('.recording-player').forEach((el) => el.remove());
  document.querySelectorAll('.action-btn.play').forEach((b) => { b.textContent = '▶ Abspielen'; });
  closePlayer();

  const el = document.createElement(recording.mode === 'video' ? 'video' : 'audio');
  el.className = 'recording-player';
  el.controls = true;
  el.setAttribute('playsinline', '');
  playerUrl = URL.createObjectURL(recording.blob);
  el.src = playerUrl;
  card.appendChild(el);
  playBtn.textContent = '⏸ Schließen';
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
  await shareFiles(
    [fileForRecording(recording), timestampsFile(recording)],
    'Die Dateien wurden heruntergeladen.'
  );
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

function renderSettings() {
  const wrap = $('#settings-content');
  wrap.textContent = '';

  // --- Design ---
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

  // --- Konto & Sicherung ---
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
    signInBtn.textContent = '☁️ Mit Google anmelden';
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

  // --- Über die App ---
  const about = settingsSection('Über die App');
  const version = document.createElement('p');
  version.className = 'settings-note';
  version.textContent = `Lebensspuren, Version ${APP_VERSION}`;
  about.appendChild(version);
  wrap.appendChild(about);
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
    if (user) syncAll();
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

    for (const recording of recordings) {
      if (!state.user || !navigator.onLine) break;
      state.uploadingIds.add(recording.id);
      refreshSyncBadge(recording);
      try {
        // Zeitlimit je nach Dateigröße (angenommene Mindestrate ~20 KB/s),
        // maximal 15 Minuten pro Aufnahme.
        const timeoutMs = Math.min(120000 + recording.size / 20, 15 * 60 * 1000);
        const driveFileId = await withTimeout(
          uploadRecording(recording, recording.blob, timestampsText(recording)),
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

window.addEventListener('online', () => syncAll());

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

function wireEvents() {
  $('#btn-home-audio').addEventListener('click', () => showView('audio'));
  $('#btn-home-video').addEventListener('click', () => showView('video'));
  $('#btn-home-browse').addEventListener('click', () => showView('browse'));
  $('#btn-home-recordings').addEventListener('click', () => showView('recordings'));
  $('#btn-settings').addEventListener('click', () => showView('settings'));

  document.querySelectorAll('[data-back]').forEach((btn) => {
    btn.addEventListener('click', () => showView('home'));
  });

  $('#audio-record').addEventListener('click', () => toggleRecording('audio'));
  $('#video-record').addEventListener('click', () => toggleRecording('video'));
  $('#audio-prev').addEventListener('click', () => goToQuestion(state.questionIndex - 1));
  $('#audio-next').addEventListener('click', () => goToQuestion(state.questionIndex + 1));
  $('#video-prev').addEventListener('click', () => goToQuestion(state.questionIndex - 1));
  $('#video-next').addEventListener('click', () => goToQuestion(state.questionIndex + 1));
  $('#video-flip').addEventListener('click', () => flipCamera());

  $('#btn-share-all').addEventListener('click', () => shareAllRecordings());
  $('#btn-export-all-timestamps').addEventListener('click', () => exportAllTimestamps());
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
