/**
 * Turn solver. Searches piece order and every legal cell for the pieces still
 * in hand, then ranks finished boards.
 *
 * Score (higher is better):
 *   lines cleared along the sequence
 *   minus pockets and rough edges (holes / fragmentation)
 *   plus open runs and 2×2 gaps (room for the next random pieces)
 *
 * Small trees are searched exactly. A board already reached with as many
 * cleared lines is skipped, because lines dominate the score. Wide trees
 * (an empty board and tiny pieces) keep a beam of the healthiest boards, then
 * a depth-first search stops at the first full plan if the beam missed one.
 * A full 3-piece search stays under 100 ms.
 */

import { SIZE } from "./config.js"
import { getShape } from "./pieces.js"

const N = SIZE * SIZE

function toFlat(board) {
  if (board instanceof Uint8Array && board.length === N) return board
  const flat = new Uint8Array(N)
  for (let r = 0; r < SIZE; r++) {
    const row = board[r]
    for (let c = 0; c < SIZE; c++) flat[r * SIZE + c] = row[c]
  }
  return flat
}

const SPOTS = new Map()

function origins(shape) {
  let list = SPOTS.get(shape.id)
  if (list) return list
  list = []
  for (let r = 0; r <= SIZE - shape.rows; r++) {
    for (let c = 0; c <= SIZE - shape.cols; c++) {
      const idx = []
      for (let i = 0; i < shape.cells.length; i++) {
        idx.push((r + shape.cells[i][0]) * SIZE + (c + shape.cells[i][1]))
      }
      list.push({ row: r, col: c, idx })
    }
  }
  SPOTS.set(shape.id, list)
  return list
}

function legalSpots(flat, shape) {
  const all = origins(shape)
  const spots = []
  for (let s = 0; s < all.length; s++) {
    const idx = all[s].idx
    let ok = true
    for (let i = 0; i < idx.length; i++) {
      if (flat[idx[i]] !== 0) {
        ok = false
        break
      }
    }
    if (ok) spots.push(all[s])
  }
  return spots
}

function stamp(flat, idx, color) {
  for (let i = 0; i < idx.length; i++) flat[idx[i]] = color
}

function wipeLines(flat) {
  const rows = []
  const cols = []
  for (let r = 0; r < SIZE; r++) {
    let full = true
    const base = r * SIZE
    for (let c = 0; c < SIZE; c++) {
      if (flat[base + c] === 0) {
        full = false
        break
      }
    }
    if (full) rows.push(r)
  }
  for (let c = 0; c < SIZE; c++) {
    let full = true
    for (let r = 0; r < SIZE; r++) {
      if (flat[r * SIZE + c] === 0) {
        full = false
        break
      }
    }
    if (full) cols.push(c)
  }
  if (rows.length === 0 && cols.length === 0) return 0
  for (let i = 0; i < rows.length; i++) flat.fill(0, rows[i] * SIZE, rows[i] * SIZE + SIZE)
  for (let i = 0; i < cols.length; i++) {
    const c = cols[i]
    for (let r = 0; r < SIZE; r++) flat[r * SIZE + c] = 0
  }
  return rows.length + cols.length
}

