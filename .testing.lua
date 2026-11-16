-- .testing.lua -- what the test sheets of this repository run against (testing.nvim, docs/SHEETS.md there). The sheets
-- in TESTS/sheets only name an app; how it starts is here, under testing.nvim's trust gate. tasks-desktop has no Lua
-- spec: `testing sheets run --all` runs the sheets.

return {
  sheets = {
    -- playwright-core comes at the version of the e2e tests from ui/ (ui/package.json), the Chrome of the machine.
    browser = { playwright_dir = "ui", channel = "chrome" },
    apps = {
      -- The hub of a first start: no vault (the machine's TASKS_VAULT is blanked), a Neovim that is not there, its
      -- settings in a folder of the run, and the seams of the dialogs: the folder dialog "chooses" the run's folder,
      -- the file dialog a nvim.exe that does not exist, and the installation is written to a log, never run. Nothing of
      -- the user's profile is read or written.
      ["setup-hub"] = {
        build = {
          { "pnpm", "--dir", "ui", "build" },
          { "cargo", "build", "-p", "tasks-hub", "--example", "setup-hub", "--locked" },
        },
        run = { "target/debug/examples/setup-hub.exe" },
        env = {
          TASKS_DESKTOP_CONFIG_DIR = "${temp}",
          TASKS_VAULT = "",
          TASKS_DESKTOP_TAILNET = "",
          TASKS_NVIM = "${temp}/no-such-nvim.exe",
          TASKS_DESKTOP_INSTALL_DIR = "${temp}/bin",
          TASKS_DESKTOP_EDITOR_LOG = "${temp}/dialogs.log",
          TASKS_DESKTOP_PICK_RESULT = "${temp}",
          TASKS_DESKTOP_PICK_PROGRAM_RESULT = "${temp}/nvim.exe",
          TASKS_DESKTOP_INSTALL_LOG = "${temp}/install.log",
        },
        ready = { stdout = "^http://127%.0%.0%.1:%d+/#pair=", as = "link" },
      },
    },
  },
}
