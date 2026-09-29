/**
 * Lazy Firebase client. Importing this module does not download the SDK.
 * If the CDN or the network is unavailable the game keeps working offline.
 * Firestore offline persistence is intentionally not enabled.
 */

import { firebaseConfig } from "./firebase-config.js"
import { DIFFICULTIES } from "./config.js"
import { validateName } from "./names.js"

const VERSION = "12.4.0"
const BASE = "https://www.gstatic.com/firebasejs/" + VERSION

let loaded = null
let loading = null

function withTimeout(promise, ms = 8000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (err) => {
        clearTimeout(timer)
        reject(err)
      },
    )
  })
}

export function useEmulator() {
  try {
    return new URLSearchParams(location.search).get("emu") === "1"
  } catch {
    return false
  }
}

export function onlineNow() {
  if (useEmulator()) return true
  return typeof navigator === "undefined" || navigator.onLine !== false
}

function denied(err) {
  const code = err && (err.code || err.message || "")
  return code === "permission-denied" || String(code).includes("permission-denied")
}

async function load() {
  if (loaded) return loaded
  if (loading) return loading
  loading = (async () => {
    try {
      const appMod = await import(BASE + "/firebase-app.js")
      const authMod = await import(BASE + "/firebase-auth.js")
      const fsMod = await import(BASE + "/firebase-firestore.js")
      const app = appMod.initializeApp(firebaseConfig)
      const auth = authMod.getAuth(app)
      const db = fsMod.getFirestore(app)
      if (useEmulator()) {
        authMod.connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true })
        fsMod.connectFirestoreEmulator(db, "127.0.0.1", 8080)
      }
      loaded = { auth, db, authMod, fsMod }
      return loaded
    } catch {
      loading = null
      return null
    }
  })()
  return loading
}

export async function ensureUser() {
  if (!onlineNow()) return null
  const fb = await load()
  if (!fb) return null
  if (fb.auth.currentUser) return fb.auth.currentUser
  await withTimeout(fb.authMod.signInAnonymously(fb.auth))
  return fb.auth.currentUser
}

/** Sign out and back in. Used by the emulator screenshot seed, not by normal play. */
export async function rotateUser() {
  const fb = await load()
  if (!fb) return null
  if (fb.auth.currentUser) await fb.authMod.signOut(fb.auth)
  await withTimeout(fb.authMod.signInAnonymously(fb.auth))
  return fb.auth.currentUser
}

export async function fetchPlayerName(uid) {
  const fb = await load()
  if (!fb || !uid) return null
  const snap = await withTimeout(fb.fsMod.getDoc(fb.fsMod.doc(fb.db, "players", uid)))
  if (!snap.exists()) return null
  const data = snap.data()
  if (!data || typeof data.name !== "string") return null
  return { name: data.name, nameLower: data.nameLower }
}

/** @returns {boolean | null} null when the check could not be made */
export async function isNameTaken(nameLower) {
  const fb = await load()
  if (!fb) return null
  const snap = await withTimeout(fb.fsMod.getDoc(fb.fsMod.doc(fb.db, "names", nameLower)))
  return snap.exists()
}

export async function claimName(uid, raw) {
  const check = validateName(raw)
  if (!check.ok) return { ok: false, code: check.code }
  const fb = await load()
  if (!fb || !uid) return { ok: false, code: "offline" }
  const { db, fsMod } = fb
  try {
    await withTimeout(
      fsMod.runTransaction(db, async (tx) => {
        const nameRef = fsMod.doc(db, "names", check.nameLower)
        const snap = await tx.get(nameRef)
        if (snap.exists()) {
          const err = new Error("taken")
          err.code = "taken"
          throw err
        }
        tx.set(nameRef, { uid, name: check.name, createdAt: fsMod.serverTimestamp() })
        tx.set(fsMod.doc(db, "players", uid), { name: check.name, nameLower: check.nameLower })
      }),
    )
    return { ok: true, name: check.name, nameLower: check.nameLower }
  } catch (err) {
    if (err.code === "taken" || denied(err)) return { ok: false, code: "taken" }
    return { ok: false, code: "offline" }
  }
}

export async function submitScore(uid, name, level, score, knownBest) {
  if (!DIFFICULTIES.includes(level) || !uid || !name) return { ok: false, code: "invalid" }
  if (!Number.isInteger(score) || score < 0 || score > 10000000) return { ok: false, code: "invalid" }
  if (typeof knownBest === "number" && score <= knownBest) return { ok: false, code: "not-higher", best: knownBest }
  const fb = await load()
  if (!fb) return { ok: false, code: "offline" }
  const { db, fsMod } = fb
  const ref = fsMod.doc(db, "scores", level, "entries", uid)
  try {
    const existing = await withTimeout(fsMod.getDoc(ref))
    const prev = existing.exists() && Number.isInteger(existing.data().score) ? existing.data().score : 0
    if (score <= prev) return { ok: false, code: "not-higher", best: prev }
    await withTimeout(fsMod.setDoc(ref, { uid, name, score, updatedAt: fsMod.serverTimestamp() }))
    return { ok: true, best: score }
  } catch (err) {
    if (denied(err)) return { ok: false, code: "not-higher" }
    return { ok: false, code: "offline" }
  }
}

export async function loadLeaderboard(level, uid) {
  if (!DIFFICULTIES.includes(level)) return { ok: false, code: "invalid" }
  const fb = await load()
  if (!fb) return { ok: false, code: "offline" }
  const { db, fsMod } = fb
  const coll = fsMod.collection(db, "scores", level, "entries")
  const q = fsMod.query(coll, fsMod.orderBy("score", "desc"), fsMod.orderBy("updatedAt", "asc"), fsMod.limit(50))
  try {
    const snap = await withTimeout(fsMod.getDocs(q))
    const rows = snap.docs.map((docSnap, index) => {
      const data = docSnap.data()
      return {
        rank: index + 1,
        uid: data.uid,
        name: data.name,
        score: data.score,
        mine: Boolean(uid) && data.uid === uid,
      }
    })
    let place = null
    if (uid && !rows.some((row) => row.mine)) {
      const own = await withTimeout(fsMod.getDoc(fsMod.doc(db, "scores", level, "entries", uid)))
      if (own.exists()) {
        const score = own.data().score
        const countSnap = await withTimeout(
          fsMod.getCountFromServer(fsMod.query(coll, fsMod.where("score", ">", score))),
        )
        place = { rank: countSnap.data().count + 1, score, name: own.data().name }
      }
    }
    return { ok: true, rows, place }
  } catch {
    return { ok: false, code: "offline" }
  }
}
