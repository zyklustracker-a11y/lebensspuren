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

// Wird aufgerufen, wenn sich jemand zum allerersten Mal registriert
// (Firebase unterscheidet neue Konten von bloßen Wieder-Anmeldungen).
let firstRegistrationCb = null;
export function onFirstRegistration(cb) {
  firstRegistrationCb = cb;
}

function captureTokenFromResult(result) {
  try {
    const cred = fb.authMod.GoogleAuthProvider.credentialFromResult(result);
    if (cred && cred.accessToken) setDriveToken(cred.accessToken, 3500);
  } catch {
    // Ohne Token klappt der Upload später über die stille Erneuerung.
  }
  try {
    const info = fb.authMod.getAdditionalUserInfo(result);
    if (info && info.isNewUser && firstRegistrationCb) firstRegistrationCb();
  } catch {
    // Erkennung ist Komfort – die Anmeldung selbst ist davon unabhängig.
  }
}

export async function signOutUser() {
  if (!fb) return;
  driveToken = null;
  resetDriveFolderCache();
  await fb.authMod.signOut(fb.auth);
}

// Löscht das Konto in dieser App: erst alle Firestore-Metadaten des Nutzers,
// dann den Firebase-Auth-Nutzer selbst. Die Dateien im Google Drive des
// Nutzers bleiben unangetastet – sie gehören ihm, nicht der App.
// Wirft auth/requires-recent-login, wenn die Anmeldung zu lange her ist;
// in dem Fall einmal neu anmelden und erneut versuchen.
export async function deleteCloudAccount() {
  if (!fb) throw new Error('Cloud nicht initialisiert');
  const user = fb.auth.currentUser;
  if (!user) throw new Error('Nicht angemeldet');

  const col = fb.fsMod.collection(fb.db, 'users', user.uid, 'recordings');
  const snapshot = await fb.fsMod.getDocs(col);
  await Promise.all(snapshot.docs.map((d) => fb.fsMod.deleteDoc(d.ref)));
  await Promise.all([
    fb.fsMod.deleteDoc(fb.fsMod.doc(fb.db, 'users', user.uid, 'app', 'katalog')).catch(() => {}),
    fb.fsMod.deleteDoc(fb.fsMod.doc(fb.db, 'users', user.uid, 'app', 'fortschritt')).catch(() => {}),
    fb.fsMod.deleteDoc(fb.fsMod.doc(fb.db, 'freigaben', user.uid)).catch(() => {}),
  ]);

  driveToken = null;
  resetDriveFolderCache();
  await fb.authMod.deleteUser(user);
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
// Gleichzeitige Aufrufe teilen sich dieselbe Suche (sonst könnten zwei
// Abläufe parallel je einen Ordner anlegen), und falls durch frühere
// Versionen Duplikate entstanden sind, räumt die App sie selbst auf.
let folderPromise = null;
const subfolderPromises = new Map();

function resetDriveFolderCache() {
  folderPromise = null;
  subfolderPromises.clear();
}

// Findet oder erstellt einen Unterordner – ebenfalls serialisiert,
// damit parallele Uploads keine Duplikate anlegen.
function ensureSubfolder(token, parentId, name) {
  const key = `${parentId}/${name}`;
  if (!subfolderPromises.has(key)) {
    subfolderPromises.set(key, resolveSubfolder(token, parentId, name).catch((err) => {
      subfolderPromises.delete(key);
      throw err;
    }));
  }
  return subfolderPromises.get(key);
}

async function resolveSubfolder(token, parentId, name) {
  const safeName = name.replace(/'/g, "\\'");
  const q = encodeURIComponent(
    `name='${safeName}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`
  );
  const found = (await (await driveFetch(token,
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)&orderBy=createdTime`)).json()).files || [];
  if (found.length > 0) return found[0].id;
  const created = await (await driveFetch(token, 'https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=UTF-8' },
    body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] }),
  })).json();
  return created.id;
}

function ensureDriveFolder(token) {
  if (!folderPromise) {
    folderPromise = resolveDriveFolder(token).catch((err) => {
      folderPromise = null; // Beim nächsten Versuch neu suchen
      throw err;
    });
  }
  return folderPromise;
}

async function listFolderChildren(token, folderId) {
  const q = encodeURIComponent(`'${folderId}' in parents and trashed=false`);
  const res = await (await driveFetch(token,
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)&pageSize=1000`)).json();
  return res.files || [];
}

async function resolveDriveFolder(token) {
  const q = encodeURIComponent(
    `name='${DRIVE_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`
  );
  const found = (await (await driveFetch(token,
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)&orderBy=createdTime`)).json()).files || [];

  if (found.length === 0) {
    const created = await (await driveFetch(token, 'https://www.googleapis.com/drive/v3/files', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify({ name: DRIVE_FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' }),
    })).json();
    return created.id;
  }
  if (found.length === 1) return found[0].id;

  // Duplikate zusammenführen: Ordner mit den meisten Dateien behalten,
  // Inhalte der übrigen hinüberziehen, leere Duplikate in den Papierkorb.
  const withContents = [];
  for (const f of found) {
    withContents.push({ id: f.id, children: await listFolderChildren(token, f.id) });
  }
  withContents.sort((a, b) => b.children.length - a.children.length);
  const keep = withContents[0];
  for (const dup of withContents.slice(1)) {
    for (const child of dup.children) {
      await driveFetch(token,
        `https://www.googleapis.com/drive/v3/files/${child.id}?addParents=${keep.id}&removeParents=${dup.id}`,
        { method: 'PATCH', headers: { 'Content-Type': 'application/json; charset=UTF-8' }, body: '{}' });
    }
    await driveFetch(token, `https://www.googleapis.com/drive/v3/files/${dup.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify({ trashed: true }),
    });
  }
  console.info(`Doppelte Lebensspuren-Ordner zusammengeführt (${found.length} → 1).`);
  return keep.id;
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

// Sichert eine Aufnahme nach Google Drive – aufgeräumt in Unterordnern:
// Lebensspuren / <Profilname> / <Kategorie – Frage> / Dateien
// (Mediendatei, Zeitstempel-Textdatei, falls vorhanden das Transkript).
// Metadaten gehen nach Firestore. Gibt die Drive-Datei-ID zurück.
export async function uploadRecording(rec, blob, extras = {}) {
  const { timestampsText, transcriptText, profileName, questionFolder } = extras;
  if (!fb) throw new Error('Cloud nicht initialisiert');
  const user = fb.auth.currentUser;
  if (!user) throw new Error('Nicht angemeldet');

  const token = await getDriveToken();
  if (!token) throw new Error('kein-drive-token');

  let folderId = await ensureDriveFolder(token);
  if (profileName) folderId = await ensureSubfolder(token, folderId, profileName);
  if (questionFolder) folderId = await ensureSubfolder(token, folderId, questionFolder);

  const ext = extensionForMime(rec.mimeType);
  const safeTitle = rec.title.replace(/[\\/:*?"<>|]/g, '').slice(0, 120);

  // Drive bekommt den MIME-Typ ohne Codec-Zusatz („audio/webm" statt
  // „audio/webm;codecs=opus"): Mit Parametern findet vor allem der mobile
  // Drive-Player keinen passenden Abspieler und meldet einen Dateifehler.
  const driveMime = (rec.mimeType || '').split(';')[0].trim()
    || (rec.mode === 'video' ? 'video/webm' : 'audio/webm');

  const fileId = await driveUploadFile(token, `${safeTitle}.${ext}`, driveMime, blob, folderId);
  const sidecarFileIds = [];
  if (timestampsText) {
    sidecarFileIds.push(await driveUploadFile(token, `${safeTitle} – Zeitstempel.txt`, 'text/plain',
      new Blob([timestampsText], { type: 'text/plain' }), folderId));
  }
  if (transcriptText) {
    sidecarFileIds.push(await driveUploadFile(token, `${safeTitle} – Transkript.txt`, 'text/plain',
      new Blob([transcriptText], { type: 'text/plain' }), folderId));
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
    sidecarFileIds,
    deviceId: extras.deviceId || null,
    deleted: false,
  });

  return fileId;
}

// ---------------------------------------------------------------------------
// Lösch-Abgleich: Was auf dem Gerät gelöscht wurde, wandert im Drive in den
// Papierkorb und wird in Firestore als gelöscht markiert (die Familie sieht
// es dann unter „Gelöschte Aufnahmen" und kann es endgültig entfernen).
// ---------------------------------------------------------------------------

export async function fetchOwnRecordingDocs() {
  if (!fb) return [];
  const user = fb.auth.currentUser;
  if (!user) return [];
  const { collection, getDocs } = fb.fsMod;
  const snap = await getDocs(collection(fb.db, 'users', user.uid, 'recordings'));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function markOwnRecordingDeleted(recordingId) {
  if (!fb) throw new Error('Cloud nicht initialisiert');
  const user = fb.auth.currentUser;
  if (!user) throw new Error('Nicht angemeldet');
  const { doc, setDoc } = fb.fsMod;
  await setDoc(doc(fb.db, 'users', user.uid, 'recordings', recordingId),
    { deleted: true, deletedAt: Date.now() }, { merge: true });
}

async function trashOneFile(token, fileId) {
  try {
    await driveFetch(token, `https://www.googleapis.com/drive/v3/files/${fileId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify({ trashed: true }),
    });
  } catch (err) {
    if (!String(err).includes('404')) throw err; // schon gelöscht = erledigt
  }
}

