/** Board rules: placement and line clears. No gravity — filled lines just empty. */

import { SIZE } from "./config.js"

export function emptyBoard() {
  return Array.from({ length: SIZE }, () => Array(SIZE).fill(0))
}

export function cloneBoard(board) {
  return board.map((row) => row.slice())
}

export function cellKey(row, col) {
  return row + "," + col
}

export function canPlace(board, shape, row, col) {
  for (const [dr, dc] of shape.cells) {
    const r = row + dr
    const c = col + dc
    if (r < 0 || c < 0 || r >= SIZE || c >= SIZE) return false
    if (board[r][c] !== 0) return false
  }
  return true
}

export function shapeFits(board, shape) {
  const maxR = SIZE - shape.rows
  const maxC = SIZE - shape.cols
  for (let r = 0; r <= maxR; r++) {
    for (let c = 0; c <= maxC; c++) {
      if (canPlace(board, shape, r, c)) return true
    }
  }
  return false
}

export function placeCells(board, shape, row, col, color) {
  const next = cloneBoard(board)
  for (const [dr, dc] of shape.cells) {
    next[row + dr][col + dc] = color
  }
  return next
}

export function placedKeys(shape, row, col) {
  return shape.cells.map(([dr, dc]) => cellKey(row + dr, col + dc))
}

/** @returns {{ rows: number[], cols: number[] }} */
export function findFullLines(board) {
  const rows = []
  const cols = []
  for (let r = 0; r < SIZE; r++) {
    let full = true
    for (let c = 0; c < SIZE; c++) {
      if (board[r][c] === 0) {
        full = false
        break
      }
    }
    if (full) rows.push(r)
  }
  for (let c = 0; c < SIZE; c++) {
    let full = true
    for (let r = 0; r < SIZE; r++) {
      if (board[r][c] === 0) {
        full = false
        break
      }
    }
    if (full) cols.push(c)
  }
  return { rows, cols }
}

export function lineKeys(rows, cols) {
  const keys = new Set()
  for (const r of rows) {
    for (let c = 0; c < SIZE; c++) keys.add(cellKey(r, c))
  }
  for (const c of cols) {
    for (let r = 0; r < SIZE; r++) keys.add(cellKey(r, c))
  }
  return keys
}

export function clearLines(board, rows, cols) {
  const next = cloneBoard(board)
  for (const r of rows) next[r].fill(0)
  for (const c of cols) {
    for (let r = 0; r < SIZE; r++) next[r][c] = 0
  }
  return next
}

export function countFilled(board) {
  let n = 0
  for (const row of board) {
    for (const cell of row) if (cell !== 0) n++
  }
  return n
}
