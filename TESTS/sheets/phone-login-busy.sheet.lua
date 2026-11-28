-- The phone page against a hub with too many logins (the app `busy-hub` of .testing.lua: the page of mobile.lock under
-- /m/, the vault of the levels sheet, appkit's guard of pairing, challenge and device session lowered to 2 a minute),
-- step by step:
--   testing sheets step phone-login-busy --headed
-- The phone pairs (1 of 2), the page is loaded again and logs in with its device key: the challenge is the 2nd, the
-- session the 3rd and gets 429. The page must say that the PC has too many logins (data-state "busy"), not "offline",
-- stay off the pairing screen, and come back by itself once the minute of the guard is over (its tries come after 5 s,
-- 15 s and 60 s: the third one, about 80 s after the reload, finds the guard empty). The logic is checked in tasks-mobile
-- (src/lib/app.test.ts, src/lib/device.test.ts) against appkit-ui's real login; this sheet checks the same through the
-- real hub and the built page.

local BAR = '[data-testid="connection"]'
local function state(value)
  return "document.querySelector('" .. BAR .. "')?.dataset.state === '" .. value .. "'"
end

return {
  id = "tasks.phone-login-busy",
  feature = "tasks.phone-login-busy",
  task = "tasks-desktop/handy-seite-zeigt-429-der-anmeldung-als-offline",
  title = "tasks-desktop: the phone page says that the hub has too many logins (429), not offline, and comes back by itself",
  engine = "browser",
  app = "busy-hub",
  sizes = { { cols = 412, rows = 860 } },
  steps = {
    {
      open = "${link}",
      note = "the phone page with the code of the hub: it pairs (the 1st of 2 a minute)",
    },
    { wait = state("live"), timeout = 30000, note = "paired and connected" },
    {
      expect = "(setTimeout(() => location.reload(), 0), true)",
      note = "the page loaded again: it logs in with its device key (challenge 2nd, session 3rd: 429)",
    },
    {
      wait = state("busy") .. " && document.querySelector('[data-testid=\"login-busy\"]') !== null",
      timeout = 20000,
      note = "said as too many logins, not as offline",
    },
    { expect = "document.querySelector('nav.bottom') !== null", note = "not the pairing screen" },
    { shot = "busy" },
    {
      wait = state("live"),
      timeout = 120000,
      note = "the guard's minute is over: the page logged in by itself",
    },
  },
}
