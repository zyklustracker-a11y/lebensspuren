// Cloud-Anbindung für „Lebensspuren" (optional).
//
// Aufbau der Sicherung – bewusst ohne Firebase Cloud Storage, damit kein
// Zahlungsmittel nötig ist:
//   • Firebase Authentication (Google-Login)  → kostenlos (Spark-Tarif)
//   • Firestore für die Metadaten             → kostenlos (Spark-Tarif)
//   • Google Drive für die Mediendateien      → 15 GB kostenlos im eigenen
//     Google-Konto, Ordner „Lebensspuren", Zugriff nur auf App-eigene Dateien
//     (Berechtigung drive.file).
//
// ╔══════════════════════════════════════════════════════════════════╗
// ║  KONFIGURATION                                                   ║
// ║                                                                  ║
// ║  firebaseConfig: aus der Firebase-Konsole (Projekt → Web-App).   ║
// ║                                                                  ║
// ║  googleOAuthClientId: Firebase-Konsole → Authentication →        ║
// ║  Sign-in method → Google → „Web SDK configuration" →             ║
// ║  „Web client ID". Wird für die stille Erneuerung der             ║
// ║  Drive-Berechtigung gebraucht; ohne den Wert klappt der Upload   ║
// ║  nur direkt nach einer frischen Anmeldung (~1 Stunde).           ║
// ║                                                                  ║
// ║  Solange alles leer ist, läuft die App rein lokal –              ║
// ║  ohne Anmeldung, ohne Cloud, ohne Fehlermeldung.                 ║
// ╚══════════════════════════════════════════════════════════════════╝
export const firebaseConfig = {
  apiKey: 'AIzaSyBPBXUJhdaMXb2wWQ82eK-EIxKylv8f4bE',
  authDomain: 'lebensspuren.firebaseapp.com',
  projectId: 'lebensspuren',
  storageBucket: 'lebensspuren.firebasestorage.app',
  messagingSenderId: '830956130018',
  appId: '1:830956130018:web:01fc468d90dc87d0a118bb',
};

export const googleOAuthClientId = '830956130018-6toupd91aa5oero4d33estgk1931aoe9.apps.googleusercontent.com';
// ╚═══════════════ ENDE DES KONFIGURATIONS-BLOCKS ══════════════════╝

const SDK = 'https://www.gstatic.com/firebasejs/11.0.1';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const DRIVE_FOLDER_NAME = 'Lebensspuren';

let fb = null; // { app, auth, db, authMod, fsMod } sobald initialisiert

export function isConfigured() {
  return Boolean(firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.appId);
}

// Initialisiert Firebase per dynamischem Import – nur wenn konfiguriert.
// Gibt null zurück, wenn keine Konfiguration vorliegt oder das SDK
// nicht geladen werden kann (z. B. offline beim allerersten Start).
export async function initCloud() {
  if (!isConfigured()) return null;
  if (fb) return fb;
  try {
    const [appMod, authMod, fsMod] = await Promise.all([
      import(`${SDK}/firebase-app.js`),
      import(`${SDK}/firebase-auth.js`),
      import(`${SDK}/firebase-firestore.js`),
    ]);
    const app = appMod.initializeApp(firebaseConfig);
    const auth = authMod.getAuth(app);
    auth.languageCode = 'de';
    const db = fsMod.getFirestore(app);
    fb = { app, auth, db, authMod, fsMod };
    return fb;
  } catch (err) {
    console.warn('Cloud-Anbindung nicht verfügbar:', err);
    return null;
  }
}

// Meldet Änderungen des Anmeldestatus (user oder null).
export function onUserChanged(callback) {
  if (!fb) return;
  fb.authMod.onAuthStateChanged(fb.auth, callback);
}

export function currentUser() {
  return fb ? fb.auth.currentUser : null;
}

export async function signInWithGoogle() {
  if (!fb) throw new Error('Cloud nicht initialisiert');
  const provider = new fb.authMod.GoogleAuthProvider();
  provider.addScope(DRIVE_SCOPE);
  try {
    const result = await fb.authMod.signInWithPopup(fb.auth, provider);
    captureTokenFromResult(result);
  } catch (err) {
    // Popup blockiert (z. B. installierte PWA auf iOS) → Redirect-Anmeldung
    if (err && (err.code === 'auth/popup-blocked' || err.code === 'auth/operation-not-supported-in-this-environment')) {
      await fb.authMod.signInWithRedirect(fb.auth, provider);
    } else {
      throw err;
    }
  }
}

// Nach einer Redirect-Anmeldung (iOS-Fallback) das Drive-Token einsammeln.
export async function resumeRedirectSignIn() {
  if (!fb) return;
  try {
    const result = await fb.authMod.getRedirectResult(fb.auth);
    if (result) captureTokenFromResult(result);
  } catch {
    // Kein Redirect-Ergebnis vorhanden – normaler App-Start.
  }
}

function captureTokenFromResult(result) {
  try {
    const cred = fb.authMod.GoogleAuthProvider.credentialFromResult(result);
    if (cred && cred.accessToken) setDriveToken(cred.accessToken, 3500);
  } catch {
    // Ohne Token klappt der Upload später über die stille Erneuerung.
  }
}

export async function signOutUser() {
  if (!fb) return;
  driveToken = null;
  await fb.authMod.signOut(fb.auth);
}

// ---------------------------------------------------------------------------
// Google-Drive-Zugriff (Berechtigung nur für App-eigene Dateien)
// ---------------------------------------------------------------------------

let driveToken = null; // { token, expiresAt }
let gisLoaded = null;

function setDriveToken(token, expiresInSec) {
  driveToken = { token, expiresAt: Date.now() + (Number(expiresInSec) || 3600) * 1000 };
}

