-- The hand check of "Suggest fields" with a real ai-desktop and a real model: what no test sees is the model's answer
-- itself, the question before a text leaves the machine and how the filled form reads. What a machine checks runs
-- elsewhere: ui/e2e ("Suggest fields" fills the new-task form: an ai-desktop double gets the text, the choices and the
-- yes with the secret, the form is filled, nothing is created), crates/tasks-hub (the routes, the refusals, only the
-- result of the job reaches the page), ui/src/lib/suggestFields.test.ts (the check of a draft), ai-desktop's
-- tests/draft-jobs.test.mjs (the prompt, the check, private always) and tasks.nvim's tasks_draft_spec. Only on a private
-- machine with ai-desktop installed (never on the workstation).
--   testing sheets step draft-fields-live
return {
  id = "tasks-desktop.draft-fields-live",
  title = "Suggest fields: a real ai-desktop drafts a new task from a free text; nothing is created before Create",
  task = "tasks-desktop/abnahme-felder-vorschlagen-mit-echtem-ai-desktop-formular-un",
  engine = "manual",
  steps = {
    {
      ask = "ai-desktop runs with a local model (Ollama) as its jobs model; the new-task form (c) has 'Suggest fields ...'"
        .. " above the title, looking like any other button?",
    },
    {
      ask = "A few lines (a note about a bug of this vault), Suggest: after a while title, area, kind, prio, effort,"
        .. " value, tags, category and the acceptance lines are filled in, sensibly, and no question was asked (a local"
        .. " model)? The dashboard of ai-desktop did not come to the front?",
    },
    {
      ask = "Every filled field can be changed, a value of no list of this vault is named under the form ('Left out"
        .. " ...'), and only Create makes the task (Cancel leaves nothing behind)?",
    },
    {
      ask = "With claude-code (or a cloud model) as the jobs model of ai-desktop: Suggest asks 'the text counts as"
        .. " private ... Send the text there anyway?'; 'Do not send' says nothing was sent, 'Send' fills the form?",
    },
    {
      ask = "After 'Do not send', and after closing the form while it asks (Escape): the dashboard of ai-desktop shows"
        .. " no waiting draft-task job any more (before, it stayed there with the text)? The same after 'n' to the"
        .. " question of ':Tasks new --draft' in Neovim?",
    },
    {
      ask = "In Neovim: ':Tasks new --draft Der Knopf im Formular soll blau sein' and ':'<,'>Tasks new --draft' over a"
        .. " note open the form of :Tasks new filled in the same way (the same question for a model that is not"
        .. " local); <C-s> creates, q drops? Without ai-desktop, ai.nvim answers after its question?",
    },
    {
      ask = "Options > 'Show AI functions' off: no 'Suggest fields ...' in the new-task form?",
    },
  },
}
