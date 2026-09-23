"use strict";
/* ==========================================================================
   TASK BOARD ASSIGNMENT TIMER — pure derived logic, nothing stored as a
   metric except the pause bookkeeping (pausedAt/pausedMsTotal), which has to
   persist across sessions since it can't be re-derived from current state
   alone. Covered by scripts/taskboard-test.js. Mirrors src/domain.js exactly
   (nextBoardPauseState is duplicated there and here on purpose — the server
   copy is authoritative, this one is only for optimistic UI).
   ========================================================================== */

/** Is the assignment timer running for this task right now? */
function isBoardTimerRunning(t) { return t.status !== "COMPLETED" && t.boardCategory !== "on_hold"; }

/**
 * Pure pause/resume transition: whenever "is this timer running" flips, stash
 * or accumulate the paused time. No-op if it didn't flip. One rule covers
 * pause-on-done, pause-on-hold, resume-from-hold and reopen-from-done —
 * display copy is what tells them apart, not this transition.
 */
function nextBoardPauseState({ wasRunning, isRunning, pausedAt, pausedMsTotal }, nowISO) {
  pausedMsTotal = Number(pausedMsTotal) || 0;
  if (wasRunning === isRunning) return { pausedAt: pausedAt || null, pausedMsTotal };
  if (isRunning) {                                          // resuming
    const ms = pausedAt ? Math.max(0, new Date(nowISO) - new Date(pausedAt)) : 0;
    return { pausedAt: null, pausedMsTotal: pausedMsTotal + ms };
  }
  return { pausedAt: pausedAt || nowISO, pausedMsTotal };     // pausing (done or on_hold)
}

/**
 * Days since assigned, and the copy to show on a Task Board card.
 * `now` is injectable for tests; defaults to the real clock.
 */
function taskTimerInfo(t, now) {
  now = now || new Date();
  const done = t.status === "COMPLETED";
  const onHold = t.boardCategory === "on_hold";
  const isRunning = !done && !onHold;
  const pausedMsTotal = Number(t.pausedMsTotal) || 0;
  const end = isRunning ? now : (dOf(t.pausedAt) || now);
  const assigned = startOfDay(dOf(t.assignedDate) || now);
  const days = Math.max(0, Math.floor((end.getTime() - assigned.getTime() - pausedMsTotal) / DAY));

  if (isRunning) {
    return { isRunning, days, muted: false, text: days === 0 ? "⏱ Assigned today" : `⏱ ${days} day${days === 1 ? "" : "s"} since assigned` };
  }
  if (onHold) {
    return { isRunning, days, muted: true, text: `⏸ Paused at ${days} day${days === 1 ? "" : "s"} (On Hold)` };
  }
  return { isRunning, days, muted: true, text: `✓ Completed in ${days} day${days === 1 ? "" : "s"}` };
}
