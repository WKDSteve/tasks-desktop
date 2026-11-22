-- The figures of the tab Lernpläne in the page against a hub with a vault and the real engine (the app
-- `learn-figures-hub` of .testing.lua: a copy of the fixture vault in a folder of the run with a running path and the
-- rows of the series of the learning figures of tools/sheet-learn-figures-vault.mjs: started eight days ago, 2 learned
-- a week ago, 5 today), step by step:
--   testing sheets step learn-figures --headed
-- The overview: the period Today by its radio, the points learned today against yesterday with the mark and the words,
-- the bars of the week as a table. The statistics: two days of one's own (eight days back to today), the row of the
-- path (5 learned, 50 XP, 2.5 h), the calendar of the learning days as a table. The steps go by data attributes and
-- values, not by words: the page speaks the language of the browser. The browser test ui/e2e/learn-figures.spec.ts checks the same against the test hub of the
-- e2e run, with axe in both themes and a narrow window; what only eyes and ears show stays in the hand run
-- tasks-desktop/abnahme-reiter-lernplaene-und-ansichten-von-hand.

local function fig(name)
  return '[data-fig="' .. name .. '"]'
end
local function text_of(sel)
  return "(document.querySelector('" .. sel .. "')?.textContent ?? '')"
end
local ROW = 'section[aria-labelledby="learnstats-paths"] tr[data-path="lib.nvim/learn-sheet-figures"]'
-- the two days are date fields; a sheet has no step to type into one, so the expression sets them as a person would
local DAYS = "(() => { const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); "
  .. "return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }; "
  .. "for (const [id, n] of [['learnstats-since', -8], ['learnstats-until', 0]]) { const i = document.getElementById(id); "
  .. "i.value = day(n); i.dispatchEvent(new Event('change', { bubbles: true })); } return true; })()"

return {
  id = "tasks.learn-figures",
  feature = "tasks.learn-figures",
  task = "tasks-desktop/lern-uebersicht-start-des-reiters-mit-zeitraum-kachel",
  title = "tasks-desktop: the overview and the statistics of the tab Lernpläne (period by radios, figures against the period before, bars as a table; days of one's own, a row per path, the learning days)",
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

    -- the statistics
    {
      expect = "(() => { location.hash = '#view=learnstats'; return true; })()",
      note = "the statistics, in the same page (the code of the link pairs once)",
    },
    { wait = "document.getElementById('learnstats-paths') !== null", timeout = 20000 },
    { click = 'input[name="learnstats-period"][value="custom"]', note = "a period of its own" },
    { wait = "document.getElementById('learnstats-since') !== null" },
    { expect = DAYS, note = "from eight days back to today" },
    {
      wait = text_of(ROW .. " td") .. " === '5'",
      timeout = 10000,
      note = "the path learned 5 points in those days",
    },
    {
      expect = "/^50[|]2[.,]5 h$/.test([...document.querySelectorAll('" .. ROW .. " td')].map((c) => c.textContent.trim()).slice(1, 3).join('|'))",
      note = "50 XP and 2.5 hours (2,5 in German)",
    },
    { shot = "stats", note = "the charts, the calendar and the row of the path" },
    { click = 'button[aria-controls="learnstats-days-table"]', note = "the learning days as a table" },
    {
      wait = "document.querySelectorAll('#learnstats-days-table:not(.sr-only) tr[data-day]').length === 9",
      note = "a row per day the series knows, eight days back to today",
    },
    { shot = "stats-days", note = "the days as a table" },
  },
}
