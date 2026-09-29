import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { emptyBests } from "../js/config.js"
import { mulberry32 } from "../js/rng.js"
import { emptyBoard } from "../js/board.js"
import { createMatch, placePiece, undoMove, takeHint, legalMoves } from "../js/game.js"
import { deserialize, serialize } from "../js/storage.js"

const settings = { theme: "classic", muted: true, showPreview: true, lang: "ru", seenHint: true }

function piece(shapeId, uid) {
  return { uid, shapeId, color: 1, used: false }
}

function crossBoard() {
  const board = emptyBoard()
  for (let c = 1; c < 8; c++) board[0][c] = 1
  for (let r = 1; r < 8; r++) board[r][0] = 1
  return board
}

function withHand(state, extra) {
  return {
    ...state,
    hand: [piece("mono", "a"), piece("mono", "b"), piece("mono", "c")],
    preview: [piece("domino-0", "p1"), piece("domino-0", "p2"), piece("o2", "p3")],
    ...extra,
  }
}

describe("undo", () => {
  it("restores the board, score, streak, hints and the same pieces", () => {
    const start = withHand(createMatch(mulberry32(1), 20, settings, "normal"), {
      board: crossBoard(),
      score: 8,
      best: 20,
      hintsLeft: 1,
      undosLeft: 2,
      undo: null,
    })
    const handIds = start.hand.map((item) => item.uid + ":" + item.shapeId)
    const previewIds = start.preview.map((item) => item.uid)
    const placed = placePiece(start, 0, 0, 0, mulberry32(3))
    assert.equal(placed.linesCleared, 2)
    assert.equal(placed.state.score, 8 + placed.gained)
    assert.equal(placed.state.streak, 1)
    assert.equal(placed.state.hintsLeft, 3)
    assert.equal(placed.state.undosLeft, 3)
    assert.notDeepEqual(placed.state.board, start.board)

    const undone = undoMove(placed.state)
    assert.equal(undone.ok, true)
    assert.deepEqual(undone.state.board, start.board)
    assert.equal(undone.state.score, 8)
    assert.equal(undone.state.streak, 0)
    assert.equal(undone.state.best, 20)
    assert.equal(undone.state.hintsLeft, 1)
    assert.equal(undone.state.undosLeft, 1)
    assert.deepEqual(
      undone.state.hand.map((item) => item.uid + ":" + item.shapeId + ":" + item.used),
      handIds.map((id) => id + ":false"),
    )
    assert.deepEqual(undone.state.preview.map((item) => item.uid), previewIds)
    assert.equal(undone.state.undo, null)
    assert.equal(undoMove(undone.state).ok, false)
  })

  it("puts the exact dealt set back and does not reroll", () => {
    let state = createMatch(mulberry32(4), 0, settings, "easy")
    const rngs = [mulberry32(11), mulberry32(12), mulberry32(13)]
    let before = null
    for (let i = 0; i < 3; i++) {
      const move = legalMoves(state)[0]
      if (i === 2) {
        before = {
          hand: state.hand.map((item) => ({ ...item })),
          preview: state.preview.map((item) => ({ ...item })),
          score: state.score,
        }
      }
      state = placePiece(state, move.slot, move.r, move.c, rngs[i]).state
    }
    assert.notDeepEqual(state.hand.map((item) => item.uid), before.hand.map((item) => item.uid))
    const undone = undoMove(state)
    assert.equal(undone.ok, true)
    assert.deepEqual(undone.state.hand, before.hand)
    assert.deepEqual(undone.state.preview, before.preview)
    assert.equal(undone.state.score, before.score)
  })

  it("caps the budget, refills on a streak of clears, and blocks farming and game over", () => {
    let state = createMatch(mulberry32(2), 0, settings, "normal")
    assert.equal(state.undosLeft, 3)
    const easy = createMatch(mulberry32(2), 0, settings, "easy")
    assert.equal(easy.undosLeft, 5)
    const hard = createMatch(mulberry32(2), 0, settings, "hard")
    assert.equal(hard.undosLeft, 1)
    const expert = createMatch(mulberry32(2), 0, settings, "expert")
    assert.equal(expert.undosLeft, 0)
    const expertMove = legalMoves(expert)[0]
    const expertPlaced = placePiece(expert, expertMove.slot, expertMove.r, expertMove.c, mulberry32(1))
    assert.equal(undoMove(expertPlaced.state).ok, false)

    const very = createMatch(mulberry32(2), 0, settings, "veryEasy")
    assert.equal(very.undosLeft, null)
    const veryMove = legalMoves(very)[0]
    const veryPlaced = placePiece(very, veryMove.slot, veryMove.r, veryMove.c, mulberry32(1))
    assert.equal(veryPlaced.state.undosLeft, null)
    assert.equal(undoMove(veryPlaced.state).state.undosLeft, null)

    const rows = emptyBoard()
    for (let r = 0; r < 3; r++) {
      for (let c = 1; c < 8; c++) rows[r][c] = 1
    }
    state = withHand(state, { board: rows, undosLeft: 1, hintsLeft: 3, undo: null, score: 0, streak: 0 })
    for (let r = 0; r < 3; r++) {
      state = placePiece(state, r, r, 0, mulberry32(20 + r)).state
    }
    assert.equal(state.streak, 3)
    assert.equal(state.undosLeft, 2)
    const back = undoMove(state)
    assert.equal(back.state.streak, 2)
    assert.equal(back.state.undosLeft, 0)
    assert.equal(back.state.score < state.score, true)

    const ended = withHand(createMatch(mulberry32(5), 0, settings, "normal"), {
      undosLeft: 3,
      over: true,
      undo: { board: emptyBoard(), hand: [piece("mono", "a"), piece("mono", "b"), piece("mono", "c")], preview: null, score: 0, streak: 0, best: 0, bests: emptyBests(), hintsLeft: 3, undosLeft: 3 },
    })
    assert.equal(undoMove(ended).reason, "over")
  })

  it("does not refund a hint spent after the move", () => {
    let state = withHand(createMatch(mulberry32(6), 0, settings, "normal"), { hintsLeft: 2, undosLeft: 3 })
    const move = legalMoves(state)[0]
    state = placePiece(state, move.slot, move.r, move.c, mulberry32(1)).state
    assert.equal(state.hintsLeft, 2)
    state = takeHint(state).state
    assert.equal(state.hintsLeft, 1)
    const undone = undoMove(state)
    assert.equal(undone.state.hintsLeft, 1)
    assert.equal(undone.state.undosLeft, 2)
  })

  it("round-trips the undo snapshot", () => {
    let state = createMatch(mulberry32(7), 4, settings, "hard")
    const move = legalMoves(state)[0]
    state = placePiece(state, move.slot, move.r, move.c, mulberry32(1)).state
    const loaded = deserialize(serialize(state))
    assert.equal(loaded.state.undosLeft, state.undosLeft)
    assert.equal(loaded.state.undo.score, 0)
    assert.equal(loaded.state.undo.hand.length, 3)
    const undone = undoMove(loaded.state)
    assert.equal(undone.ok, true)
    assert.equal(undone.state.score, 0)
  })
})
