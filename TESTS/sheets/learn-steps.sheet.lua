-- Three views of the tab Lernpläne in the page against a hub with a vault and the real engine (the app `learn-steps-hub` of
-- .testing.lua: a copy of the fixture vault in a folder of the run with the paths of tools/sheet-learn-steps-vault.mjs), step
-- by step:
--   testing sheets step learn-steps --headed
-- Next learning step: a card per running path, the machine filter, the keys of a card (l marks its point, the engine
-- names the next), the safety question before a {safety} point is closed (cancel, then yes). Learning time: the
-- overrun beside the bar, the sessions of a path. Notes & sources: / finds the search, the engine's hit is marked, a hit
-- opens its point in the path. One size: the code of the link pairs once per app; the narrow window (the learning
-- time draws its rows as cards) is checked by the browser test with axe.
-- The steps go by data attributes, not by words: the page speaks the language of the browser. The browser test
-- ui/e2e/learn-steps.spec.ts checks the same against the test hub of the e2e run, with axe in both themes; what only
-- eyes and ears show stays in the hand run tasks-desktop/abnahme-reiter-lernplaene-und-ansichten-von-hand.

local A = "lib.nvim"
local OS = A .. "/learn-sheet-os"
local SHELL = A .. "/learn-sheet-shell"
local function card(id)
  return 'article[data-path="' .. id .. '"]'
end
local function row(id)
  return 'tr[data-path="' .. id .. '"]'
end
local function point_of(id, value)
  return "document.querySelector('" .. card(id) .. "')?.dataset.point === '" .. value .. "'"
end
-- the machine filter is a <select>; a sheet has no step to choose in one, so the expression chooses as a person would
local function machine(value)
  return "(() => { const s = [...document.querySelectorAll('.learnnext select')].at(-1); s.value = '"
    .. value
    .. "'; s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()"
end

return {
  id = "tasks.learn-steps",
  feature = "tasks.learn-steps",
  task = "tasks-desktop/naechster-lernschritt-ueber-alle-laufenden-pfade",
  title = "tasks-desktop: next learning step, learning time, notes & sources (cards, keys, safety question, machine filter; hours and sessions; search, hit, jump to the point)",
  engine = "browser",
  app = "learn-steps-hub",
  sizes = { { cols = 1300, rows = 900 } },
  steps = {
    -- next learning step
    {
      open = "${link}&view=learnnext",
      note = "the link of the hub, straight to the next learning step",
    },
    {
      wait = "document.querySelector('" .. card(OS) .. "') !== null",
      timeout = 20000,
      note = "paired, the cards are drawn",
    },
    {
      expect = point_of(OS, "fork"),
      note = "the engine's next point of the OS path: the first open leaf",
    },
    {
      expect = "document.querySelectorAll('" .. card(OS) .. " details.after li').length === 2",
      note = "the two after it, folded below (the driver among them)",
    },
    { expect = machine("workstation"), note = "machine: workstation" },
    {
      wait = "!(document.querySelector('"
        .. card(OS)
        .. " details.after')?.textContent ?? '').includes('Load a driver')",
      timeout = 10000,
      note = "the driver is for the private machine only: the engine leaves it out (and names the page tables instead)",
    },
    { expect = machine(""), note = "every machine again" },
    {
      wait = "(document.querySelector('"
        .. card(OS)
        .. " details.after')?.textContent ?? '').includes('Load a driver')",
      timeout = 10000,
    },
    { shot = "next", note = "the cards" },

    { focus = card(OS), note = "the OS card holds the focus" },
    { press = "l", note = "l: learned" },
    {
      wait = point_of(OS, "exec"),
      timeout = 15000,
      note = "written; the engine names the next point",
    },

    {
      click = card(SHELL) .. " footer button.primary",
      note = "'Learned' on the safety point of the shell path",
    },
    {
      wait = "document.querySelector('" .. card(SHELL) .. " .ask') !== null",
      note = "the safety question",
    },
    {
      expect = "document.activeElement?.classList.contains('confirm-no') === true",
      note = "Cancel holds the focus",
    },
    { press = "Enter", note = "cancel" },
    {
      wait = "document.querySelector('" .. card(SHELL) .. " .ask') === null",
      note = "nothing written, the card stays",
    },
    { expect = point_of(SHELL, "quoting") },
    { click = card(SHELL) .. " footer button.primary" },
    { wait = "document.querySelector('" .. card(SHELL) .. " .ask button.primary') !== null" },
    { click = card(SHELL) .. " .ask button.primary", note = "yes: sent with ack" },
    {
      wait = "document.querySelector('" .. card(SHELL) .. "') === null",
      timeout = 15000,
      note = "the shell path has nothing left to learn: its card goes",
    },

    -- learning time
    {
      expect = "(() => { location.hash = '#view=learntime'; return true; })()",
      note = "the learning time, in the same page (the code of the link pairs once)",
    },
    { wait = "document.querySelector('" .. row(SHELL) .. "') !== null", timeout = 20000 },
    {
      expect = "document.querySelector('"
        .. row(SHELL)
        .. " .overrun')?.textContent.includes('+3') === true",
      note = "5 h done of 2 planned: +3 h, in words beside the bar",
    },
    { click = row(OS) .. " button.fold", note = "unfold the sessions of the OS path" },
    {
      wait = "document.querySelectorAll('table.sessions tbody tr').length === 2",
      timeout = 10000,
      note = "week 1 and the page tables: the points with planned hours one level below a root",
    },
    { shot = "time", note = "the table, the bars, the sessions" },

    -- notes & sources
    {
      expect = "(() => { location.hash = '#view=learnnotes'; return true; })()",
      note = "notes & sources, in the same page (the code of the link pairs once)",
    },
    { wait = "document.querySelector('ul.hits') !== null", timeout = 20000 },
    { blur = true },
    { press = "/", note = "/ finds the search" },
    { expect = "document.activeElement?.type === 'search'" },
    { press = "p" },
    { press = "i" },
    { press = "p" },
    { press = "e" },
    { press = "f" },
    { press = "a" },
    { press = "i" },
    { press = "l" },
    { press = "Enter", note = "'pipefail': the engine searches" },
    {
      wait = "document.querySelectorAll('ul.hits > li').length === 1 && document.querySelector('ul.hits mark')?.textContent === 'pipefail'",
      timeout = 10000,
      note = "one hit, marked",
    },
    { shot = "notes", note = "the hit" },
    { click = "ul.hits button.open", note = "open the hit in its path" },
    {
      wait = "document.activeElement?.closest('li[data-point]')?.dataset.point === 'quoting'",
      timeout = 10000,
      note = "the view of the paths, the point in sight and focused",
    },
  },
  judge = {
    "a card names its path, its point, the stage and the hours; a safety point says so in a word beside the sign",
    "in the learning time an overrun reads as '+3 h' in the warning colour, and the bar is not the only hint",
    "the hit of the search is marked and readable in the light theme",
  },
}
