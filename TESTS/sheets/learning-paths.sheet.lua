-- The view of the learning paths in the page against a hub with a vault and the real engine (the app `levels-hub` of
-- .testing.lua: a copy of the fixture vault in a folder of the run with the path `points-sheet` of
-- tools/sheet-levels-vault.mjs, five open leaves), step by step:
--   testing sheets step learning-paths --headed
-- What the hand sheet learning-paths-live asked and a machine can see: a tick and its Undo, does not apply and blocked
-- with their reason, a change of the file by another program that the page must not overwrite, a point promoted and
-- its task finished as seen. What a file holds is read through the hub (`/api/tasks/path`, with the session of the
-- page), which reads it with the engine. The other program is the hub's `ops` called from outside the view, as an
-- editor or a CLI writes the file: the page still holds the version it read.
-- The browser tests ui/e2e/paths.spec.ts and ui/e2e-web/paths.spec.ts check folding, a finger, a reason that is
-- missing, a note and promote with axe; the installed window, a real finger, a screen reader and the eye on both
-- themes stay in the hand run tasks-desktop/abnahme-lernpfad-ansicht-in-der-app-und-im-web-echtes-fenste.

local PATH = "lib.nvim/points-sheet"

-- The session the page holds, as the client sends it.
local AUTH = "headers: { Authorization: 'Bearer ' + sessionStorage.getItem('tasks-desktop.session'), "
  .. "'Content-Type': 'application/json' }"

-- An answer of the hub to a read; `test` sees it as `d`.
local function read(api, query, test)
  return "(async () => { const r = await fetch('/api/tasks/"
    .. api
    .. "?"
    .. query
    .. "', { cache: 'no-store', credentials: 'omit', "
    .. AUTH
    .. " }); if (!r.ok) return false; const d = await r.json(); return "
    .. test
    .. "; })()"
end

-- The body of the path has a line that holds every one of `parts`.
local function line_with(parts)
  -- A sheet is loaded with an empty environment (no ipairs, no table): the parts are joined by hand.
  local quoted = ""
  for i = 1, #parts do
    quoted = quoted .. (i > 1 and ", " or "") .. "'" .. parts[i] .. "'"
  end
  return read(
    "path",
    "id=" .. PATH,
    "d.body.split('\\n').some((l) => [" .. quoted .. "].every((p) => l.includes(p)))"
  )
end

-- Operations sent from outside the view (another program writing the file); true when every one went through.
local function outside(ops_js)
  return "(async () => { const r = await fetch('/api/tasks/ops', { method: 'POST', credentials: 'omit', "
    .. AUTH
    .. ", body: JSON.stringify({ client_op_id: 'sheet-' + Date.now(), ops: "
    .. ops_js
    .. " }) }); if (!r.ok) return false; const d = await r.json(); return d.results.every((e) => e.ok); })()"
end

local function point(key)
  return 'li[data-point="' .. key .. '"]'
end

-- Typing into a field as the page sees it: the value set and the `input` event a key would send.
local function fill(selector, value)
  return "(() => { const e = document.querySelector('"
    .. selector
    .. "'); if (!e) return false; e.value = '"
    .. value
    .. "'; e.dispatchEvent(new Event('input', { bubbles: true })); return true; })()"
end

-- No write on its way and the path not being read: the marks can be clicked again.
local SETTLED = "document.querySelector('"
  .. point("tick")
  .. " button.mark') !== null"
  .. " && !document.querySelector('"
  .. point("tick")
  .. " button.mark').disabled"
  .. " && document.querySelector('.busy') === null"

-- A point is set seen, does not apply or blocked from its menu, with `reason`.
local function with_reason(key, state, reason)
  return {
    { click = point(key) .. ' [data-choice="point"] summary', note = "the menu of " .. key },
    { click = point(key) .. ' button[data-choice-id="' .. state .. '"]' },
    {
      wait = "document.activeElement?.matches('" .. point(key) .. " input[id^=reason-]')",
      note = "the reason field has the focus",
    },
    { expect = fill(point(key) .. " input[id^=reason-]", reason) },
    { press = "Enter", note = "saved with Enter" },
  }
end

local steps = {
  {
    open = "${link}&view=paths",
    note = "the link of the hub, straight to the view of the learning paths",
  },
  {
    wait = "document.querySelector('button[data-path=\"" .. PATH .. "\"]') !== null",
    timeout = 20000,
    note = "paired, the path of the run is listed",
  },
  { click = 'button[data-path="' .. PATH .. '"]' },
  { wait = SETTLED, timeout = 10000, note = "its tree is shown" },
  {
    expect = "document.querySelector('" .. point("root") .. " button.mark') === null",
    note = "the parent has no mark of its own",
  },

  -- a tick, and Undo in its toast
  { click = point("tick") .. " button.mark", note = "the mark of 'Tick point'" },
  { wait = line_with({ "[x] Tick point" }), timeout = 15000, note = "the engine wrote [x]" },
  {
    wait = "document.querySelector('" .. point("tick") .. "')?.dataset.state === 'learned'",
    timeout = 15000,
  },
  {
    wait = "document.querySelector('.toast button:not(.close)') !== null",
    timeout = 15000,
    note = "Undo is offered",
  },
  { click = ".toast button:not(.close)", note = "Undo" },
  { wait = line_with({ "[ ] Tick point" }), timeout = 15000, note = "the file has [ ] again" },
  {
    wait = "document.querySelector('" .. point("tick") .. "')?.dataset.state === 'open'",
    timeout = 15000,
    note = "and the view the open point",
  },
  { wait = SETTLED, timeout = 15000 },
}