function validDriveToken() {
  return driveToken && Date.now() < driveToken.expiresAt - 60000 ? driveToken.token : null;
}

function loadGis() {
  if (gisLoaded) return gisLoaded;
  gisLoaded = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('GIS nicht ladbar'));
    document.head.appendChild(script);
  });
  return gisLoaded;
}

// Besorgt ein gültiges Drive-Zugriffstoken.
// 1. Noch gültiges Token aus der Anmeldung
// 2. Stille Erneuerung über Google Identity Services (braucht Client-ID)
// 3. interactive=true: notfalls erneutes Anmelde-Popup
// Gibt null zurück, wenn gerade kein Token zu bekommen ist – der Upload
// wird dann später automatisch erneut versucht.
export async function getDriveToken({ interactive = false } = {}) {
  const cached = validDriveToken();
  if (cached) return cached;

  const user = currentUser();
  if (!user) return null;

  if (googleOAuthClientId) {
    try {
      await loadGis();
      // Zeitlimit: Bleibt die Antwort aus (z. B. blockiertes Popup), darf die
      // Sicherung nicht ewig hängen – dann eben beim nächsten Anlass erneut.
      const timeoutMs = interactive ? 120000 : 15000;
      const token = await Promise.race([
        new Promise((resolve) => {
          const client = window.google.accounts.oauth2.initTokenClient({
            client_id: googleOAuthClientId,
            scope: DRIVE_SCOPE,
            prompt: '',
            login_hint: user.email || undefined,
            callback: (resp) => resolve(resp && resp.access_token ? resp : null),
            error_callback: () => resolve(null),
          });
          client.requestAccessToken({ prompt: interactive ? 'consent' : '' });
        }),
        new Promise((resolve) => setTimeout(() => resolve(null), timeoutMs)),
      ]);
      if (token) {
        setDriveToken(token.access_token, token.expires_in);
        return token.access_token;
      }
    } catch (err) {
      console.warn('Stille Token-Erneuerung fehlgeschlagen:', err);
    }
  }

  if (interactive) {
    // Letzter Ausweg: frische Anmeldung liefert ein neues Token mit.
    await signInWithGoogle();
    return validDriveToken();
  }
  return null;
}

export function hasDriveToken() {
  return Boolean(validDriveToken());
}

async function driveFetch(token, url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, ...(options.headers || {}) },
  });
  if (res.status === 401) {
    driveToken = null; // Token abgelaufen – nächster Sync holt ein frisches.
    throw new Error('drive-token-abgelaufen');
  }
  if (!res.ok) throw new Error(`Drive-Fehler ${res.status}`);
  return res;
}

// Findet oder erstellt den Ordner „Lebensspuren" im Drive des Nutzers.
async function ensureDriveFolder(token) {
  const q = encodeURIComponent(
    `name='${DRIVE_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`
  );
  const found = await (await driveFetch(token,
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)`)).json();
  if (found.files && found.files.length > 0) return found.files[0].id;

  const created = await (await driveFetch(token, 'https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=UTF-8' },
    body: JSON.stringify({ name: DRIVE_FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' }),
  })).json();
  return created.id;
}

// Lädt eine Datei per fortsetzbarem Upload nach Drive (geeignet für große Dateien).
async function driveUploadFile(token, name, mimeType, blob, folderId) {
  const init = await driveFetch(token,
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify({ name, mimeType, parents: folderId ? [folderId] : undefined }),
    });
  const uploadUrl = init.headers.get('Location');
  if (!uploadUrl) throw new Error('Drive-Upload: keine Upload-Adresse erhalten');

  const res = await fetch(uploadUrl, { method: 'PUT', body: blob });
  if (!res.ok) throw new Error(`Drive-Upload fehlgeschlagen (${res.status})`);
  return (await res.json()).id;
}

// Sichert eine Aufnahme: Mediendatei + Zeitstempel-Textdatei nach Google Drive,
// Metadaten nach Firestore. Gibt die Drive-Datei-ID zurück.
export async function uploadRecording(rec, blob, timestampsText) {
  if (!fb) throw new Error('Cloud nicht initialisiert');
  const user = fb.auth.currentUser;
  if (!user) throw new Error('Nicht angemeldet');

  const token = await getDriveToken();
  if (!token) throw new Error('kein-drive-token');

  const folderId = await ensureDriveFolder(token);
  const ext = extensionForMime(rec.mimeType);
  const safeTitle = rec.title.replace(/[\\/:*?"<>|]/g, '').slice(0, 120);

  const fileId = await driveUploadFile(token, `${safeTitle}.${ext}`, rec.mimeType, blob, folderId);
  if (timestampsText) {
    await driveUploadFile(token, `${safeTitle} – Zeitstempel.txt`, 'text/plain',
      new Blob([timestampsText], { type: 'text/plain' }), folderId);
  }

  const docRef = fb.fsMod.doc(fb.db, 'users', user.uid, 'recordings', rec.id);
  await fb.fsMod.setDoc(docRef, {
    title: rec.title,
    createdAt: rec.createdAt,
    mode: rec.mode,
    mimeType: rec.mimeType,
    durationMs: rec.durationMs,
    size: rec.size,
    timestamps: rec.timestamps,
    driveFileId: fileId,
  });

  return fileId;
}

export function extensionForMime(mimeType) {
  const mt = (mimeType || '').toLowerCase();
  if (mt.includes('webm')) return 'webm';
  if (mt.includes('mp4')) return mt.startsWith('audio') ? 'm4a' : 'mp4';
  if (mt.includes('ogg')) return 'ogg';
  return 'bin';
}
