/**
 * Oriented piece catalog.
 * Players cannot rotate a piece (same rule as Block Blast). Each rotation and
 * mirror is its own entry so the dealer picks a concrete orientation.
 * Shapes are plain data: { id, archetype, cells: [row, col][], rows, cols }.
 */

const ARCHETYPES = [
  ["mono", [[0, 0]]],
  ["domino", [[0, 0], [0, 1]]],
  ["i3", [[0, 0], [0, 1], [0, 2]]],
  ["i4", [[0, 0], [0, 1], [0, 2], [0, 3]]],
  ["i5", [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4]]],
  ["o2", [[0, 0], [0, 1], [1, 0], [1, 1]]],
  ["o3", [[0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [1, 2], [2, 0], [2, 1], [2, 2]]],
  ["rect23", [[0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [1, 2]]],
  ["l3", [[0, 0], [1, 0], [1, 1]]],
  ["l4", [[0, 0], [1, 0], [2, 0], [2, 1]]],
  ["t4", [[0, 0], [0, 1], [0, 2], [1, 1]]],
  ["s4", [[0, 1], [0, 2], [1, 0], [1, 1]]],
  ["plus", [[0, 1], [1, 0], [1, 1], [1, 2], [2, 1]]],
  ["l5", [[0, 0], [1, 0], [2, 0], [3, 0], [3, 1]]],
  ["v5", [[0, 0], [1, 0], [2, 0], [2, 1], [2, 2]]],
  ["u5", [[0, 0], [0, 2], [1, 0], [1, 1], [1, 2]]],
  ["t5", [[0, 0], [0, 1], [0, 2], [1, 1], [2, 1]]],
  ["p5", [[0, 0], [0, 1], [1, 0], [1, 1], [2, 0]]],
]

function normalize(cells) {
  let minR = Infinity
  let minC = Infinity
  for (const [r, c] of cells) {
    if (r < minR) minR = r
    if (c < minC) minC = c
  }
  return cells
    .map(([r, c]) => [r - minR, c - minC])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1])
}

function rotate90(cells) {
  return normalize(cells.map(([r, c]) => [c, -r]))
}

function mirror(cells) {
  return normalize(cells.map(([r, c]) => [r, -c]))
}

function keyOf(cells) {
  return cells.map(([r, c]) => r + "," + c).join(";")
}

function orientations(base) {
  const seen = new Set()
  const out = []
  const seeds = [normalize(base), mirror(normalize(base))]
  for (const seed of seeds) {
    let cur = seed
    for (let i = 0; i < 4; i++) {
      const key = keyOf(cur)
      if (!seen.has(key)) {
        seen.add(key)
        out.push(cur)
      }
      cur = rotate90(cur)
    }
  }
  return out
}

function bounds(cells) {
  let rows = 0
  let cols = 0
  for (const [r, c] of cells) {
    if (r + 1 > rows) rows = r + 1
    if (c + 1 > cols) cols = c + 1
  }
  return { rows, cols }
}

function freezeShape(shape) {
  shape.cells.forEach((cell) => Object.freeze(cell))
  Object.freeze(shape.cells)
  return Object.freeze(shape)
}

export const SHAPES = ARCHETYPES.flatMap(([archetype, cells]) => {
  const variants = orientations(cells)
  return variants.map((variant, index) => {
    const { rows, cols } = bounds(variant)
    const id = variants.length === 1 ? archetype : archetype + "-" + index
    return freezeShape({ id, archetype, cells: variant, rows, cols })
  })
})

const BY_ID = new Map(SHAPES.map((shape) => [shape.id, shape]))

export function getShape(id) {
  const shape = BY_ID.get(id)
  if (!shape) return null
  return shape
}

export function shapeKey(shape) {
  return keyOf(shape.cells)
}
