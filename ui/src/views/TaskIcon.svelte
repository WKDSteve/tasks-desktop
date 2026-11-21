<script lang="ts">
  // The icon of a task wherever it stands as a card or a line (board, today, inbox, views, calendar, timeline): the
  // inheritance of lib/icons.ts (own, path, category) drawn by ItemIcon. It stands beside the title, never inside
  // its text, and is hidden from a screen reader (the title says what the task is).
  import type { App } from '../lib/app.svelte';
  import type { Icon } from '../lib/contract';
  import { shownIcon } from '../lib/icons';
  import ItemIcon from './ItemIcon.svelte';

  let {
    app,
    task,
    size = 14,
  }: {
    app: App;
    task: { id: string; icon?: Icon; point?: string; category?: readonly string[] };
    size?: number;
  } = $props();

  const shown = $derived(
    shownIcon({ kind: 'task', id: task.id, icon: task.icon, point: task.point, category: task.category }, app.pathIcons, app.categoryIcons),
  );
  $effect(() => {
    if (task.point && !task.icon) app.wantPathIcons();
  });
</script>

<ItemIcon {app} {shown} {size} />
