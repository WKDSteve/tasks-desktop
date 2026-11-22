-- .testing.lua -- what the test sheets of this repository run against (testing.nvim, docs/SHEETS.md there). The sheets
-- in TESTS/sheets only name an app; how it starts is here, under testing.nvim's trust gate. tasks-desktop has no Lua
-- spec: `testing sheets run --all` runs the sheets.
--
-- `ci`: the pipeline of `testing ci` / `testing ci commit` (testing.nvim docs/CI.md, "Native apps") as process steps, so
-- a commit is checked in a worktree of its own and never in the checkout other sessions work in. tasks-desktop has no
-- Lua spec, so `--quick` has no spec selection to make: the quick profile is the part of the pipeline that is cheap and
-- reaches every diff (format, the repository's own checks, svelte-check, vitest). The full profile adds clippy and the
-- Rust tests. A worktree has no `target/` and no `node_modules`: start the run with CARGO_TARGET_DIR set to the target
-- of the main checkout (cargo locks it), pnpm links from its store. Not in a profile: the browser tests (`pnpm e2e`,
-- `pnpm web:e2e`, `testing sheets run --all`), the web engine against nvim and the phone page, which need Chrome, the
-- pinned engine and the mobile lock; the CI workflows run them on the runner.

-- On Windows pnpm is a shell script libuv cannot spawn, so the step starts the pnpm.cmd shim; elsewhere (a quick run in
-- WSL2) it is `pnpm`. tools/check-testing-lua.lua holds this to both systems.
local pnpm = package.config:sub(1, 1) == "\\" and "pnpm.cmd" or "pnpm"

return {
  ci = {
    default = "full",
    profiles = {
      fast = { "fmt", "control-chars", "process-starts", "color-literals", "testing-lua" },
      quick = { "fast", "ui-install", "ui-check", "ui-test" },
      full = { "quick", "ui-build", "clippy", "rust-test" },
    },
    steps = {
      fmt = { run = { "cargo", "fmt", "--check" } },
      -- this file itself: the pnpm steps name the right program on each system
      ["testing-lua"] = {
        run = {
          "nvim",
          "-n",
          "-i",
          "NONE",
          "--headless",
          "-u",
          "NONE",
          "-l",
          "tools/check-testing-lua.lua",
        },
        timeout = "1m",
      },
      ["control-chars"] = { run = { "python", "tools/check-control-chars.py" }, timeout = "2m" },
      ["process-starts"] = { run = { "python", "tools/check-process-starts.py" }, timeout = "2m" },
      ["color-literals"] = {
        run = {
          "python",
          "tools/check-color-literals.py",
          "--root",
          "ui/src",
          "--tokens",
          "ui/src/palette.css",
        },
        timeout = "2m",
      },
      ["ui-install"] = {
        run = { pnpm, "--dir", "ui", "install", "--frozen-lockfile", "--prefer-offline" },
        timeout = "10m",
      },
      ["ui-check"] = { run = { pnpm, "--dir", "ui", "check" }, timeout = "10m" },
      ["ui-test"] = { run = { pnpm, "--dir", "ui", "test" }, timeout = "15m" },
      -- the interface is part of the hub binary (crates/tasks-hub/build.rs), so it is built before cargo reads it
      ["ui-build"] = { run = { pnpm, "--dir", "ui", "build" }, timeout = "10m" },
      clippy = {
        run = {
          "cargo",
          "clippy",
          "--workspace",
          "--all-targets",
          "--locked",
          "--",
          "-D",
          "warnings",
        },
        timeout = "40m",
      },
      ["rust-test"] = {
        run = { "cargo", "test", "--workspace", "--locked", "--exclude", "hub-testkit" },
        timeout = "40m",
      },
    },
  },
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
      -- The same hub with a vault: a copy of the synthetic fixture vault in a folder of the run with a learning path of
      -- its own (tools/sheet-levels-vault.mjs), the real engine as the machine finds it (TASKS_ENGINE_DIR, else the
      -- tasks.nvim checkout under REPOS_DIR; it must know `path_levels`), its settings in a folder of the run. The
      -- variables that name this machine's data (ui/web/nvim-env.mjs MACHINE_VARS) are blanked, so neither the hub nor
      -- the engine reads the real vault, its marker documents or the tailnet.
      ["levels-hub"] = {
        build = {
          { "pnpm", "--dir", "ui", "build" },
          { "cargo", "build", "-p", "tasks-hub", "--example", "setup-hub", "--locked" },
        },
        prepare = { "node", "tools/sheet-levels-vault.mjs", "${temp}" },
        run = { "target/debug/examples/setup-hub.exe" },
        env = {
          TASKS_DESKTOP_CONFIG_DIR = "${temp}/cfg",
          TASKS_VAULT = "${temp}/vault",
          TASKS_MARKER_DOCS = "",
          TASKS_EXTRA_AREAS = "",
          TASKS_LISTS_FILE = "${temp}/lists.json",
          TASKS_FRECENCY_FILE = "${temp}/frecency.json",
          TASKS_LINKS = "",
          TASKS_TRUST_VAULT_LINT = "",
          TASKS_DESKTOP_TAILNET = "",
          NVIM_CONFIG_DIR = "",
          TASKS_DESKTOP_NO_GH = "1",
          TASKS_DESKTOP_EDITOR_LOG = "${temp}/editor.log",
          TASKS_DESKTOP_PICK_RESULT = "${temp}/picked",
          APPKIT_FAMILY_DIR = "${temp}/family",
          AI_DESKTOP_CONFIG_DIR = "${temp}/ai-desktop",
        },
        ready = { stdout = "^http://127%.0%.0%.1:%d+/#pair=", as = "link" },
      },
      -- The same hub with the vault of the meetings sheet (tools/sheet-meetings-vault.mjs: the fixture vault and one
      -- meeting of lib.nvim/alpha that is over); everything else as `levels-hub`.
      ["meetings-hub"] = {
        build = {
          { "pnpm", "--dir", "ui", "build" },
          { "cargo", "build", "-p", "tasks-hub", "--example", "setup-hub", "--locked" },
        },
        prepare = { "node", "tools/sheet-meetings-vault.mjs", "${temp}" },
        run = { "target/debug/examples/setup-hub.exe" },
        env = {
          TASKS_DESKTOP_CONFIG_DIR = "${temp}/cfg",
          TASKS_VAULT = "${temp}/vault",
          TASKS_MARKER_DOCS = "",
          TASKS_EXTRA_AREAS = "",
          TASKS_LISTS_FILE = "${temp}/lists.json",
          TASKS_FRECENCY_FILE = "${temp}/frecency.json",
          TASKS_LINKS = "",
          TASKS_TRUST_VAULT_LINT = "",
          TASKS_DESKTOP_TAILNET = "",
          NVIM_CONFIG_DIR = "",
          TASKS_DESKTOP_NO_GH = "1",
          TASKS_DESKTOP_EDITOR_LOG = "${temp}/editor.log",
          TASKS_DESKTOP_PICK_RESULT = "${temp}/picked",
          APPKIT_FAMILY_DIR = "${temp}/family",
          AI_DESKTOP_CONFIG_DIR = "${temp}/ai-desktop",
        },
        ready = { stdout = "^http://127%.0%.0%.1:%d+/#pair=", as = "link" },
      },
      -- The same hub with the learning paths of the competence map (tools/sheet-pathmap-vault.mjs): a finished root, two
      -- projects where one needs the other, a soft requirement, a circle and an unknown id. The engine must know
      -- `requires`.
      ["pathmap-hub"] = {
        build = {
          { "pnpm", "--dir", "ui", "build" },
          { "cargo", "build", "-p", "tasks-hub", "--example", "setup-hub", "--locked" },
        },
        prepare = { "node", "tools/sheet-pathmap-vault.mjs", "${temp}" },
        run = { "target/debug/examples/setup-hub.exe" },
        env = {
          TASKS_DESKTOP_CONFIG_DIR = "${temp}/cfg",
          TASKS_VAULT = "${temp}/vault",
          TASKS_MARKER_DOCS = "",
          TASKS_EXTRA_AREAS = "",
          TASKS_LISTS_FILE = "${temp}/lists.json",
          TASKS_FRECENCY_FILE = "${temp}/frecency.json",
          TASKS_LINKS = "",
          TASKS_TRUST_VAULT_LINT = "",
          TASKS_DESKTOP_TAILNET = "",
          NVIM_CONFIG_DIR = "",
          TASKS_DESKTOP_NO_GH = "1",
          TASKS_DESKTOP_EDITOR_LOG = "${temp}/editor.log",
          TASKS_DESKTOP_PICK_RESULT = "${temp}/picked",
          APPKIT_FAMILY_DIR = "${temp}/family",
          AI_DESKTOP_CONFIG_DIR = "${temp}/ai-desktop",
        },
        ready = { stdout = "^http://127%.0%.0%.1:%d+/#pair=", as = "link" },
      },
      -- The same hub with the levels, the field of knowledge and the evidence of the learning views
      -- (tools/sheet-learn-vault.mjs): badges, rewards, competence catalogue, evidence. The engine must know
      -- `paths_levels`, `path_reward`, `competences` and `learn_evidence`.
      ["learn-views-hub"] = {
        build = {
          { "pnpm", "--dir", "ui", "build" },
          { "cargo", "build", "-p", "tasks-hub", "--example", "setup-hub", "--locked" },
        },
        prepare = { "node", "tools/sheet-learn-vault.mjs", "${temp}" },
        run = { "target/debug/examples/setup-hub.exe" },
        env = {
          TASKS_DESKTOP_CONFIG_DIR = "${temp}/cfg",
          TASKS_VAULT = "${temp}/vault",
          TASKS_MARKER_DOCS = "",
          TASKS_EXTRA_AREAS = "",
          TASKS_LISTS_FILE = "${temp}/lists.json",
          TASKS_FRECENCY_FILE = "${temp}/frecency.json",
          TASKS_LINKS = "",
          TASKS_TRUST_VAULT_LINT = "",
          TASKS_DESKTOP_TAILNET = "",
          NVIM_CONFIG_DIR = "",
          TASKS_DESKTOP_NO_GH = "1",
          TASKS_DESKTOP_EDITOR_LOG = "${temp}/editor.log",
          TASKS_DESKTOP_PICK_RESULT = "${temp}/picked",
          APPKIT_FAMILY_DIR = "${temp}/family",
          AI_DESKTOP_CONFIG_DIR = "${temp}/ai-desktop",
        },
        ready = { stdout = "^http://127%.0%.0%.1:%d+/#pair=", as = "link" },
      },
      -- The same hub with the paths of the views of the tab Lernpläne (tools/sheet-learn-steps-vault.mjs: next steps, one
      -- under {safety}, hours over the plan, notes and links), for TESTS/sheets/learn-steps.sheet.lua.
      ["learn-steps-hub"] = {
        build = {
          { "pnpm", "--dir", "ui", "build" },
          { "cargo", "build", "-p", "tasks-hub", "--example", "setup-hub", "--locked" },
        },
        prepare = { "node", "tools/sheet-learn-steps-vault.mjs", "${temp}" },
        run = { "target/debug/examples/setup-hub.exe" },
        env = {
          TASKS_DESKTOP_CONFIG_DIR = "${temp}/cfg",
          TASKS_VAULT = "${temp}/vault",
          TASKS_MARKER_DOCS = "",
          TASKS_EXTRA_AREAS = "",
          TASKS_LISTS_FILE = "${temp}/lists.json",
          TASKS_FRECENCY_FILE = "${temp}/frecency.json",
          TASKS_LINKS = "",
          TASKS_TRUST_VAULT_LINT = "",
          TASKS_DESKTOP_TAILNET = "",
          NVIM_CONFIG_DIR = "",
          TASKS_DESKTOP_NO_GH = "1",
          TASKS_DESKTOP_EDITOR_LOG = "${temp}/editor.log",
          TASKS_DESKTOP_PICK_RESULT = "${temp}/picked",
          APPKIT_FAMILY_DIR = "${temp}/family",
          AI_DESKTOP_CONFIG_DIR = "${temp}/ai-desktop",
        },
        ready = { stdout = "^http://127%.0%.0%.1:%d+/#pair=", as = "link" },
      },
      -- The same hub with a running path and the rows of the series of the learning figures around the day of the run
      -- (tools/sheet-learn-figures-vault.mjs), for TESTS/sheets/learn-figures.sheet.lua.
      ["learn-figures-hub"] = {
        build = {
          { "pnpm", "--dir", "ui", "build" },
          { "cargo", "build", "-p", "tasks-hub", "--example", "setup-hub", "--locked" },
        },
        prepare = { "node", "tools/sheet-learn-figures-vault.mjs", "${temp}" },
        run = { "target/debug/examples/setup-hub.exe" },
        env = {
          TASKS_DESKTOP_CONFIG_DIR = "${temp}/cfg",
          TASKS_VAULT = "${temp}/vault",
          TASKS_MARKER_DOCS = "",
          TASKS_EXTRA_AREAS = "",
          TASKS_LISTS_FILE = "${temp}/lists.json",
          TASKS_FRECENCY_FILE = "${temp}/frecency.json",
          TASKS_LINKS = "",
          TASKS_TRUST_VAULT_LINT = "",
          TASKS_DESKTOP_TAILNET = "",
          NVIM_CONFIG_DIR = "",
          TASKS_DESKTOP_NO_GH = "1",
          TASKS_DESKTOP_EDITOR_LOG = "${temp}/editor.log",
          TASKS_DESKTOP_PICK_RESULT = "${temp}/picked",
          APPKIT_FAMILY_DIR = "${temp}/family",
          AI_DESKTOP_CONFIG_DIR = "${temp}/ai-desktop",
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
