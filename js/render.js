/** DOM view. Reads state, never changes rules. */

import { SIZE } from "./config.js"
import { getShape } from "./pieces.js"
import { pieceFits } from "./generator.js"
import { translate, floatCaption } from "./i18n.js"

const $ = (id) => document.getElementById(id)

const ui = {
  app: null,
  board: null,
  cells: [],
  tray: null,
  preview: null,
  previewSection: null,
  ghost: null,
}

let lastScore = null

export function initView() {
  ui.app = $("app")
  ui.board = $("board")
  ui.tray = $("tray")
  ui.preview = $("preview")
  ui.previewSection = $("preview-section")
  ui.ghost = $("ghost")
  ui.board.replaceChildren()
  ui.cells = []
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const cell = document.createElement("div")
      cell.className = "cell"
      cell.dataset.r = String(r)
      cell.dataset.c = String(c)
      cell.dataset.color = "0"
      ui.board.appendChild(cell)
      ui.cells.push(cell)
    }
  }
  fitBoard()
  const wrap = document.querySelector(".board-wrap")
  if (wrap && window.ResizeObserver) {
    new ResizeObserver(() => fitBoard()).observe(wrap)
  }
}

export function fitBoard() {
  const wrap = document.querySelector(".board-wrap")
  if (!wrap || !ui.board) return
  const size = Math.floor(Math.min(wrap.clientWidth, wrap.clientHeight))
  if (size < 32) return
  if (Math.abs(ui.board.clientWidth - size) < 2 && Math.abs(ui.board.clientHeight - size) < 2) return
  ui.board.style.width = size + "px"
  ui.board.style.height = size + "px"
}

function fillCell(el, color, fresh) {
  el.dataset.color = String(color)
  el.replaceChildren()
  if (!color) return
  const block = document.createElement("div")
  block.className = "block p" + color + (fresh ? " fresh" : "")
  el.appendChild(block)
}

export function syncBoard(board, { fresh = new Set(), clearing = new Set() } = {}) {
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const el = ui.cells[r * SIZE + c]
      const color = board[r][c]
      const key = r + "," + c
      const wantFresh = fresh.has(key) && color !== 0
      if (el.dataset.color !== String(color) || (wantFresh && !el.querySelector(".fresh"))) {
        fillCell(el, color, wantFresh)
      }
      el.classList.toggle("clearing", clearing.has(key))
    }
  }
}

export function clearHints() {
  for (const cell of ui.cells) {
    cell.classList.remove("hint", "bad", "glow")
    cell.style.removeProperty("--hint")
  }
}

/** @param {Map<string, "hint" | "bad" | "glow">} marks */
export function paintHints(marks, color) {
  clearHints()
  if (!marks) return
  const hint = "var(--p" + color + ")"
  for (const [key, kind] of marks) {
    const [r, c] = key.split(",").map(Number)
    const el = ui.cells[r * SIZE + c]
    if (!el) continue
    if (kind === "hint") {
      el.classList.add("hint")
      el.style.setProperty("--hint", hint)
    } else if (kind === "bad") {
      el.classList.add("bad")
    } else if (kind === "glow") {
      el.classList.add("glow")
      if (!el.querySelector(".block")) {
        el.classList.add("hint")
        el.style.setProperty("--hint", hint)
      }
    }
  }
}

export function boardMetrics() {
  const first = ui.cells[0]
  const right = ui.cells[1]
  const below = ui.cells[SIZE]
  if (!first || !right || !below) return null
  const a = first.getBoundingClientRect()
  const b = right.getBoundingClientRect()
  const d = below.getBoundingClientRect()
  return {
    originX: a.left,
    originY: a.top,
    cell: a.width,
    strideX: b.left - a.left,
    strideY: d.top - a.top,
    board: ui.board.getBoundingClientRect(),
  }
}

export function pointToCell(metrics, x, y) {
  const c = Math.round((x - metrics.originX - metrics.cell / 2) / metrics.strideX)
  const r = Math.round((y - metrics.originY - metrics.cell / 2) / metrics.strideY)
  return { r, c }
}

