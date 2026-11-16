-- The hand check after the old installations on the private machine: tasks-desktop and testing-desktop installed
-- again from the Rolling build, so that the acceptance run measures what the repositories build now (a hub without
-- wscript, cmd and rundll32). A Claude session may not install (it sees a redirected AppData and HKCU).
--   testing sheets step reinstall-live
return {
  id = "tasks-desktop.reinstall-live",
  title = "tasks-desktop and testing-desktop installed again from the Rolling build: the hubs start the new way",
  task = "tasks-desktop/installationen-von-tasks-desktop-und-testing-desktop-auf-dem-p",
  engine = "manual",
  steps = {
    {
      ask = "In a normal terminal (not a Claude session): tasks-desktop and testing-desktop installed again from the"
        .. " Rolling build latest, the way their READMEs say?",
    },
    {
      ask = "%APPDATA%/tasks-desktop/start-hub.vbs is gone, and tasks-hub start runs serve directly (app-proc-watch"
        .. " or the Task Manager: no wscript, no cmd)?",
    },
    { ask = "testing-hub starts again (if not, its message noted in the task)?" },
  },
}
