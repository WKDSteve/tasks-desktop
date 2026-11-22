-- The tab Learning plans of the menu bar in the page, against a hub with a vault and the real engine (the app
-- `levels-hub` of .testing.lua), step by step:
--   testing sheets step learn-tab --headed
-- The steps go by the ids of the menus and the addresses of the items, not by their words: the page speaks the language
-- of the browser. Which views the tab offers is ui/src/lib/learnViews.ts (learnViews.test.ts); the whole page in a DOM
-- is ui/src/AppLearnTab.dom.test.ts, the real hub with axe ui/e2e/learn-tab.spec.ts. A screen reader, the eye on both
-- themes and the installed window stay in the hand run tasks-desktop/abnahme-reiter-lernplaene-und-ansichten-von-hand.

local TRIGGER = "button.mb-trigger[data-for=learn]"
local POPUP = "[role=menu][data-menu=learn]"

return {
  id = "tasks.learn-tab",
  feature = "tasks.learn-tab",
  task = "tasks-desktop/menue-ansichten-kategorie-lernplaene-mit-untereintraegen",
  title = "tasks-desktop: the tab Learning plans of the menu bar (its place, its views, the dot of the view shown)",
  engine = "browser",
  app = "levels-hub",
  sizes = { { cols = 1200, rows = 900 } },
  steps = {
    { open = "${link}&view=paths", note = "the link of the hub, straight to the learning paths" },
    {
      wait = "document.querySelector('" .. TRIGGER .. "') !== null",
      timeout = 20000,
      note = "paired: the tab is in the bar (the engine has the learning paths)",
    },
    {
      expect = "[...document.querySelectorAll('button.mb-trigger')].map((b) => b.dataset.for).join(',')"
        .. " === 'tasks,project,view,learn,options,help'",
      note = "its place: after View, before Options",
    },
    {
      expect = "document.querySelector('"
        .. TRIGGER
        .. " .mb-current') !== null"
        .. " && document.querySelector('"
        .. TRIGGER
        .. "').getAttribute('aria-label').length"
        .. " > document.querySelector('"
        .. TRIGGER
        .. "').textContent.length",
      note = "the link #view=paths puts the dot on the tab, and its name says the view shown",
    },
    { shot = "tab-current" },
    { click = TRIGGER, note = "the tab opened" },
    { wait = "document.querySelector('" .. POPUP .. "') !== null", timeout = 5000 },
    {
      expect = "document.querySelector('"
        .. POPUP
        .. ' [role=menuitemradio][href*="view=paths"]\')'
        .. "?.getAttribute('aria-checked') === 'true'",
      note = "the learning paths, checked",
    },
    {
      expect = "document.querySelectorAll('"
        .. POPUP
        .. " [role=menuitemradio]').length === 6"
        .. " && document.querySelector('"
        .. POPUP
        .. ' [href*="view=learnnotes"]\') === null',
      note = "the six views the page has; one it does not have yet is missing, not greyed",
    },
    { shot = "tab-open" },
    { press = "Escape", note = "closed" },
    { click = "button.mb-trigger[data-for=view]", note = "the menu View" },
    { wait = "document.querySelector('[role=menu][data-menu=view]') !== null", timeout = 5000 },
    {
      expect = "document.querySelector('[role=menu][data-menu=view] [href*=\"view=paths\"]') === null"
        .. " && document.querySelector('[role=menu][data-menu=view] [href*=\"view=pathmap\"]') === null",
      note = "View has neither the learning paths nor the competence map any more",
    },
    { press = "Escape" },
    {
      expect = "(location.hash = '#view=learnnotes', location.reload(), true)",
      note = "a link to a view of the tab that is not built yet (the page reloads with it)",
    },
    {
      wait = "(document.querySelector('.toast')?.textContent ?? '').includes('learnnotes')",
      timeout = 20000,
      note = "a word says the view is not there yet",
    },
    {
      expect = "document.querySelector('"
        .. TRIGGER
        .. " .mb-current') !== null"
        .. " && location.hash.includes('view=paths')",
      note = "and the page shows the learning paths",
    },
    { shot = "missing-view" },
  },
  judge = {
    "the dot before Learning plans reads as the mark of the view shown, as the dot of a checked item does",
    "the sections of the tab read as one menu with View and Options, in light and dark",
    "the word about the missing view is readable and says where the page went",
  },
}
