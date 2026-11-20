-- The hand check of the view of the learning paths: what no test sees is the installed window (where a link goes), a
-- real finger, what a screen reader says and how both themes look. What a machine checks runs elsewhere: ui/e2e
-- (paths.spec.ts: real hub and engine, axe, a finger by touch events, the keys, the focus after a write), ui/e2e-web
-- (paths.spec.ts), ui/src/views/PathsView.dom.test.ts (ticking fast, a draft kept on a new read, the focus after
-- Escape and Save, markHidden, folding by name) and ui/src/lib/paths.test.ts. Only on a private machine: the installed
-- app is not for the workstation. A test vault with a path like "Lua lernen" (concept 11.3) under
-- <area>/ROADMAP/paths/.
--   testing sheets step learning-paths-live
return {
  id = "tasks-desktop.learning-paths-live",
  title = "Learning paths by hand: the installed window, a finger, a screen reader, both themes",
  task = "tasks-desktop/abnahme-lernpfad-ansicht-in-der-app-und-im-web-echtes-fenste",
  engine = "manual",
  steps = {
    {
      ask = "View > Learning paths in the installed app: the paths on the left with their progress, the tree on the"
        .. " right; a click folds a parent, 'Fold all' and 'Unfold all' do what they say?",
    },
    {
      ask = "A click on the mark of a leaf ticks it learned, a second click sets it open; the file shows [x] and [ ];"
        .. " Undo in the toast brings the old state back?",
    },
    {
      ask = "More > 'Seen, not done ...' without a reason says a reason is needed; with one the file has"
        .. " '[~] ... – Grund: ...'; the same for 'Not applicable ...' ([-]) and 'Blocked ...' ([!], with the key)?",
    },
    {
      ask = "A note added and edited: it stands under the point in the file and in the view?",
    },
    {
      ask = "The file changed in an editor, then a point ticked in the view: the page says the path changed, reads it"
        .. " again, and nothing of the editor's change is lost?",
    },
    {
      ask = "A link of a point opens in the system's browser, not in the app window, and its host stands beside it in"
        .. " brackets?",
    },
    {
      ask = "Promote: the task is made and opens; the point then shows 'Task <id>' with its status, and once the task"
        .. " is finished as seen (outcome seen, with a reason) the point shows 'done · seen'?",
    },
    {
      ask = "Five points ticked quickly from top to bottom: never 'The path changed meanwhile'; a click while the path is"
        .. " read again says 'The path is still being read' and a second click takes?",
    },
    {
      ask = "With NVDA or Narrator: a mark names the point, its state and what a click does; folding says"
        .. " expanded/collapsed; after Escape, Cancel or Save in a note or reason field the focus is read on 'More' of"
        .. " that point?",
    },
    {
      ask = "A note begun, then another line of the file changed in an editor: the field stays open with its text;"
        .. " the point deleted in the editor: the field closes with a word why?",
    },
    {
      ask = "A folded parent stays folded when a point is inserted above it in the editor?",
    },
    {
      ask = "The web variant (tasks.html from the disk, Chrome or Edge): ticking, a reason and a note work the same?",
    },
    {
      ask = "On a phone or tablet (web variant or the hub in its browser): mark, menu and folding are easy to hit with"
        .. " a finger?",
    },
    {
      ask = "Light and dark: the progress bar, the marks and the notes read well?",
    },
  },
}
