// Lebensspuren – App-Logik
// Reine Client-Anwendung: alles läuft lokal, die Cloud (firebase.js) ist optional.

import { ALL_QUESTIONS, CATEGORIES } from './questions.js';
import {
  isConfigured, initCloud, onUserChanged, signInWithGoogle, signOutUser,
  uploadRecording, extensionForMime, getDriveToken, resumeRedirectSignIn,
} from './firebase.js';

// ---------------------------------------------------------------------------
// Kleine Helfer
// ---------------------------------------------------------------------------

const APP_VERSION = '1.1.0';

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

function formatDateShort(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
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
  progress: new Map(),       // qid → { starred, answered }
  cloud: null,               // Firebase-Handle oder null
  user: null,                // angemeldeter Google-Nutzer oder null
  syncing: false,
  uploadingIds: new Set(),   // Aufnahmen, die gerade hochgeladen werden
  playingId: null,           // Aufnahme, deren Player gerade offen ist
};

function currentQuestion() {
  return ALL_QUESTIONS[state.questionIndex];
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
// Ansichten-Wechsel
// ---------------------------------------------------------------------------

const VIEWS = ['home', 'audio', 'video', 'browse', 'recordings'];

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
}

// ---------------------------------------------------------------------------
// Fragen-Navigation (in Audio- und Video-Modus)
// ---------------------------------------------------------------------------

function renderQuestionDisplays() {
  const q = currentQuestion();
  $('#audio-category').textContent = `${q.categoryIcon} ${q.categoryTitle}`;
  $('#audio-question').textContent = q.text;
  $('#audio-counter').textContent = `Frage ${state.questionIndex + 1} von ${ALL_QUESTIONS.length}`;
  $('#video-category').textContent = `${q.categoryIcon} ${q.categoryTitle}`;
  $('#video-question').textContent = q.text;
}

async function goToQuestion(index) {
  const len = ALL_QUESTIONS.length;
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
  const render = () => {
    if (!wave.analyser) return;
    wave.analyser.getByteFrequencyData(wave.data);
    g.clearRect(0, 0, canvas.width, canvas.height);
    const bars = 32;
    const step = Math.floor(wave.data.length / bars);
    const barWidth = canvas.width / bars;
    g.fillStyle = '#d32f2f';
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

  const answered = ALL_QUESTIONS.filter((q) => progressFor(q.qid).answered).length;
  $('#home-progress').textContent = answered > 0
    ? `Du hast schon ${answered} von ${ALL_QUESTIONS.length} Fragen beantwortet. Weiter so!`
    : 'Such dir eine Frage aus und erzähl einfach los.';

  renderAuthArea();
}

// ---------------------------------------------------------------------------
// Fragen-Modus (Stöbern)
// ---------------------------------------------------------------------------

function renderBrowse() {
  const list = $('#browse-list');
  list.textContent = '';

  for (const cat of CATEGORIES) {
    const heading = document.createElement('h2');
    heading.className = 'browse-category';
    heading.textContent = `${cat.icon} ${cat.title}`;
    const answeredCount = cat.questions.filter((_, i) =>
      progressFor(`${cat.id}-${i + 1}`).answered).length;
    if (answeredCount > 0) {
      const prog = document.createElement('span');
      prog.className = 'browse-category-progress';
      prog.textContent = `${answeredCount} von ${cat.questions.length} beantwortet`;
      heading.appendChild(prog);
    }
    list.appendChild(heading);

    cat.questions.forEach((text, i) => {
      const qid = `${cat.id}-${i + 1}`;
      const p = progressFor(qid);

      const row = document.createElement('div');
      row.className = 'question-row';

      const main = document.createElement('button');
      main.className = 'question-row-main';
      const check = document.createElement('span');
      check.className = 'check';
      check.textContent = p.answered ? '✓' : '';
      if (p.answered) check.setAttribute('title', 'Schon beantwortet');
      const label = document.createElement('span');
      label.textContent = text;
      main.append(check, label);
      main.addEventListener('click', async () => {
        const idx = ALL_QUESTIONS.findIndex((q) => q.qid === qid);
        await goToQuestion(idx);
        showView('audio');
      });

      const star = document.createElement('button');
      star.className = `star-btn${p.starred ? ' starred' : ''}`;
      star.textContent = p.starred ? '★' : '☆';
      star.setAttribute('aria-label', p.starred ? 'Merken aufheben' : 'Frage merken');
      star.addEventListener('click', async () => {
        const newVal = !progressFor(qid).starred;
        await updateProgress(qid, { starred: newVal });
        star.classList.toggle('starred', newVal);
        star.textContent = newVal ? '★' : '☆';
      });

      row.append(main, star);
      list.appendChild(row);
    });
  }
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
  state.playingId = null;
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
  let armed = false;
  let armTimer = null;
  deleteBtn.addEventListener('click', async () => {
    if (!armed) {
      armed = true;
      deleteBtn.textContent = 'Wirklich löschen?';
      armTimer = setTimeout(() => {
        armed = false;
        deleteBtn.textContent = '🗑️ Löschen';
      }, 4000);
      return;
    }
    clearTimeout(armTimer);
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
  state.playingId = recording.id;
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
// Cloud-Sicherung (optional, local-first)
// ---------------------------------------------------------------------------

async function initCloudFeatures() {
  if (!isConfigured()) return; // Ohne Konfiguration: rein lokale App, keine Login-UI.
  state.cloud = await initCloud();
  if (!state.cloud) return;
  $('#auth-area').classList.remove('hidden');
  resumeRedirectSignIn(); // iOS-Fallback: Drive-Token nach Redirect-Login einsammeln
  onUserChanged((user) => {
    state.user = user;
    renderAuthArea();
    if (user) syncAll();
    if (state.view === 'recordings') renderRecordings();
  });
  renderAuthArea();
}

function renderAuthArea() {
  const area = $('#auth-area');
  if (!state.cloud) return;
  area.textContent = '';

  if (state.user) {
    const status = document.createElement('p');
    status.className = 'auth-status';
    status.textContent = `☁️ Angemeldet als ${state.user.displayName || state.user.email} – deine Aufnahmen werden automatisch in Google Drive gesichert.`;
    const btn = document.createElement('button');
    btn.className = 'auth-btn';
    btn.textContent = 'Abmelden';
    btn.addEventListener('click', async () => {
      await signOutUser();
      showToast('Du bist abgemeldet. Deine Aufnahmen bleiben auf dem Gerät.');
    });
    area.append(status, btn);
  } else {
    const status = document.createElement('p');
    status.className = 'auth-status';
    status.textContent = 'Optional: Melde dich an, damit deine Aufnahmen zusätzlich in deinem Google Drive gesichert werden.';
    const btn = document.createElement('button');
    btn.className = 'auth-btn';
    btn.textContent = '☁️ Mit Google anmelden';
    btn.addEventListener('click', async () => {
      try {
        await signInWithGoogle();
      } catch (err) {
        console.warn('Anmeldung fehlgeschlagen:', err);
        showToast('Die Anmeldung hat nicht geklappt. Versuch es später noch einmal.', 'error', 4000);
      }
    });
    area.append(status, btn);
  }
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
  $('#app-version').textContent = `Version ${APP_VERSION}`;
  wireEvents();
  await loadProgress();
  state.questionIndex = Math.min(
    await getMeta('questionIndex', 0),
    ALL_QUESTIONS.length - 1
  );
  renderQuestionDisplays();
  renderHome();
  registerServiceWorker();
  initCloudFeatures(); // asynchron, blockiert den Start nicht
}

init();
