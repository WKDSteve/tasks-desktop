-- The hand check of the view of the learning paths: only what no machine sees, the installed window (where a link goes),
-- the feel of ticking in real use, a real finger, what a screen reader says and how both themes look. What a machine
-- checks runs elsewhere: TESTS/sheets/learning-paths.sheet.lua (a tick and its Undo, does not apply and blocked with
-- their reason, a change by another program kept, promote and the task finished as seen, shots in both themes),
-- ui/e2e (paths.spec.ts: real hub and engine, axe, a finger by touch events, the keys, a note, the focus after a write),
-- ui/e2e-web (paths.spec.ts: the web variant), ui/src/views/PathsView.dom.test.ts (ticking fast, a draft kept on a new
-- read, the focus after Escape and Save, markHidden, folding by name) and ui/src/lib/paths.test.ts. Only on a private
-- machine: the installed app is not for the workstation. A test vault with a path like "Lua lernen" (concept 11.3)
-- under <area>/ROADMAP/paths/.
--   testing sheets step learning-paths-live
return {
  id = "tasks-desktop.learning-paths-live",
  title = "Learning paths by hand: the installed window, a real finger, a screen reader, both themes",
  task = "tasks-desktop/abnahme-lernpfad-ansicht-in-der-app-und-im-web-echtes-fenste",
  engine = "manual",
  steps = {
    {
      ask = "Learning plans > Learning paths in the installed app: the paths on the left with their progress, the tree on the"
        .. " right; folding, 'Fold all' and 'Unfold all' look and feel right in the window?",
    },
    {
      ask = "A link of a point opens in the system's browser, not in the app window, and its host stands beside it in"
        .. " brackets?",
    },
    {
      ask = "Ticking a real path quickly from top to bottom: does the short lock while the path is read again ('The path"
        .. " is still being read') get in the way? If it does, note it as a task.",
    },
    {
      ask = "With NVDA or Narrator: a mark names the point, its state and what a click does; folding says"
        .. " expanded/collapsed; after Escape, Cancel or Save in a note or reason field the focus is read on 'More' of"
        .. " that point? (how it sounds, not only the names)",
    },
    {
      ask = "On a phone or tablet (web variant or the hub in its browser): mark, menu and folding are easy to hit with"
        .. " a finger?",
    },
    {
      ask = "Light and dark (the shots of TESTS/sheets/out/tasks.learning-paths.* help): the progress bar, the marks,"
        .. " a reason and a note read well?",
    },
  },
}
