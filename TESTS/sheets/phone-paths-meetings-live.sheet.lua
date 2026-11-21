-- The hand check of learning paths and meetings on the phone page: what no test sees is the real phone with the real
-- hub, 'Join' opening the Teams or Zoom app, a real finger, TalkBack and reading outside. What a machine checks runs
-- elsewhere: ui/e2e/mobile.spec.ts (a path ticked and a minutes line written on a paired phone, Chrome at phone size,
-- the real engine), paths.spec.ts and meetings.spec.ts in tasks-mobile, and the cut per field in
-- crates/hub-testkit/tests/devices.rs; the same on the real device follows as
-- tasks-desktop/geraete-e2e-lernpfad-abhaken-und-meeting-mitschrift-am-echte. Only on a private machine.
--   testing sheets step phone-paths-meetings-live
return {
  id = "tasks-desktop.phone-paths-meetings-live",
  title = "Learning paths and meetings on the real phone: Join, a finger, TalkBack, reading outside",
  task = "tasks-desktop/abnahme-lernpfade-und-meetings-am-echten-handy-beitreten-fin",
  engine = "manual",
  steps = {
    {
      ask = "Learning paths: the list with its progress; a point ticked with a finger and opened again; the file on"
        .. " the PC shows it?",
    },
    {
      ask = "A learning path of an area that is not released for the phone does not show?",
    },
    {
      ask = "Meetings: the list of the next two weeks; 'Join' of a meeting with a Teams link opens the Teams app, of"
        .. " one with a Zoom link the Zoom app, not the browser?",
    },
    {
      ask = "Minutes on the phone (text, task, decision, question): the lines arrive on the PC?",
    },
    {
      ask = "An internal meeting shows no participants and no links while meetings.internal_links and"
        .. " meetings.internal_people are off?",
    },
    {
      ask = "With TalkBack: points, states and buttons are read sensibly, and the focus stays on the point after"
        .. " ticking it?",
    },
    {
      ask = "Targets are big enough for a thumb, and light and dark read well outside in the sun?",
    },
  },
}
