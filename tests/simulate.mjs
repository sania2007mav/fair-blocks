/**
 * Play random legal games and print the fairness invariant.
 * Usage: node tests/simulate.mjs [seed] [games]
 */

import { mulberry32 } from "../js/rng.js"
import { SHAPES } from "../js/pieces.js"
import { DIFFICULTIES } from "../js/config.js"
import { createMatch, placePiece, legalMoves } from "../js/game.js"
import { handHasFit } from "../js/generator.js"

const seed = Number(process.argv[2] || 4242)
const games = Number(process.argv[3] || 6)
const rng = mulberry32(seed)

let deals = 0
let moves = 0
let overs = 0
let violations = 0
let best = 0

for (const difficulty of DIFFICULTIES) {
  for (let game = 0; game < games; game++) {
    let state = createMatch(rng, 0, undefined, difficulty)
    if (!handHasFit(state.board, state.hand)) violations++
    deals++
    for (let step = 0; step < 80 && !state.over; step++) {
      const options = legalMoves(state)
      if (options.length === 0) {
        violations++
        break
      }
      const move = options[Math.floor(rng() * options.length)]
      const result = placePiece(state, move.slot, move.r, move.c, rng)
      if (!result.ok) {
        violations++
        break
      }
      moves++
      state = result.state
      if (state.score > best) best = state.score
      if (result.dealt) {
        deals++
        if (!handHasFit(state.board, state.hand)) violations++
      }
    }
    if (state.over) overs++
  }
  console.log(difficulty + ": проверено")
}

console.log("Каталог фигур: " + SHAPES.length)
console.log("Партий: " + games * DIFFICULTIES.length)
console.log("Ходов: " + moves)
console.log("Раздач: " + deals)
console.log("Поражений: " + overs)
console.log("Лучший счёт в прогоне: " + best)
console.log("Нарушений гарантии: " + violations)

if (violations > 0) process.exit(1)
