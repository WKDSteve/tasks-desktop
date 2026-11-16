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
}
