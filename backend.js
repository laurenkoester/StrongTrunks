// Firebase connection. Everything that talks to Firebase lives in this file.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, onAuthStateChanged, signOut }
  from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { getFirestore, collection, doc, onSnapshot, writeBatch, setDoc }
  from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyB1dVkeV-z39llAw3Jv-lJcLaF_fNuWxvU",
  authDomain: "strongtrunks.firebaseapp.com",
  projectId: "strongtrunks",
  storageBucket: "strongtrunks.firebasestorage.app",
  messagingSenderId: "220056892913",
  appId: "1:220056892913:web:d57a121b81081ba515c050",
  measurementId: "G-Q4WD7DB156"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: "select_account" });

export function onUser(cb) {
  return onAuthStateChanged(auth, (u) =>
    cb(u ? { uid: u.uid, name: u.displayName || "", email: u.email || "" } : null));
}

export async function signIn() {
  try {
    await signInWithPopup(auth, provider);
  } catch (e) {
    if (e.code === "auth/popup-blocked" || e.code === "auth/operation-not-supported-in-this-environment") {
      await signInWithRedirect(auth, provider);
    } else if (e.code !== "auth/popup-closed-by-user" && e.code !== "auth/cancelled-popup-request") {
      throw e;
    }
  }
}

export const logOut = () => signOut(auth);

// All trees, live. rows: [{id, data}]
export function watchTrees(cb, err) {
  return onSnapshot(collection(db, "trees"),
    (s) => cb(s.docs.map((d) => ({ id: d.id, data: d.data() })), s.metadata.fromCache), err);
}

// Which tree this account has claimed (or null).
export function watchMyTree(uid, cb, err) {
  return onSnapshot(doc(db, "users", uid),
    (s) => cb(s.exists() ? s.data().tree : null), err);
}

export async function claim(uid, treeId, logs) {
  const b = writeBatch(db);
  b.set(doc(db, "trees", treeId), { owner: uid, logs });
  b.set(doc(db, "users", uid), { tree: treeId });
  await b.commit();
}

export async function release(uid, treeId, logs) {
  const b = writeBatch(db);
  b.set(doc(db, "trees", treeId), { owner: "", logs });
  b.delete(doc(db, "users", uid));
  await b.commit();
}

export function saveLogs(treeId, uid, logs) {
  return setDoc(doc(db, "trees", treeId), { owner: uid, logs });
}
