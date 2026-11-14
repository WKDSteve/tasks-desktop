<script lang="ts">
  // The choice of the areas of the filter, with how many tasks each would keep. One component for the list and for the
  // bar at the top (Options > "Area filter in the top bar"): both change the one filter of the page, so they never
  // disagree.
  import MultiSelect from 'appkit-ui/MultiSelect.svelte';
  import type { App } from '../lib/app.svelte';
  import { areaLabel } from '../lib/filter';
  import { translate, type Key } from '../lib/i18n';

  let { app, hint }: { app: App; hint: string } = $props();

  const t = (key: Key, params: Record<string, string | number> = {}) => translate(app.lang, key, params);

  // Beside each area how many tasks it would keep under the other filters (switched off in Options).
  const counts = $derived(app.areaCountsShown ? app.areaCounts : null);
  const areaOptions = $derived([
    // the area groups first: a name that stands for several areas (the engine's `area_groups`)
    ...app.areaGroups
      .filter((g) => !app.allAreaNames.includes(g.name))
      .map((g) => ({
        value: g.name,
        label: t('areas.group', { name: g.name }),
        title: t('areas.group.title', { members: g.members.join(', ') || '-' }),
        ...(counts ? { suffix: String(counts.get(g.name) ?? 0) } : {}),
      })),
    ...app.areaNames
      .map((name) => ({
        value: name,
        label: app.shortAreas ? areaLabel(name, app.allAreaNames) : name,
        title: name,
        ...(counts ? { suffix: String(counts.get(name) ?? 0) } : {}),
      }))
      .sort((x, y) => x.label.localeCompare(y.label)),
  ]);
  // Counts from the first picture of the cache may still change when the hub answers: the choice says so.
  const areasNote = $derived(
    counts && app.cachedAt !== null ? `${t('multi.note.areas')} ${t('multi.note.counts_cached')}` : t('multi.note.areas'),
  );
</script>

<MultiSelect
  label={t('nav.areas')}
  {hint}
  note={areasNote}
  options={areaOptions}
  selected={app.filter.areas}
  onchange={(areas) => (app.filter = { ...app.filter, areas })}
  clearLabel={t('kit.select.clear', { label: t('nav.areas') })}
  resetLabel={t('multi.reset')}
  searchLabel={t('multi.search')}
/>
