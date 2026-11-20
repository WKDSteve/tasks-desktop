-- The hand check of making meetings: what no test sees is the system's browser and the program a join link starts,
-- the clipboard of the system, the camera, the microphone and the screen of the machine, and how both themes look.
-- What a machine checks runs elsewhere: ui/e2e (the form, the quick line of the palette, the meeting page against
-- the real hub and engine), ui/e2e-web, ui/src/views/MeetingPage.dom.test.ts, ui/src/lib/meetings*.test.ts,
-- crates/tasks-hub (meeting_parse, uploads) and crates/hub-testkit (real_meetings.rs, devices.rs). Only on a private
-- machine: the installed app is not for the workstation.
--   testing sheets step meetings-make-live
return {
  id = "tasks-desktop.meetings-make-live",
  title = "Making meetings by hand: the system's browser, the clipboard, camera and microphone, both themes",
  task = "tasks-desktop/abnahme-meetings-anlegen",
  engine = "manual",
  steps = {
    {
      ask = "In a task's detail 'New meeting': the form has the task filled in; a Teams link typed in shows the sign"
        .. " 'Teams', Open opens it in the system's browser (Teams takes it over), Copy puts it on the clipboard?",
    },
    {
      ask = "Ctrl+K, a line like 'Mo 14:00-15:00 Sync #<task-id> !-15m', 'Meeting from the line': the form is filled"
        .. " in and the vault has no file yet; only Create writes <area>/MEETINGS/<slug>.md?",
    },
    {
      ask = "With a picture under 'Attach once it is made' and 'first image as cover' ticked: the meeting has cover: on"
        .. " the picture, and its page shows it?",
    },
    {
      ask = "The meeting page opens on the tab the clock says (before: Preparation, from 15 minutes before: In the"
        .. " meeting, after: Result); agenda ticked, presence ticked, a document (link) added, 'Mark as done': the file"
        .. " shows each?",
    },
    {
      ask = "The attach bar of a meeting: a file, a video recorded, a photo, a screenshot, audio (assets/audio/); 'Use"
        .. " as cover' changes the picture?",
    },
    {
      ask = "Light and dark: form and page read well, no colour outside the tokens; German and English with no key in"
        .. " the text?",
    },
  },
}
