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
  {
    id = "tasks.lists",
    title = "The tab Lists: quick lists of short entries, the first line making the first list, a #word a tag, newest on top, ticked, filtered by the engine, an entry made a task, the done ones deleted in one step",
    docs = "README.md",
  },
  {
    id = "tasks.meetings-make",
    title = "A meeting from a quick line of the palette: nothing written before Create, its cover, a recording, a document; a meeting that is over opens on its result, is ticked and done",
    docs = "README.md",
  },
  {
    id = "tasks.phone-login-busy",
    title = "The phone page against a hub with too many logins (429): said as such, not as offline, not the pairing screen, and back by itself after the minute of the guard",
    docs = "README.md",
  },
  {
    id = "tasks.path-levels",
    title = "The levels of a learning path set in a form: written to ## Level with a badge and rewards, refused by the engine, the XP of a promoted task",
    docs = "README.md",
  },
  {
    id = "tasks.learning-paths",
    title = "A learning path ticked and undone, a point set not applicable or blocked with its reason, a change of the file by another program kept, a point promoted to a task finished as seen",
    docs = "README.md",
  },
  {
    id = "tasks.learn-steps",
    title = "Three views of the tab Lernpläne: the next learning step (cards, keys, the safety question, the machine filter), the learning time (planned against done hours, the sessions) and notes & sources (the engine's search, a hit opens its point)",
    docs = "README.md",
  },
  {
    id = "tasks.learn-figures",
    title = "The figures of the tab Lernpläne: the overview with its period (today to year) against the period before, in words and a mark, and its bars as a table; the statistics over days of one's own, per path, the learning days",
    docs = "README.md",
  },
  {
    id = "tasks.pathmap",
    title = "The competence map of the learning paths: boxes by stage, frames of projects, the arrows of requires, a circle and a ghost; finished ones hidden, the list, a box opens its path",
    docs = "README.md",
  },
  {
    id = "tasks.learn-tab",
    title = "The tab Learning plans of the menu bar: after View, the views of the learning plans that are there, the dot of the view shown, a link to a view not built yet",
    docs = "README.md",
  },
  {
    id = "tasks.learn-views",
    title = "Badges, rewards, competence catalogue and evidence of all learning paths: earned and open badges, a reward granted and taken back, a field with its stage and paths, evidence by field",
    docs = "README.md",
  },
}
