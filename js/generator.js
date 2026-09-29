/**
 * Fair piece dealer.
 *
 * Contract: every hand that this module returns has at least one piece that
 * can be placed on the board it was dealt for. The distribution does not
 * depend on score, turn number, or a hidden difficulty curve.
 *
 * Algorithm for a fresh hand:
 *   1. Collect every oriented shape that fits somewhere on the board.
 *   2. If that list is empty, return null (no legal piece exists at all).
 *   3. Anchor = a fitting shape. Families (domino, L, square, …) are chosen
 *      uniformly, then a fitting orientation of that family. Extra rotations
 *      of a big L are not more likely than a 1×1 just because there are more
 *      of them. This is the guarantee, and it is not a "smallest piece" pity.
 *   4. Two more shapes = the same family-uniform pick over the FULL catalog.
 *      They are not biased toward pieces that fail, and they are not forced
 *      to fit. Score and turn number are not inputs.
 *   5. Shuffle the three so the anchor is not glued to one slot.
 *
 * Upcoming-set repair (`ensureFair`):
 *   A preview is dealt up front, so the board may change before it is played.
 *   If at least one of those three still fits, the set is kept as shown.
 *   If none fit, one slot is replaced by a uniform fitting shape.
 *   The current hand is never rewritten this way — if the pieces the player
 *   already holds no longer fit, the game is over.
 */

import { COLOR_COUNT } from "./config.js"
import { shapeFits } from "./board.js"
import { SHAPES, getShape } from "./pieces.js"
import { pick, shuffle } from "./rng.js"

const FAMILIES = []
{
  const grouped = new Map()
  for (const shape of SHAPES) {
    if (!grouped.has(shape.archetype)) grouped.set(shape.archetype, [])
    grouped.get(shape.archetype).push(shape)
  }
  for (const family of grouped.values()) FAMILIES.push(family)
}

/** Equal chance per family, then equal chance per orientation in that family. */
function pickAnyShape(rng) {
  return pick(pick(FAMILIES, rng), rng)
}

function pickFittingShape(board, rng) {
  const groups = []
  for (const family of FAMILIES) {
    const fitting = []
    for (const shape of family) {
      if (shapeFits(board, shape)) fitting.push(shape)
    }
    if (fitting.length > 0) groups.push(fitting)
  }
  if (groups.length === 0) return null
  return pick(pick(groups, rng), rng)
}

function makePiece(shape, rng) {
  return {
    uid: Math.floor(rng() * 1e9).toString(36),
    shapeId: shape.id,
    color: 1 + Math.floor(rng() * COLOR_COUNT),
    used: false,
  }
}

export function pieceFits(board, piece) {
  if (!piece || piece.used) return false
  const shape = getShape(piece.shapeId)
  if (!shape) return false
  return shapeFits(board, shape)
}

export function handHasFit(board, hand) {
  if (!hand) return false
  for (const piece of hand) {
    if (pieceFits(board, piece)) return true
  }
  return false
}

/** @returns {object[] | null} three unused pieces, or null when nothing fits */
export function dealFair(board, rng = Math.random) {
  const anchor = pickFittingShape(board, rng)
  if (!anchor) return null
  const ordered = shuffle([anchor, pickAnyShape(rng), pickAnyShape(rng)], rng)
  return ordered.map((shape) => makePiece(shape, rng))
}

/**
 * Keep `hand` if it still has a legal piece. Otherwise swap one piece for a
 * fitting shape. Returns null only when the catalog itself cannot be placed.
 */
export function ensureFair(board, hand, rng = Math.random) {
  if (hand && hand.length === 3 && handHasFit(board, hand)) {
    return hand.map((piece) => ({ ...piece, used: false }))
  }
  const replacementShape = pickFittingShape(board, rng)
  if (!replacementShape) return null
  const index = hand && hand.length === 3 ? Math.floor(rng() * 3) : 0
  const replacement = makePiece(replacementShape, rng)
  if (!hand || hand.length !== 3) return dealFair(board, rng)
  return hand.map((piece, i) => (i === index ? replacement : { ...piece, used: false }))
}
