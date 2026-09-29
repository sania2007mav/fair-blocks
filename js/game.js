/**
 * Match state machine. Pure data in, pure data out — no DOM, no storage.
 * A port can call `placePiece` and `createMatch` and render the result.
 */

import { defaultSettings } from "./config.js"
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
import { dealFair, ensureFair, handHasFit, pieceFits } from "./generator.js"
import { scorePlacement } from "./scoring.js"

/** Re-validate a save: an unfinished empty hand is re-dealt, a dead hand is game over. */
export function restoreMatch(state) {
  if (!state) return null
  const remaining = state.hand.filter((piece) => !piece.used)
  if (remaining.length === 0) {
    const hand = ensureFair(state.board, state.preview, Math.random)
    if (!hand) return { ...state, over: true }
    return { ...state, hand, preview: dealFair(state.board, Math.random), over: false }
  }
  if (!state.over && !handHasFit(state.board, remaining)) {
    return { ...state, over: true }
  }
  return state
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
    over: state.over,
    settings: { ...state.settings },
  }
}

export function createMatch(rng = Math.random, best = 0, settings = defaultSettings()) {
  const board = emptyBoard()
  return {
    board,
    hand: dealFair(board, rng),
    preview: dealFair(board, rng),
    score: 0,
    streak: 0,
    best,
    over: false,
    settings: { ...settings },
  }
}

export function restartMatch(state, rng = Math.random) {
  return createMatch(rng, state.best, state.settings)
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
  const scored = scorePlacement({
    cellsPlaced: shape.cells.length,
    linesCleared,
    streak: state.streak,
  })

  const hand = state.hand.map((item, index) =>
    index === slot ? { ...item, used: true } : { ...item },
  )

  let preview = state.preview ? state.preview.map(copyPiece) : null
  let over = false
  let dealt = false
  const remaining = hand.filter((item) => !item.used)

  if (remaining.length === 0) {
    const nextHand = ensureFair(board, preview, rng)
    if (!nextHand) {
      over = true
    } else {
      hand.splice(0, hand.length, ...nextHand)
      preview = dealFair(board, rng)
      dealt = true
    }
  } else if (!handHasFit(board, remaining)) {
    over = true
  }

  const score = state.score + scored.points
  const best = Math.max(state.best, score)
  const next = {
    board,
    hand,
    preview,
    score,
    streak: scored.streak,
    best,
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
    gained: scored.points,
    breakdown: scored.breakdown,
    dealt,
    gameOver: over,
    newRecord: state.best > 0 && state.score < state.best && score >= state.best,
  }
}
