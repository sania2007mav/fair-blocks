/**
 * App shell: wires the pure rules to the view, sound, and save file.
 *
 * PLACEHOLDER — one-time "support the game" purchase.
 * This prototype has no ads and no payments. Store reviews of similar
 * games mostly complained about aggressive ads, so do not add banners,
 * interstitials, or energy timers here. If a purchase is ever added,
 * keep it a single non-consumable (for example to fund development or
 * to unlock an extra theme) and do not gate normal play behind it.
 * function requestSupportPurchase() {}
 */

import { createMatch, restartMatch, placePiece, restoreMatch } from "./game.js"
import { loadGame, saveGame } from "./storage.js"
import { createAudio } from "./audio.js"
import { THEMES, LANGS } from "./config.js"
import {
  initView,
  render,
  syncBoard,
  syncChrome,
  syncTray,
  syncPreview,
  fitBoard,
  showFloat,
  pulseBoard,
  setSettingsOpen,
  setConfirmOpen,
  prefersReducedMotion,
  shakeGhost,
  hideGhost,
} from "./render.js"
import { setupDrag } from "./input.js"

const audio = createAudio()
const saved = loadGame()
let state = restoreMatch(saved.state) || createMatch(Math.random, saved.best)
let busy = false
let settingsOpen = false
let dragNonce = 0

function wait(ms) {
  if (prefersReducedMotion() || ms <= 0) return Promise.resolve()
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function persist() {
  saveGame(state)
}

function applyAudio() {
  audio.setMuted(state.settings.muted)
}

function show() {
  render(state)
  applyAudio()
}

async function resolveDrop(result) {
  busy = true
  syncBoard(result.boardBeforeClear, { fresh: new Set(result.placedKeys) })
  if (result.linesCleared > 0) {
    await wait(90)
    syncBoard(result.boardBeforeClear, { clearing: result.clearedKeys })
    pulseBoard()
    audio.playClear(result.linesCleared)
  } else {
    audio.playPlace()
  }
  showFloat(state.settings.lang, {
    gained: result.gained,
    linesCleared: result.linesCleared,
    streak: result.state.streak,
    newRecord: result.newRecord,
  })
  await wait(result.linesCleared > 0 ? 260 : 40)
  state = result.state
  persist()
  show()
  if (result.gameOver) {
    await wait(180)
    audio.playOver()
    render(state)
  }
  if (navigator.vibrate && result.linesCleared > 0) {
    navigator.vibrate(result.linesCleared > 1 ? [12, 30, 12] : 10)
  }
  busy = false
}

function onDrop(slot, row, col, valid) {
  const nonce = dragNonce
  if (!valid) {
    audio.playInvalid()
    shakeGhost()
    setTimeout(() => {
      if (nonce === dragNonce) hideGhost()
    }, 180)
    return
  }
  hideGhost()
  const result = placePiece(state, slot, row, col)
  if (!result.ok) {
    audio.playInvalid()
    return
  }
  resolveDrop(result)
}

function updateSettings(patch) {
  state = {
    ...state,
    settings: { ...state.settings, ...patch },
  }
  persist()
  syncChrome(state)
  syncPreview(state)
  syncTray(state)
  requestAnimationFrame(fitBoard)
  applyAudio()
}

function requestNewGame() {
  if (state.over || state.score === 0) {
    startNewGame()
    return
  }
  setConfirmOpen(true)
}

function startNewGame() {
  setConfirmOpen(false)
  setSettingsOpen(false)
  settingsOpen = false
  state = restartMatch(state)
  persist()
  show()
  audio.playTap()
}

function bind() {
  document.getElementById("btn-sound").addEventListener("click", () => {
    audio.unlock()
    const muted = !state.settings.muted
    updateSettings({ muted })
    if (!muted) audio.playTap()
  })

  document.getElementById("btn-settings").addEventListener("click", () => {
    audio.unlock()
    settingsOpen = !settingsOpen
    setSettingsOpen(settingsOpen)
  })
  document.getElementById("settings-backdrop").addEventListener("click", () => {
    settingsOpen = false
    setSettingsOpen(false)
  })
  document.getElementById("btn-close-settings").addEventListener("click", () => {
    settingsOpen = false
    setSettingsOpen(false)
  })

  document.getElementById("opt-preview").addEventListener("change", (event) => {
    updateSettings({ showPreview: event.target.checked })
  })

  for (const button of document.querySelectorAll("[data-theme-pick]")) {
    button.addEventListener("click", () => {
      if (!THEMES.includes(button.dataset.themePick)) return
      audio.unlock()
      audio.playTap()
      updateSettings({ theme: button.dataset.themePick })
    })
  }
  for (const button of document.querySelectorAll("[data-lang-pick]")) {
    button.addEventListener("click", () => {
      if (!LANGS.includes(button.dataset.langPick)) return
      audio.playTap()
      updateSettings({ lang: button.dataset.langPick })
    })
  }

  document.getElementById("btn-new").addEventListener("click", requestNewGame)
  document.getElementById("btn-again").addEventListener("click", startNewGame)
  document.getElementById("confirm-yes").addEventListener("click", startNewGame)
  document.getElementById("confirm-no").addEventListener("click", () => setConfirmOpen(false))

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return
    setConfirmOpen(false)
    settingsOpen = false
    setSettingsOpen(false)
  })

  window.addEventListener("pointerdown", () => audio.unlock(), { once: true })
  window.addEventListener("resize", fitBoard)
  window.addEventListener("orientationchange", () => setTimeout(fitBoard, 60))

  setupDrag({
    getState: () => state,
    isBusy: () => busy,
    onDragStart: () => {
      dragNonce++
    },
    onDrop,
  })
}

function registerWorker() {
  if (!("serviceWorker" in navigator)) return
  if (location.protocol !== "http:" && location.protocol !== "https:") return
  navigator.serviceWorker.register("./sw.js").catch(() => {})
}

initView()
bind()
show()
registerWorker()

if (location.hash === "#debug") {
  window.__GAME__ = {
    getState: () => state,
    setState(next) {
      state = next
      persist()
      show()
    },
    placePiece,
    createMatch,
    restartMatch,
    isBusy: () => busy,
  }
}