function buildPiece(shape, color, cellPx, gapPx) {
  const el = document.createElement("div")
  el.className = "piece"
  el.style.gridTemplateColumns = "repeat(" + shape.cols + ", " + cellPx + "px)"
  el.style.gridTemplateRows = "repeat(" + shape.rows + ", " + cellPx + "px)"
  el.style.gap = gapPx + "px"
  const filled = new Set(shape.cells.map(([r, c]) => r + "," + c))
  for (let r = 0; r < shape.rows; r++) {
    for (let c = 0; c < shape.cols; c++) {
      const spot = document.createElement("div")
      if (filled.has(r + "," + c)) {
        spot.className = "block p" + color
      } else {
        spot.className = "spacer"
      }
      el.appendChild(spot)
    }
  }
  return el
}

function cellPxFor(shape, slotPx, cap) {
  const side = Math.max(shape.rows, shape.cols)
  return Math.max(8, Math.min(cap, Math.floor((slotPx - 16) / side)))
}

export function syncTray(state) {
  const lang = state.settings.lang
  const slotPx = ui.tray.offsetWidth > 0 ? (ui.tray.offsetWidth - 16) / 3 : 110
  ui.tray.replaceChildren()
  state.hand.forEach((piece, index) => {
    const slot = document.createElement("div")
    slot.className = "slot"
    slot.dataset.slot = String(index)
    slot.setAttribute("role", "button")
    slot.setAttribute("aria-label", translate(lang, "piece") + " " + (index + 1))
    if (piece.used) {
      slot.classList.add("used")
      slot.setAttribute("aria-hidden", "true")
    } else {
      const shape = getShape(piece.shapeId)
      const px = cellPxFor(shape, slotPx, 28)
      slot.appendChild(buildPiece(shape, piece.color, px, 3))
      if (state.over && !pieceFits(state.board, piece)) slot.classList.add("nofit")
    }
    ui.tray.appendChild(slot)
  })
  ui.tray.style.pointerEvents = state.over ? "none" : ""
}

export function syncPreview(state) {
  const show = state.settings.showPreview
  ui.previewSection.hidden = !show
  if (!show) return
  const lang = state.settings.lang
  $("preview-label").textContent = translate(lang, "preview")
  const badge = $("preview-badge")
  const fits = state.preview && state.preview.some((piece) => pieceFits(state.board, piece))
  badge.textContent = fits ? translate(lang, "previewOk") : translate(lang, "previewRefresh")
  badge.className = "badge " + (fits ? "ok" : "warn")
  ui.preview.replaceChildren()
  if (!state.preview) return
  const slotPx = ui.preview.offsetWidth > 0 ? ui.preview.offsetWidth / 3 : 90
  for (const piece of state.preview) {
    const wrap = document.createElement("div")
    wrap.className = "mini"
    const shape = getShape(piece.shapeId)
    const px = cellPxFor(shape, slotPx, 16)
    wrap.appendChild(buildPiece(shape, piece.color, px, 2))
    ui.preview.appendChild(wrap)
  }
}

function setText(id, value) {
  const el = $(id)
  if (el && el.textContent !== value) el.textContent = value
}

