import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { SIZE } from "../js/config.js"
import { mulberry32 } from "../js/rng.js"
import { SHAPES, getShape, shapeKey } from "../js/pieces.js"
import {
  emptyBoard,
  canPlace,
  shapeFits,
  placeCells,
  findFullLines,
  clearLines,
  countFilled,
} from "../js/board.js"
import { dealFair, ensureFair, handHasFit } from "../js/generator.js"
import { scorePlacement } from "../js/scoring.js"
import { createMatch, placePiece, legalMoves } from "../js/game.js"
import { DICT } from "../js/i18n.js"
import { deserialize, serialize } from "../js/storage.js"

function fillAll(board, color = 1) {
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) board[r][c] = color
  }
  return board
}

function oneHole(at = [3, 4]) {
  const board = emptyBoard()
  fillAll(board)
  board[at[0]][at[1]] = 0
  return board
}

function piece(shapeId, color = 1, uid = shapeId) {
  return { uid, shapeId, color, used: false }
}

describe("catalog", () => {
  it("has unique orientations and a 1x1 piece", () => {
    const keys = SHAPES.map(shapeKey)
    assert.equal(new Set(keys).size, keys.length)
    assert.ok(SHAPES.length >= 40)
    assert.ok(getShape("mono"))
    assert.equal(getShape("mono").cells.length, 1)
    assert.equal(getShape(null), null)
  })
})

describe("board", () => {
  it("clears a full row and a full column, including a cross", () => {
    const board = emptyBoard()
    for (let c = 1; c < SIZE; c++) board[0][c] = 2
    for (let r = 1; r < SIZE; r++) board[r][0] = 3
    const placed = placeCells(board, getShape("mono"), 0, 0, 1)
    const lines = findFullLines(placed)
    assert.deepEqual(lines.rows, [0])
    assert.deepEqual(lines.cols, [0])
    const cleared = clearLines(placed, lines.rows, lines.cols)
    for (let c = 0; c < SIZE; c++) assert.equal(cleared[0][c], 0)
    for (let r = 0; r < SIZE; r++) assert.equal(cleared[r][0], 0)
    assert.equal(cleared[2][2], 0)
    assert.equal(countFilled(cleared), 0)
  })

  it("rejects a blocked cell and accepts an open one", () => {
    const board = emptyBoard()
    board[0][0] = 1
    assert.equal(canPlace(board, getShape("domino-0"), 0, 0), false)
    assert.equal(shapeFits(board, getShape("o3")), true)
  })
})

describe("scoring", () => {
  it("scores placement, squared line combo, and streak, then resets", () => {
    const quiet = scorePlacement({ cellsPlaced: 4, linesCleared: 0, streak: 3 })
    assert.equal(quiet.points, 4)
    assert.equal(quiet.streak, 0)

    const first = scorePlacement({ cellsPlaced: 1, linesCleared: 1, streak: 0 })
    assert.equal(first.points, 11)
    assert.equal(first.streak, 1)

    const combo = scorePlacement({ cellsPlaced: 3, linesCleared: 2, streak: 1 })
    assert.equal(combo.points, 3 + 40 + 10)
    assert.equal(combo.streak, 2)
  })
})

describe("fair generator", () => {
  it("always includes a fitting piece on random boards", () => {
    const rng = mulberry32(2026)
    for (let n = 0; n < 200; n++) {
      const board = emptyBoard()
      for (let r = 0; r < SIZE; r++) {
        for (let c = 0; c < SIZE; c++) board[r][c] = rng() < 0.5 ? 1 : 0
      }
      const hand = dealFair(board, rng)
      const any = SHAPES.some((shape) => shapeFits(board, shape))
      if (!any) {
        assert.equal(hand, null)
        continue
      }
      assert.equal(hand.length, 3)
      assert.equal(handHasFit(board, hand), true)
    }
  })

  it("guarantees a 1x1 on a one-hole board without forcing the other pieces", () => {
    const board = oneHole()
    const rng = mulberry32(7)
    const slotCounts = [0, 0, 0]
    let others = 0
    for (let n = 0; n < 120; n++) {
      const hand = dealFair(board, rng)
      assert.equal(handHasFit(board, hand), true)
      hand.forEach((item, index) => {
        if (item.shapeId === "mono") slotCounts[index]++
        else others++
      })
    }
    assert.ok(slotCounts.every((count) => count > 15))
    assert.ok(others > 40)
  })

  it("returns null when the board is full", () => {
    assert.equal(dealFair(fillAll(emptyBoard()), mulberry32(1)), null)
  })

  it("repairs an impossible preview and keeps a possible one", () => {
    const board = oneHole()
    const rng = mulberry32(3)
    const bad = [piece("o3", 1, "a"), piece("o3", 2, "b"), piece("i5-0", 3, "c")]
    assert.equal(handHasFit(board, bad), false)
    const fixed = ensureFair(board, bad, rng)
    assert.equal(handHasFit(board, fixed), true)
    const keptIds = fixed.filter((item) => item.shapeId === "o3" || item.shapeId.startsWith("i5"))
    assert.equal(keptIds.length, 2)

    const good = [piece("mono", 4, "m"), piece("o3", 2, "x"), piece("o3", 3, "y")]
    const same = ensureFair(board, good, rng)
    assert.deepEqual(same.map((item) => item.shapeId), ["mono", "o3", "o3"])
  })

  it("does not change with the score", () => {
    const board = emptyBoard()
    for (let c = 0; c < 6; c++) board[7][c] = 1
    const preview = [piece("mono", 1, "p1"), piece("domino-0", 2, "p2"), piece("o2", 3, "p3")]
    const base = {
      board,
      hand: [piece("mono", 4, "h1"), { ...piece("o3", 5, "h2"), used: true }, { ...piece("o3", 6, "h3"), used: true }],
      preview,
      streak: 0,
      over: false,
      settings: { theme: "classic", muted: true, showPreview: true, lang: "ru", seenHint: true },
    }
    const low = placePiece({ ...base, score: 10, best: 10, hand: base.hand.map((p) => ({ ...p })), preview: preview.map((p) => ({ ...p })), board: board.map((row) => row.slice()) }, 0, 0, 0, mulberry32(99))
    const high = placePiece({ ...base, score: 9000, best: 9000, hand: base.hand.map((p) => ({ ...p })), preview: preview.map((p) => ({ ...p })), board: board.map((row) => row.slice()) }, 0, 0, 0, mulberry32(99))
    assert.deepEqual(
      low.state.hand.map((item) => item.shapeId),
      high.state.hand.map((item) => item.shapeId),
    )
    assert.deepEqual(
      low.state.preview.map((item) => item.shapeId),
      high.state.preview.map((item) => item.shapeId),
    )
  })
})

