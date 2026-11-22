-- TESTS/sheets/features.lua -- the functionalities of tasks-desktop as its user meets them that have a test sheet;
-- `testing sheets report` says which ones have a feature sheet (`feature = "<id>"`) and in which state. Data: read with
-- an empty environment like a sheet (testing.nvim docs/SHEETS.md). The browser tests of ui/e2e cover the page itself;
-- a sheet stands here where a check was a hand run before.
return {
  {
    id = "tasks.first-start",
    title = "The first start is in the page: the vault and Neovim chosen in the dialogs of the system, the installation offered",
    docs = "README.md",
  },
  {
    id = "tasks.meetings-make",
    title = "A meeting from a quick line of the palette: nothing written before Create, its cover, a recording, a document; a meeting that is over opens on its result, is ticked and done",
    docs = "README.md",
  },
  {
    id = "tasks.path-levels",
    title = "The levels of a learning path set in a form: written to ## Level with a badge and rewards, refused by the engine, the XP of a promoted task",
    docs = "README.md",
  },
  {
    id = "tasks.learning-paths",
    title = "A learning path ticked and undone, a point set not applicable or blocked with its reason, a change of the file by another program kept, a point promoted to a task finished as seen",
    docs = "README.md",
  },
}
