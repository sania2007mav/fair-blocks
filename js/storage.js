/** localStorage save/load. `deserialize` is pure so tests can round-trip JSON. */

import { SIZE, STORAGE_KEY, THEMES, LANGS, COLOR_COUNT, DIFFICULTIES, defaultSettings, emptyBests, levelOf } from "./config.js"
import { getShape } from "./pieces.js"

function isBoard(board) {
  if (!Array.isArray(board) || board.length !== SIZE) return false
  for (const row of board) {
    if (!Array.isArray(row) || row.length !== SIZE) return false
    for (const cell of row) {
      if (!Number.isInteger(cell) || cell < 0 || cell > COLOR_COUNT) return false
    }
  }
  return true
}

function isPiece(piece) {
  if (!piece || typeof piece !== "object") return false
  if (typeof piece.uid !== "string" || !getShape(piece.shapeId)) return false
  if (!Number.isInteger(piece.color) || piece.color < 1 || piece.color > COLOR_COUNT) return false
  if (typeof piece.used !== "boolean") return false
  return true
}

function isHand(hand) {
  return Array.isArray(hand) && hand.length === 3 && hand.every(isPiece)
}

function readSettings(raw) {
  const base = defaultSettings()
  if (!raw || typeof raw !== "object") return base
  if (THEMES.includes(raw.theme)) base.theme = raw.theme
  if (LANGS.includes(raw.lang)) base.lang = raw.lang
  if (typeof raw.muted === "boolean") base.muted = raw.muted
  if (typeof raw.showPreview === "boolean") base.showPreview = raw.showPreview
  if (typeof raw.seenHint === "boolean") base.seenHint = raw.seenHint
  return base
}

function readNumber(value) {
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0
}

function readBests(data, difficulty, best) {
  const bests = emptyBests()
  if (data && data.bests && typeof data.bests === "object") {
    for (const id of DIFFICULTIES) bests[id] = readNumber(data.bests[id])
  }
  bests[difficulty] = Math.max(bests[difficulty], best)
  return bests
}

function readHints(value, difficulty) {
  if (value === null) return null
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return Math.floor(value)
  return levelOf(difficulty).hints
}

/** @returns {{ state: object | null, best: number }} */
export function deserialize(raw) {
  let data = raw
  if (typeof raw === "string") {
    try {
      data = JSON.parse(raw)
    } catch {
      return { state: null, best: 0 }
    }
  }
  if (!data || typeof data !== "object") return { state: null, best: 0 }
  const best = readNumber(data.best)
  if ((data.v !== 1 && data.v !== 2) || !isBoard(data.board) || !isHand(data.hand)) {
    return { state: null, best }
  }
  if (data.preview != null && !isHand(data.preview)) return { state: null, best }
  const difficulty = DIFFICULTIES.includes(data.difficulty) ? data.difficulty : "normal"
  const bests = readBests(data, difficulty, best)
  const state = {
    board: data.board.map((row) => row.slice()),
    hand: data.hand.map((piece) => ({ ...piece })),
    preview: data.preview ? data.preview.map((piece) => ({ ...piece })) : null,
    score: readNumber(data.score),
    streak: readNumber(data.streak),
    best: Math.max(best, bests[difficulty]),
    bests,
    difficulty,
    hintsLeft: readHints(data.hintsLeft, difficulty),
    over: Boolean(data.over),
    settings: readSettings(data.settings),
  }
  if (state.score > state.best) {
    state.best = state.score
    state.bests[difficulty] = state.score
  }
  return { state, best: state.best }
}

export function serialize(state) {
  return JSON.stringify({ v: 2, ...state })
}

export function loadGame() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { state: null, best: 0 }
    return deserialize(raw)
  } catch {
    return { state: null, best: 0 }
  }
}

export function saveGame(state) {
  try {
    localStorage.setItem(STORAGE_KEY, serialize(state))
  } catch {
    /* Private mode or a full disk: the match still runs, it just won't resume. */
  }
}
