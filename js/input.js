/** Pointer drag for touch and mouse. The ghost sits above a finger so the board stays visible. */

import { SIZE } from "./config.js"
import { getShape } from "./pieces.js"
import { canPlace, placeCells, findFullLines, lineKeys } from "./board.js"
import {
  boardMetrics,
  pointToCell,
  paintHints,
  clearHints,
  mountGhost,
  moveGhost,
  hideGhost,
  markSlotDragging,
} from "./render.js"

export function setupDrag({ getState, isBusy, onDrop, onDragStart }) {
  const tray = document.getElementById("tray")
  let drag = null

  function end(commit) {
    if (!drag) return
    const current = drag
    drag = null
    markSlotDragging(current.slot, false)
    clearHints()
    document.body.classList.remove("dragging")
    if (commit && current.hover) {
      onDrop(current.slot, current.hover.r, current.hover.c, current.valid)
      return
    }
    hideGhost()
  }

  function onMove(event) {
    if (!drag || event.pointerId !== drag.pointerId) return
    event.preventDefault()
    const metrics = boardMetrics()
    if (!metrics) return
    const ghostW = drag.shape.cols * metrics.cell + (drag.shape.cols - 1) * (metrics.strideX - metrics.cell)
    const ghostH = drag.shape.rows * metrics.cell + (drag.shape.rows - 1) * (metrics.strideY - metrics.cell)
    const lift = drag.touch ? Math.max(28, ghostH * 0.15) + 36 : 0
    let left = event.clientX - ghostW / 2
    let top = drag.touch ? event.clientY - ghostH - lift : event.clientY - ghostH / 2

    const originX = left + metrics.cell / 2
    const originY = top + metrics.cell / 2
    const cell = pointToCell(metrics, originX, originY)
    const near =
      cell.r > -drag.shape.rows &&
      cell.c > -drag.shape.cols &&
      cell.r < SIZE &&
      cell.c < SIZE

    const state = getState()
    const valid = near && canPlace(state.board, drag.shape, cell.r, cell.c)
    drag.hover = near ? cell : null
    drag.valid = valid

    if (near) {
      left = metrics.originX + cell.c * metrics.strideX
      top = metrics.originY + cell.r * metrics.strideY
    }
    moveGhost(left, top)

    if (!near) {
      clearHints()
      return
    }
    const marks = new Map()
    for (const [dr, dc] of drag.shape.cells) {
      const r = cell.r + dr
      const c = cell.c + dc
      if (r < 0 || c < 0 || r >= SIZE || c >= SIZE) continue
      marks.set(r + "," + c, valid ? "hint" : "bad")
    }
    if (valid) {
      const placed = placeCells(state.board, drag.shape, cell.r, cell.c, drag.color)
      const lines = findFullLines(placed)
      if (lines.rows.length || lines.cols.length) {
        for (const key of lineKeys(lines.rows, lines.cols)) marks.set(key, "glow")
      }
    }
    paintHints(marks, drag.color)
  }

  tray.addEventListener("contextmenu", (event) => event.preventDefault())
  tray.addEventListener("pointerdown", (event) => {
    if (drag || isBusy()) return
    if (document.getElementById("settings").classList.contains("open")) return
    if (document.getElementById("confirm").classList.contains("open")) return
    if (document.getElementById("picker").classList.contains("open")) return
    if (document.getElementById("name-modal").classList.contains("open")) return
    if (document.getElementById("leaderboard").classList.contains("open")) return
    const slotEl = event.target.closest("[data-slot]")
    if (!slotEl || slotEl.classList.contains("used") || slotEl.classList.contains("nofit")) return
    const state = getState()
    if (state.over) return
    const slot = Number(slotEl.dataset.slot)
    const piece = state.hand[slot]
    if (!piece || piece.used) return
    const shape = getShape(piece.shapeId)
    const metrics = boardMetrics()
    if (!metrics) return
    event.preventDefault()
    if (onDragStart) onDragStart()
    drag = {
      pointerId: event.pointerId,
      slot,
      shape,
      color: piece.color,
      touch: event.pointerType === "touch",
      hover: null,
      valid: false,
    }
    document.body.classList.add("dragging")
    markSlotDragging(slot, true)
    const gap = Math.max(2, metrics.strideX - metrics.cell)
    mountGhost(shape, piece.color, metrics.cell, gap)
    onMove(event)
    try {
      tray.setPointerCapture(event.pointerId)
    } catch {
      /* Some browsers reject capture during tests; window listeners still work. */
    }
  })

  window.addEventListener("pointermove", onMove, { passive: false })
  window.addEventListener("pointerup", (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return
    end(true)
  })
  window.addEventListener("pointercancel", (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return
    end(false)
  })
}
