-- The form of the levels of a learning path in the page against a hub with a vault and the real engine (the app
-- `levels-hub` of .testing.lua: a copy of the fixture vault in a folder of the run, the path of
-- tools/sheet-levels-vault.mjs with one point learned at 60 XP and one promoted to a task with `xp: 10`), step by step:
--   testing sheets step path-levels --headed
-- The steps go by ids and data attributes, not by words: the page speaks the language of the browser. What a file holds
-- is read through the hub (`/api/tasks/path`, `/api/tasks/task`, with the session of the page), which reads it with
-- the engine: the body of the path is the text after its frontmatter as it stands on the disk.
-- The browser test ui/e2e/paths.spec.ts ("levels set in a form") checks the same against the test hub of the e2e run,
-- with axe; what only eyes and the installed window show (both themes, a screen reader, the badge as a picture) stays
-- in the hand run tasks-desktop/abnahme-level-und-belohnungen-eines-lernpfads-im-echten.

local PATH = "lib.nvim/levels-sheet"
local TASK = "lib.nvim/levels-sheet-task"

-- An answer of the hub to a read, with the session the page holds (the client sends it as a bearer token).
local function read(api, id, test)
  return "(async () => { const r = await fetch('/api/tasks/"
    .. api
    .. "?id="
    .. id
    .. "', { cache: 'no-store', credentials: 'omit', headers: { Authorization: 'Bearer ' +"
    .. " sessionStorage.getItem('tasks-desktop.session') } }); if (!r.ok) return false; const d = await r.json(); return "
    .. test
    .. "; })()"
end

-- Typing into a field as the page sees it: the value set and the `input` event a key would send (Svelte binds on it).
local function fill(selector, value)
  return "(() => { const e = document.querySelector('"
    .. selector
    .. "'); if (!e) return false; e.value = '"
    .. value
    .. "'; e.dispatchEvent(new Event(e.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); return e.value === '"
    .. value
    .. "'; })()"
end

