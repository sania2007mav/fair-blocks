/** Tunable rules. Kept free of DOM so a Flutter/Godot port can copy them. */

export const SIZE = 8
export const HAND_SIZE = 3
export const COLOR_COUNT = 6

/** Points for completing one line, before the multi-line square and streak. */
export const LINE_BASE = 10

/** Extra points per line for each clear after the first in a streak. */
export const STREAK_STEP = 5

export const STORAGE_KEY = "chestnye-bloki-v1"
export const PROFILE_KEY = "chestnye-bloki-profile-v1"

export const THEMES = ["classic", "dark", "pastel", "wood"]
export const LANGS = ["ru", "kk", "en"]

/** Easiest first. `hints: null` means unlimited. */
export const DIFFICULTIES = ["veryEasy", "easy", "normal", "hard", "expert"]

export const LEVELS = {
  veryEasy: { hints: null, hintMode: "full", deal: "friendly", autoMs: 6000, multiplier: 1, earn: false, cap: null, undos: null, undoMax: null },
  easy: { hints: null, hintMode: "full", deal: "placeable", autoMs: 0, multiplier: 1, earn: false, cap: null, undos: 5, undoMax: 5 },
  normal: { hints: 3, hintMode: "full", deal: "fair", autoMs: 0, multiplier: 1, earn: true, cap: 3, undos: 3, undoMax: 3 },
  hard: { hints: 1, hintMode: "single", deal: "awkward", autoMs: 0, multiplier: 1, earn: false, cap: 1, undos: 1, undoMax: 1 },
  expert: { hints: 0, hintMode: "none", deal: "hardest", autoMs: 0, multiplier: 2, earn: false, cap: 0, undos: 0, undoMax: 0 },
}

export function levelOf(id) {
  return LEVELS[id] || LEVELS.normal
}

export function emptyBests() {
  return { veryEasy: 0, easy: 0, normal: 0, hard: 0, expert: 0 }
}

export function defaultSettings() {
  return {
    theme: "classic",
    muted: false,
    showPreview: true,
    lang: "ru",
    seenHint: false,
  }
}