-- Steps put after `steps` (no ipairs in a sheet).
local function append(more)
  for i = 1, #more do
    steps[#steps + 1] = more[i]
  end
end

-- does not apply and blocked, each with its reason beside the mark
append(with_reason("drop", "dropped", "not needed here"))
steps[#steps + 1] = { wait = line_with({ "[-] Drop point", "not needed here" }), timeout = 15000 }
steps[#steps + 1] = {
  wait = "document.querySelector('"
    .. point("drop")
    .. " .reason')?.textContent.includes('not needed here')",
  timeout = 15000,
  note = "the reason is shown under the point",
}
steps[#steps + 1] = { wait = SETTLED, timeout = 15000 }
append(with_reason("block", "blocked", "vpn-access"))
steps[#steps + 1] =
  { wait = line_with({ "[!] Block point", "vpn-access" }), timeout = 15000, note = "the key" }
steps[#steps + 1] = { wait = SETTLED, timeout = 15000 }
steps[#steps + 1] = { shot = "reasons" }

local rest = {
  -- another program writes the file while the page holds the version it read; a tick right after is never written
  -- over the other change: the engine refuses it (the page says so and reads again), or the page had read anew first
  {
    expect = outside(
      "[{ op: 'node_set', id: '" .. PATH .. "', point: 'outside', state: 'learned' }]"
    )
      .. ".then((ok) => { if (ok) document.querySelector('"
      .. point("tick")
      .. " button.mark').click(); return ok; })",
    note = "'Outside point' learned by another program, then a click on 'Tick point' at once",
  },
  { wait = SETTLED, timeout = 15000 },
  {
    wait = line_with({ "[x] Outside point" }),
    timeout = 15000,
    note = "the other program's change is in the file",
  },
  {
    wait = "document.querySelector('" .. point("outside") .. "')?.dataset.state === 'learned'",
    timeout = 15000,
    note = "and in the view, read again",
  },
  { shot = "outside" },

  -- promote, then the task finished as seen: the point shows how it ended
  { click = point("promo") .. ' [data-choice="point"] summary' },
  { click = point("promo") .. ' button[data-choice-id="promote"]', note = "Promote" },
  {
    wait = read("path", "id=" .. PATH, "/Promote point → \\S+/.test(d.body)"),
    timeout = 15000,
    note = "the line of the point names the task",
  },
  {
    wait = "document.querySelector('dialog[open]') !== null",
    timeout = 15000,
    note = "the task is opened in its float",
  },
  { press = "Escape", note = "the float closed" },
  { wait = "document.querySelector('dialog[open]') === null", timeout = 5000 },
  {
    expect = read(
      "path",
      "id=" .. PATH,
      "(window.__promoted = /Promote point → (\\S+)/.exec(d.body)[1].replace(/\\s*\\{#.*$/, ''), true)"
    ),
    note = "the id of the task",
  },
  {
    expect = "(async () => { const id = window.__promoted; const p = await fetch('/api/tasks/done_preview?id=' + id,"
      .. " { cache: 'no-store', credentials: 'omit', "
      .. AUTH
      .. " }); if (!p.ok) return false; const confirm = (await p.json()).confirm; return "
      .. outside(
        "[{ op: 'done', id: window.__promoted, confirm, outcome: 'seen', outcome_reason: 'looked at, not done' }]"
      )
      .. "; })()",
    note = "the task finished as seen with a reason, by another program",
  },
  {
    -- Back walks through the places the page put in the history (the task, the list): as often as it takes, at most
    -- three times. The words of the menu are not used: the page speaks the language of the browser.
    expect = "(async () => { for (let i = 0; i < 3; i += 1) { if (document.querySelector('"
      .. point("promo")
      .. "')) return true; history.back(); await new Promise((r) => setTimeout(r, 1000)); }"
      .. " return document.querySelector('"
      .. point("promo")
      .. "') !== null; })()",
    note = "Back of the browser, to the view of the learning paths",
  },
  {
    wait = "document.querySelector('"
      .. point("promo")
      .. "')?.dataset.state === 'seen'"
      .. " && document.querySelector('"
      .. point("promo")
      .. " .promoted') !== null && document.querySelector('"
      .. point("promo")
      .. " .promoted button') === null",
    timeout = 20000,
    note = "the point is seen, by its task, which is no open task any more (no button to open it)",
  },
  {
    wait = line_with({ "[~] Promote point" }),
    timeout = 15000,
    note = "and the file has the point seen",
  },

  -- the looks, for the person who reads the shots
  { scheme = "light" },
  { shot = "light" },
  { scheme = "dark" },
  { shot = "dark" },
}
append(rest)

return {
  id = "tasks.learning-paths",
  feature = "tasks.learning-paths",
  task = "tasks-desktop/testblatt-lernpfade-haken-grund-rueckgaengig-aenderung-von",
  title = "tasks-desktop: a learning path ticked, undone, given reasons, changed from outside and promoted to a task finished as seen",
  engine = "browser",
  app = "levels-hub",
  sizes = { { cols = 1200, rows = 900 } },
  steps = steps,
  judge = {
    "the reason of a point and the key of a blocked one read as a quiet line under the point",
    "the progress bar shows learned, seen, not applicable and open apart, in light and dark",
    "the marks, the menu button and the promoted task's line keep their contrast in dark",
  },
}
