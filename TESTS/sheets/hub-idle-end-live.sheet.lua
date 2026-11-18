-- The hand check of the hub in the background in the real profile: it ends by itself when no page is open and nothing
-- asks it to stay, and it stays while a page, a paired phone or the tailnet needs it. A Claude session may not start the
-- installed hub (it sees a redirected AppData and HKCU), and the waits are minutes long, so a person does it in a normal
-- terminal. What a machine checks runs elsewhere: tasks-hub's tests/cli.rs with the real program in folders of their own
-- (built in tasks-desktop/hub-laeuft-nach-abbruch-weiter, tasks-desktop@02883c3).
--   testing sheets step hub-idle-end-live
return {
  id = "tasks-desktop.hub-idle-end-live",
  title = "tasks-hub in the background: ends by itself without a page, stays while a page or a phone needs it",
  task = "tasks-desktop/handlauf-hub-im-hintergrund-beendet-sich-selbst",
  engine = "manual",
  steps = {
    {
      ask = "Private machine, normal terminal: the installed Rolling build contains tasks-desktop@02883c3 (tasks-hub"
        .. " --version names the commit)?",
    },
    {
      ask = "No autostart, no paired phone, no keep_running: tasks-hub start --open, use the page, close the tab. After"
        .. ' a good 10 minutes tasks-hub stop says "no hub is running", no tasks-hub in the Task Manager, and hub.log'
        .. ' says "no page is connected and nothing asks the hub to stay: it ends"?',
    },
    {
      ask = "The same with the tab open for 15 minutes: the hub stays and the page keeps working?",
    },
    {
      ask = "The tab left in the background (Edge or Chrome with the memory saver) for 30 minutes, then back to it:"
        .. " does the page still live (write down if it loads into nothing)?",
    },
    {
      ask = "A tab left open while the hub ended (tasks-hub stop in a terminal is enough): above the view the page says"
        .. ' that the hub is not running any more and how to start it (Start menu "Tasks", tasks-hub start --open),'
        .. " the list stays, a title typed into the new-task form stays, and no error toast repeats?",
    },
    {
      ask = "Then start the hub from the Start menu (it opens a new tab). Back in the OLD tab: it says that the hub was"
        .. " started anew, and within a moment of getting the focus it takes the session of the new tab over: the"
        .. " line goes, the list is fresh, and what was typed is still there and can be saved?",
    },
    {
      ask = "The same, but the new tab closed before going back: the old tab keeps its line; the link of tasks-hub"
        .. " open pasted into its address bar pairs it where it stands (nothing typed is lost)?",
    },
    {
      ask = "With a paired phone (tasks-hub devices shows one): tab closed, after 15 minutes the hub still runs and"
        .. " the phone reaches it?",
    },
    {
      ask = "With TASKS_DESKTOP_TAILNET set: tasks-hub start --open opens the browser and the hub stays?",
    },
    {
      ask = "tasks-hub uninstall: the hub is gone, no value tasks-desktop under"
        .. " HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run, no start-hub.vbs in the config folder?",
    },
  },
}
