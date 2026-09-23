/**
 * Unit check for the Task Board assignment timer in public/app/taskTimer.js.
 *
 * That file is a plain browser <script> (classic global scope, not an ES
 * module), so it can't be `import`ed directly — same problem, same fix, as
 * scripts/notif-test.js: run the real, unmodified source (together with
 * public/app/util.js, which it depends on for dOf/startOfDay/DAY) inside a
 * small vm sandbox, then call the real functions with fixture tasks.
 *
 * It also cross-checks the server's copies in src/domain.js (BOARD_CATEGORIES
 * and nextBoardPauseState are deliberately duplicated client-side for
 * optimistic UI — this is what catches the two silently drifting apart).
 *
 *   npm run test:taskboard
 */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { BOARD_CATEGORIES as SERVER_BOARD_CATEGORIES, nextBoardPauseState as serverNextBoardPauseState } from "../src/domain.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.join(HERE, "..", "public", "app");

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (detail ? "  :: " + detail : "")); }
};

function loadClient() {
  const sandbox = { console };
  vm.createContext(sandbox);
  for (const file of ["util.js", "taskTimer.js"]) {
    vm.runInContext(fs.readFileSync(path.join(APP, file), "utf8"), sandbox, { filename: file });
  }
  vm.runInContext(
    "this.taskTimerInfo = taskTimerInfo; this.nextBoardPauseState = nextBoardPauseState; " +
    "this.BOARD_CATEGORIES = BOARD_CATEGORIES; this.iso = iso; this.startOfDay = startOfDay; this.DAY = DAY;",
    sandbox
  );
  return sandbox;
}

const { taskTimerInfo, nextBoardPauseState, BOARD_CATEGORIES, iso, startOfDay, DAY } = loadClient();

// A fixed, midnight-aligned "now" — every fixture below is built as an exact
// whole-day offset from it, so day-count assertions are exact regardless of
// the wall-clock time the test happens to run at.
const TODAY = startOfDay(new Date());
const daysAgoDate = n => new Date(TODAY.getTime() - n * DAY);
const daysAgoISO = n => iso(daysAgoDate(n));       // date-only string, e.g. "2026-09-12"
const daysAgoTS = n => daysAgoDate(n).toISOString(); // full timestamp, midnight-aligned

/* -------------------------------------------------------- 1. running */
{
  const t = { status: "IN_PROGRESS", boardCategory: "to_do", assignedDate: daysAgoISO(3), pausedAt: null, pausedMsTotal: 0 };
  const info = taskTimerInfo(t, TODAY);
  ok("running: counts days since assigned", info.isRunning === true && info.days === 3 && info.text === "⏱ 3 days since assigned", JSON.stringify(info));
}

/* --------------------------------------------------- 2. assigned today */
{
  const t = { status: "IN_PROGRESS", boardCategory: "to_do", assignedDate: daysAgoISO(0), pausedAt: null, pausedMsTotal: 0 };
  const info = taskTimerInfo(t, TODAY);
  ok("assigned today: \"Assigned today\", not \"0 days\"", info.isRunning === true && info.days === 0 && info.text === "⏱ Assigned today", JSON.stringify(info));
}

/* ------------------------------------------------- 3. paused on hold */
{
  // Assigned 5 days ago, moved to On Hold 2 days ago (so it ran for 3 days first).
  const t = { status: "IN_PROGRESS", boardCategory: "on_hold", assignedDate: daysAgoISO(5), pausedAt: daysAgoTS(2), pausedMsTotal: 0 };
  const info = taskTimerInfo(t, TODAY);
  ok("paused on hold: frozen at the day count when it was put on hold", info.isRunning === false && info.muted === true && info.days === 3 && info.text === "⏸ Paused at 3 days (On Hold)", JSON.stringify(info));
}

/* ------------------------------------------------ 4. resumed after hold */
{
  // Assigned 10 days ago, spent 2 of those days on hold (already folded into pausedMsTotal).
  const t = { status: "IN_PROGRESS", boardCategory: "to_do", assignedDate: daysAgoISO(10), pausedAt: null, pausedMsTotal: 2 * DAY };
  const info = taskTimerInfo(t, TODAY);
  ok("resumed after hold: excludes the paused interval", info.isRunning === true && info.days === 8, JSON.stringify(info));
}

