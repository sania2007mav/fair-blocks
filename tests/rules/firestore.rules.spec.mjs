import { test, before, after, beforeEach } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing"
import {
  doc, getDoc, setDoc, updateDoc, deleteDoc, writeBatch, serverTimestamp, collection, query, orderBy, limit, getDocs,
  getCountFromServer, where, runTransaction, Timestamp,
} from "firebase/firestore"

let env
before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-fair-blocks",
    firestore: {
      rules: readFileSync(fileURLToPath(new URL("../../firestore.rules", import.meta.url)), "utf8"),
      host: "127.0.0.1",
      port: 8080,
    },
  })
})
after(async () => { await env.cleanup() })
beforeEach(async () => { await env.clearFirestore() })

const norm = (s) => s.normalize("NFC").trim().replace(/\s+/g, " ")
const db = (uid) => (uid ? env.authenticatedContext(uid).firestore() : env.unauthenticatedContext().firestore())

function claim(fs, uid, raw) {
  const name = norm(raw)
  const nameLower = name.toLowerCase()
  const b = writeBatch(fs)
  b.set(doc(fs, "names", nameLower), { uid, name, createdAt: serverTimestamp() })
  b.set(doc(fs, "players", uid), { name, nameLower })
  return b.commit()
}
const score = (fs, level, uid, name, s) =>
  setDoc(doc(fs, "scores", level, "entries", uid), { uid, name, score: s, updatedAt: serverTimestamp() })

test("claim valid names (RU, KK, EN, digits, _ -)", async () => {
  await assertSucceeds(claim(db("u1"), "u1", "  Саша  "))
  await assertSucceeds(claim(db("u2"), "u2", "Әлия Құрман"))
  await assertSucceeds(claim(db("u3"), "u3", "Player_1-X"))
  await assertSucceeds(claim(db("u4"), "u4", "ІҢҒҮҰҚӨҺ ёЁ"))
  await assertSucceeds(claim(db("u5"), "u5", "abcdefghijklmnop")) // 16
  await assertSucceeds(claim(db("u6"), "u6", "Жанңаргүлсұлтанә")) // 16 cyrillic
})

test("reject invalid names", async () => {
  for (const [i, bad] of ["a", "abcdefghijklmnopq", "Жанңаргүлсұлтанәх", "a  b", "ab!", "a.b", "😀😀", "a\u0483b", "ab\n", "Ѣab", " ab", "ab "].entries()) {
    const uid = "bad" + i
    const fs = db(uid)
    const nameLower = bad.toLowerCase()
    const b = writeBatch(fs)
    b.set(doc(fs, "names", nameLower), { uid, name: bad, createdAt: serverTimestamp() })
    b.set(doc(fs, "players", uid), { name: bad, nameLower })
    await assertFails(b.commit())
  }
})

test("names are unique and case-insensitive", async () => {
  await assertSucceeds(claim(db("u1"), "u1", "Саша"))
  await assertFails(claim(db("u2"), "u2", "САША"))
  await assertFails(claim(db("u2"), "u2", "саша"))
  await assertSucceeds(claim(db("u3"), "u3", "Әлия Ёж"))
  await assertFails(claim(db("u4"), "u4", "ӘЛИЯ ЁЖ"))
  await assertSucceeds(claim(db("u5"), "u5", "Mixed Ґ"))
  await assertFails(claim(db("u6"), "u6", "mixed ґ"))
})

test("forged nameLower (display name not matching key) is denied", async () => {
  const fs = db("u1")
  const b = writeBatch(fs)
  b.set(doc(fs, "names", "xxxx"), { uid: "u1", name: "Саша", createdAt: serverTimestamp() })
  b.set(doc(fs, "players", "u1"), { name: "Саша", nameLower: "xxxx" })
  await assertFails(b.commit())
  const b2 = writeBatch(fs) // key keeps an upper-case Cyrillic letter
  b2.set(doc(fs, "names", "Саша"), { uid: "u1", name: "Саша", createdAt: serverTimestamp() })
  b2.set(doc(fs, "players", "u1"), { name: "Саша", nameLower: "Саша" })
  await assertFails(b2.commit())
})

test("one name per uid, no rename, no delete, no steal", async () => {
  await assertSucceeds(claim(db("u1"), "u1", "Alpha"))
  await assertFails(claim(db("u1"), "u1", "Beta"))
  await assertFails(setDoc(doc(db("u1"), "players", "u1"), { name: "Beta", nameLower: "beta" }))
  await assertFails(deleteDoc(doc(db("u1"), "names", "alpha")))
  await assertFails(deleteDoc(doc(db("u2"), "names", "alpha")))
  await assertFails(updateDoc(doc(db("u2"), "names", "alpha"), { uid: "u2" }))
  await assertFails(setDoc(doc(db("u2"), "names", "alpha"), { uid: "u2", name: "Alpha", createdAt: serverTimestamp() }))
  await assertFails(deleteDoc(doc(db("u1"), "players", "u1")))
})