export async function trashDriveFiles(fileIds) {
  const token = await getDriveToken();
  if (!token) throw new Error('kein-drive-token');
  for (const id of fileIds) await trashOneFile(token, id);
}

// Für ältere Aufnahmen ohne gespeicherte Beiblatt-IDs: Dateien über den
// Titel finden. Bewusst streng geprüft, damit „(Teil 2)"-Aufnahmen mit
// gleichem Fragen-Titel nicht mitgelöscht werden.
export async function trashDriveFilesByTitle(titlePrefix) {
  const token = await getDriveToken();
  if (!token) throw new Error('kein-drive-token');
  const safe = titlePrefix.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const q = encodeURIComponent(`name contains '${safe}' and trashed=false`);
  const found = (await (await driveFetch(token,
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,mimeType)&pageSize=100`)).json()).files || [];
  for (const f of found) {
    if (f.mimeType === 'application/vnd.google-apps.folder') continue;
    if (f.name.startsWith(`${titlePrefix}.`) || f.name.startsWith(`${titlePrefix} – `)) {
      await trashOneFile(token, f.id);
    }
  }
}

// Familien-Recht: endgültiges Entfernen eines bereits als gelöscht
// markierten Eintrags aus der Liste (laut Security Rules nur dann erlaubt).
export async function deleteMemberRecording(uid, recordingId) {
  if (!fb) throw new Error('Cloud nicht initialisiert');
  const { doc, deleteDoc } = fb.fsMod;
  await deleteDoc(doc(fb.db, 'users', uid, 'recordings', recordingId));
}

// ---------------------------------------------------------------------------
// Familien-Zugriff: Drive-Ordner freigeben, Zustand in Firestore spiegeln
// ---------------------------------------------------------------------------

// Gibt den „Lebensspuren"-Ordner für ein Familienmitglied frei (Leserechte).
// Legt den Ordner an, falls er noch nicht existiert.
export async function shareDriveFolderWithEmail(email, { interactive = false } = {}) {
  const token = await getDriveToken({ interactive });
  if (!token) throw new Error('kein-drive-token');
  const folderId = await ensureDriveFolder(token);
  await driveFetch(token,
    `https://www.googleapis.com/drive/v3/files/${folderId}/permissions?sendNotificationEmail=false`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify({ role: 'reader', type: 'user', emailAddress: email }),
    });
  return folderId;
}

