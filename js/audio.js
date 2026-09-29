/** Short WebAudio tones. No audio files, so the build stays offline and license-clean. */

function tone(ctx, { freq, dur, type = "sine", gain = 0.06, delay = 0, slide = 0 }) {
  const t = ctx.currentTime + delay
  const osc = ctx.createOscillator()
  const amp = ctx.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, t)
  if (slide > 0) osc.frequency.exponentialRampToValueAtTime(slide, t + dur)
  amp.gain.setValueAtTime(gain, t)
  amp.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  osc.connect(amp)
  amp.connect(ctx.destination)
  osc.start(t)
  osc.stop(t + dur + 0.02)
}

export function createAudio() {
  let ctx = null
  let muted = false

  function context() {
    const AC = window.AudioContext || window.webkitAudioContext
    if (!AC) return null
    if (!ctx) ctx = new AC()
    if (ctx.state === "suspended") ctx.resume()
    return ctx
  }

  function play(notes) {
    if (muted) return
    const audio = context()
    if (!audio) return
    for (const note of notes) tone(audio, note)
  }

  return {
    unlock() {
      context()
    },
    setMuted(value) {
      muted = Boolean(value)
    },
    isMuted() {
      return muted
    },
    playPlace() {
      play([{ freq: 520, dur: 0.07, type: "triangle", gain: 0.05 }])
    },
    playClear(lines) {
      const chord = [523, 659, 784, 1046]
      const count = Math.min(chord.length, 1 + lines)
      const notes = []
      for (let i = 0; i < count; i++) {
        notes.push({
          freq: chord[i],
          dur: 0.14,
          type: "triangle",
          gain: 0.05,
          delay: i * 0.07,
        })
      }
      play(notes)
    },
    playInvalid() {
      play([{ freq: 180, dur: 0.09, type: "sine", gain: 0.04, slide: 120 }])
    },
    playOver() {
      play([
        { freq: 392, dur: 0.16, type: "sine", gain: 0.05, delay: 0 },
        { freq: 311, dur: 0.18, type: "sine", gain: 0.05, delay: 0.12 },
        { freq: 220, dur: 0.28, type: "triangle", gain: 0.05, delay: 0.24 },
      ])
    },
    playTap() {
      play([{ freq: 740, dur: 0.04, type: "sine", gain: 0.03 }])
    },
  }
}
