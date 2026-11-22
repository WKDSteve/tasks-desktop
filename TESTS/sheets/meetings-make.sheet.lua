-- Making meetings in the page against a hub with a vault and the real engine (the app `meetings-hub` of .testing.lua:
-- a copy of the fixture vault in a folder of the run, with one meeting of lib.nvim/alpha that is over), step by step:
--   testing sheets step meetings-make --headed
-- The steps go by ids and data attributes, not by words: the page speaks the language of the browser. What a file holds
-- is read through the hub (`/api/tasks/meetings`, `/api/tasks/meeting`, with the session of the page), which reads it
-- with the engine. Files are handed to the pickers of the page as a browser would (a DataTransfer), not from a disk.
-- ui/e2e/app.spec.ts ("a meeting: made from the detail of a task ...") checks the form and the page with axe; what only
-- the machine shows (the system's browser for a join link, the system clipboard, camera, microphone and screen, both
-- themes) stays in the hand run TESTS/sheets/meetings-make-live.sheet.lua.

local AREA = "lib.nvim"
local TASK = AREA .. "/alpha"
local PAST = AREA .. "/sheet-past-meeting"
local TITLE = "Sheet quick m1"
local DAY = "2031-11-24"
local LINE = "24.11.2031 9:30 90m " .. TITLE .. " @Raum_4 #" .. TASK
-- The id the engine gives it: the title and the day (`meeting_new`).
local NEW_ID = AREA .. "/sheet-quick-m1-2031-11-24"

-- An answer of the hub to a read, with the session the page holds (the client sends it as a bearer token); `test` is
-- an expression of `d`, the document.
local function api(path, test)
  return "(async () => { const r = await fetch('/api/tasks/"
    .. path
    .. "', { cache: 'no-store', credentials: 'omit', headers: { Authorization: 'Bearer ' +"
    .. " sessionStorage.getItem('tasks-desktop.session') } }); if (!r.ok) return false; const d = await r.json(); return "
    .. test
    .. "; })()"
end

-- The new meeting of the quick line, by its title, among the meetings of its day.
local NEW = "d.items.find((m) => m.title === '" .. TITLE .. "')"
local function new_meeting(test)
  return api(
    "meetings?area=" .. AREA .. "&since=" .. DAY .. "&until=" .. DAY,
    "((m) => !!m && (" .. test .. "))(" .. NEW .. ")"
  )
end

-- Typing into a field as the page sees it: the value set and the `input` event a key would send (Svelte binds on it).
local function fill(selector, value)
  return "(() => { const e = document.querySelector('"
    .. selector
    .. "'); if (!e) return false; e.value = '"
    .. value
    .. "'; e.dispatchEvent(new Event('input', { bubbles: true })); return e.value === '"
    .. value
    .. "'; })()"
end

-- A file handed to a file input as a browser hands a chosen one (one PNG pixel, or a few bytes of a recording).
local PIXEL =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
local function pick(selector, name, kind)
  local bytes = kind == "image/png"
      and ("Uint8Array.from(atob('" .. PIXEL .. "'), (c) => c.charCodeAt(0))")
    or "new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112])"
  return "(() => { const i = document.querySelector('"
    .. selector
    .. "'); if (!i) return false; const t = new DataTransfer(); t.items.add(new File(["
    .. bytes
    .. "], '"
    .. name
    .. "', { type: '"
    .. kind
    .. "' })); i.files = t.files; i.dispatchEvent(new Event('change', { bubbles: true })); return true; })()"
end

local FORM = "dialog.meeting-form[open]"
local PAGE = "dialog.meeting-page[open]"
local IDLE = "document.querySelector('"
  .. PAGE
  .. ' button[data-attach="file"]\')?.disabled === false'

