-- The tab Lists in the page, against a hub with a vault and the real engine (the app `levels-hub` of .testing.lua, its
-- vault has no list yet), step by step:
--   testing sheets step lists --headed
-- The first line typed makes the first list; a #word is a tag; the newest entry is on top; a tick; the filter of the
-- engine (only the open ones); an entry made a task of an area; the done ones deleted in one step. The steps go by the
-- data attributes of the view, not by its words: the page speaks the language of the browser. The same in a DOM is
-- ui/src/views/ListsView.dom.test.ts, the real hub with axe ui/e2e/lists.spec.ts, the page without a hub
-- ui/e2e-web/lists.spec.ts. A real microphone, a real clipboard and the installed window stay in the hand run
-- tasks-desktop/abnahme-reiter-listen-von-hand (lists-live.sheet.lua).

local LINE = "[data-lists-line]"

--- The line of the field set as typed (the page reads the `input` event), as a step's expression.
---@param text string
---@return string
local function typed(text)
  return "(() => { const i = document.querySelector('"
    .. LINE
    .. "'); i.value = '"
    .. text
    .. "'; i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()"
end

--- The titles of the entries shown, top first, apart by `|`.
local TITLES =
  "[...document.querySelectorAll('[data-entry] [data-entry-open]')].map((b) => b.textContent.trim()).join('|')"

return {
  id = "tasks.lists",
  feature = "tasks.lists",
  task = "tasks-desktop/reiter-checklist-mehrere-listen-mit-filter-und-export",
  title = "tasks-desktop: the tab Lists (the first list with the first line, a #tag, newest on top, a tick, the filter, an entry made a task, the done ones deleted)",
  engine = "browser",
  app = "levels-hub",
  sizes = { { cols = 1200, rows = 900 } },
  steps = {
    { open = "${link}&view=lists", note = "the link of the hub, straight to the tab Lists" },
    {
      wait = "document.querySelector('"
        .. LINE
        .. "') !== null && !document.querySelector('"
        .. LINE
        .. "').disabled",
      timeout = 20000,
      note = "paired: the field of a new entry can be typed into",
    },
    {
      expect = "document.querySelector('[data-lists-none]') !== null",
      note = "a vault without a list says so",
    },
    { expect = typed("Sheet first line #sheettag"), note = "a line with a #word" },
    { focus = LINE },
    { press = "Enter", note = "Enter sends the form" },
    {
      wait = "document.querySelector('[data-entry-tag=sheettag]') !== null",
      timeout = 15000,
      note = "the entry is there, its #word a tag and no longer in its title",
    },
    {
      expect = "document.querySelector('[data-lists-choose]').value.startsWith('_list-') && "
        .. TITLES
        .. " === 'Sheet first line'",
      note = "the first list was made with the first line",
    },
    { expect = typed("Sheet second line") },
    { focus = LINE },
    { press = "Enter" },
    {
      wait = TITLES .. " === 'Sheet second line|Sheet first line'",
      timeout = 15000,
      note = "the newest entry is on top",
    },
    { click = "[data-entry]:first-child [data-entry-done]", note = "the newest one ticked" },
    {
      wait = "document.querySelector('[data-entry]:first-child').classList.contains('done')",
      timeout = 15000,
    },
    {
      expect = "(() => { const s = document.querySelector('[data-lists-state]'); s.value = 'open';"
        .. " s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()",
      note = "only the open ones",
    },
    { wait = TITLES .. " === 'Sheet first line'", timeout = 15000, note = "the engine's filter" },
    { shot = "filtered" },
    { click = "[data-lists-reset]", note = "all again" },
    { wait = "document.querySelectorAll('[data-entry]').length === 2", timeout = 15000 },
    { click = "[data-entry]:last-child [data-entry-open]", note = "the older entry opened" },
    { wait = "document.querySelector('[data-entry-area]') !== null", timeout = 5000 },
    {
      expect = "(() => { const s = document.querySelector('[data-entry-area]'); s.value = 'lib.nvim';"
        .. " s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()",
      note = "the area of the task",
    },
    { click = "[data-entry-promote]", note = "made a task" },
    {
      wait = TITLES .. " === 'Sheet second line'",
      timeout = 15000,
      note = "the entry is gone: it is a task now",
    },
    { click = "[data-lists-clear-done]", note = "the done ones deleted in one step" },
    {
      wait = "document.querySelector('[data-lists-empty]') !== null",
      timeout = 15000,
      note = "the list is empty",
    },
    { shot = "empty" },
  },
  judge = {
    "the field of a new entry reads as the place to type, its button beside it",
    "the filter reads as one row above the entries, in light and dark",
    "an empty list says so without looking like an error",
  },
}
