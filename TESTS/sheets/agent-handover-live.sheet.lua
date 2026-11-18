-- The hand check of "Hand to an agent" with a real ai-desktop: what no test sees is the other program itself, its
-- dashboard, the focus of Windows and the question of a private area. What a machine checks runs elsewhere: ui/e2e
-- ("a task goes to ai-desktop": an ai-desktop double gets the task file with the secret in the header and no Origin,
-- the page says the job, the mode is kept, a refusal is said), crates/tasks-hub (the route, the refusals, /health with
-- its instance before the secret goes out, a chunked answer). Only on a private machine with ai-desktop installed
-- (never on the workstation). The hub, ai-desktop and the browser are the person's own; nothing is started for them.
--   testing sheets step agent-handover-live
return {
  id = "tasks-desktop.agent-handover-live",
  title = "Hand to an agent: a real ai-desktop takes the task, its dashboard, the focus, a private area",
  task = "tasks-desktop/abnahme-knopf-an-agent-uebergeben-mit-echtem-ai-desktop-auft",
  engine = "manual",
  steps = {
    {
      ask = "ai-desktop runs; in tasks-desktop Options shows 'Show AI functions' ticked, and the detail of an open task"
        .. " has 'Hand to an agent ...' beside 'Open in Neovim', looking like it (no colour, no badge)?",
    },
    {
      ask = "'Only fill in', Hand over: the page says 'Handed to ai-desktop (job ...)', and the job stands in the"
        .. " dashboard of ai-desktop with the title, the id and the text of the task, not running?",
    },
    {
      ask = "Without the tick 'Open the dashboard of ai-desktop afterwards' (the default): ai-desktop does not come to"
        .. " the front, its button in the task bar flashes (the hub runs in the background and cannot hand the"
        .. " foreground on)? With the tick: a new tab shows the dashboard of ai-desktop with this job selected, and the"
        .. " tick is still set the next time?",
    },
    {
      ask = "'Run at once' on a task of a public area: the page says the agent is working on it, the job runs in the"
        .. " dashboard, and the dialog opens with 'Run at once' the next time?",
    },
    {
      ask = "A task of a private or unclassified area, 'Run at once' with a cloud model in ai-desktop: the dialog said"
        .. " the area is private, the page says the job waits for the confirmation, and ai-desktop asks before it sends?",
    },
    {
      ask = "A task in decision: the choice offers 'Prepare the decision', and the job in ai-desktop has that kind?"
        .. " (A finished task of the Backlog gets 'Review against the acceptance' with"
        .. " ALL/ki-erledigte-task-gegen-akzeptanz-pruefen.)",
    },
    {
      ask = "A job that runs with Claude Code: the agent claims the task, and without a click the list marks it"
        .. " 'agent', the page says 'Agent <job> works on ...', and the detail's 'Open the job in ai-desktop' shows that"
        .. " job? When the agent finishes it: 'Finished by agent <job>: ...' and the task leaves the list?",
    },
    {
      ask = "ai-desktop ended: Hand over says 'Not handed over: ai-desktop is not running', and after the next focus of"
        .. " the window the button is still there (installed) or gone (a build without installer)?",
    },
    {
      ask = "Options > 'Show AI functions' off: no button in the detail, no entry in the context menu of a task, no"
        .. " 'Hand the task to an agent' in the palette (Ctrl+K)?",
    },
  },
}
