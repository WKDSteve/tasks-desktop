-- The hand check of the views of time and of the repo status: what no test sees is a real finger on a real touch
-- screen, what a screen reader says, how the mail of the reminders reads, and GitHub itself (a login of gh, a run the
-- runner guard refused). What a machine checks runs elsewhere: ui/e2e (the keys of the calendar, a finger by touch
-- events of the browser, the timeline moved by keys, mouse, finger and the fields of its table with the real engine,
-- the reminders view against a hub without a mail account, the repo status of a checkout without GitHub),
-- ui/src/views/*.dom.test.ts (the states), crates/tasks-hub (mail.rs, repos/status.rs with a git and a gh that only
-- answer) and crates/hub-testkit (reminders_mail.rs, repo_status_route.rs). Only on a private machine: the installed
-- hub is not for the workstation.
--   testing sheets step time-views-live
return {
  id = "tasks-desktop.time-views-live",
  title = "Calendar, timeline, reminders and repo status by hand: a finger, a screen reader, the mail, the real GitHub",
  task = "tasks-desktop/abnahme-zeit-ansichten-von-hand-kalender-und-zeitleiste-mit",
  engine = "manual",
  steps = {
    {
      ask = "View > Calendar on a touch screen (a tablet, or a laptop with one): a task of 'Without a date' dragged by"
        .. " its grip onto a day gets that due date, dragged back the date is gone, and a short touch on the grip moves"
        .. " nothing? The page still scrolls with a finger beside the grips?",
    },
    {
      ask = "Calendar with the keys only: Tab reaches one day, the arrows and h j k l walk the days and into the next"
        .. " month, m on a task and Enter on a day set the due date, Shift with an arrow moves it, Delete takes it away,"
        .. " Escape gives a carried task up, and the focus is always visible (light and dark)?",
    },
    {
      ask = "With a screen reader (NVDA or Narrator) in the calendar: a day is read with its date and the number of its"
        .. " tasks, and picking a task up is said ('Moving ...') with what the keys do?",
    },
    {
      ask = "View > Timeline with tasks that have start and due: bars, marks for one date, the line of today, the zoom"
        .. " (week, month, quarter) and the groups by plan and by area look right; a group folds; an arrow from a task"
        .. " that ends after its follower begins is thick and in the warning colour, and the table says so in words?",
    },
    {
      ask = "Timeline with the mouse and a finger: dragging a bar moves both dates, dragging an end only that date, the"
        .. " grip of a row moves the bar with a finger, a tap on a bar opens the task; Ctrl+Z (undo) takes one drag"
        .. " back as one step? A start dragged past the due date stops at it?",
    },
    {
      ask = "Timeline with the keys: holding Shift and pressing right three times shows the bar three days on and"
        .. " writes once when Shift is let go (one undo); Escape while Shift is held writes nothing; a screen reader"
        .. " says the dates while they move?",
    },
    {
      ask = "View > Reminders: every task with a reminder is listed by day, finished ones too, the due ones marked;"
        .. " 'The due ones' ticks exactly those; with an address, 'Show the mail' shows a mail with day, title and id"
        .. " only, a task of a private area is named under 'Not in the mail' with its reason, and the view says that"
        .. " this hub has no mail account (nothing is sent)?",
    },
    {
      ask = "View > Repo status with a few repo tiles and gh logged in: each row shows the checkout as 'git status'"
        .. " says it and the CI of the newest push as the Actions page of GitHub shows it; 'Open the run' opens that"
        .. " run in the browser; a change in a checkout shows after 'Ask again now'?",
    },
    {
      ask = "Repo status of a public repo whose newest commit the runner guard refused (not approved yet): the row says"
        .. " 'waiting for approval', not RED, shows 'testing ci trust <owner/repo> <sha>', and Copy puts exactly that"
        .. " on the clipboard?",
    },
    {
      ask = "With the network off (or 'gh auth logout' in a test profile): the rows say that GitHub cannot be reached"
        .. " (or that gh is not logged in) and still show the checkouts; nothing shows an error box?",
    },
  },
}