test("half-claims and mismatched batches are denied", async () => {
  const fs = db("u1")
  await assertFails(setDoc(doc(fs, "names", "solo"), { uid: "u1", name: "Solo", createdAt: serverTimestamp() }))
  await assertFails(setDoc(doc(fs, "players", "u1"), { name: "Solo", nameLower: "solo" }))
  let b = writeBatch(fs) // name doc for someone else
  b.set(doc(fs, "names", "solo"), { uid: "u2", name: "Solo", createdAt: serverTimestamp() })
  b.set(doc(fs, "players", "u1"), { name: "Solo", nameLower: "solo" })
  await assertFails(b.commit())
  b = writeBatch(fs) // players pointing at a different name
  b.set(doc(fs, "names", "solo"), { uid: "u1", name: "Solo", createdAt: serverTimestamp() })
  b.set(doc(fs, "players", "u1"), { name: "Other", nameLower: "other" })
  await assertFails(b.commit())
  b = writeBatch(fs) // players doc for another uid
  b.set(doc(fs, "names", "solo"), { uid: "u1", name: "Solo", createdAt: serverTimestamp() })
  b.set(doc(fs, "players", "u2"), { name: "Solo", nameLower: "solo" })
  await assertFails(b.commit())
  b = writeBatch(fs) // wrong doc id vs name
  b.set(doc(fs, "names", "solox"), { uid: "u1", name: "Solo", createdAt: serverTimestamp() })
  b.set(doc(fs, "players", "u1"), { name: "Solo", nameLower: "solox" })
  await assertFails(b.commit())
  b = writeBatch(fs) // extra field, client createdAt
  b.set(doc(fs, "names", "solo"), { uid: "u1", name: "Solo", createdAt: Timestamp.fromMillis(0) })
  b.set(doc(fs, "players", "u1"), { name: "Solo", nameLower: "solo" })
  await assertFails(b.commit())
  b = writeBatch(fs)
  b.set(doc(fs, "names", "solo"), { uid: "u1", name: "Solo", createdAt: serverTimestamp(), admin: true })
  b.set(doc(fs, "players", "u1"), { name: "Solo", nameLower: "solo" })
  await assertFails(b.commit())
  await assertFails(claim(db(null), "u1", "Solo"))
})

test("transaction claim works", async () => {
  const fs = db("u1")
  await assertSucceeds(runTransaction(fs, async (tx) => {
    const ref = doc(fs, "names", "тест")
    const snap = await tx.get(ref)
    assert.equal(snap.exists(), false)
    tx.set(ref, { uid: "u1", name: "Тест", createdAt: serverTimestamp() })
    tx.set(doc(fs, "players", "u1"), { name: "Тест", nameLower: "тест" })
  }))
})

test("reads: names get public, list denied; players owner-only", async () => {
  await claim(db("u1"), "u1", "Alpha")
  await assertSucceeds(getDoc(doc(db(null), "names", "alpha")))
  await assertSucceeds(getDoc(doc(db(null), "names", "nobody")))
  await assertFails(getDocs(collection(db(null), "names")))
  await assertSucceeds(getDoc(doc(db("u1"), "players", "u1")))
  await assertFails(getDoc(doc(db("u2"), "players", "u1")))
  await assertFails(getDocs(collection(db("u1"), "players")))
})

test("scores: owner writes, name must match, int range, only increases", async () => {
  await claim(db("u1"), "u1", "Alpha")
  await claim(db("u2"), "u2", "Beta")
  const fs = db("u1")
  await assertFails(score(fs, "normal", "u1", "Beta", 10))       // wrong name
  await assertFails(score(fs, "normal", "u2", "Beta", 10))       // other uid
  await assertFails(score(db(null), "normal", "u1", "Alpha", 10)) // unauth
  await assertFails(score(fs, "insane", "u1", "Alpha", 10))      // bad level
  await assertFails(score(fs, "normal", "u1", "Alpha", -1))
  await assertFails(score(fs, "normal", "u1", "Alpha", 10000001))
  await assertFails(score(fs, "normal", "u1", "Alpha", 1.5))
  await assertFails(score(fs, "normal", "u1", "Alpha", "10"))
  await assertFails(setDoc(doc(fs, "scores", "normal", "entries", "u1"), { uid: "u1", name: "Alpha", score: 5, updatedAt: Timestamp.fromMillis(0) }))
  await assertFails(setDoc(doc(fs, "scores", "normal", "entries", "u1"), { uid: "u1", name: "Alpha", score: 5, updatedAt: serverTimestamp(), x: 1 }))
  await assertSucceeds(score(fs, "normal", "u1", "Alpha", 0))
  await assertSucceeds(score(fs, "normal", "u1", "Alpha", 120))
  await assertFails(score(fs, "normal", "u1", "Alpha", 120))
  await assertFails(score(fs, "normal", "u1", "Alpha", 100))
  await assertSucceeds(score(fs, "normal", "u1", "Alpha", 10000000))
  await assertFails(updateDoc(doc(fs, "scores", "normal", "entries", "u1"), { score: 10000001, updatedAt: serverTimestamp() }))
  await assertFails(deleteDoc(doc(fs, "scores", "normal", "entries", "u1")))
  await assertFails(deleteDoc(doc(db("u2"), "scores", "normal", "entries", "u1")))
  await assertSucceeds(score(db("u2"), "expert", "u2", "Beta", 50))
  // no player doc => no score
  await assertFails(score(db("u3"), "easy", "u3", "Gamma", 5))
  await assertFails(setDoc(doc(fs, "scores", "normal"), { a: 1 }))
})

test("public leaderboard queries", async () => {
  await claim(db("u1"), "u1", "Alpha")
  await score(db("u1"), "hard", "u1", "Alpha", 77)
  const anon = db(null)
  const q = query(collection(anon, "scores", "hard", "entries"), orderBy("score", "desc"), orderBy("updatedAt", "asc"), limit(50))
  const snap = await assertSucceeds(getDocs(q))
  assert.equal(snap.size, 1)
  await assertSucceeds(getCountFromServer(query(collection(anon, "scores", "hard", "entries"), where("score", ">", 10))))
  await assertFails(getDocs(collection(anon, "scores", "bogus", "entries")))
  await assertFails(getDocs(collection(anon, "scores")))
})