return {
  id = "tasks.meetings-make",
  feature = "tasks.meetings-make",
  task = "tasks-desktop/meetings-anlegen",
  title = "tasks-desktop: a meeting from a quick line of the palette, its cover, recording and documents, a meeting that is over ticked and done",
  engine = "browser",
  app = "meetings-hub",
  sizes = { { cols = 1200, rows = 900 } },
  steps = {
    { open = "${link}&view=list", note = "the link of the hub" },
    {
      wait = "document.querySelector('[role=menubar]') !== null",
      timeout = 20000,
      note = "paired, the page is there",
    },
    {
      wait = "document.querySelector('.rows')?.textContent.includes('" .. TASK .. "') === true",
      timeout = 20000,
      note = "the list is read: the keys of the page are live",
    },

    -- the quick line: read by the engine into the form, nothing written yet
    { press = "Control+k", note = "the command palette" },
    {
      wait = "document.querySelector('dialog[open] input[role=combobox]') !== null",
      timeout = 10000,
    },
    { expect = fill("dialog[open] input[role=combobox]", LINE) },
    {
      wait = "document.querySelector('#palette-list li[role=option]:last-child')?.textContent.includes('"
        .. TITLE
        .. "')",
      timeout = 5000,
      note = "the line is offered as a meeting, last",
    },
    { click = "#palette-list li[role=option]:last-child", note = "'Meeting from the line: ...'" },
    {
      wait = "document.querySelector('"
        .. FORM
        .. " [data-meeting-title]')?.value === '"
        .. TITLE
        .. "'",
      timeout = 15000,
      note = "the form opens with the title the engine read",
    },
    {
      expect = "document.querySelector('"
        .. FORM
        .. " input[type=date]')?.value === '"
        .. DAY
        .. "'",
      note = "and its day",
    },
    {
      expect = api(
        "meetings?area=" .. AREA .. "&since=" .. DAY .. "&until=" .. DAY,
        "d.items.length === 0"
      ),
      note = "the vault has no meeting of that day yet: a proposal writes nothing",
    },

    -- a picture to attach once it is made, as its cover
    {
      expect = pick(FORM .. " input[type=file]", "sheet-cover.png", "image/png"),
      note = "a picture chosen",
    },
    {
      wait = "document.querySelector('" .. FORM .. " [data-cover-first]')?.checked === true",
      note = "'first image as cover' is offered and ticked",
    },
    {
      wait = "document.querySelector('" .. FORM .. " [data-meeting-create]')?.disabled === false",
      timeout = 15000,
      note = "the dry run of the engine names the meeting",
    },
    { shot = "form" },
    { click = FORM .. " [data-meeting-create]", note = "Create" },
    {
      wait = "document.querySelector('"
        .. FORM
        .. "') === null && document.querySelector('"
        .. PAGE
        .. "') !== null",
      timeout = 20000,
      note = "the form closes, the page of the new meeting opens",
    },
    {
      wait = new_meeting(
        "m.cover === 'assets/images/sheet-cover.png' && m.tasks.includes('" .. TASK .. "')"
      ),
      timeout = 20000,
      note = "the file: its task, the picture as cover:",
    },
    {
      expect = new_meeting("m.id === '" .. NEW_ID .. "'"),
      note = "named by its title and its day",
    },
    {
      expect = new_meeting(
        "m.location === 'Raum 4' && m.time === '09:30' && m.duration_min === 90"
      ),
      note = "place, beginning and length from the line",
    },
    {
      expect = "document.querySelector('#meeting-tab-prep')?.getAttribute('aria-selected') === 'true'",
      note = "a meeting to come opens on the preparation",
    },
    { wait = IDLE, timeout = 15000, note = "nothing on its way" },

    -- a recording and a second picture into its folder, that one as the cover
    {
      expect = pick(PAGE .. " [data-audio-picker]", "sheet-note.m4a", "audio/mp4"),
      note = "Audio: a recording",
    },
    {
      wait = api(
        "meeting?id=" .. NEW_ID,
        "(d.meeting.assets ?? []).includes('assets/audio/sheet-note.m4a')"
      ),
      timeout = 20000,
      note = "it is in assets/audio/ of the meeting",
    },
    { wait = IDLE, timeout = 15000 },
    {
      expect = pick(PAGE .. " [data-image-picker]", "sheet-second.png", "image/png"),
      note = "Image: a second picture",
    },
    {
      wait = "document.querySelector('"
        .. PAGE
        .. ' [data-cover-use="assets/images/sheet-second.png"]\') !== null',
      timeout = 20000,
      note = "it is offered as the cover",
    },
    {
      click = PAGE .. ' [data-cover-use="assets/images/sheet-second.png"]',
      note = "'Use as cover'",
    },
    {
      wait = new_meeting("m.cover === 'assets/images/sheet-second.png'"),
      timeout = 15000,
      note = "cover: names the second picture",
    },

    -- a document: a line of ## Unterlagen
    {
      wait = "document.querySelector('" .. PAGE .. " form[data-document-add] input') !== null",
      timeout = 10000,
    },
    { expect = fill(PAGE .. " form[data-document-add] input", "https://example.org/sheet-doc") },
    { click = PAGE .. " form[data-document-add] button[type=submit]", note = "'Add'" },
    {
      wait = api(
        "meeting?id=" .. NEW_ID,
        "d.documents.some((doc) => doc.href === 'https://example.org/sheet-doc')"
      ),
      timeout = 15000,
      note = "the address is one of its documents",
    },
    { shot = "page" },

    -- the task names both meetings; the one that is over opens on its result
    {
      click = PAGE .. " section[aria-labelledby=meeting-tasks] button.link",
      note = "its task: the page closes, the task's detail opens",
    },
    {
      wait = "document.querySelector('[data-meeting=\""
        .. PAST
        .. "\"]') !== null"
        .. " && [...document.querySelectorAll('[data-meeting]')].some((b) => b.textContent.includes('"
        .. TITLE
        .. "'))",
      timeout = 20000,
      note = "the section Meetings of the task lists the new one and the one that is over",
    },
    { click = '[data-meeting="' .. PAST .. '"]', note = "the meeting that is over" },
    {
      wait = "document.querySelector('#meeting-tab-result')?.getAttribute('aria-selected') === 'true'",
      timeout = 15000,
      note = "it opens on its result",
    },
    { click = "#meeting-tab-prep", note = "Preparation, reached at any time" },
    {
      wait = "document.querySelector('" .. PAGE .. ' [data-agenda="1"]\') !== null',
      timeout = 10000,
    },
    { click = PAGE .. ' [data-agenda="1"]', note = "the agenda item ticked" },
    {
      wait = api("meeting?id=" .. PAST, "d.agenda[0]?.ticked === true"),
      timeout = 15000,
      note = "- [x] in ## Agenda",
    },
    {
      wait = "document.querySelector('"
        .. PAGE
        .. ' [data-present="1"]\')?.checked === false'
        .. " && document.querySelector('"
        .. PAGE
        .. ' [data-agenda="1"]\')?.checked === true',
      timeout = 15000,
      note = "the page read it again",
    },
    { click = PAGE .. ' [data-present="1"]', note = "Rick ticked as present" },
    {
      wait = api("meeting?id=" .. PAST, "d.participants[0]?.present === true"),
      timeout = 15000,
      note = "present in ## Teilnehmer",
    },
    { click = "#meeting-tab-result" },
    {
      wait = "document.querySelector('" .. PAGE .. " [data-meeting-close]')?.disabled === false",
      timeout = 15000,
    },
    { click = PAGE .. " [data-meeting-close]", note = "'Mark as done'" },
    {
      wait = api("meeting?id=" .. PAST, "d.meeting.status === 'done'"),
      timeout = 15000,
      note = "status: done, without a result (allowed)",
    },
    {
      wait = "document.querySelector('" .. PAGE .. " [data-meeting-close]') === null",
      timeout = 15000,
      note = "nothing more to finish",
    },
  },
  judge = {
    "the form reads as two columns that fit the window: the time and place on the left, the people and the rest on the right",
    "the meeting page shows its time, place and status in its head, and the tabs as tabs",
  },
}
