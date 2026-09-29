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
  const base = {
    ...state,
    difficulty,
    bests,
    hintsLeft,
    best: Math.max(state.best || 0, bests[difficulty] || 0),
  }
  const remaining = base.hand.filter((piece) => !piece.used)
  if (remaining.length === 0) {
    const hand = ensureHand(base.board, base.preview, Math.random, difficulty)
    if (!hand) return { ...base, over: true }
    return { ...base, hand, preview: dealHand(base.board, Math.random, difficulty), over: false }
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
    over: state.over,
    settings: { ...state.settings },
  }
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

  let hintsLeft = state.hintsLeft
  if (level.earn && linesCleared > 0 && typeof hintsLeft === "number") {
    const bonus = linesCleared >= 2 ? 2 : 1
    hintsLeft = Math.min(level.cap, hintsLeft + bonus)
  }

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
  return {
    ok: true,
    state: next,
    steps,
    complete: plan.complete,
    placed: plan.placed,
    mode: level.hintMode,
  }
}
