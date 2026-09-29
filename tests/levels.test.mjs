import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { DIFFICULTIES, emptyBests } from "../js/config.js"
import { mulberry32 } from "../js/rng.js"
import { SHAPES, getShape } from "../js/pieces.js"
import { emptyBoard, canPlace, placeCells, findFullLines, clearLines, shapeFits } from "../js/board.js"
import { dealHand, handHasFit } from "../js/generator.js"
import { createMatch, placePiece, takeHint, legalMoves, restartMatch } from "../js/game.js"
import { solve } from "../js/solver.js"
import { deserialize, serialize } from "../js/storage.js"

const settings = { theme: "classic", muted: true, showPreview: true, lang: "ru", seenHint: true }

function piece(shapeId, color = 1, uid = shapeId) {
  return { uid, shapeId, color, used: false }
}

function randomBoard(rng, fill) {
  const board = emptyBoard()
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) board[r][c] = rng() < fill ? 1 : 0
  }
  return board
}

function spotCount(board, shape) {
  let n = 0
  for (let r = 0; r <= 8 - shape.rows; r++) {
    for (let c = 0; c <= 8 - shape.cols; c++) {
      if (canPlace(board, shape, r, c)) n++
    }
  }
  return n
}

/** Independent existence search. Stops at the first full placement order. */
function bruteExists(board, shapes, limit) {
  let nodes = 0
  let capped = false
  function dfs(current, mask) {
    if (mask === 0) return true
    if (nodes > limit) {
      capped = true
      return false
    }
    const order = []
    for (let i = 0; i < shapes.length; i++) {
      if ((mask & (1 << i)) === 0) continue
      order.push(i)
    }
    order.sort((a, b) => spotCount(current, shapes[a]) - spotCount(current, shapes[b]))
    for (const i of order) {
      const shape = shapes[i]
      for (let r = 0; r <= 8 - shape.rows; r++) {
        for (let c = 0; c <= 8 - shape.cols; c++) {
          if (!canPlace(current, shape, r, c)) continue
          nodes++
          const placed = placeCells(current, shape, r, c, 1)
          const lines = findFullLines(placed)
          const cleared = lines.rows.length + lines.cols.length
          const next = cleared > 0 ? clearLines(placed, lines.rows, lines.cols) : placed
          if (dfs(next, mask & ~(1 << i))) return true
          if (capped) return false
        }
      }
    }
    return false
  }
  const found = dfs(board, (1 << shapes.length) - 1)
  return { found, capped }
}

function applyPlan(board, hand, steps) {
  let state = {
    board,
    hand,
    preview: hand.map((item) => ({ ...item, uid: item.uid + "p" })),
    score: 0,
    streak: 0,
    best: 0,
    bests: emptyBests(),
    difficulty: "easy",
    hintsLeft: null,
    over: false,
    settings,
  }
  for (const step of steps) {
    const result = placePiece(state, step.slot, step.row, step.col, mulberry32(1))
    assert.equal(result.ok, true, "hint step must be a legal placement")
    state = result.state
  }
  return state
}