// Entzieht einem Familienmitglied die Ordner-Freigabe (best effort).
export async function removeDriveFolderShare(email) {
  const token = await getDriveToken({});
  if (!token) return false;
  const folderId = await ensureDriveFolder(token);
  const res = await (await driveFetch(token,
    `https://www.googleapis.com/drive/v3/files/${folderId}/permissions?fields=permissions(id,emailAddress)`)).json();
  const perm = (res.permissions || [])
    .find((p) => (p.emailAddress || '').toLowerCase() === email.toLowerCase());
  if (perm) {
    await driveFetch(token,
      `https://www.googleapis.com/drive/v3/files/${folderId}/permissions/${perm.id}`,
      { method: 'DELETE' });
  }
  return true;
}

// Spiegelt Profil, Fragenkatalog und Fortschritt des angemeldeten Nutzers
// nach Firestore, damit Familienmitglieder (laut Security Rules) mitlesen
// und den Katalog aus der Ferne pflegen können.
export async function pushFamilyState({ name, familyEmails, catalog, catalogUpdatedAt, progress, pushCatalog }) {
  if (!fb) return;
  const user = fb.auth.currentUser;
  if (!user) return;
  const { doc, setDoc } = fb.fsMod;
  await setDoc(doc(fb.db, 'freigaben', user.uid), {
    ownerUid: user.uid,
    name: name || '',
    familyEmails: familyEmails || [],
    updatedAt: Date.now(),
  });
  if (pushCatalog) {
    await setDoc(doc(fb.db, 'users', user.uid, 'app', 'katalog'), {
      data: catalog,
      updatedAt: catalogUpdatedAt || 0,
    });
  }
  await setDoc(doc(fb.db, 'users', user.uid, 'app', 'fortschritt'), {
    rows: progress || {},
    updatedAt: Date.now(),
  });
}

