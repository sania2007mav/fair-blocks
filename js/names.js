/**
 * Display-name rules for the global leaderboard.
 * Normalization and the allowed alphabet match firestore.rules, which
 * re-checks every claim. `nameKey` is `name.toLowerCase()`, not toLocaleLowerCase.
 */

const NAME_RE =
  /^[A-Za-z0-9А-яЁёӘәҒғҚқҢңӨөҰұҮүҺһІіЄєЇїҐґЎў_-][A-Za-z0-9А-яЁёӘәҒғҚқҢңӨөҰұҮүҺһІіЄєЇїҐґЎў _-]{0,14}[A-Za-z0-9А-яЁёӘәҒғҚқҢңӨөҰұҮүҺһІіЄєЇїҐґЎў_-]$/u

const RESERVED_RE = /^__.*__$/

export function normalizeName(raw) {
  return String(raw ?? "").normalize("NFC").trim().replace(/\s+/g, " ")
}

export function nameKey(name) {
  return String(name ?? "").toLowerCase()
}

/**
 * @returns {{ ok: boolean, code: "short" | "long" | "reserved" | "invalid" | null, name: string, nameLower: string }}
 */
export function validateName(raw) {
  const name = normalizeName(raw)
  const nameLower = nameKey(name)
  if (name.length < 2) return { ok: false, code: "short", name, nameLower }
  if (name.length > 16) return { ok: false, code: "long", name, nameLower }
  if (RESERVED_RE.test(name)) return { ok: false, code: "reserved", name, nameLower }
  if (!NAME_RE.test(name)) return { ok: false, code: "invalid", name, nameLower }
  return { ok: true, code: null, name, nameLower }
}