/** Cheap health of a flat board. `lines` is how many lines the sequence cleared. */
export function assessFlat(flat, lines) {
  let pockets = 0
  let transitions = 0
  let maxRun = 0
  let quads = 0
  let near = 0
  let sparse = 0
  let filled = 0

  for (let r = 0; r < SIZE; r++) {
    let rowFill = 0
    let run = 0
    const base = r * SIZE
    for (let c = 0; c < SIZE; c++) {
      const on = flat[base + c] !== 0
      if (on) {
        filled++
        rowFill++
        run = 0
      } else {
        run++
        if (run > maxRun) maxRun = run
        let walls = 0
        if (c === 0 || flat[base + c - 1] !== 0) walls++
        if (c === 7 || flat[base + c + 1] !== 0) walls++
        if (r === 0 || flat[base - SIZE + c] !== 0) walls++
        if (r === 7 || flat[base + SIZE + c] !== 0) walls++
        if (walls >= 3) pockets++
      }
      if (c > 0 && on !== (flat[base + c - 1] !== 0)) transitions++
    }
    if (rowFill >= 6 && rowFill < 8) near++
    if (rowFill > 0 && rowFill <= 2) sparse++
  }

  for (let c = 0; c < SIZE; c++) {
    let colFill = 0
    let run = 0
    for (let r = 0; r < SIZE; r++) {
      const on = flat[r * SIZE + c] !== 0
      if (on) {
        colFill++
        run = 0
      } else {
        run++
        if (run > maxRun) maxRun = run
      }
      if (r > 0 && on !== (flat[(r - 1) * SIZE + c] !== 0)) transitions++
    }
    if (colFill >= 6 && colFill < 8) near++
    if (colFill > 0 && colFill <= 2) sparse++
  }

  for (let r = 0; r < 7; r++) {
    for (let c = 0; c < 7; c++) {
      const i = r * SIZE + c
      if (flat[i] === 0 && flat[i + 1] === 0 && flat[i + SIZE] === 0 && flat[i + SIZE + 1] === 0) quads++
    }
  }

  const future =
    (maxRun >= 1 ? 2 : 0) +
    (maxRun >= 2 ? 3 : 0) +
    (maxRun >= 3 ? 4 : 0) +
    (maxRun >= 4 ? 3 : 0) +
    Math.min(quads, 8)
  const empty = N - filled
  return lines * 100 + near * 8 + future * 3 + empty * 0.25 + maxRun * 2 - pockets * 18 - transitions * 0.35 - sparse * 5
}

export function assessBoard(board, lines) {
  return assessFlat(toFlat(board), lines)
}

function occupancy(flat) {
  let key = 0n
  for (let i = 0; i < N; i++) {
    if (flat[i] !== 0) key |= 1n << BigInt(i)
  }
  return key
}

function renumber(plan) {
  for (let i = 0; i < plan.steps.length; i++) plan.steps[i].order = i + 1
  return plan
}

function remember(best, steps, lines, flat, complete) {
  const placed = steps.length
  const score = assessFlat(flat, lines)
  const better =
    complete !== best.complete
      ? complete
      : placed !== best.placed
        ? placed > best.placed
        : score > best.score
  if (!better) return best
  const copy = []
  for (let i = 0; i < steps.length; i++) copy.push(steps[i])
  return { complete, steps: copy, score, placed }
}

/** Exact search. Used when each piece has few homes, so the tree stays small. */
function exactSolve(flat, pieces) {
  const total = pieces.length
  const seen = new Map()
  let best = { complete: false, steps: [], score: -Infinity, placed: 0 }

  function dfs(mask, steps, lines) {
    if (mask === 0) {
      best = remember(best, steps, lines, flat, true)
      return
    }
    const key = occupancy(flat) * 16n + BigInt(mask)
    const prev = seen.get(key)
    if (prev !== undefined && prev >= lines) return
    seen.set(key, lines)

    let progressed = false
    for (let i = 0; i < total; i++) {
      const bit = 1 << i
      if ((mask & bit) === 0) continue
      const spots = legalSpots(flat, pieces[i].shape)
      if (spots.length === 0) continue
      progressed = true
      const nextMask = mask & ~bit
      const snap = flat.slice()
      for (let s = 0; s < spots.length; s++) {
        const spot = spots[s]
        stamp(flat, spot.idx, 1)
        const cleared = wipeLines(flat)
        steps.push({ slot: pieces[i].slot, row: spot.row, col: spot.col, order: steps.length + 1 })
        dfs(nextMask, steps, lines + cleared)
        steps.pop()
        flat.set(snap)
      }
    }
    if (!progressed) best = remember(best, steps, lines, flat, false)
  }

  dfs((1 << total) - 1, [], 0)
  return best
}

/**
 * Wide trees (an empty board, tiny pieces) are beam-searched: the healthiest
 * boards are kept after each piece. If that misses a no-lose line, a depth-first
 * search stops at the first full plan.
 */
