-- luacheck: ignore 122
-- Holds the `ci` section of .testing.lua to both systems: the pnpm steps start `pnpm.cmd` where the path separator is a
-- backslash (Windows: pnpm itself is a shell script libuv cannot spawn) and `pnpm` elsewhere (a quick run in WSL2).
-- Run: nvim -n -i NONE --headless -u NONE -l tools/check-testing-lua.lua  (exit 1 on a finding)

local PNPM_STEPS = { "ui-install", "ui-check", "ui-test", "ui-build" }

--- Load .testing.lua as if the system had the path separator `sep` (package.config starts with it).
---@param sep string
local function load_for(sep)
  local saved = package.config
  package.config = sep .. saved:sub(2)
  local ok, config = pcall(dofile, ".testing.lua")
  package.config = saved
  assert(ok, config)
  return config
end

local failures = 0
for _, case in ipairs({
  { sep = "\\", pnpm = "pnpm.cmd", system = "Windows" },
  { sep = "/", pnpm = "pnpm", system = "Linux" },
}) do
  local steps = load_for(case.sep).ci.steps
  for _, name in ipairs(PNPM_STEPS) do
    local run = steps[name] and steps[name].run
    local got = run and run[1]
    if got ~= case.pnpm then
      failures = failures + 1
      io.stderr:write(
        ("%s: step %s starts %s, expected %s\n"):format(case.system, name, tostring(got), case.pnpm)
      )
    end
  end
end

if failures > 0 then
  os.exit(1)
end
print("check-testing-lua: ok")
