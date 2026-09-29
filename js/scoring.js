/**
 * Scoring, independent of the board.
 *
 *   placePoints = cells placed
 *   if no lines cleared: streak resets, score += placePoints
 *   else:
 *     streak += 1
 *     linePoints  = LINE_BASE * lines^2          (combo: 1 line = 10, 2 = 40, 3 = 90)
 *     streakBonus = (streak - 1) * STREAK_STEP * lines
 *     score += placePoints + linePoints + streakBonus
 *
 * A "streak" is consecutive placements that each clear at least one line.
 * Several lines cleared by one placement count as one combo, not several turns.
 */

import { LINE_BASE, STREAK_STEP } from "./config.js"

export function scorePlacement({ cellsPlaced, linesCleared, streak }) {
  const placePoints = cellsPlaced
  if (linesCleared <= 0) {
    return {
      points: placePoints,
      streak: 0,
      breakdown: { placePoints, linePoints: 0, streakBonus: 0 },
    }
  }
  const nextStreak = streak + 1
  const linePoints = LINE_BASE * linesCleared * linesCleared
  const streakBonus = (nextStreak - 1) * STREAK_STEP * linesCleared
  return {
    points: placePoints + linePoints + streakBonus,
    streak: nextStreak,
    breakdown: { placePoints, linePoints, streakBonus },
  }
}
