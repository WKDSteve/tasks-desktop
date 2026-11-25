-- The hand check of the tab Lists with what no test sees: a real microphone and its question, a real clipboard, the
-- installed window (WebView2), the drawing surface and a large file in the page without a hub (tasks-web, file://), a
-- change made in Neovim while the tab is open, the print dialog. What a machine checks runs elsewhere:
-- lists.sheet.lua (the tab against a hub, step by step), ui/e2e/lists.spec.ts (the real hub, axe, a pasted picture as
-- a synthetic paste), ui/e2e-web/lists.spec.ts (the page without a hub, a picture moved along when an entry becomes a
-- task), ui/src/views/ListsView.dom.test.ts.
--   testing sheets step lists-live
return {
  id = "tasks-desktop.lists-live",
  title = "The tab Lists by hand: microphone, clipboard, installed window, board and a large file in tasks-web, a change from Neovim, print",
  task = "tasks-desktop/abnahme-reiter-listen-von-hand",
  engine = "manual",
  steps = {
    {
      ask = "In the installed app, tab Lists: type a line with a #word and Enter. The entry is on top, the #word a tag,"
        .. " and in the vault a folder _list-<name>/ holds list.md and the entry as <time>-<title>.md?",
    },
    {
      ask = "Win+Shift+S, then Ctrl+V into the field of a new entry: an entry with that picture (the picture shown when"
        .. " the entry is opened, the file in assets/images/ of its folder)? And Ctrl+V into the text of an open entry"
        .. " attaches the picture without changing the text?",
    },
    {
      ask = "In an open entry: Audio > Record with the microphone. The browser asks for the microphone once; Stop and"
        .. " attach puts a recording into assets/audio/ that plays? With the microphone refused: a message, nothing"
        .. " attached?",
    },
    {
      ask = "The same in the Tauri window of the app (WebView2): the microphone question, the recording, the paste of a"
        .. " picture; and if one does not work there, what does the page say?",
    },
    {
      ask = "Edit an entry file in Neovim (its title or its text) while the tab is open: the tab shows the change within"
        .. " a few seconds, without a reload; a new file of an entry written by hand shows up too?",
    },
    {
      ask = "Export > Print or PDF: the print dialog shows the list as a table with the filter named on top; the PDF"
        .. " saved from it reads well?",
    },
    {
      ask = "tasks-web (file://, the folder of the vault chosen): the tab Lists works the same; a board drawn on an"
        .. " entry is saved into assets/boards/ of its folder and opens again with its strokes?",
    },
    {
      ask = "tasks-web: attach a video of a few hundred MB to an entry, then make the entry a task. The video lies in"
        .. " the task's folder afterwards (moved, once on disk), the page stays responsive, and its memory (Task Manager)"
        .. " does not grow by the size of the video when the entry becomes a task?",
    },
    {
      ask = "tasks-web: Export > PNG picture saves a picture of the filtered entries that reads well?",
    },
    {
      ask = "Delete the done ones with an entry with attachments among them: the question names how many have"
        .. " attachments; after yes they are gone with their folders; without attachments, Undo brings them back?",
    },
  },
}
