-- The hand check on the workstation: the link of the web variant (start-tasks.cmd /shortcut) points at the browser
-- itself, so opening it starts no cmd and no powershell. The link and its target were measured on the private machine
-- with a browser profile of its own; what only the workstation can say (its endpoint protection, its browser) is
-- asked here. A manual sheet runs there: it starts nothing.
--   testing sheets step tasks-web-workstation-live
return {
  id = "tasks-desktop.tasks-web-workstation-live",
  title = "tasks-web on the workstation: the new link opens the page without cmd or powershell",
  task = "tasks-desktop/handlauf-workstation-tasks-web-startet-ohne-cmd-und-powershell",
  engine = "manual",
  steps = {
    {
      ask = "On the workstation: git pull in the clone of tasks-web, then start-tasks.cmd /shortcut once in a terminal?",
    },
    {
      ask = "A click on the new link opens the page, and the Task Manager shows no cmd.exe or powershell.exe under"
        .. " the start?",
    },
    { ask = "No notice of the endpoint protection came up (result noted in the task)?" },
  },
}
