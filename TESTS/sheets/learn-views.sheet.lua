-- The badges, the rewards, the competence catalogue and the evidence of the tab "Learning plans" in the page against a
-- hub with a vault and the real engine (the app `learn-views-hub` of .testing.lua: a copy of the fixture vault in a
-- folder of the run with the files of tools/sheet-learn-vault.mjs: a path halfway with two levels, a field of knowledge,
-- a path that serves it with evidence given and open, a path without a field), step by step:
--   testing sheets step learn-views --headed
-- The steps go by data attributes, not by words: the page speaks the language of the browser. The browser tests
-- ui/e2e/learn-progress.spec.ts and ui/e2e/learn-knowledge.spec.ts check the same against the test hub of the e2e run,
-- with axe in both themes; what only eyes show stays in the hand run
-- tasks-desktop/abnahme-reiter-lernplaene-und-ansichten-von-hand.

local A = "lib.nvim"
local LEVELS = A .. "/learn-sheet-levels"
local FIELD = A .. "/learn-sheet-os"
local function q(selector)
  return "document.querySelector('" .. selector .. "')"
end

return {
  id = "tasks.learn-views",
  feature = "tasks.learn-views",
  task = "tasks-desktop/badge-uebersicht-verdiente-und-offene-abzeichen-aller",
  title = "tasks-desktop: badges, rewards, competence catalogue and evidence of the tab Learning plans (from the engine; a detail, a reward granted, a row opened)",
  engine = "browser",
  app = "learn-views-hub",
  sizes = { { cols = 1400, rows = 1000 } },
  steps = {
    -- the badges
    { open = "${link}&view=badges", note = "the link of the hub, straight to the badges" },
    {
      wait = q('[data-badge="' .. LEVELS .. '#1"]') .. " !== null",
      timeout = 20000,
      note = "paired, the badges are drawn",
    },
    {
      expect = q('[data-badge="' .. LEVELS .. '#1"]') .. "?.dataset.badgeState === 'earned'",
      note = "halfway: reached (the engine)",
    },
    {
      expect = q('[data-badge="' .. LEVELS .. '#done"] .ring') .. " !== null",
      note = "the next one of the path carries its ring",
    },
    { shot = "badges", note = "the badges" },
    {
      click = '[data-badge="' .. LEVELS .. '#done"]',
      note = "the detail of the line of the whole path",
    },
    { wait = q("[data-badge-detail]") .. " !== null", timeout = 5000 },
    { shot = "badge-detail", note = "threshold and reward" },

    -- the rewards: grant one
    {
      expect = "(location.hash = '#view=rewards', true)",
      note = "the rewards (the same page: the link pairs only once)",
    },
    {
      wait = q('[data-rewards-part="open"] [data-reward="' .. LEVELS .. '#1"]') .. " !== null",
      timeout = 20000,
    },
    { shot = "rewards", note = "open, granted, still to come" },
    { click = '[data-reward="' .. LEVELS .. '#1"] [data-reward-grant]', note = "'Granted'" },
    {
      wait = q('[data-rewards-part="given"] [data-reward="' .. LEVELS .. '#1"]') .. " !== null",
      timeout = 15000,
      note = "the row went to Granted (path_reward wrote the mark)",
    },

    -- the competence catalogue
    {
      expect = "(location.hash = '#view=competences', true)",
      note = "the competence catalogue (the same page: the link pairs only once)",
    },
    { wait = q('[data-competence="' .. FIELD .. '"]') .. " !== null", timeout = 20000 },
    {
      expect = q('[data-competence="' .. FIELD .. '"] [data-ladder="p"] .rung.half') .. " !== null",
      note = "practice 1.5: half a rung",
    },
    {
      expect = "("
        .. q('[data-competence="' .. FIELD .. '"] [data-competence-evidence]')
        .. "?.textContent ?? '').includes('1')",
      note = "the evidence of its path counted",
    },
    {
      click = '[data-competence="' .. FIELD .. '"] [data-competence-more]',
      note = "the row opens",
    },
    {
      wait = q('[data-competence-detail="' .. FIELD .. '"] strong') .. " !== null",
      timeout = 5000,
    },
    { shot = "catalogue", note = "the catalogue with a row open" },

    -- the evidence
    {
      expect = "(location.hash = '#view=evidence', true)",
      note = "the evidence (the same page: the link pairs only once)",
    },
    {
      wait = q(
        '[data-evidence-group-of="competence:' .. FIELD .. '"] [data-evidence-state="given"]'
      ) .. " !== null",
      timeout = 20000,
      note = "grouped by field, the shell given",
    },
    { shot = "evidence", note = "the evidence by field" },
    {
      click = '[data-evidence-group-of="competence:'
        .. FIELD
        .. '"] [data-evidence-state="given"] [data-evidence-open]',
    },
    {
      wait = q('button[data-path="' .. A .. '/learn-sheet-serves"][aria-current="true"]')
        .. " !== null",
      timeout = 10000,
      note = "the view of the paths with the path of the point chosen",
    },
  },
  judge = {
    "earned badges have a solid frame, open ones a dashed frame, a lock and a grey picture; the next one a ring with its percent",
    "every state says itself in words beside its symbol (earned on, to go, open, granted, comes at)",
    "the ladders of theory and practice show the stage filled, the half stage half, the targets framed (12 solid, 24 dashed), with number and name beside",
    "the evidence names given and open with symbol and word, and the stage it proves",
  },
}
