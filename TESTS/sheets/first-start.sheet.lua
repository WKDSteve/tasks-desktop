-- The first start in the page against a hub without a vault (the app `setup-hub` of .testing.lua: a folder of the run,
-- the seams of the dialogs, nothing of the user's profile), step by step:
--   testing sheets step first-start --headed
-- The steps go by the ids of the card's sections, not by its words: the page speaks the language of the browser. Only
-- the reasons the hub gives are its own English words.
-- What only a real profile shows (no console window on a double click, the real dialogs of Windows, the installation
-- into the user's folder and the page opened anew) stays a hand run: tasks-desktop/handlauf-ersteinrichtung-in-der-seite.
return {
  id = "tasks.first-start",
  feature = "tasks.first-start",
  task = "tasks-desktop/handlauf-ersteinrichtung-in-der-seite",
  title = "tasks-desktop: the first start in the page (vault, Neovim, installation)",
  engine = "browser",
  app = "setup-hub",
  sizes = { { cols = 1100, rows = 900 } },
  steps = {
    { open = "${link}", note = "the link the double click opens" },
    {
      wait = "document.getElementById('setup-vault') !== null",
      timeout = 15000,
      note = "no vault: the setup card asks for one (the session of the link is taken before the hub is set up)",
    },
    { expect = "!location.href.includes('pair')", note = "the code has left the address" },
    {
      expect = "document.getElementById('setup-install') !== null",
      note = "the installation is offered beside it",
    },
    {
      expect = "document.getElementById('setup-nvim') === null",
      note = "one step at a time: Neovim comes later",
    },
    { shot = "vault-step" },
    {
      click = "section[aria-labelledby=setup-vault] button.primary",
      note = "the folder dialog (its seam chooses the run's folder)",
    },
    {
      wait = "document.getElementById('setup-nvim') !== null && document.getElementById('setup-vault') === null",
      timeout = 15000,
      note = "the vault is kept, the page loads again and asks for Neovim next",
    },
    { shot = "nvim-step" },
    {
      click = "section[aria-labelledby=setup-nvim] button.primary",
      note = "the file dialog (its seam names a nvim.exe that is not there)",
    },
    {
      wait = "(document.querySelector('.setup [role=alert]')?.textContent ?? '').includes('there is no such program')",
      note = "the hub checked the choice and refused it, with its reason and without a path",
    },
    {
      expect = "document.getElementById('setup-nvim') !== null",
      note = "and Neovim is still the step",
    },
    {
      click = "section[aria-labelledby=setup-install] button:not(:last-child)",
      note = "install (the seam writes the command to a log instead of running it)",
    },
    {
      wait = "document.getElementById('setup-install') === null && document.querySelector('.setup p[role=status]') !== null",
      note = "the page says that the hub starts again from the installed copy, and offers it no more",
    },
    { shot = "installing" },
  },
  judge = {
    "the card reads as one step at a time: what is missing, one button, no path anywhere",
    "the refusal of the program is visible next to its button and readable in light and dark",
  },
}
