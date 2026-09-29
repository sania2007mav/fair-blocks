/**
 * Match state machine. Pure data in, pure data out — no DOM, no storage.
 * A port can call `placePiece` and `createMatch` and render the result.
 */

import { DIFFICULTIES, defaultSettings, emptyBests, levelOf } from "./config.js"
import {
  emptyBoard,
  canPlace,
  placeCells,
  placedKeys,
  findFullLines,
  lineKeys,
  clearLines,
} from "./board.js"
import { getShape } from "./pieces.js"
import { dealHand, ensureHand, handHasFit, pieceFits } from "./generator.js"
import { scorePlacement } from "./scoring.js"
import { solve } from "./solver.js"

function copyBests(state) {
  const bests = emptyBests()
  if (state && state.bests) {
    for (const id of DIFFICULTIES) {
      const value = state.bests[id]
      bests[id] = Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
    }
    return bests
  }
  const fallback = state && Number.isFinite(state.best) ? Math.floor(state.best) : 0
  const id = state && state.difficulty && levelOf(state.difficulty) ? state.difficulty : "normal"
  if (DIFFICULTIES.includes(id)) bests[id] = fallback
  else bests.normal = fallback
  return bests
}

function normalizeBestArg(best, difficulty) {
  if (best && typeof best === "object") return copyBests({ bests: best })
  const bests = emptyBests()
  const value = Number.isFinite(best) ? Math.floor(best) : 0
  const id = DIFFICULTIES.includes(difficulty) ? difficulty : "normal"
  bests[id] = value
  if (id !== "normal" && difficulty === "normal") bests.normal = value
  return bests
}

/** Re-validate a save: an unfinished empty hand is re-dealt, a dead hand is game over. */
export function restoreMatch(state) {
  if (!state) return null
  const difficulty = DIFFICULTIES.includes(state.difficulty) ? state.difficulty : "normal"
  const level = levelOf(difficulty)
  const bests = copyBests({ ...state, difficulty })
  const hintsLeft = state.hintsLeft === undefined ? level.hints : state.hintsLeft
  const undosLeft = state.undosLeft === undefined ? level.undos : state.undosLeft
  const base = {
    ...state,
    difficulty,
    bests,
    hintsLeft,
    undosLeft,
    undo: state.undo || null,
    best: Math.max(state.best || 0, bests[difficulty] || 0),
  }
  const remaining = base.hand.filter((piece) => !piece.used)
  if (remaining.length === 0) {
    const hand = ensureHand(base.board, base.preview, Math.random, difficulty)
    if (!hand) return { ...base, over: true, undo: null }
    return { ...base, hand, preview: dealHand(base.board, Math.random, difficulty), over: false, undo: null }
  }
  if (!base.over && !handHasFit(base.board, remaining)) {
    return { ...base, over: true }
  }
  return base
}

function copyPiece(piece) {
  return { ...piece }
}

export function cloneState(state) {
  return {
    board: state.board.map((row) => row.slice()),
    hand: state.hand.map(copyPiece),
    preview: state.preview ? state.preview.map(copyPiece) : null,
    score: state.score,
    streak: state.streak,
    best: state.best,
    bests: copyBests(state),
    difficulty: state.difficulty || "normal",
    hintsLeft: state.hintsLeft === undefined ? levelOf(state.difficulty || "normal").hints : state.hintsLeft,
    undosLeft: state.undosLeft === undefined ? levelOf(state.difficulty || "normal").undos : state.undosLeft,
    undo: state.undo ? copyUndo(state.undo) : null,
    over: state.over,
    settings: { ...state.settings },
  }
}

function copyUndo(undo) {
  if (!undo) return null
  return {
    board: undo.board.map((row) => row.slice()),
    hand: undo.hand.map(copyPiece),
    preview: undo.preview ? undo.preview.map(copyPiece) : null,
    score: undo.score,
    streak: undo.streak,
    best: undo.best,
    bests: { ...undo.bests },
    hintsLeft: undo.hintsLeft,
    undosLeft: undo.undosLeft,
  }
}

