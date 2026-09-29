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

import { createMatch, restartMatch, placePiece, restoreMatch, takeHint } from "./game.js"
import { loadGame, saveGame } from "./storage.js"
import { createAudio } from "./audio.js"
import { THEMES, LANGS, DIFFICULTIES, levelOf } from "./config.js"
import { translate } from "./i18n.js"
import { solve } from "./solver.js"
import { dealHand } from "./generator.js"
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
  setPickerOpen,
  syncPicker,
  paintPlan,
  clearPlan,
  showHintMessage,
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
let plan = null
let pickerOpen = !saved.state
let pickerBoot = !saved.state
let pickerSelection = state.difficulty || "normal"
let confirmKind = null
let pendingDifficulty = null
let idleTimer = 0

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

function applyConfirmCopy() {
  const dialog = document.getElementById("confirm")
  if (!dialog.classList.contains("open")) return
  if (confirmKind !== "difficulty") return
  const lang = state.settings.lang
  document.getElementById("confirm-title").textContent = translate(lang, "changeDifficulty")
  document.getElementById("confirm-hint").textContent = translate(lang, "changeDifficultyHint")
}

function applyPlan() {
  const hintEl = document.getElementById("hint")
  if (!plan) {
    clearPlan()
    hintEl.classList.remove("status")
    return
  }
  paintPlan(state.board, state.hand, plan.steps)
  hintEl.hidden = false
  hintEl.classList.add("status")
  hintEl.textContent = translate(state.settings.lang, plan.key)
}

function armAutoHint() {
  clearTimeout(idleTimer)
  const ms = levelOf(state.difficulty).autoMs
  if (!ms || state.over || plan || busy || pickerOpen || settingsOpen) return
  if (document.getElementById("confirm").classList.contains("open")) return
  idleTimer = setTimeout(() => {
    if (busy || plan || state.over || pickerOpen || settingsOpen) return
    revealHint()
  }, ms)
}

function show() {
  render(state)
  applyPlan()
  if (pickerOpen) syncPicker(state, pickerSelection)
  applyConfirmCopy()
  applyAudio()
  armAutoHint()
}

function dismissPlan() {
  if (!plan) return
  plan = null
  clearPlan()
  const hintEl = document.getElementById("hint")
  hintEl.classList.remove("status")
  hintEl.textContent = translate(state.settings.lang, "hint")
  hintEl.hidden = state.settings.seenHint
}

function planKey(result) {
  if (!result.steps || result.steps.length === 0) return "hintNoneMove"
  if (result.mode === "single") return result.complete ? "hintOne" : "hintOnePartial"
  return result.complete ? "hintFull" : "hintPartial"
}

function revealHint() {
  if (state.over) return
  const level = levelOf(state.difficulty)
  if (level.hintMode === "none") {
    showHintMessage(state.settings.lang, "hintOff")
    return
  }
  if (plan) {
    dismissPlan()
    armAutoHint()
    return
  }
  if (state.hintsLeft === 0) {
    showHintMessage(state.settings.lang, "hintSpent")
    return
  }
  const result = takeHint(state)
  if (!result.ok) {
    showHintMessage(state.settings.lang, result.reason === "spent" ? "hintSpent" : "hintOff")
    return
  }
  state = result.state
  persist()
  plan = { steps: result.steps, key: planKey(result) }
  show()
  audio.playTap()
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
  armAutoHint()
}

function onDrop(slot, row, col, valid) {
  const nonce = dragNonce
  dismissPlan()
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
  applyPlan()
  requestAnimationFrame(fitBoard)
  applyAudio()
}

function openPicker() {
  pickerSelection = state.difficulty || "normal"
  pickerOpen = true
  setPickerOpen(true)
  syncPicker(state, pickerSelection)
  armAutoHint()
}

function closePicker() {
  pickerOpen = false
  pickerBoot = false
  setPickerOpen(false)
}

function begin(difficulty) {
  dismissPlan()
  confirmKind = null
  pendingDifficulty = null
  setConfirmOpen(false)
  setSettingsOpen(false)
  settingsOpen = false
  closePicker()
  state = restartMatch(state, Math.random, difficulty || state.difficulty)
  persist()
  show()
  audio.playTap()
}

function requestNewGame() {
  openPicker()
}

function playChosen() {
  const chosen = DIFFICULTIES.includes(pickerSelection) ? pickerSelection : "normal"
  if (pickerBoot) {
    pickerBoot = false
    closePicker()
    if (chosen !== state.difficulty) begin(chosen)
    else {
      persist()
      show()
      audio.playTap()
    }
    return
  }
  const changed = chosen !== state.difficulty
  const midGame = state.score > 0 && !state.over
  if (changed || midGame) {
    pendingDifficulty = chosen
    confirmKind = changed ? "difficulty" : "restart"
    closePicker()
    setConfirmOpen(true)
    applyConfirmCopy()
    return
  }
  begin(chosen)
}

function confirmYes() {
  const difficulty = pendingDifficulty || state.difficulty
  begin(difficulty)
}

function confirmNo() {
  confirmKind = null
  pendingDifficulty = null
  setConfirmOpen(false)
  armAutoHint()
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
    armAutoHint()
  })
  document.getElementById("settings-backdrop").addEventListener("click", () => {
    settingsOpen = false
    setSettingsOpen(false)
    armAutoHint()
  })
  document.getElementById("btn-close-settings").addEventListener("click", () => {
    settingsOpen = false
    setSettingsOpen(false)
    armAutoHint()
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
  document.getElementById("btn-again").addEventListener("click", () => begin(state.difficulty))
  document.getElementById("btn-hint").addEventListener("click", () => {
    audio.unlock()
    revealHint()
  })
  document.getElementById("btn-play").addEventListener("click", () => {
    audio.unlock()
    playChosen()
  })
  document.getElementById("levels").addEventListener("click", (event) => {
    const button = event.target.closest("[data-diff]")
    if (!button || !DIFFICULTIES.includes(button.dataset.diff)) return
    pickerSelection = button.dataset.diff
    syncPicker(state, pickerSelection)
    audio.playTap()
  })
  document.getElementById("diff-picks").addEventListener("click", (event) => {
    const button = event.target.closest("[data-diff]")
    if (!button || !DIFFICULTIES.includes(button.dataset.diff)) return
    if (button.dataset.diff === state.difficulty) return
    audio.unlock()
    audio.playTap()
    pendingDifficulty = button.dataset.diff
    confirmKind = "difficulty"
    setConfirmOpen(true)
    applyConfirmCopy()
  })
  document.getElementById("confirm-yes").addEventListener("click", confirmYes)
  document.getElementById("confirm-no").addEventListener("click", confirmNo)

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return
    if (document.getElementById("confirm").classList.contains("open")) {
      confirmNo()
      return
    }
    if (pickerOpen && !pickerBoot) {
      closePicker()
      show()
      return
    }
    settingsOpen = false
    setSettingsOpen(false)
  })

  window.addEventListener("pointerdown", () => armAutoHint())

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
if (pickerOpen) setPickerOpen(true)
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
    takeHint,
    solve,
    dealHand,
    isBusy: () => busy,
    revealHint,
  }
}
