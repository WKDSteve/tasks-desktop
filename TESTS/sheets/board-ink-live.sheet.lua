-- The hand check of the page's own whiteboard (tasks-desktop/meetings-board-ink) with what no test sees: a real pen
-- tablet with its pressure and its eraser end, a real touchscreen with a palm and two fingers, the Tauri window, and
-- how both themes look. What a machine checks runs elsewhere: ui/e2e/app.spec.ts ("the whiteboard of a meeting":
-- synthetic pen and touch events, the board and its line saved, opened again and replaced on its version, axe),
-- ui/src/views/BoardEditor.dom.test.ts, ui/src/lib/ink.test.ts and crates/hub-testkit/tests/real_meetings.rs (the
-- route against the real engine). Only on a private machine: the installed app is not for the workstation.
--   testing sheets step board-ink-live
return {
  id = "tasks-desktop.board-ink-live",
  title = "The whiteboard by hand: a real pen tablet, a touchscreen, the Tauri window, both themes",
  task = "tasks-desktop/abnahme-whiteboard-mit-echtem-stifttablett-und-touchscreen",
  engine = "manual",
  steps = {
    {
      ask = "A meeting, tab 'In the meeting', '✎ Board', a USB pen tablet: light and firm pressure give thin and thick"
        .. " lines, the line follows the pen without lag or jags, with no setting of the tablet's driver in the app?",
    },
    {
      ask = "The eraser end of the pen (or its eraser button) erases without choosing 'Eraser'; Ctrl+Z brings the"
        .. " stroke back, Ctrl+Y takes it again?",
    },
    {
      ask = "A touchscreen: a finger draws while no pen was used; after the pen the palm lies on the screen and draws"
        .. " nothing; two fingers move and zoom; Space + drag moves, Ctrl + wheel zooms?",
    },
    {
      ask = "A photo as 'Picture behind', drawn over: closed, the line of the minutes shows both in its preview; a very"
        .. " large photo shows only the strokes in the preview, and the board opened again still has the photo?",
    },
    {
      ask = "The same board open in a second window, drawn in both: the second save goes to '<name>-2' and says so; the"
        .. " minutes have a line for each?",
    },
    {
      ask = "Light and dark: tools, colours, paper and grid read well; the saved SVG looks the same (light) in both;"
        .. " German and English with no key in the text?",
    },
    {
      ask = "The Tauri window (WebView2): pen pressure, eraser end and palm behave as in the browser?",
    },
    {
      ask = "The board chosen as the cover of the meeting: the calendar and the timeline show it?",
    },
  },
}