describe("solver", () => {
  it("matches brute force on random boards and stays under 100 ms", () => {
    const rng = mulberry32(99)
    const empty = emptyBoard()
    const monos = [piece("mono", 1, "a"), piece("mono", 2, "b"), piece("mono", 3, "c")]
    const t0 = performance.now()
    const monoPlan = solve(empty, monos)
    const monoMs = performance.now() - t0
    assert.equal(monoPlan.complete, true)
    assert.equal(monoPlan.steps.length, 3)
    assert.ok(monoMs < 100, "3 monos took " + monoMs.toFixed(1) + " ms")

    const mixed = [piece("v5-0", 1, "a"), piece("t4-0", 2, "b"), piece("domino-0", 3, "c")]
    const t1 = performance.now()
    const mixedPlan = solve(empty, mixed)
    const mixedMs = performance.now() - t1
    assert.equal(mixedPlan.complete, true)
    assert.ok(mixedMs < 100, "mixed hand took " + mixedMs.toFixed(1) + " ms")
    applyPlan(empty, mixed, mixedPlan.steps)

    let compared = 0
    for (let n = 0; n < 24; n++) {
      const board = randomBoard(rng, 0.5)
      const hand = [0, 1, 2].map((i) => piece(SHAPES[Math.floor(rng() * SHAPES.length)].id, i + 1, "p" + n + "-" + i))
      const shapes = hand.map((item) => getShape(item.shapeId))
      const product = shapes.reduce((acc, shape) => acc * Math.max(1, spotCount(board, shape)), 1)
      if (product > 400) continue
      const plan = solve(board, hand)
      const brute = bruteExists(board, shapes, 8000)
      if (brute.capped) continue
      assert.equal(plan.complete, brute.found, "solver and brute disagree")
      if (plan.complete) applyPlan(board.map((row) => row.slice()), hand.map((item) => ({ ...item })), plan.steps)
      compared++
    }
    assert.ok(compared >= 8, "expected several comparable boards, got " + compared)
  })

  it("says so when only part of the hand fits", () => {
    const board = emptyBoard()
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) board[r][c] = 1
    }
    for (let r = 0; r < 8; r++) {
      board[r][(2 * r) % 8] = 0
      board[r][(2 * r + 3) % 8] = 0
    }
    const hand = [piece("mono", 1, "m"), piece("o3", 2, "a"), piece("o3", 3, "b")]
    assert.equal(shapeFits(board, getShape("o3")), false)
    const plan = solve(board, hand)
    assert.equal(plan.complete, false)
    assert.equal(plan.placed, 1)
    assert.equal(plan.steps.length, 1)
    assert.equal(plan.steps[0].slot, 0)
    assert.equal(plan.steps[0].order, 1)
  })
})

describe("difficulty deals", () => {
  it("deals a fully placeable set on very easy and easy", () => {
    const rng = mulberry32(2026)
    for (const difficulty of ["veryEasy", "easy"]) {
      for (let n = 0; n < 16; n++) {
        const board = n === 0 ? emptyBoard() : randomBoard(rng, 0.32)
        const any = SHAPES.some((shape) => shapeFits(board, shape))
        const hand = dealHand(board, rng, difficulty)
        if (!any) {
          assert.equal(hand, null)
          continue
        }
        assert.ok(hand)
        assert.equal(handHasFit(board, hand), true)
        const plan = solve(board, hand)
        assert.equal(plan.complete, true, difficulty + " deal was not fully placeable")
        assert.equal(plan.placed, 3)
      }
    }
  })

  it("keeps at least one fitting piece on every level", () => {
    const rng = mulberry32(11)
    for (const difficulty of DIFFICULTIES) {
      for (let n = 0; n < 20; n++) {
        const board = randomBoard(rng, 0.45)
        const any = SHAPES.some((shape) => shapeFits(board, shape))
        const hand = dealHand(board, rng, difficulty)
        if (!any) {
          assert.equal(hand, null)
          continue
        }
        assert.equal(handHasFit(board, hand), true, difficulty)
      }
    }
  })

  it("keeps the fairness guarantee while playing each level", () => {
    const rng = mulberry32(4242)
    for (const difficulty of DIFFICULTIES) {
      let deals = 0
      for (let game = 0; game < 3; game++) {
        let state = createMatch(rng, 0, settings, difficulty)
        assert.equal(handHasFit(state.board, state.hand), true)
        deals++
        for (let step = 0; step < 40 && !state.over; step++) {
          const options = legalMoves(state)
          assert.ok(options.length > 0)
          const move = options[Math.floor(rng() * options.length)]
          const result = placePiece(state, move.slot, move.r, move.c, rng)
          assert.equal(result.ok, true)
          state = result.state
          if (result.dealt) {
            deals++
            assert.equal(handHasFit(state.board, state.hand), true, difficulty)
            if (difficulty === "veryEasy" || difficulty === "easy") {
              assert.equal(solve(state.board, state.hand).complete, true, difficulty)
            }
          }
          if (state.over) assert.equal(legalMoves(state).length, 0)
        }
      }
      assert.ok(deals >= 3, difficulty)
    }
  })
})

