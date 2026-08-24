import { firebaseConfig, isFirebaseConfigured } from "./firebase-config.js";

const LOCAL_KEY = "doktogul_progress_v1_records";

let firebase = null;
let auth = null;
let db = null;
let currentUser = null;
let unsubscribeSnapshot = null;
let cloudListener = null;

export function storageMode() {
  if (!isFirebaseConfigured()) return "local";
  return currentUser ? "cloud" : "local";
}

export function getCurrentUser() {
  return currentUser;
}

export function getLocalRecords() {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveLocalRecords(records) {
  localStorage.setItem(LOCAL_KEY, JSON.stringify(records));
}

export async function initDataLayer({ onRecords, onAuth }) {
  cloudListener = onRecords;
  onRecords(getLocalRecords(), "local");

  if (!isFirebaseConfigured()) {
    onAuth({ configured:false, user:null, mode:"local" });
    return;
  }

  try {
    const [
      appMod,
      authMod,
      fsMod
    ] = await Promise.all([
      import("https://www.gstatic.com/firebasejs/12.17.1/firebase-app.js"),
      import("https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js"),
      import("https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js")
    ]);

    const app = appMod.initializeApp(firebaseConfig);
    auth = authMod.getAuth(app);
    db = fsMod.getFirestore(app);

    firebase = { authMod, fsMod };

    authMod.onAuthStateChanged(auth, user => {
      currentUser = user || null;
      if (unsubscribeSnapshot) {
        unsubscribeSnapshot();
        unsubscribeSnapshot = null;
      }

      if (!user) {
        onRecords(getLocalRecords(), "local");
        onAuth({ configured:true, user:null, mode:"local" });
        return;
      }

      const q = fsMod.query(
        fsMod.collection(db, "users", user.uid, "lessonRecords"),
        fsMod.orderBy("date", "asc")
      );

      unsubscribeSnapshot = fsMod.onSnapshot(
        q,
        snap => {
          const rows = snap.docs.map(d => ({ id:d.id, ...d.data() }));
          onRecords(rows, "cloud");
        },
        err => {
          console.error("Firestore snapshot error:", err);
          onAuth({ configured:true, user, mode:"cloud", error:err.message });
        }
      );
      onAuth({ configured:true, user, mode:"cloud" });
    });
  } catch (err) {
    console.error(err);
    onAuth({ configured:true, user:null, mode:"local", error:err.message });
  }
}

export async function signInGoogle() {
  if (!firebase || !auth) throw new Error("Firebase 초기화가 완료되지 않았습니다.");
  const provider = new firebase.authMod.GoogleAuthProvider();
  provider.setCustomParameters({ prompt:"select_account" });
  return firebase.authMod.signInWithPopup(auth, provider);
}

export async function signOutGoogle() {
  if (!firebase || !auth) return;
  return firebase.authMod.signOut(auth);
}

function normalize(record) {
  const copy = { ...record };
  delete copy._source;
  return copy;
}

export async function upsertRecord(record) {
  const clean = normalize(record);
  if (storageMode() === "cloud") {
    const id = String(clean.id);
    await firebase.fsMod.setDoc(
      firebase.fsMod.doc(db, "users", currentUser.uid, "lessonRecords", id),
      clean,
      { merge:true }
    );
    return;
  }

  const rows = getLocalRecords();
  const idx = rows.findIndex(r => String(r.id) === String(clean.id));
  if (idx >= 0) rows[idx] = clean;
  else rows.push(clean);
  saveLocalRecords(rows);
  cloudListener?.(rows, "local");
}

export async function deleteRecordById(id) {
  if (storageMode() === "cloud") {
    await firebase.fsMod.deleteDoc(
      firebase.fsMod.doc(db, "users", currentUser.uid, "lessonRecords", String(id))
    );
    return;
  }
  const rows = getLocalRecords().filter(r => String(r.id) !== String(id));
  saveLocalRecords(rows);
  cloudListener?.(rows, "local");
}

export async function migrateLocalToCloud() {
  if (storageMode() !== "cloud") throw new Error("먼저 Google 로그인을 해 주세요.");
  const rows = getLocalRecords();
  for (const row of rows) {
    const clean = normalize(row);
    await firebase.fsMod.setDoc(
      firebase.fsMod.doc(db, "users", currentUser.uid, "lessonRecords", String(clean.id)),
      clean,
      { merge:true }
    );
  }
  return rows.length;
}

export async function replaceAllRecords(imported) {
  if (!Array.isArray(imported)) throw new Error("올바른 기록 배열이 아닙니다.");
  if (storageMode() === "cloud") {
    const existing = await firebase.fsMod.getDocs(
      firebase.fsMod.collection(db, "users", currentUser.uid, "lessonRecords")
    );
    const batch = firebase.fsMod.writeBatch(db);
    existing.docs.forEach(d => batch.delete(d.ref));
    imported.forEach(r => {
      const clean = normalize(r);
      const id = String(clean.id || crypto.randomUUID());
      batch.set(
        firebase.fsMod.doc(db, "users", currentUser.uid, "lessonRecords", id),
        { ...clean, id }
      );
    });
    await batch.commit();
  } else {
    saveLocalRecords(imported);
    cloudListener?.(imported, "local");
  }
}
