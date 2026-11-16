# Programs tasks-desktop starts

Every program the hub (`tasks-hub`) starts, with why, how long it lives and which way of
[appkit's `docs/PROCESSES.md`](https://github.com/WKDSteve/appkit/blob/main/docs/PROCESSES.md)
(rule `RS-08`) starts it. **A process that is not in this list is a bug.** The list is taken
from the code (`tools/process-starts.allow`, the `appkit_core::child` and `launch` calls of this
repository and of appkit) and checked against a measurement with `app-proc-watch`.

The ways:

- **child**: `appkit_core::child`. No console window, the streams are pipes of the hub, bound to
  the hub by the system (a job object on Windows, a process group elsewhere): it ends with the
  hub, also when the hub crashes or is killed. Its start is in `hub.log`.
- **launch**: `appkit_core::launch::spawn`. A program that is not the hub's: it gets its own
  window where it has one and outlives the hub on purpose; nothing of the hub is inherited.
- **system**: the system opens something (`ShellExecuteW` on Windows); no process of the hub is
  started. On macOS and Linux `/usr/bin/open` or `xdg-open` is started through **launch**.

| Program | Why | How long | Way |
| --- | --- | --- | --- |
| `tasks-hub serve` | `start` (the link, the login entry, `install`) puts the hub in the background | until `stop`, the stop route, or the hub ends itself | named exception: the hub in the background (`background::start`), no window, output to `hub.log` |
| `nvim --version` | the first start and the settings check the version of Neovim (`setup::checked_nvim` only starts a file named `nvim`/`nvim.exe`) | the call | child |
| `nvim --headless -u NONE -i NONE -n -l <tasks.nvim>/scripts/tasks-host.lua` (the engine host) | every question to the engine (the board, a task, a write) | as long as the hub; started again after it ended | child (`child::spawn`) |
| `nvim --headless … -l <tasks.nvim>/scripts/tasks.lua call <method>` | the same questions, one process each, when `TASKS_HUB_ENGINE=process` is set or the host is not available | the call | child |
| `nvim --headless … -l <tasks.nvim>/scripts/tasks.lua sheet-run <id>` | **Run sheets** of a task in the page; it starts `testing sheets run` and the tests of the sheet | at most 35 minutes and 16 MiB of output per stream; ends with the hub together with all it started | child |
| what the engine starts (`git rev-parse` from tasks.nvim, the sheets' tests) | the engine's own work | in the job of its engine process: it ends with the hub; what a single call (`call <method>`) started on purpose for you, such as an editor, stays (`Leftovers::Keep`) | child of a child |
| `nvim` in a console of its own (Linux: in a terminal program) | **Open in Neovim** | until you close it | named exception: the editor you work in (`appkit_hub::editor`, `CREATE_NEW_CONSOLE`), visible |
| `tasks-hub install --open` | **Install** in the page of a first start | until it has copied the program, restarted the hub and opened its page | launch |
| `<installed tasks-hub> start` | `tasks-hub install` brings the hub back from the installed program | the call; the hub it puts in the background stays | child (`background::start_from`, `Leftovers::Keep`) |
| the default browser | `start --open`, `open`, the link | yours | system (`appkit_hub::browser::open`) |
| the folder or program dialog | choosing the vault or Neovim in the page | until you choose | Windows: in the hub's own process (`IFileOpenDialog`), no program; macOS `osascript`, Linux `zenity`/`kdialog`: child, closed after 30 minutes |
| `conhost.exe` | Windows gives every console program (`nvim`, `git`) a console host, also without a window | as long as its console program | comes with each child; no window |

What the hub does **not** start any more: `taskkill.exe` (`stop` asks the hub over its control
route and ends it with `TerminateProcess` only when it does not answer), `reg.exe` (the login
entry and the uninstall entry go through the registry API), `icacls.exe` (the rights of the
control secret go through the security API), `wscript.exe` or `cmd.exe` (the hub starts itself),
`explorer.exe` (a folder is shown through the shell).

The release build is a window program (GUI subsystem): the link, the login entry and a double
click open no console window. `tasks-hub setup` opens a console window only for its questions.
