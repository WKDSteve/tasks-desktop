-- The hand check of the date fields of the detail with the calendar of the browser: what no test reaches is the
-- browser's own popup (Playwright cannot click into it). What a machine checks runs elsewhere: ui/e2e/app.spec.ts
-- ("a date typed into the detail digit by digit is written once, when the field is left": the digits, Tab, one write)
-- and ui/src/views/Detail.dom.test.ts (blur, Enter, a change without a key writes at once, a refused date).
--   testing sheets step date-picker-live
return {
  id = "tasks-desktop.date-picker-live",
  title = "The date fields of the detail: a day chosen in the calendar of the browser is written at once, a typed one once",
  task = "tasks-desktop/abnahme-datumsfelder-der-detailansicht-mit-dem-kalender-popu",
  engine = "manual",
  steps = {
    {
      ask = "The page in Chrome (the app or the hub in the browser), a task open in the detail: the calendar symbol of"
        .. " 'Due' opens the calendar of the browser, a day clicked in it shows at once in the field and the task is"
        .. " saved without leaving the field (the list shows the new date, the file has it)?",
    },
    {
      ask = "The clear button of the calendar (or 'Delete' in it) takes the date away at once, in the field and in the"
        .. " file?",
    },
    {
      ask = "A year typed digit by digit into 'Start' (e.g. 2027): nothing is saved while typing (no 'Saving' toast,"
        .. " no jumping of the field); Tab out of the field (once or twice) saves it once?",
    },
    {
      ask = "The same in Edge, and in Firefox (its calendar is its own): a day chosen in the calendar is saved at once,"
        .. " a typed one when the field is left?",
    },
    {
      ask = "A start after the due day, chosen in the calendar: the engine refuses it, the toast says why, and the"
        .. " field shows the start of the task again (not the refused day)?",
    },
  },
}