local FORM = "form[data-levels-form]"
local LEVELS = [[## Level\n\n- [ ] 50 XP · Starter sheet · Badge assets/badges/star.svg · Belohnung: Tea sheet\n]]
  .. [[- [ ] 100 XP\n- [ ] Pfad fertig · Belohnung: Trip sheet\n]]

return {
  id = "tasks.path-levels",
  feature = "tasks.path-levels",
  task = "tasks-desktop/testblatt-lernpfade-das-level-formular-anlegen-fehler-der",
  title = "tasks-desktop: the levels of a learning path set in a form (written, refused by the engine, a badge, the XP of a promoted task)",
  engine = "browser",
  app = "levels-hub",
  sizes = { { cols = 1200, rows = 900 } },
  steps = {
    {
      open = "${link}&view=paths",
      note = "the link of the hub, straight to the view of the learning paths",
    },
    {
      wait = "document.querySelector('button[data-path=\"" .. PATH .. "\"]') !== null",
      timeout = 20000,
      note = "paired, the path of the run is listed",
    },
    { click = 'button[data-path="' .. PATH .. '"]' },
    {
      wait = "document.querySelector('[data-levels-open]') !== null && document.querySelector('li[data-point=\"t\"]') !== null",
      timeout = 10000,
      note = "its tree is shown and the levels can be set (engine capability path_levels)",
    },
    {
      expect = "document.querySelector('p.level') === null",
      note = "no ## Level yet: no level line",
    },
    {
      expect = "document.querySelector('.path p.summary') === null",
      note = "the text starts with its learning points: no summary line (tasks.nvim 93d87f9)",
    },

    -- the form: two levels, a badge of the path's assets/badges/, a reward for the whole path
    { click = "[data-levels-open]", note = "'Set levels and rewards …'" },
    {
      wait = "document.querySelector('" .. FORM .. "') !== null",
      timeout = 10000,
      note = "the form (loaded on demand)",
    },
    { click = FORM .. " > p > button[type=button]", note = "'Add a level'" },
    {
      expect = "document.getElementById('level-threshold-0')?.value === '50'",
      note = "the first level proposes 50",
    },
    {
      expect = "[...document.getElementById('level-badge-0').options].some((o) => o.value === 'assets/badges/star.svg')",
      note = "the badge of the path's assets/badges/ is offered",
    },
    { expect = fill("#level-name-0", "Starter sheet") },
    { expect = fill("#level-badge-0", "assets/badges/star.svg") },
    { expect = fill("#level-reward-0", "Tea sheet") },
    { click = FORM .. " > p > button[type=button]", note = "'Add a level' a second time" },
    {
      expect = "document.getElementById('level-threshold-1')?.value === '100'",
      note = "the next one proposes 100",
    },
    { click = "[data-levels-done]", note = "'A reward when the whole path is done'" },
    { wait = "document.getElementById('level-done-reward') !== null" },
    { expect = fill("#level-done-reward", "Trip sheet") },
    { shot = "form" },
    { click = FORM .. " button[type=submit]", note = "'Save levels': one path_levels" },
    {
      wait = "document.querySelector('" .. FORM .. "') === null",
      timeout = 15000,
      note = "the engine wrote it: the form closes",
    },
    {
      expect = "document.activeElement?.matches('[data-levels-open]')",
      note = "the focus is on 'Edit levels and rewards …', not on the page",
    },
    {
      wait = read("path", PATH, "d.body.includes('" .. LEVELS .. "')"),
      timeout = 15000,
      note = "## Level of the file: both levels, the badge, both rewards, in the engine's words",
    },
    {
      wait = "document.querySelector('p.level')?.dataset.level === '1'"
        .. " && document.querySelector('p.level').textContent.includes('Starter sheet')",
      timeout = 15000,
      note = "60 XP: level 1 reached, by its name",
    },
    {
      wait = "document.querySelector('p.level img.badge') !== null && document.querySelector('[data-badge=\"1\"] img') !== null",
      timeout = 10000,
      note = "its badge beside the level and in the gallery, as a picture",
    },
    { shot = "level-1" },

    -- thresholds that fall: the engine refuses, the file stays, the form stays open with what was typed
    {
      expect = read("path", PATH, "(window.__levelsBefore = d.body, true)"),
      note = "the file as it is now",
    },
    { click = "[data-levels-open]", note = "'Edit levels and rewards …'" },
    {
      wait = "document.getElementById('level-threshold-1')?.value === '100'",
      timeout = 10000,
      note = "filled from the file",
    },
    { expect = "document.getElementById('level-name-0')?.value === 'Starter sheet'" },
    { expect = fill("#level-threshold-1", "40") },
    { click = FORM .. " button[type=submit]", note = "'Save levels' with 50, then 40" },
    {
      wait = "[...document.querySelectorAll('[role=alert]')].some((e) => e.textContent.includes('must rise'))",
      timeout = 15000,
      note = "the engine's reason is shown",
    },
    { expect = "document.querySelector('" .. FORM .. "') !== null", note = "the form stays open" },
    {
      expect = "document.getElementById('level-threshold-1')?.value === '40'",
      note = "with what was typed",
    },
    {
      expect = read("path", PATH, "d.body === window.__levelsBefore"),
      note = "the file is unchanged",
    },
    { shot = "refused" },
    { click = FORM .. " .buttons button[type=button]", note = "Cancel" },
    {
      wait = "document.querySelector('" .. FORM .. "') === null",
      note = "the form closes, nothing written",
    },
    {
      expect = "document.activeElement?.matches('[data-levels-open]')",
      note = "the focus is back on the button that opened it",
    },
    { expect = read("path", PATH, "d.body === window.__levelsBefore") },

    -- the XP of the promoted task: xp: of the task, through set
    {
      expect = "document.querySelector('li[data-point=\"t\"] .xp-point')?.dataset.xp === '10'",
      note = "the promoted point counts the task's 10 XP",
    },
    { click = 'li[data-point="t"] [data-choice="point"] summary', note = "the point's menu" },
    {
      click = 'li[data-point="t"] button[data-choice-id="task_xp"]',
      note = "'XP of the task …'",
    },
    {
      wait = "document.activeElement?.id?.startsWith('task-xp-') && document.activeElement.value === '10'",
      note = "the field has the focus and the task's XP",
    },
    { expect = fill('li[data-point="t"] input[id^=task-xp-]', "25") },
    { press = "Enter", note = "saved with Enter" },
    {
      wait = read("task", TASK, "d.task.xp === 25"),
      timeout = 15000,
      note = "xp: 25 in the task's file (set), not in the path",
    },
    {
      wait = "document.querySelector('li[data-point=\"t\"] .xp-point')?.dataset.xp === '25'",
      timeout = 15000,
      note = "the point counts 25 XP from the task",
    },
    {
      expect = "document.activeElement?.closest('li[data-point=\"t\"]') !== null",
      note = "the focus is back on the point, not on the page",
    },
    {
      expect = read("path", PATH, "!d.body.includes('xp=25')"),
      note = "the path itself is not written",
    },

    -- Undo in the toast: the levels as they were before the last save
    {
      expect = read("path", PATH, "(window.__levelsBefore = d.body, true)"),
      note = "the levels as they are",
    },
    { click = "[data-levels-open]", note = "'Edit levels and rewards …'" },
    {
      wait = "document.getElementById('level-name-0')?.value === 'Starter sheet'",
      timeout = 10000,
    },
    { expect = fill("#level-name-0", "Master sheet") },
    { click = FORM .. " button[type=submit]", note = "'Save levels' with the new name" },
    {
      wait = read("path", PATH, "d.body.includes('50 XP · Master sheet ·')"),
      timeout = 15000,
      note = "the new name is in ## Level",
    },
    {
      wait = "document.querySelector('.toast button:not(.close)') !== null && document.querySelector('"
        .. FORM
        .. "') === null",
      timeout = 15000,
      note = "the toast of the save offers Undo",
    },
    { click = ".toast button:not(.close)", note = "Undo" },
    {
      wait = read("path", PATH, "d.body === window.__levelsBefore"),
      timeout = 15000,
      note = "the file has the old levels again, byte for byte",
    },
    {
      wait = "document.querySelector('p.level')?.textContent.includes('Starter sheet')",
      timeout = 15000,
      note = "and the view the old name of level 1",
    },
  },
  judge = {
    "the form reads as one level per row: threshold, name, badge and reward side by side, and fits the window",
    "the engine's reason is visible beside the form, in light and dark",
    "the badge beside the level and in the gallery is the star of the path",
  },
}