// Holt den eigenen Katalog aus Firestore (für den Abgleich zwischen
// Gerät und Fern-Änderungen der Familie). null, wenn keiner existiert.
export async function fetchOwnCatalogDoc() {
  if (!fb) return null;
  const user = fb.auth.currentUser;
  if (!user) return null;
  const { doc, getDoc } = fb.fsMod;
  const snap = await getDoc(doc(fb.db, 'users', user.uid, 'app', 'katalog'));
  return snap.exists() ? snap.data() : null;
}

// Findet alle Personen, die die angegebene E-Mail als Familienmitglied
// eingetragen haben (Grundlage der Familien-Ansicht).
export async function queryFamilyMembers(email) {
  if (!fb) return [];
  const { collection, query, where, getDocs } = fb.fsMod;
  const snap = await getDocs(query(
    collection(fb.db, 'freigaben'),
    where('familyEmails', 'array-contains', email.toLowerCase())
  ));
  return snap.docs.map((d) => ({ uid: d.id, ...d.data() }));
}

// Lädt Katalog, Fortschritt und Aufnahmen-Metadaten einer Person.
export async function fetchMemberData(uid) {
  if (!fb) throw new Error('Cloud nicht initialisiert');
  const { doc, getDoc, collection, getDocs } = fb.fsMod;
  const [kat, fort, recs] = await Promise.all([
    getDoc(doc(fb.db, 'users', uid, 'app', 'katalog')),
    getDoc(doc(fb.db, 'users', uid, 'app', 'fortschritt')),
    getDocs(collection(fb.db, 'users', uid, 'recordings')),
  ]);
  return {
    catalog: kat.exists() ? kat.data() : null,
    progress: fort.exists() ? fort.data() : null,
    recordings: recs.docs.map((d) => ({ id: d.id, ...d.data() })),
  };
}

// Schreibt den Katalog einer Person aus der Ferne (Familien-Recht laut Rules).
export async function writeMemberCatalog(uid, catalogData, updatedAt) {
  if (!fb) throw new Error('Cloud nicht initialisiert');
  const { doc, setDoc } = fb.fsMod;
  await setDoc(doc(fb.db, 'users', uid, 'app', 'katalog'), {
    data: catalogData,
    updatedAt,
  });
}

export function extensionForMime(mimeType) {
  const mt = (mimeType || '').toLowerCase();
  if (mt.includes('webm')) return 'webm';
  if (mt.includes('mp4')) return mt.startsWith('audio') ? 'm4a' : 'mp4';
  if (mt.includes('ogg')) return 'ogg';
  return 'bin';
}