describe("match", () => {
  it("clears a line, updates the record once, and ends when nothing fits", () => {
    const board = fillAll(emptyBoard(), 1)
    board[0][0] = 0
    for (const [r, c] of [[1, 0], [2, 1], [3, 2], [4, 3], [5, 4], [6, 5], [7, 6], [7, 7]]) {
      board[r][c] = 0
    }
    const state = {
      board,
      hand: [piece("mono", 2, "a"), piece("o3", 3, "b"), piece("o3", 4, "c")],
      preview: [piece("mono", 1, "d"), piece("mono", 1, "e"), piece("mono", 1, "f")],
      score: 15,
      streak: 0,
      best: 20,
      over: false,
      settings: { theme: "classic", muted: true, showPreview: true, lang: "ru", seenHint: false },
    }
    const result = placePiece(state, 0, 0, 0, mulberry32(1))
    assert.equal(result.ok, true)
    assert.equal(result.linesCleared, 1)
    assert.equal(result.gained, 11)
    assert.equal(result.state.score, 26)
    assert.equal(result.newRecord, true)
    assert.equal(result.state.best, 26)
    assert.equal(result.gameOver, true)
    assert.equal(state.board[0][0], 0)
    assert.equal(state.score, 15)
    assert.ok(result.state.board[0].every((cell) => cell === 0))
    assert.equal(result.state.board[3][3], 1)
    assert.equal(legalMoves(result.state).length, 0)
    assert.equal(placePiece(result.state, 0, 1, 1, mulberry32(1)).ok, false)

    const follow = {
      ...result.state,
      over: false,
      hand: [piece("mono", 1, "z"), piece("mono", 1, "y"), piece("mono", 1, "x")],
      score: result.state.score,
      best: result.state.best,
    }
    const next = placePiece(follow, 0, 0, 0, mulberry32(2))
    assert.equal(next.ok, true)
    assert.equal(next.newRecord, false)
    assert.ok(next.state.score > result.state.score)
  })

  it("deals a fair hand after the third piece and does not mutate the previous state", () => {
    const state = createMatch(mulberry32(4), 40)
    const snapshot = JSON.stringify(state)
    let current = state
    for (let i = 0; i < 3; i++) {
      const moves = legalMoves(current)
      assert.ok(moves.length > 0)
      const move = moves[0]
      const result = placePiece(current, move.slot, move.r, move.c, mulberry32(10 + i))
      assert.equal(result.ok, true)
      current = result.state
    }
    assert.equal(JSON.stringify(state), snapshot)
    assert.equal(current.over, false)
    assert.equal(handHasFit(current.board, current.hand), true)
    assert.equal(handHasFit(current.board, current.preview), true)
  })
})

describe("saved game", () => {
  it("round-trips a match and salvages the best score from junk", () => {
    const state = createMatch(mulberry32(8), 12)
    state.score = 4
    const loaded = deserialize(serialize(state))
    assert.equal(loaded.best, 12)
    assert.equal(loaded.state.score, 4)
    assert.equal(loaded.state.hand.length, 3)
    assert.deepEqual(loaded.state.board, state.board)
    const junk = deserialize('{"v":1,"best":77,"board":"nope"}')
    assert.equal(junk.state, null)
    assert.equal(junk.best, 77)
    assert.equal(deserialize("not json").state, null)
  })
})

describe("i18n", () => {
  it("gives Kazakh and English every Russian key", () => {
    const keys = Object.keys(DICT.ru)
    for (const lang of ["kk", "en"]) {
      for (const key of keys) {
        assert.equal(typeof DICT[lang][key], "string")
        assert.ok(DICT[lang][key].length > 0)
      }
      assert.deepEqual(Object.keys(DICT[lang]).sort(), keys.sort())
    }
  })
})

describe("simulation", () => {
  it("keeps the fairness guarantee across random games", () => {
    const rng = mulberry32(4242)
    let deals = 0
    let moves = 0
    for (let game = 0; game < 20; game++) {
      let state = createMatch(rng, 0)
      assert.equal(handHasFit(state.board, state.hand), true)
      deals++
      for (let step = 0; step < 250 && !state.over; step++) {
        const options = legalMoves(state)
        assert.ok(options.length > 0, "game over flag out of sync with legal moves")
        const move = options[Math.floor(rng() * options.length)]
        const result = placePiece(state, move.slot, move.r, move.c, rng)
        assert.equal(result.ok, true)
        moves++
        state = result.state
        if (result.dealt) {
          deals++
          assert.equal(handHasFit(state.board, state.hand), true)
        }
        if (state.over) assert.equal(legalMoves(state).length, 0)
      }
    }
    assert.ok(moves > 100)
    assert.ok(deals > 20)
  })
})