/* --------------------------------------------------------- 5. done */
{
  // Assigned 7 days ago, completed 1 day ago -> ran for 6 days.
  const t = { status: "COMPLETED", boardCategory: "to_do", assignedDate: daysAgoISO(7), pausedAt: daysAgoTS(1), pausedMsTotal: 0 };
  const infoNow = taskTimerInfo(t, TODAY);
  const infoLater = taskTimerInfo(t, new Date(TODAY.getTime() + 5 * DAY));
  ok("done: \"Completed in N days\", muted", infoNow.isRunning === false && infoNow.muted === true && infoNow.days === 6 && infoNow.text === "✓ Completed in 6 days", JSON.stringify(infoNow));
  ok("done: frozen — a later `now` doesn't change the answer", infoNow.days === infoLater.days, JSON.stringify({ infoNow, infoLater }));
}

/* --------------------------------------------------- 6. reopened after done */
{
  // Same history as #5, but reopened: the 1 day spent Done is now in pausedMsTotal.
  const t = { status: "IN_PROGRESS", boardCategory: "to_do", assignedDate: daysAgoISO(7), pausedAt: null, pausedMsTotal: 1 * DAY };
  const info = taskTimerInfo(t, TODAY);
  ok("reopened after done: running again, excludes the Done interval", info.isRunning === true && info.days === 6, JSON.stringify(info));
}

/* ---------------------------------------------- 7. backdated assigned date */
{
  // A task entered today but backdated to have been assigned 20 days ago.
  const t = { status: "NOT_STARTED", boardCategory: "to_do", assignedDate: daysAgoISO(20), pausedAt: null, pausedMsTotal: 0 };
  const info = taskTimerInfo(t, TODAY);
  ok("backdated assigned date: computed from assignedDate, not from now", info.isRunning === true && info.days === 20, JSON.stringify(info));
}

/* --------------------------------------------- nextBoardPauseState (bonus) */
{
  const r = nextBoardPauseState({ wasRunning: true, isRunning: false, pausedAt: null, pausedMsTotal: 0 }, daysAgoTS(0));
  ok("nextBoardPauseState: pausing (done or on_hold) stashes pausedAt", r.pausedAt === daysAgoTS(0) && r.pausedMsTotal === 0, JSON.stringify(r));
}
{
  const r = nextBoardPauseState({ wasRunning: false, isRunning: true, pausedAt: daysAgoTS(2), pausedMsTotal: 0 }, daysAgoTS(0));
  ok("nextBoardPauseState: resuming accumulates the elapsed paused time", r.pausedAt === null && r.pausedMsTotal === 2 * DAY, JSON.stringify(r));
}
{
  const r = nextBoardPauseState({ wasRunning: true, isRunning: true, pausedAt: null, pausedMsTotal: 5 }, daysAgoTS(0));
  ok("nextBoardPauseState: no flip is a no-op", r.pausedAt === null && r.pausedMsTotal === 5, JSON.stringify(r));
}
{
  // A task created directly as On Hold: treated as wasRunning=true (fresh) -> isRunning=false.
  const r = nextBoardPauseState({ wasRunning: true, isRunning: false, pausedAt: null, pausedMsTotal: 0 }, daysAgoTS(0));
  ok("nextBoardPauseState: created directly On Hold pauses immediately", r.pausedAt === daysAgoTS(0), JSON.stringify(r));
}

/* ------------------------------------------- server/client consistency */
ok("BOARD_CATEGORIES ids match between src/domain.js and public/app/util.js",
  JSON.stringify(SERVER_BOARD_CATEGORIES.map(c => c.id)) === JSON.stringify(BOARD_CATEGORIES.map(c => c.id)),
  JSON.stringify({ server: SERVER_BOARD_CATEGORIES, client: BOARD_CATEGORIES }));
{
  const args = [{ wasRunning: false, isRunning: true, pausedAt: daysAgoTS(2), pausedMsTotal: 0 }, daysAgoTS(0)];
  ok("nextBoardPauseState: server (src/domain.js) and client (taskTimer.js) copies agree",
    JSON.stringify(serverNextBoardPauseState(...args)) === JSON.stringify(nextBoardPauseState(...args)));
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
