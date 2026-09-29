/** Tunable rules. Kept free of DOM so a Flutter/Godot port can copy them. */

export const SIZE = 8
export const HAND_SIZE = 3
export const COLOR_COUNT = 6

/** Points for completing one line, before the multi-line square and streak. */
export const LINE_BASE = 10

/** Extra points per line for each clear after the first in a streak. */
export const STREAK_STEP = 5

export const STORAGE_KEY = "chestnye-bloki-v1"

export const THEMES = ["classic", "dark", "pastel", "wood"]
export const LANGS = ["ru", "kk", "en"]

export function defaultSettings() {
  return {
    theme: "classic",
    muted: false,
    showPreview: true,
    lang: "ru",
    seenHint: false,
  }
}
