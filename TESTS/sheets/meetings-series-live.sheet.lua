-- The hand check of meeting series (tasks-desktop/meetings-serien-im-kalender-und-zeitplaner-zeigen-und-beim-e) with
-- what no test sees: a real Web Push on the phone and a real mail for an occurrence, the Tauri window, both themes.
-- What a machine checks runs elsewhere: ui/e2e/meetings-series.spec.ts (occurrences marked in the calendar, the first
-- entry makes the file, a move in the hour grid, a day skipped, the series edited, axe), ui/src/lib/series.test.ts,
-- ui/src/views/TaskMeetings.dom.svelte.test.ts and crates/hub-testkit/tests/real_series_schedule.rs (the scheduler
-- plans every occurrence against the real engine). Only on a private machine: the installed app is not for the
-- workstation.
--   testing sheets step meetings-series-live
return {
  id = "tasks-desktop.meetings-series-live",
  title = "Meeting series by hand: a notice for each occurrence on the phone and by mail, the Tauri window, both themes",
  task = "tasks-desktop/abnahme-meeting-serien-im-echten-hub-mitteilungen-je-vorkomm",
  engine = "manual",
  steps = {
    {
      ask = "A weekly series with notify -15m whose occurrence today begins in half an hour: the phone (Web Push) and"
        .. " the mail tell of it with the day and time of that occurrence, not of the first day of the series?",
    },
    {
      ask = "The same occurrence cancelled before ('Cancel this occurrence'): nothing comes for it, and the next"
        .. " occurrence tells again?",
    },
    {
      ask = "A day skipped ('Skip as exception'): nothing comes on that day?",
    },
    {
      ask = "The Tauri window, light and dark: the sign of a series and the dotted edge of an occurrence without a file"
        .. " are easy to see in the month and in the hour grid; the bar of the series and 'Repeat' in the form read"
        .. " well, German and English with no key in the text?",
    },
  },
}