function snapshotUndo(state) {
  return {
    board: state.board.map((row) => row.slice()),
    hand: state.hand.map(copyPiece),
    preview: state.preview ? state.preview.map(copyPiece) : null,
    score: state.score,
    streak: state.streak,
    best: state.best || 0,
    bests: copyBests(state.bests || state.difficulty ? state : { best: state.best, difficulty: "normal" }),
    hintsLeft: state.hintsLeft,
    undosLeft: state.undosLeft,
  }
}

function refillUndos(level, undosLeft, linesCleared, streak) {
  if (typeof undosLeft !== "number" || !level.undoMax) return undosLeft
  const combo = linesCleared >= 2
  const streakGrant = linesCleared > 0 && streak > 0 && streak % 3 === 0
  if (!combo && !streakGrant) return undosLeft
  return Math.min(level.undoMax, undosLeft + 1)
}

export function createMatch(rng = Math.random, best = 0, settings = defaultSettings(), difficulty = "normal") {
  const id = DIFFICULTIES.includes(difficulty) ? difficulty : "normal"
  const level = levelOf(id)
  const bests = normalizeBestArg(best, id)
  const board = emptyBoard()
  return {
    board,
    hand: dealHand(board, rng, id),
    preview: dealHand(board, rng, id),
    score: 0,
    streak: 0,
    best: bests[id] || 0,
    bests,
    difficulty: id,
    hintsLeft: level.hints,
    undosLeft: level.undos,
    undo: null,
    over: false,
    settings: { ...settings },
  }
}

export function restartMatch(state, rng = Math.random, difficulty) {
  const id = DIFFICULTIES.includes(difficulty) ? difficulty : state.difficulty || "normal"
  const bests = copyBests(state)
  if (state.difficulty && DIFFICULTIES.includes(state.difficulty)) {
    bests[state.difficulty] = Math.max(bests[state.difficulty] || 0, state.best || 0)
  }
  return createMatch(rng, bests, state.settings, id)
}

/** Every legal drop for the pieces the player still holds. */
export function legalMoves(state) {
  const moves = []
  if (state.over) return moves
  state.hand.forEach((piece, slot) => {
    if (!pieceFits(state.board, piece)) return
    const shape = getShape(piece.shapeId)
    const maxR = state.board.length - shape.rows
    const maxC = state.board[0].length - shape.cols
    for (let r = 0; r <= maxR; r++) {
      for (let c = 0; c <= maxC; c++) {
        if (canPlace(state.board, shape, r, c)) moves.push({ slot, r, c })
      }
    }
  })
  return moves
}

/**
 * Drop the piece in `slot` with its top-left cell on (row, col).
 * Does not mutate `state`.
 */
export function placePiece(state, slot, row, col, rng = Math.random) {
  if (state.over) return { ok: false, reason: "over" }
  const piece = state.hand[slot]
  if (!piece || piece.used) return { ok: false, reason: "used" }
  const shape = getShape(piece.shapeId)
  if (!shape || !canPlace(state.board, shape, row, col)) {
    return { ok: false, reason: "blocked" }
  }

  const placed = placeCells(state.board, shape, row, col, piece.color)
  const lines = findFullLines(placed)
  const linesCleared = lines.rows.length + lines.cols.length
  const cleared = linesCleared > 0 ? lineKeys(lines.rows, lines.cols) : new Set()
  const board = linesCleared > 0 ? clearLines(placed, lines.rows, lines.cols) : placed
  const difficulty = DIFFICULTIES.includes(state.difficulty) ? state.difficulty : "normal"
  const level = levelOf(state.difficulty ? difficulty : "normal")
  const scored = scorePlacement({
    cellsPlaced: shape.cells.length,
    linesCleared,
    streak: state.streak,
  })
  const gained = scored.points * (level.multiplier || 1)

  const hand = state.hand.map((item, index) =>
    index === slot ? { ...item, used: true } : { ...item },
  )

  let preview = state.preview ? state.preview.map(copyPiece) : null
  let over = false
  let dealt = false
  const remaining = hand.filter((item) => !item.used)

  if (remaining.length === 0) {
    const nextHand = ensureHand(board, preview, rng, state.difficulty ? difficulty : "normal")
    if (!nextHand) {
      over = true
    } else {
      hand.splice(0, hand.length, ...nextHand)
      preview = dealHand(board, rng, state.difficulty ? difficulty : "normal")
      dealt = true
    }
  } else if (!handHasFit(board, remaining)) {
    over = true
  }

  const prior = snapshotUndo(state)

  let hintsLeft = state.hintsLeft
  if (level.earn && linesCleared > 0 && typeof hintsLeft === "number") {
    const bonus = linesCleared >= 2 ? 2 : 1
    hintsLeft = Math.min(level.cap, hintsLeft + bonus)
  }
  const undosLeft = refillUndos(level, state.undosLeft, linesCleared, scored.streak)

  const score = state.score + gained
  const bests = copyBests(state.bests || state.difficulty ? state : { best: state.best, difficulty: "normal" })
  const best = Math.max(state.best || 0, score)
  bests[difficulty] = Math.max(bests[difficulty] || 0, best)
  const next = {
    board,
    hand,
    preview,
    score,
    streak: scored.streak,
    best,
    bests,
    difficulty: state.difficulty,
    hintsLeft,
    undosLeft,
    undo: prior,
    over,
    settings: { ...state.settings, seenHint: true },
  }

  return {
    ok: true,
    state: next,
    boardBeforeClear: placed,
    placedKeys: placedKeys(shape, row, col),
    clearedKeys: cleared,
    linesCleared,
    gained,
    breakdown: scored.breakdown,
    dealt,
    gameOver: over,
    newRecord: state.best > 0 && state.score < state.best && score >= state.best,
  }
}

