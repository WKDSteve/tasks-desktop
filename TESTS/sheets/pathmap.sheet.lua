-- The competence map of the learning paths in the page against a hub with a vault and the real engine (the app
-- `pathmap-hub` of .testing.lua: a copy of the fixture vault in a folder of the run with the paths of
-- tools/sheet-pathmap-vault.mjs: a finished root, a chain through two projects where one needs the other (hard), a
-- soft requirement not met, a circle, a requirement that names nothing, an id of another vault and a broken entry), step
-- by step:
--   testing sheets step pathmap --headed
-- The steps go by data attributes, not by words: the page speaks the language of the browser. The browser test
-- ui/e2e/pathmap.spec.ts checks the same against the test hub of the e2e run, with axe in both themes; what only eyes
-- show stays in the hand run tasks-desktop/abnahme-kompetenzkarte-und-untermenue-lernplaene-von-hand.

local A = "lib.nvim"
local function box(slug)
  return '[data-box="' .. A .. "/" .. slug .. '"]'
end
local function stage(slug, value)
  return "document.querySelector('" .. box(slug) .. "')?.dataset.stage === '" .. value .. "'"
end

return {
  id = "tasks.pathmap",
  feature = "tasks.pathmap",
  task = "tasks-desktop/kompetenzkarte-lernpfade-und-projekte-als-boxen-mit",
  title = "tasks-desktop: the competence map of the learning paths (stages, frames, a chain, a circle, a ghost; hide the finished ones; the list; a box opens its path)",
  engine = "browser",
  app = "pathmap-hub",
  sizes = { { cols = 1400, rows = 1000 } },
  steps = {
    {
      open = "${link}&view=pathmap",
      note = "the link of the hub, straight to the competence map",
    },
    {
      wait = "document.querySelector('" .. box("map-sheet-a") .. "') !== null",
      timeout = 20000,
      note = "paired, the map is drawn",
    },
    {
      expect = stage("map-sheet-root", "done"),
      note = "the finished root from the Backlog (include_done)",
    },
    { expect = stage("map-sheet-a", "doing") },
    {
      expect = stage("map-sheet-b", "waiting"),
      note = "waits: its project needs the base project (hard)",
    },
    {
      expect = "document.querySelector('[data-edge=\"j:"
        .. A
        .. "/map-sheet-base>j:"
        .. A
        .. "/map-sheet-top\"]') !== null",
      note = "the requirement of a project, from frame to frame",
    },
    {
      expect = "document.querySelector('" .. box("map-sheet-soft") .. " .hint') !== null",
      note = "a soft requirement not met: the hint on the box",
    },
    {
      expect = "(document.querySelector('[data-pathmap-cycle]')?.textContent ?? '').includes('Map sheet x')",
      note = "the circle in its own area",
    },
    {
      expect = stage("map-sheet-nothing", "ghost"),
      note = "the requirement that names nothing: a ghost",
    },
    {
      expect = "document.querySelector('[data-box=\"work:lib.nvim/map-sheet-far\"]')?.dataset.stage === 'ghost'",
      note = "an id of another vault (kind foreign): a ghost",
    },
    {
      expect = "document.querySelector('[data-box=\"kein id\"]')?.dataset.stage === 'ghost'",
      note = "a broken entry (kind bad): a ghost",
    },
    { shot = "map", note = "the map" },

    -- the finished ones hidden
    { click = "[data-pathmap-hide-done]", note = "'Hide finished'" },
    { wait = "document.querySelector('" .. box("map-sheet-root") .. "') === null", timeout = 5000 },
    { click = "[data-pathmap-hide-done]", note = "shown again" },
    { wait = "document.querySelector('" .. box("map-sheet-root") .. "') !== null", timeout = 5000 },

    -- the list
    { click = 'input[value="list"]', note = "'List'" },
    {
      wait = "document.querySelector('[data-pathmap-list] [data-row=\""
        .. A
        .. "/map-sheet-b\"]') !== null",
      timeout = 5000,
    },
    { shot = "list", note = "the list" },
    { click = 'input[value="map"]', note = "back to the map" },

    -- a box opens its path
    { wait = "document.querySelector('" .. box("map-sheet-a") .. "') !== null", timeout = 5000 },
    { click = box("map-sheet-a") },
    {
      wait = "document.querySelector('button[data-path=\""
        .. A
        .. '/map-sheet-a"][aria-current="true"]\') !== null',
      timeout = 10000,
      note = "the view of the paths with the path chosen",
    },
  },
  judge = {
    "each box shows its stage by colour, symbol and word; the frames hold the paths of their projects",
    "hard and soft arrows are told apart by line and head; open ones in the warning colour",
    "the circle and the ghost stand out in red and say what to do",
  },
}
