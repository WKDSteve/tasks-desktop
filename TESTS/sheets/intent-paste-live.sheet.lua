-- The hand check of what the wave UI-W1D built and no test sees: the real clipboard between two apps, the real
-- permission of a browser for a folder after its restart, and the real REPOS_DIR of this machine. What a machine checks
-- runs elsewhere: ui/e2e/intent.spec.ts and ui/e2e-web/intent.spec.ts (a pasted intent beside a hub and from disk),
-- ui/web/engine.test.mjs (the golden examples against the engine), ui/web/entry.test.mjs and ui/src/lib/app.test.ts
-- (the vault menu of the web variant), crates/hub-testkit/tests/repos_route.rs (the suggestions).
--   testing sheets step intent-paste-live
return {
  id = "tasks-desktop.intent-paste-live",
  title = "Paste an intent from a real app, the vault menu of the web variant after a restart, repo suggestions",
  task = "tasks-desktop/abnahme-absicht-einfuegen-web-vault-menue-repo-vorschlaege",
  engine = "manual",
  steps = {
    {
      ask = "testing-web (or testing.nvim) with a red case: its button copies 'make a task' to the clipboard. In"
        .. " tasks-desktop Work > 'Paste an intent ...', Ctrl+V into the field, Check: the new-task form opens with"
        .. " title, area, kind bug, the refs and the excerpt of that finding, and nothing is in the vault yet?",
    },
    {
      ask = "Create makes the task. The same intent pasted again says 'A task holds this finding already: <id>' and"
        .. " 'Open that task' shows it; no second task?",
    },
    {
      ask = "The same from a saved file (the file choice of the dialog), and once in tasks-web opened from disk"
        .. " (tasks.html): the form opens there too and Create writes into the chosen folder?",
    },
    {
      ask = "Something that is no intent on the clipboard (a text, a picture): the dialog says so and opens no form?",
    },
    {
      ask = "tasks-web in Chrome or Edge with two vault folders used before; close the browser, open it and the page"
        .. " again with one vault: Project lists the other one with the hint to allow it. Choose it: either the browser"
        .. ' asks at once and it opens, or the start page says \'The browser asks again for "<name>". One click on'
        .. ' "Allow access" in its row opens it\' and that click opens it?',
    },
    {
      ask = "The same tab left open, the other folder renamed in the Explorer meanwhile: opening the menu Project"
        .. " shows it as not found (it was read again), without a reload?",
    },
    {
      ask = "tasks-desktop with REPOS_DIR set: Repos > 'Folder of the repo' offers the folders below REPOS_DIR that"
        .. " are no tile yet (Chrome, Edge and Firefox show the list), choosing one and 'Add the repo' makes the tile,"
        .. " and that folder is not offered again?",
    },
  },
}
