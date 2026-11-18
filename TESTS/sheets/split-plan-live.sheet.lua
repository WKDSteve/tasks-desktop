-- The hand check of "Split into tasks" with a real ai-desktop and model: what no test sees is what a model proposes
-- for a real plan, the question before a private plan leaves the machine and how the dialog reads with real drafts.
-- What a machine checks runs elsewhere: ui/e2e ("Split into tasks": an ai-desktop double gets the plan file and the
-- list of its tasks, nothing is ticked at first, only the ticked drafts are made, a new phase only after its yes),
-- crates/tasks-hub (the routes, the plan file, only the block of drafts reaches the page), ui/src/lib/split.test.ts
-- (the block, #N, the refusals). Only on a private machine with ai-desktop installed (never on the workstation).
--   testing sheets step split-plan-live
return {
  id = "tasks-desktop.split-plan-live",
  title = "Split into tasks: a real ai-desktop proposes the missing tasks of a plan; only the ticked are made",
  task = "tasks-desktop/abnahme-in-tasks-zerlegen-mit-echtem-ai-desktop-entwuerfe-ab",
  engine = "manual",
  steps = {
    {
      ask = "ai-desktop runs; the plan view of a plan with a definition of done has 'Split into tasks …' beside the"
        .. " other buttons, looking like them, and no such button with 'Show AI functions' off?",
    },
    {
      ask = "Split into tasks on a plan of a public area: after a while the drafts stand in the dialog, none ticked,"
        .. " sensible, none repeating a task the plan has (open or finished)?",
    },
    {
      ask = "A plan of a private area with claude-code (or a cloud model) as the jobs model: the dialog asks before it"
        .. " sends; 'Do not send' sends nothing?",
    },
    {
      ask = "Two drafts ticked, one of them of a phase the plan does not have: Create asks once, then about the phase;"
        .. " 'Without them' makes only the other (its file has plan, phase and the acceptance), 'Add the phases' puts"
        .. " the phase into the phase order of the plan and makes both?",
    },
    {
      ask = "A draft that waits for another (#N): the made task has the id of that other in after/blocked_by?",
    },
  },
}