/**
 * Spend one hint (unlimited levels stay unlimited) and return the plan.
 * Hard shows only the first step. The plan is partial when no no-lose line exists.
 */
export function takeHint(state) {
  const difficulty = DIFFICULTIES.includes(state.difficulty) ? state.difficulty : "normal"
  const level = levelOf(difficulty)
  if (level.hintMode === "none") return { ok: false, reason: "off", state }
  if (state.hintsLeft === 0) return { ok: false, reason: "spent", state }
  const plan = solve(state.board, state.hand)
  const hintsLeft = state.hintsLeft == null ? null : Math.max(0, state.hintsLeft - 1)
  const steps = level.hintMode === "single" ? plan.steps.slice(0, 1) : plan.steps.slice()
  const next = cloneState(state)
  next.hintsLeft = hintsLeft
  if (next.undo) next.undo = { ...next.undo, hintsLeft }
  return {
    ok: true,
    state: next,
    steps,
    complete: plan.complete,
    placed: plan.placed,
    mode: level.hintMode,
  }
}

/**
 * Revert the most recent placement. The piece set and preview come back
 * unchanged. A refill granted by that move is dropped, and the undo itself
 * is spent, so the action cannot be farmed. Not available after game over.
 */
export function undoMove(state) {
  const difficulty = DIFFICULTIES.includes(state.difficulty) ? state.difficulty : "normal"
  const level = levelOf(difficulty)
  if (state.over) return { ok: false, reason: "over", state }
  if (level.undoMax === 0) return { ok: false, reason: "off", state }
  if (state.undosLeft === 0) return { ok: false, reason: "spent", state }
  if (!state.undo || !state.undo.board || !state.undo.hand) return { ok: false, reason: "empty", state }

  const prior = state.undo
  const hintsLeft =
    typeof state.hintsLeft === "number" && typeof prior.hintsLeft === "number"
      ? Math.min(state.hintsLeft, prior.hintsLeft)
      : prior.hintsLeft
  const undosLeft = state.undosLeft == null ? null : Math.max(0, (prior.undosLeft ?? 0) - 1)
  const bests = copyBests({ bests: prior.bests })
  const next = {
    board: prior.board.map((row) => row.slice()),
    hand: prior.hand.map(copyPiece),
    preview: prior.preview ? prior.preview.map(copyPiece) : null,
    score: prior.score,
    streak: prior.streak,
    best: prior.best,
    bests,
    difficulty: state.difficulty,
    hintsLeft,
    undosLeft,
    undo: null,
    over: false,
    settings: { ...state.settings },
  }
  return { ok: true, state: next }
}
