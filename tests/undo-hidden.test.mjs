/**
 * Expert must not show «Отменить ход». The button uses display:inline-flex,
 * which used to override the hidden attribute, so this checks computed style
 * in a real browser rather than the hidden property alone.
 */
import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { createServer } from "node:http"
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, extname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, it, before, after } from "node:test"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webmanifest": "application/manifest+json",
  ".json": "application/json",
}

function chromeBin() {
  const candidates = [process.env.CHROME_PATH, "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"]
  return candidates.find((path) => path && existsSync(path)) || null
}

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server.address().port))
  })
}

function startServer() {
  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1")
    const rel = decodeURIComponent(url.pathname)
    const path = join(ROOT, rel === "/" ? "index.html" : rel)
    if (!path.startsWith(ROOT) || !existsSync(path)) {
      res.writeHead(404)
      res.end("missing")
      return
    }
    res.writeHead(200, { "Content-Type": TYPES[extname(path)] || "application/octet-stream", "Cache-Control": "no-store" })
    res.end(readFileSync(path))
  })
  return server
}

class Cdp {
  constructor(ws) {
    this.ws = ws
    this.id = 0
    this.pending = new Map()
    ws.addEventListener("message", (event) => {
      const msg = JSON.parse(event.data)
      if (!msg.id || !this.pending.has(msg.id)) return
      const { resolve, reject } = this.pending.get(msg.id)
      this.pending.delete(msg.id)
      if (msg.error) reject(new Error(msg.error.message))
      else resolve(msg.result)
    })
  }

  send(method, params = {}) {
    const id = ++this.id
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }
}

async function launchChrome() {
  const bin = chromeBin()
  const profile = mkdtempSync(join(tmpdir(), "fair-blocks-chrome-"))
  const chrome = spawn(bin, [
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--remote-debugging-port=0",
    `--user-data-dir=${profile}`,
    "--host-resolver-rules=MAP www.gstatic.com 127.0.0.1, MAP www.googleapis.com 127.0.0.1, MAP securetoken.googleapis.com 127.0.0.1, MAP identitytoolkit.googleapis.com 127.0.0.1, MAP firebase.googleapis.com 127.0.0.1, MAP fair-blocks-2f88.firebaseapp.com 127.0.0.1",
    "about:blank",
  ], { stdio: ["ignore", "ignore", "pipe"] })
  let stderr = ""
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Chrome did not open a DevTools port")), 15000)
    chrome.stderr.on("data", (chunk) => {
      stderr += String(chunk)
      const match = stderr.match(/127\.0\.0\.1:(\d+)/)
      if (match) {
        clearTimeout(timer)
        resolve(Number(match[1]))
      }
    })
    chrome.on("exit", (code) => {
      clearTimeout(timer)
      reject(new Error("Chrome exited " + code))
    })
  })
  const port = await ready
  return { chrome, profile, port }
}

async function openPage(debugPort, url) {
  const version = await fetch(`http://127.0.0.1:${debugPort}/json/version`).then((res) => res.json())
  const browser = new WebSocket(version.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    browser.addEventListener("open", resolve)
    browser.addEventListener("error", reject)
  })
  const cdp = new Cdp(browser)
  const { targetId } = await cdp.send("Target.createTarget", { url })
  const targets = await fetch(`http://127.0.0.1:${debugPort}/json/list`).then((res) => res.json())
  const page = targets.find((target) => target.id === targetId)
  const socket = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve)
    socket.addEventListener("error", reject)
  })
  const pageCdp = new Cdp(socket)
  await pageCdp.send("Page.enable")
  await pageCdp.send("Runtime.enable")
  await pageCdp.send("Page.navigate", { url })
  await pageCdp.send("Runtime.evaluate", {
    expression: "new Promise((resolve) => { const tick = () => window.__GAME__ ? resolve(true) : setTimeout(tick, 30); tick() })",
    awaitPromise: true,
    returnByValue: true,
  })
  return { browser, socket, pageCdp }
}

async function evalPage(pageCdp, expression) {
  const result = await pageCdp.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  })
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text || "page eval failed")
  }
  return result.result.value
}

const bin = chromeBin()
const suite = bin ? describe : describe.skip

suite("expert undo button", () => {
  let server
  let chrome
  let profile
  let pageCdp
  let browser
  let socket
  before(async () => {
    server = startServer()
    const httpPort = await listen(server)
    const launched = await launchChrome()
    chrome = launched.chrome
    profile = launched.profile
    const debugPort = launched.port
    const opened = await openPage(debugPort, `http://127.0.0.1:${httpPort}/?offline=1#debug`)
    pageCdp = opened.pageCdp
    browser = opened.browser
    socket = opened.socket
  })

  after(async () => {
    browser?.close()
    socket?.close()
    if (chrome && chrome.exitCode == null) {
      await new Promise((resolve) => {
        chrome.once("exit", resolve)
        chrome.kill()
      })
    }
    server?.close()
    if (profile) rmSync(profile, { recursive: true, force: true })
  })

  it("hides the button on a fresh expert game and after leaving a pending undo", async () => {
    const report = await evalPage(pageCdp, `(() => {
      const button = () => {
        const el = document.getElementById("btn-undo")
        el.focus()
        const style = getComputedStyle(el)
        return {
          display: style.display,
          disabled: el.disabled,
          hidden: el.hidden,
          focused: document.activeElement === el,
        }
      }
      const g = window.__GAME__
      const settings = g.getState().settings
      g.setState(g.createMatch(() => 0.2, 0, settings, "expert"))
      const fresh = button()
      const normal = g.createMatch(() => 0.42, 0, settings, "normal")
      const moves = []
      normal.hand.forEach((piece, slot) => {
        if (!piece) return
        for (let row = 0; row < 8 && moves.length < 1; row++) {
          for (let col = 0; col < 8 && moves.length < 1; col++) {
            const result = g.placePiece(normal, slot, row, col, () => 0.2)
            if (result.ok) moves.push(result.state)
          }
        }
      })
      if (!moves[0] || !moves[0].undo) return { error: "no pending undo", fresh }
      g.setState(moves[0])
      const pending = button()
      g.setState(g.restartMatch(moves[0], () => 0.3, "expert"))
      const switched = button()
      const floater = getComputedStyle(document.getElementById("floater")).display
      g.setState({ ...g.getState(), settings: { ...g.getState().settings, showPreview: false } })
      const preview = getComputedStyle(document.getElementById("preview-section")).display
      return { fresh, pending, switched, floater, preview }
    })()`)

    assert.equal(report.error, undefined)
    assert.equal(report.fresh.display, "none")
    assert.equal(report.fresh.disabled, true)
    assert.equal(report.fresh.hidden, true)
    assert.equal(report.fresh.focused, false)
    assert.equal(report.pending.display, "flex")
    assert.equal(report.pending.disabled, false)
    assert.equal(report.switched.display, "none")
    assert.equal(report.switched.disabled, true)
    assert.equal(report.switched.hidden, true)
    assert.equal(report.switched.focused, false)
    assert.equal(report.floater, "none")
    assert.equal(report.preview, "none")
  })
})
