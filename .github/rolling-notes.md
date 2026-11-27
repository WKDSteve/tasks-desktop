**This is not a release.** It is the newest state of `main`, rebuilt after every green CI run and replaced each time. Nothing here is signed or tested by hand; use a release for anything that matters.

**Windows** (x86-64), **Linux** (x86-64) and **macOS** (Apple silicon, experimental: built and installed by the CI, never started on a real Mac). The files of this page are public: no GitHub login is needed.

**Linux and macOS:** install for the current user (no root; the script picks the archive of your system, checks it against `SHA256SUMS` and runs `tasks-hub install`):

```
curl -fsSL https://github.com/WKDSteve/tasks-desktop/releases/download/latest/install.sh | sh
```

Run it again to update. `uninstall.sh` removes it again. The archives are `tasks-hub-x86_64-unknown-linux-gnu.tar.gz` and `tasks-hub-aarch64-apple-darwin.tar.gz` (the program and its LICENSE); on macOS an archive downloaded by a browser is quarantined, the script's own download is not. These programs carry no engine: see the last paragraph.

**Windows:**

**Install it with the script** (for the current user, no administrator rights, and no SmartScreen stop: the script downloads the program itself and checks it against `SHA256SUMS`). In your own PowerShell (not elevated):

```
irm https://github.com/WKDSteve/tasks-desktop/releases/download/latest/install.ps1 | iex
```

Type the line into the PowerShell session as it is. Wrapped in a new `powershell -ExecutionPolicy Bypass -c "..."`, Microsoft Defender reports the command line as a trojan (`Trojan:Win32/Commando.B!ml`) and nothing is installed.

Or save `install.ps1` from this page and run `powershell -ExecutionPolicy Bypass -File .\install.ps1` (a plain `.\install.ps1` is blocked: by the execution policy, or by the mark a browser puts on a downloaded file). To register the hub with your login and add a link, run it as a script block in a PowerShell session instead: `& ([scriptblock]::Create((irm https://github.com/WKDSteve/tasks-desktop/releases/download/latest/install.ps1))) -InstallArgs '--shortcut'`.

Run it again to update to the newest rolling build.

Or take the file yourself: `tasks-hub-windows-x86_64.exe`. A double click starts the hub in the background and opens the browser (a second click finds the running hub). Windows SmartScreen warns about an unsigned program: "More info", then "Run anyway". `uninstall.ps1` removes it again; `SHA256SUMS` holds the checksums of all files.

The Windows program carries its engine. The Linux and macOS programs need **Neovim 0.12 or newer** and checkouts of `tasks.nvim` and `lib.nvim` (the engine); it finds them through `TASKS_ENGINE_DIR` and `LIB_NVIM_DIR`, `REPOS_DIR`, or the settings file. Your vault is set with `TASKS_VAULT`. Without them the page says what is missing. `tasks-hub --version` names the commit this file was built from; `tasks-hub stop` ends the hub.
