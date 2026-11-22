-- The hand check of ladders and of routines that start after a finish (engine capability `repeat_steps`): what no test
-- sees is the installed window, the jump to the view of the learning paths, a screen reader, both themes and a phone.
-- What a machine checks runs elsewhere: ui/e2e/app.spec.ts (real hub and engine, axe: the ladder in Repeats, its round,
-- the routine that waits with its link, the toast once it starts, the last round in the finish dialog, Discard),
-- ui/src/views/Detail.test.ts, ui/src/lib/app.test.ts, ui/src/lib/routine.test.ts, the device cut in
-- crates/tasks-hub/src/server/device_cut.rs and the byte comparison of the web engine (ui/web/edge-vault.mjs). Only on a
-- private machine: the installed app is not for the workstation. A test vault with a learning path that has a point
-- (key k1) and a task of its own.
--   testing sheets step routine-ladder-live
return {
  id = "tasks-desktop.routine-ladder-live",
  title = "Ladders and routines that start after a finish, by hand: the installed window, a screen reader, both themes, a phone",
  task = "tasks-desktop/abnahme-staffel-wiederholung-und-start-nach-abschluss-im",
  engine = "manual",
  steps = {
    {
      ask = "In the installed app, a task's detail: 'Repeats' set to 1w,4w,12w is written to the file as"
        .. " 'repeat: 1w,4w,12w', and the label says '(round 1 of 3)'; 'repeat_step: 2' set in an editor shows"
        .. " '(round 2 of 3)' after the list is read again?",
    },
    {
      ask = "A value the engine refuses (say 1w, 4w with a blank, or 13 intervals) is refused with the engine's words,"
        .. " and the file keeps its old value?",
    },
    {
      ask = "'repeat_after: <area>/<slug>' of another open task, no due date: the detail shows 'Starts once this is"
        .. " finished' with that task as a link and its status; a click opens that task?",
    },
    {
      ask = "'repeat_after: <area>/<path>#k1' (a point of a learning path): the link opens Learning plans > Learning paths with"
        .. " that path chosen?",
    },
    {
      ask = "Finishing the task it waits for: the toast says 'A routine starts: <id>, due <date>' (a week from today for"
        .. " 1w), has no Undo, and the routine's file has due, start and remind of that day?",
    },
    {
      ask = "Setting the point k1 to learned in Learning plans > Learning paths: the same toast for a routine that waits for"
        .. " the point?",
    },
    {
      ask = "A ladder at its last round (repeat_step: 3 of 1w,4w,12w): 'Done' says 'The last round of the routine"
        .. " (1w, 4w, 12w): it ends, no further round comes.', and no next round; finishing it writes no new round?",
    },
    {
      ask = "Discard on a ladder: the question names it as a ladder with its intervals and its round; 'Keep it' writes"
        .. " nothing?",
    },
    {
      ask = "German (Options > Language): 'Runde 2 von 3', 'Startet nach Abschluss von', 'Eine Wiederholung startet:"
        .. " ..., fällig am ...' read well and fit their place?",
    },
    {
      ask = "With NVDA or Narrator: the label of 'Repeats' is read with its round, the link of what a routine waits for"
        .. " names the id, the toast is announced once?",
    },
    {
      ask = "The web variant (tasks.html from the disk, Chrome or Edge): the round, the waiting routine and the toast"
        .. " after a finish are the same as in the app?",
    },
    {
      ask = "A paired phone, area public or internal: the routine's ladder and round reach it; one that waits for a"
        .. " task of a private area shows no word of that task (until tasks-mobile shows the fields: look at the"
        .. " page of the hub in the phone's browser)?",
    },
    {
      ask = "Light and dark: the round beside 'Repeats' and the hint under what a routine waits for read well?",
    },
  },
}
