-- The hand check of the minutes of a meeting (the minutes, the result tab, the "Follow up" tile): what no test sees is
-- a real meeting typed along, two real devices at once, a real webcam and microphone, the Tauri window and both
-- themes. What a machine checks runs elsewhere: ui/e2e/app.spec.ts (minutes against the real engine: lines,
-- shortcuts, a draft over a reload, a follow-up task from a line), ui/src/lib/minutes.test.ts, the DOM tests of
-- MeetingMinutes.svelte and MeetingReview.svelte, and the device matrix in crates/hub-testkit/tests/devices.rs. Only on
-- a private machine: the installed app is not for the workstation.
--   testing sheets step meeting-minutes-live
return {
  id = "tasks-desktop.meeting-minutes-live",
  title = "Meeting minutes by hand: a real meeting, two devices, webcam and microphone, the follow-up tile",
  task = "tasks-desktop/abnahme-protokoll-und-folge-kachel-im-echten-hub-zwei-geraet",
  engine = "manual",
  steps = {
    {
      ask = "Typed along in a real meeting for about 15 minutes: the shortcuts for decision, question and task go"
        .. " smoothly, no line is lost, and the file has every line with its time?",
    },
    {
      ask = "Two devices at once (the window on the PC and the phone page): both write into the same minutes, no line"
        .. " twice or lost, each device sees the lines of the other?",
    },
    {
      ask = "The network off for a moment while typing: the draft stays, goes out by itself within 15 s once the hub is"
        .. " back, and nothing is doubled?",
    },
    {
      ask = "A webcam photo and a voice note from the microphone attached to the meeting: they stand under Documents,"
        .. " and picture and sound open?",
    },
    {
      ask = "The result tab: follow-up tasks made from lines, a result text and a link to the recording; the file"
        .. " holds all of it afterwards?",
    },
    {
      ask = "The 'Follow up' tile on Today shows the past meeting; 'Done' and 'Later' do what they say, and a done"
        .. " meeting does not come back?",
    },
    {
      ask = "The Tauri window, light and dark, German and English: everything reads well, no key in the text?",
    },
  },
}
