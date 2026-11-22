-- The figures of the tab Lernpläne in the page against a hub with a vault and the real engine (the app
-- `learn-figures-hub` of .testing.lua: a copy of the fixture vault in a folder of the run with a running path and the
-- rows of the series of the learning figures of tools/sheet-learn-figures-vault.mjs: started eight days ago, 2 learned
-- a week ago, 5 today), step by step:
--   testing sheets step learn-figures --headed
-- The overview: the period Today by its radio, the points learned today against yesterday with the mark and the words,
-- the bars of the week as a table. The steps go by data attributes and values, not by words: the page speaks the
-- language of the browser. The browser test ui/e2e/learn-figures.spec.ts checks the same against the test hub of the
-- e2e run, with axe in both themes and a narrow window; what only eyes and ears show stays in the hand run
-- tasks-desktop/abnahme-reiter-lernplaene-und-ansichten-von-hand.

local function fig(name)
  return '[data-fig="' .. name .. '"]'
end
local function text_of(sel)
  return "(document.querySelector('" .. sel .. "')?.textContent ?? '')"
end

return {
  id = "tasks.learn-figures",
  feature = "tasks.learn-figures",
  task = "tasks-desktop/lern-uebersicht-start-des-reiters-mit-zeitraum-kachel",
  title = "tasks-desktop: the overview of the tab Lernpläne (period by radios, figures against the period before, bars as a table)",
  engine = "browser",
  app = "learn-figures-hub",
  sizes = { { cols = 1300, rows = 900 } },
  steps = {
    {
      open = "${link}&view=learn",
      note = "the link of the hub, straight to the overview",
    },
    {
      wait = "document.querySelector('" .. fig("learned") .. "') !== null",
      timeout = 20000,
      note = "paired, the figures of the series are drawn",
    },
    { click = 'input[name="learn-period"][value="day"]', note = "the period Today" },
    {
      wait = text_of(fig("learned") .. " dd.big") .. " === '3'",
      timeout = 10000,
      note = "3 points learned today (5 now, 2 at the row before)",
    },
    {
      expect = text_of(fig("learned") .. ' dd.cmp [aria-hidden="true"]') .. " === '▲'",
      note = "more than yesterday: the mark up, a picture only",
    },
    {
      expect = text_of(fig("learned") .. " dd.cmp") .. ".includes('+3')",
      note = "and in words: +3 against yesterday",
    },
    {
      expect = text_of(fig("xp") .. " dd.big") .. " === '30'",
      note = "30 XP today",
    },
    { shot = "overview", note = "the tile My learning with the bars of the week" },
    { click = 'button[aria-controls="learn-bars-table"]', note = "as table" },
    {
      wait = "document.querySelectorAll('#learn-bars-table:not(.sr-only) tbody tr').length === 7",
      note = "a row per day of the week up to today",
    },
    {
      expect = "document.querySelector('.learn .chart') === null",
      note = "the table instead of the drawing",
    },
    {
      expect = "document.querySelector('ul.running li[data-path=\"lib.nvim/learn-sheet-figures\"] progress')?.value === 63",
      note = "the running path: 5 of 8 points",
    },
    { shot = "overview-table", note = "the bars as a table" },
  },
}
