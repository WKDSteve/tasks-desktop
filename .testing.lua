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
      -- The release build of tasks-hub (a window program) started the way a link starts it (testing.nvim `start =
      -- "link"`: no standard handles, no console of a parent), against a config.json it cannot use in a folder of the
      -- run. The hub in the background ends at once on the config; the start sees that within about 2 s (appkit
      -- v0.62.0) and the program says so in a message box that names the cause from hub.log, its only window. Nothing
      -- outlives the sheet (the hub in the background ends at once on the config), and the person's settings and hub
      -- stay untouched (own folder, own port, no browser).
      ["link-start-error"] = {
        build = { "cargo", "build", "--release", "-p", "tasks-hub", "--locked" },
        prepare = {
          "python",
          "-c",
          "import pathlib, sys; p = pathlib.Path(sys.argv[1]); p.parent.mkdir(parents=True, exist_ok=True);"
            .. " p.write_text(sys.argv[2])",
          "${temp}/cfg/config.json",
          '{ "port": ',
        },
        run = { "target/release/tasks-hub.exe" },
        start = "link",
        window = "tasks-hub",
        window_ms = 15000,
        env = {
          TASKS_DESKTOP_CONFIG_DIR = "${temp}/cfg",
          TASKS_DESKTOP_PORT = "47395",
          TASKS_DESKTOP_NO_LAUNCH = "1",
          TASKS_VAULT = "",
          NVIM_MACHINE_ROLE = "workstation",
        },
      },
    },
  },
}
