-- The hand check of making meetings: only what no test sees, the system's browser and the program a join link starts,
-- the clipboard of the system, the camera, the microphone and the screen of the machine, and how both themes look.
-- What a machine checks runs elsewhere: TESTS/sheets/meetings-make.sheet.lua (the quick line of the palette, nothing
-- written before Create, the cover, a recording, a document, a meeting that is over ticked and done, each read back
-- from the file), ui/e2e (the form and the page against the real hub and engine, with axe), ui/e2e-web,
-- ui/src/views/MeetingPage.dom.test.ts (the tab by the clock), ui/src/lib/meetings*.test.ts, crates/tasks-hub
-- (meeting_parse, uploads) and crates/hub-testkit (real_meetings.rs, devices.rs). Only on a private machine: the
-- installed app is not for the workstation.
--   testing sheets step meetings-make-live
return {
  id = "tasks-desktop.meetings-make-live",
  title = "Making meetings by hand: the system's browser, the clipboard, camera and microphone, both themes",
  task = "tasks-desktop/abnahme-meetings-anlegen",
  engine = "manual",
  steps = {
    {
      ask = "In the form of a new meeting a Teams link typed in shows the sign 'Teams'; Open opens it in the system's"
        .. " browser (Teams takes it over), Copy puts it on the clipboard of the system?",
    },
    {
      ask = "The attach bar of a meeting with the machine's hardware: a video recorded (camera and microphone asked"
        .. " for), a photo, a screenshot of a window; each lands in the meeting's folder?",
    },
    {
      ask = "Light and dark: the form and the meeting page read well; German and English with no key in the text?",
    },
  },
}