describe("hints and records", () => {
  it("spends a limited hint, earns them back, and doubles expert points", () => {
    const normal = createMatch(mulberry32(4), 0, settings, "normal")
    assert.equal(normal.hintsLeft, 3)
    const once = takeHint(normal)
    assert.equal(once.ok, true)
    assert.equal(once.state.hintsLeft, 2)
    assert.ok(once.steps.length >= 1)

    const hard = createMatch(mulberry32(5), 0, settings, "hard")
    assert.equal(hard.hintsLeft, 1)
    const hardHint = takeHint(hard)
    assert.equal(hardHint.steps.length, 1)
    assert.equal(hardHint.state.hintsLeft, 0)
    assert.equal(takeHint(hardHint.state).ok, false)

    const expert = createMatch(mulberry32(6), 0, settings, "expert")
    assert.equal(expert.hintsLeft, 0)
    assert.equal(takeHint(expert).reason, "off")
    const move = legalMoves(expert)[0]
    const dropped = placePiece(expert, move.slot, move.r, move.c, mulberry32(1))
    assert.equal(dropped.gained, dropped.breakdown.placePoints * 2 + dropped.breakdown.linePoints * 2 + dropped.breakdown.streakBonus * 2)

    const board = emptyBoard()
    for (let c = 1; c < 8; c++) board[0][c] = 1
    const earning = {
      board,
      hand: [piece("mono", 2, "a"), piece("mono", 3, "b"), piece("mono", 4, "c")],
      preview: [piece("mono", 1, "d"), piece("mono", 1, "e"), piece("mono", 1, "f")],
      score: 0,
      streak: 0,
      best: 0,
      bests: emptyBests(),
      difficulty: "normal",
      hintsLeft: 3,
      over: false,
      settings,
    }
    const cleared = placePiece(earning, 0, 0, 0, mulberry32(2))
    assert.equal(cleared.linesCleared, 1)
    assert.equal(cleared.state.hintsLeft, 3)
    const low = { ...earning, board: earning.board.map((row) => row.slice()), hand: earning.hand.map((item) => ({ ...item })), hintsLeft: 1 }
    assert.equal(placePiece(low, 0, 0, 0, mulberry32(2)).state.hintsLeft, 2)

    const cross = emptyBoard()
    for (let c = 1; c < 8; c++) cross[0][c] = 1
    for (let r = 1; r < 8; r++) cross[r][0] = 1
    const combo = placePiece(
      { ...earning, board: cross, hintsLeft: 0, hand: earning.hand.map((item) => ({ ...item })) },
      0,
      0,
      0,
      mulberry32(3),
    )
    assert.equal(combo.linesCleared, 2)
    assert.equal(combo.state.hintsLeft, 2)
  })

  it("stores a separate best score per difficulty and migrates v1 saves", () => {
    const bests = emptyBests()
    bests.normal = 15
    bests.easy = 4
    let state = createMatch(mulberry32(8), bests, settings, "easy")
    assert.equal(state.best, 4)
    assert.equal(state.bests.normal, 15)
    const restarted = restartMatch(state, mulberry32(9), "normal")
    assert.equal(restarted.difficulty, "normal")
    assert.equal(restarted.best, 15)
    assert.equal(restarted.bests.easy, 4)

    const saved = deserialize(serialize(state))
    assert.equal(saved.state.difficulty, "easy")
    assert.equal(saved.state.hintsLeft, null)
    assert.equal(saved.state.bests.normal, 15)

    const legacy = deserialize(
      JSON.stringify({
        v: 1,
        best: 40,
        score: 8,
        streak: 0,
        over: false,
        board: state.board,
        hand: state.hand,
        preview: state.preview,
        settings,
      }),
    )
    assert.equal(legacy.state.difficulty, "normal")
    assert.equal(legacy.state.hintsLeft, 3)
    assert.equal(legacy.state.bests.normal, 40)
    assert.equal(legacy.best, 40)
  })
})
