// Firebase-Anbindung für „Lebensspuren" (optional).
//
// ╔══════════════════════════════════════════════════════════════════╗
// ║  HIER DEINE FIREBASE-KONFIGURATION EINTRAGEN                     ║
// ║                                                                  ║
// ║  1. Firebase-Konsole öffnen: https://console.firebase.google.com ║
// ║  2. Projekt anlegen → Web-App hinzufügen (</>-Symbol)            ║
// ║  3. Die angezeigten Werte hier unten einfügen                    ║
// ║                                                                  ║
// ║  Solange die Felder leer sind, läuft die App rein lokal –        ║
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
// ╚═══════════════ ENDE DES KONFIGURATIONS-BLOCKS ══════════════════╝

const SDK = 'https://www.gstatic.com/firebasejs/11.0.1';

let fb = null; // { app, auth, db, storage, mod: {...} } sobald initialisiert

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
    const [appMod, authMod, fsMod, stMod] = await Promise.all([
      import(`${SDK}/firebase-app.js`),
      import(`${SDK}/firebase-auth.js`),
      import(`${SDK}/firebase-firestore.js`),
      import(`${SDK}/firebase-storage.js`),
    ]);
    const app = appMod.initializeApp(firebaseConfig);
    const auth = authMod.getAuth(app);
    auth.languageCode = 'de';
    const db = fsMod.getFirestore(app);
    const storage = stMod.getStorage(app);
    fb = { app, auth, db, storage, authMod, fsMod, stMod };
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
  try {
    await fb.authMod.signInWithPopup(fb.auth, provider);
  } catch (err) {
    // Popup blockiert (z. B. installierte PWA auf iOS) → Redirect-Anmeldung
    if (err && (err.code === 'auth/popup-blocked' || err.code === 'auth/operation-not-supported-in-this-environment')) {
      await fb.authMod.signInWithRedirect(fb.auth, provider);
    } else {
      throw err;
    }
  }
}

export async function signOutUser() {
  if (!fb) return;
  await fb.authMod.signOut(fb.auth);
}

// Lädt eine Aufnahme in Cloud Storage hoch und legt die Metadaten
// (Titel, Datum, Dauer, Zeitstempel) in Firestore ab.
// Gibt den Storage-Pfad zurück.
export async function uploadRecording(rec, blob) {
  if (!fb) throw new Error('Cloud nicht initialisiert');
  const user = fb.auth.currentUser;
  if (!user) throw new Error('Nicht angemeldet');

  const ext = extensionForMime(rec.mimeType);
  const storagePath = `users/${user.uid}/media/${rec.id}.${ext}`;
  const fileRef = fb.stMod.ref(fb.storage, storagePath);
  await fb.stMod.uploadBytes(fileRef, blob, { contentType: rec.mimeType });

  const docRef = fb.fsMod.doc(fb.db, 'users', user.uid, 'recordings', rec.id);
  await fb.fsMod.setDoc(docRef, {
    title: rec.title,
    createdAt: rec.createdAt,
    mode: rec.mode,
    mimeType: rec.mimeType,
    durationMs: rec.durationMs,
    size: rec.size,
    timestamps: rec.timestamps,
    storagePath,
  });

  return storagePath;
}

export function extensionForMime(mimeType) {
  const mt = (mimeType || '').toLowerCase();
  if (mt.includes('webm')) return 'webm';
  if (mt.includes('mp4')) return mt.startsWith('audio') ? 'm4a' : 'mp4';
  if (mt.includes('ogg')) return 'ogg';
  return 'bin';
}
