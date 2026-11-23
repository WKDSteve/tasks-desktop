# Creating a learning path (desktop and web variant)

The desktop app and the web variant only **show** learning paths; they are created and edited as files by the engine
(tasks.nvim). The full workflow, with checklists for before writing, for every point and for finishing, is one document
for all surfaces:

**[tasks.nvim/docs/LEARNING-PATH-WORKFLOW.md](https://github.com/WKDSteve/tasks.nvim/blob/main/docs/LEARNING-PATH-WORKFLOW.md)**
(local: `$REPOS_DIR/tasks.nvim/docs/LEARNING-PATH-WORKFLOW.md`)

## What this app adds

| Need | Where in the app |
| --- | --- |
| See progress, XP and levels of all paths | tab **Learning plans › Learning paths** (`#view=paths` in the web variant) |
| See which point to learn next | tab **Learning plans**, the view with the next points per running path |
| See paths as a map of competences | **Learning plans › Competence map** (`#view=pathmap`) |
| See a badge or image of a path | the path folder's `assets/` (images only from there, `LP-16`) |
| Tick a point, set a reward | the path view; the file is changed by the engine (`node_set`), not by editing text |

## Checks after you made a path (5 minutes in the app)

- [ ] The path appears in the list with the right title, icon and status.
- [ ] Points, XP and the stage list match `tasks path <area>/<slug>`.
- [ ] Badges show as images (not as broken links); a missing badge means a wrong path in `## Level`.
- [ ] Open a **point with an exercise note**: the task text and "Fertig, wenn" are readable. An exercise point that shows only a title
  is the known gap `tasks.nvim/uebungspunkte-mit-ausformulierter-aufgabe` (click-through to the written-out task).
- [ ] Optional groups (literature) do not count towards "path done".

If something looks wrong here, fix the file, not the app (the app is a view).