function beamSolve(flat, pieces, width) {
  let layer = [{ flat: flat.slice(), mask: (1 << pieces.length) - 1, steps: [], lines: 0, score: 0 }]
  let partial = { complete: false, steps: [], score: -Infinity, placed: 0 }

  for (let depth = 0; depth < pieces.length; depth++) {
    const next = []
    for (let n = 0; n < layer.length; n++) {
      const node = layer[n]
      let any = false
      for (let i = 0; i < pieces.length; i++) {
        const bit = 1 << i
        if ((node.mask & bit) === 0) continue
        const spots = legalSpots(node.flat, pieces[i].shape)
        if (spots.length === 0) continue
        any = true
        const nextMask = node.mask & ~bit
        for (let s = 0; s < spots.length; s++) {
          const spot = spots[s]
          const copy = node.flat.slice()
          stamp(copy, spot.idx, 1)
          const cleared = wipeLines(copy)
          let fitBonus = 0
          for (let j = 0; j < pieces.length; j++) {
            if ((nextMask & (1 << j)) === 0) continue
            if (legalSpots(copy, pieces[j].shape).length > 0) fitBonus += 50
          }
          const steps = node.steps.slice()
          steps.push({ slot: pieces[i].slot, row: spot.row, col: spot.col, order: steps.length + 1 })
          const lines = node.lines + cleared
          next.push({
            flat: copy,
            mask: nextMask,
            steps,
            lines,
            score: assessFlat(copy, lines) + fitBonus,
          })
        }
      }
      if (!any) partial = remember(partial, node.steps, node.lines, node.flat, false)
    }
    if (next.length === 0) return partial
    next.sort((a, b) => b.score - a.score)
    layer = next.slice(0, width)
  }

  let best = { complete: true, steps: layer[0].steps, score: -Infinity, placed: pieces.length }
  for (let n = 0; n < layer.length; n++) {
    const score = assessFlat(layer[n].flat, layer[n].lines)
    if (score > best.score) best = { complete: true, steps: layer[n].steps, score, placed: pieces.length }
  }
  return best
}

function firstComplete(source, pieces) {
  const flat = source.slice()
  let partial = { complete: false, steps: [], score: -Infinity, placed: 0 }
  const steps = []
  let linesTotal = 0

  function dfs(mask, lines) {
    if (mask === 0) {
      linesTotal = lines
      return true
    }
    const order = []
    for (let i = 0; i < pieces.length; i++) {
      if ((mask & (1 << i)) === 0) continue
      order.push({ i, spots: legalSpots(flat, pieces[i].shape) })
    }
    order.sort((a, b) => a.spots.length - b.spots.length)
    let progressed = false
    for (let k = 0; k < order.length; k++) {
      const spots = order[k].spots
      if (spots.length === 0) continue
      progressed = true
      const bit = 1 << order[k].i
      for (let s = 0; s < spots.length; s++) {
        const spot = spots[s]
        const snap = flat.slice()
        stamp(flat, spot.idx, 1)
        const cleared = wipeLines(flat)
        steps.push({ slot: pieces[order[k].i].slot, row: spot.row, col: spot.col, order: steps.length + 1 })
        if (dfs(mask & ~bit, lines + cleared)) return true
        steps.pop()
        flat.set(snap)
      }
    }
    if (!progressed) partial = remember(partial, steps, lines, flat, false)
    return false
  }

  if (dfs((1 << pieces.length) - 1, 0)) {
    return { complete: true, steps: steps.slice(), score: assessFlat(flat, linesTotal), placed: steps.length }
  }
  return partial
}

/**
 * @param {number[][] | Uint8Array} board
 * @param {{ slot?: number, shapeId: string, used?: boolean }[]} hand
 * @returns {{ complete: boolean, steps: { slot: number, row: number, col: number, order: number }[], score: number, placed: number }}
 */
export function solve(board, hand) {
  const pieces = []
  for (let slot = 0; slot < hand.length; slot++) {
    const piece = hand[slot]
    if (!piece || piece.used) continue
    const shape = getShape(piece.shapeId)
    if (!shape) continue
    pieces.push({ slot, shape })
  }

  const total = pieces.length
  if (total === 0) return { complete: true, steps: [], score: 0, placed: 0 }

  const flat = toFlat(board)
  const counts = []
  let product = 1
  for (let i = 0; i < pieces.length; i++) {
    const n = legalSpots(flat, pieces[i].shape).length
    counts.push(n)
    product *= Math.max(1, n)
  }
  if (product <= 8000) return renumber(exactSolve(flat, pieces))
  const beamed = beamSolve(flat, pieces, 12)
  if (beamed.complete) return renumber(beamed)
  return renumber(firstComplete(flat, pieces))
}
