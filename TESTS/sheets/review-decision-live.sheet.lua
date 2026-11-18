-- The hand check of "Check against the acceptance" and "Prepare the decision" with a real ai-desktop and Claude Code:
-- what no test sees is the agent itself (does it judge every line of the acceptance with evidence, does it propose real
-- options), the time it takes and the question of a private area in the real dialog. What a machine checks runs
-- elsewhere: ui/e2e ("a finished task is checked against its acceptance", "a task that waits for a decision is
-- prepared by an agent": a double of ai-desktop, the real engine writes the sections), crates/hub-testkit
-- (agent_result: only the engine's sections reach the page), tasks.nvim (agent_answer, set_section). Only on a private
-- machine with ai-desktop installed (never on the workstation).
--   testing sheets step review-decision-live
return {
  id = "tasks-desktop.review-decision-live",
  title = "Review and decision with a real ai-desktop and Claude Code: the proposal, adopt, the follow-up",
  task = "tasks-desktop/abnahme-pruefung-und-entscheidung-mit-echtem-ai-desktop",
  engine = "manual",
  steps = {
    {
      ask = "In a terminal `claude` -> `/login` once; ai-desktop runs with the jobs model claude-code, and in"
        .. " tasks-desktop 'Show AI functions' is ticked?",
    },
    {
      ask = "A finished task with commits (the list under the open ones, period 'all'), its dialog 'Check against the"
        .. " acceptance ...': the dialog says the agent works on it (job ...); later it shows the review with every"
        .. " line of the acceptance met, open or not checkable, with evidence; `git status` of the vault and the"
        .. " repositories is clean?",
    },
    {
      ask = "'Adopt': the Backlog file has its section ## Prüfung, `git diff` shows only that section and `updated`;"
        .. " the undo in the message takes it out again?",
    },
    {
      ask = "A review with something open proposes a follow-up: it is made only with 'Create the follow-up task', in"
        .. " the same area, and the dialog names its id?",
    },
    {
      ask = "A real task in decision with refs, 'Prepare the decision ...' from its detail or its context menu: 2-4"
        .. " options with their consequences, a recommendation, open assumptions and a question with (empfohlen);"
        .. " 'Adopt' writes ## Vorschlag and the questions (only when the task had none), the status stays decision,"
        .. " and its questions offer the options to decide?",
    },
    {
      ask = "A task of a private area with a cloud model in ai-desktop: the dialog asks before it sends, and 'Not"
        .. " now' sends nothing?",
    },
    {
      ask = "The dialog closed while the agent works: the job stays in the dashboard of ai-desktop, and nothing is"
        .. " written into the task?",
    },
  },
}
