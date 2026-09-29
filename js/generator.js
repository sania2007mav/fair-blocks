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

import { COLOR_COUNT, SIZE, levelOf } from "./config.js"
import { shapeFits, canPlace, placeCells, findFullLines, clearLines, countFilled } from "./board.js"
import { SHAPES, getShape } from "./pieces.js"
import { pick, shuffle } from "./rng.js"
import { solve } from "./solver.js"

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

const SIMPLE = new Set(["mono", "domino", "i3", "o2", "l3", "i4", "rect23", "t4"])
const AWKWARD = new Set(["o3", "i5", "l5", "v5", "u5", "t5", "p5", "plus", "l4", "s4"])
const AWKWARD_FAMILIES = FAMILIES.filter((family) => AWKWARD.has(family[0].archetype))

function fittingShapes(board) {
  const list = []
  for (const shape of SHAPES) {
    let spots = 0
    const maxR = SIZE - shape.rows
    const maxC = SIZE - shape.cols
    for (let r = 0; r <= maxR; r++) {
      for (let c = 0; c <= maxC; c++) {
        if (canPlace(board, shape, r, c)) spots++
      }
    }
    if (spots > 0) list.push({ shape, spots })
  }
  return list
}

function weightedPick(items, weights, rng) {
  let total = 0
  for (let i = 0; i < weights.length; i++) total += weights[i]
  if (total <= 0) return items[items.length - 1]
  let roll = rng() * total
  for (let i = 0; i < items.length; i++) {
    roll -= weights[i]
    if (roll <= 0) return items[i]
  }
  return items[items.length - 1]
}

function placeHealthiest(board, shape) {
  let best = null
  let bestScore = -Infinity
  const maxR = SIZE - shape.rows
  const maxC = SIZE - shape.cols
  for (let r = 0; r <= maxR; r++) {
    for (let c = 0; c <= maxC; c++) {
      if (!canPlace(board, shape, r, c)) continue
      const placed = placeCells(board, shape, r, c, 1)
      const lines = findFullLines(placed)
      const cleared = lines.rows.length + lines.cols.length
      const next = cleared > 0 ? clearLines(placed, lines.rows, lines.cols) : placed
      const empty = SIZE * SIZE - countFilled(next)
      const score = cleared * 50 + empty
      if (score > bestScore) {
        bestScore = score
        best = next
      }
    }
  }
  return best
}

function candidateShapes(board, rng, friendly, width) {
  const fitting = fittingShapes(board)
  if (fitting.length === 0) return []
  const ranked = fitting.map((entry) => {
    const simple = SIMPLE.has(entry.shape.archetype)
    const jitter = 0.75 + rng() * 0.5
    if (!friendly) return { shape: entry.shape, weight: jitter }
    const fit = entry.spots / entry.shape.cells.length
    const bias = simple ? 8 : 0.35
    return { shape: entry.shape, weight: bias * (1 + fit) * jitter }
  })
  ranked.sort((a, b) => b.weight - a.weight)
  return ranked.slice(0, width).map((entry) => entry.shape)
}

/** Build a set that can be placed in order, then the caller may shuffle slots. */
function findSequence(board, rng, friendly) {
  const chosen = []
  function rec(current, depth, width) {
    if (depth === 3) return true
    const options = candidateShapes(current, rng, friendly, width)
    for (const shape of options) {
      const next = placeHealthiest(current, shape)
      if (!next) continue
      chosen.push(shape)
      if (rec(next, depth + 1, width)) return true
      chosen.pop()
    }
    return false
  }
  if (rec(board, 0, 1)) return chosen.slice()
  chosen.length = 0
  if (rec(board, 0, 6)) return chosen.slice()
  return null
}

function dealPlaceable(board, rng, friendly) {
  const sequence = findSequence(board, rng, friendly)
  if (!sequence) return dealFair(board, rng)
  return shuffle(sequence, rng).map((shape) => makePiece(shape, rng))
}

function pickWeightedFitting(board, rng, hardest) {
  const fitting = fittingShapes(board)
  if (fitting.length === 0) return null
  const weights = fitting.map((entry) => {
    const cells = entry.shape.cells.length
    if (hardest) return (cells * cells * cells) / entry.spots
    return cells * cells
  })
  return weightedPick(fitting, weights, rng).shape
}

function pickAwkwardShape(rng, hardest) {
  if (rng() < (hardest ? 0.85 : 0.7) && AWKWARD_FAMILIES.length > 0) {
    return pick(pick(AWKWARD_FAMILIES, rng), rng)
  }
  return pickAnyShape(rng)
}

function dealAwkward(board, rng, hardest) {
  const anchor = pickWeightedFitting(board, rng, hardest)
  if (!anchor) return null
  const ordered = shuffle([anchor, pickAwkwardShape(rng, hardest), pickAwkwardShape(rng, hardest)], rng)
  return ordered.map((shape) => makePiece(shape, rng))
}

function ensureAwkward(board, hand, rng, hardest) {
  if (hand && hand.length === 3 && handHasFit(board, hand)) {
    return hand.map((piece) => ({ ...piece, used: false }))
  }
  const anchor = pickWeightedFitting(board, rng, hardest)
  if (!anchor) return null
  if (!hand || hand.length !== 3) return dealAwkward(board, rng, hardest)
  const index = Math.floor(rng() * 3)
  const replacement = makePiece(anchor, rng)
  return hand.map((piece, i) => (i === index ? replacement : { ...piece, used: false }))
}

function ensurePlaceable(board, hand, rng, friendly) {
  if (hand && hand.length === 3 && hand.every((piece) => piece && !piece.used)) {
    const plan = solve(board, hand)
    if (plan.complete && plan.placed === 3) {
      return hand.map((piece) => ({ ...piece, used: false }))
    }
  }
  return dealPlaceable(board, rng, friendly)
}

/**
 * Deal a hand for a difficulty. `fair` is the original generator, byte for
 * byte in RNG use. Easier levels build a set that fits as a whole. Harder
 * levels still keep one fitting anchor and bias the rest toward large shapes.
 */
export function dealHand(board, rng = Math.random, difficulty = "normal") {
  const deal = levelOf(difficulty).deal
  if (deal === "friendly") return dealPlaceable(board, rng, true)
  if (deal === "placeable") return dealPlaceable(board, rng, false)
  if (deal === "awkward") return dealAwkward(board, rng, false)
  if (deal === "hardest") return dealAwkward(board, rng, true)
  return dealFair(board, rng)
}

/** Promote a preview. Placeable levels keep it only when all three still fit. */
export function ensureHand(board, hand, rng = Math.random, difficulty = "normal") {
  const deal = levelOf(difficulty).deal
  if (deal === "friendly") return ensurePlaceable(board, hand, rng, true)
  if (deal === "placeable") return ensurePlaceable(board, hand, rng, false)
  if (deal === "awkward") return ensureAwkward(board, hand, rng, false)
  if (deal === "hardest") return ensureAwkward(board, hand, rng, true)
  return ensureFair(board, hand, rng)
}
