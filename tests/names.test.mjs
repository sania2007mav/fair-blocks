import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { normalizeName, nameKey, validateName } from "../js/names.js"

describe("names", () => {
  it("trims, collapses spaces, and folds case with toLowerCase", () => {
    assert.equal(normalizeName("  Саша   Петров  "), "Саша Петров")
    assert.equal(nameKey("ӘЛИЯ"), "әлия")
    assert.equal(nameKey("Саша"), nameKey("САША"))
    assert.equal(validateName("  Саша  ").name, "Саша")
    assert.equal(validateName("САША").nameLower, validateName("Саша").nameLower)
    assert.equal(validateName("Әлия Құрман").ok, true)
    assert.equal(validateName("Player_1-X").ok, true)
    assert.equal(validateName("ІҢҒҮҰҚӨҺ").ok, true)
  })

  it("rejects short, long, reserved, emoji and punctuation", () => {
    assert.equal(validateName("a").code, "short")
    assert.equal(validateName("abcdefghijklmnopq").code, "long")
    assert.equal(validateName("Жанңаргүлсұлтанәх").code, "long")
    assert.equal(validateName("abcdefghijklmnop").ok, true)
    assert.equal(validateName("__x__").code, "reserved")
    assert.equal(validateName("😀😀").code, "invalid")
    assert.equal(validateName("ab!").code, "invalid")
    assert.equal(validateName("a.b").code, "invalid")
    assert.equal(validateName("a  b").ok, true)
    assert.equal(validateName("a  b").name, "a b")
  })
})