export function syncChrome(state) {
  const lang = state.settings.lang
  const t = (key) => translate(lang, key)
  ui.app.dataset.theme = state.settings.theme
  document.documentElement.dataset.theme = state.settings.theme
  document.documentElement.lang = lang
  document.title = t("title")
  const theme = getComputedStyle(ui.app).getPropertyValue("--theme-color").trim()
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta && theme) meta.setAttribute("content", theme)

  setText("title", t("title"))
  setText("score", String(state.score))
  setText("score-label", t("score"))
  setText("best-label", t("best"))
  setText("best", String(state.best))
  setText("streak-label", t("streak"))
  setText("streak", "×" + state.streak)
  $("streak-wrap").hidden = state.streak < 1
  setText("hint", t("hint"))
  $("hint").hidden = state.settings.seenHint
  setText("btn-new", t("newGame"))
  setText("board-caption", t("boardLabel"))
  ui.board.setAttribute("aria-label", t("boardLabel"))

  const sound = $("btn-sound")
  sound.setAttribute("aria-label", state.settings.muted ? t("soundOn") : t("soundOff"))
  sound.setAttribute("aria-pressed", state.settings.muted ? "false" : "true")
  sound.classList.toggle("is-muted", state.settings.muted)

  $("btn-settings").setAttribute("aria-label", t("settings"))
  setText("settings-title", t("settings"))
  setText("lang-label", t("lang"))
  setText("theme-label", t("theme"))
  setText("opt-preview-label", t("previewToggle"))
  setText("fair-note", t("fairNote"))
  setText("btn-close-settings", t("close"))
  $("opt-preview").checked = state.settings.showPreview

  const themeNames = {
    classic: t("themeClassic"),
    dark: t("themeDark"),
    pastel: t("themePastel"),
    wood: t("themeWood"),
  }
  for (const button of document.querySelectorAll("[data-theme-pick]")) {
    const name = button.dataset.themePick
    button.setAttribute("aria-label", themeNames[name] || name)
    button.setAttribute("aria-pressed", name === state.settings.theme ? "true" : "false")
  }
  for (const button of document.querySelectorAll("[data-lang-pick]")) {
    button.setAttribute("aria-pressed", button.dataset.langPick === lang ? "true" : "false")
  }

  setText("over-title", t("gameOver"))
  setText("over-hint", t("gameOverHint"))
  setText("over-score-label", t("score"))
  setText("over-score", String(state.score))
  setText("over-best-label", t("best"))
  setText("over-best", String(state.best))
  setText("btn-again", t("again"))
  $("overlay").classList.toggle("open", state.over)
  $("overlay").setAttribute("aria-hidden", state.over ? "false" : "true")

  setText("confirm-title", t("confirmTitle"))
  setText("confirm-hint", t("confirmHint"))
  setText("confirm-yes", t("confirmYes"))
  setText("confirm-no", t("confirmNo"))

  if (lastScore !== null && state.score !== lastScore) {
    const scoreEl = $("score")
    scoreEl.classList.remove("bump")
    void scoreEl.offsetWidth
    scoreEl.classList.add("bump")
  }
  lastScore = state.score
}

export function render(state) {
  syncChrome(state)
  syncBoard(state.board)
  syncTray(state)
  syncPreview(state)
  fitBoard()
}

export function showFloat(lang, { gained, linesCleared, streak, newRecord }) {
  const el = $("floater")
  $("floater-main").textContent = "+" + gained
  $("floater-sub").textContent = floatCaption(lang, { linesCleared, streak, newRecord })
  el.hidden = false
  el.classList.remove("show")
  void el.offsetWidth
  el.classList.add("show")
}

export function pulseBoard() {
  ui.board.classList.remove("pulse")
  void ui.board.offsetWidth
  ui.board.classList.add("pulse")
}

export function setSettingsOpen(open) {
  $("settings-backdrop").classList.toggle("open", open)
  $("settings").classList.toggle("open", open)
  $("settings").setAttribute("aria-hidden", open ? "false" : "true")
  $("btn-settings").setAttribute("aria-expanded", open ? "true" : "false")
}

export function setConfirmOpen(open) {
  $("confirm").classList.toggle("open", open)
  $("confirm").setAttribute("aria-hidden", open ? "false" : "true")
}

export function mountGhost(shape, color, cellPx, gapPx) {
  ui.ghost.replaceChildren(buildPiece(shape, color, cellPx, gapPx))
  ui.ghost.hidden = false
  ui.ghost.classList.add("visible")
  return ui.ghost
}

export function moveGhost(x, y) {
  ui.ghost.style.left = x + "px"
  ui.ghost.style.top = y + "px"
}

export function hideGhost() {
  ui.ghost.hidden = true
  ui.ghost.classList.remove("visible", "shake")
  ui.ghost.replaceChildren()
}

export function shakeGhost() {
  ui.ghost.classList.remove("shake")
  void ui.ghost.offsetWidth
  ui.ghost.classList.add("shake")
}

export function markSlotDragging(index, on) {
  const slot = ui.tray.querySelector('[data-slot="' + index + '"]')
  if (slot) slot.classList.toggle("dragging", on)
}

export function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches
}
