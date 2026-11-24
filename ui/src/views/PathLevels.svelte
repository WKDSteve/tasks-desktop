<script lang="ts">
  // The levels of a learning path as a form (capability `path_levels`): per level a threshold in XP or percent, a name,
  // a badge (a picture of the path below `assets/badges/`) and a reward, and a reward for the whole path. Loaded only when
  // the person opens it (PathsView). The engine writes `## Level` and judges every rule (thresholds that rise, lengths,
  // the badge); the form says only a threshold that is no whole number, and shows the engine's reason when it refuses.
  import { untrack } from 'svelte';
  import type { App } from '../lib/app.svelte';
  import { translate, type Key } from '../lib/i18n';
  import type { PathDocument } from '../lib/contract';
  import type { Op } from '../lib/api';
  import {
    badgeFiles,
    LEVEL_NAME_MAX,
    LEVEL_REWARD_MAX,
    LEVELS_MAX,
    levelRows,
    levelsOp,
    nextRow,
    type DoneRow,
    type LevelRow,
  } from '../lib/paths';
  import { markHidden } from '../lib/text';
  import { levelWord, type LevelWord } from './pathLevelsWords';

  let {
    app,
    doc,
    busy,
    send,
    onclose,
  }: {
    app: App;
    doc: PathDocument;
    busy: boolean;
    /** Sends the operation; resolves to whether the engine wrote it. */
    send: (op: Op) => Promise<boolean>;
    onclose: () => void;
  } = $props();
  const t = (key: Key, params: Record<string, string | number> = {}) => translate(app.lang, key, params);
  const w = (key: LevelWord, params: Record<string, string | number> = {}) => levelWord(app.lang, key, params);

  // The form starts from the levels as the engine read them; it is not reset by a read of the path while it is open
  // (the person's typing stays), only by opening it again.
  const start = untrack(() => levelRows(doc.levels));
  let rows = $state<LevelRow[]>(start.rows);
  let done = $state<DoneRow>(start.done);
  let invalid = $state<number | null>(null);
  const badges = $derived(badgeFiles(doc.path.assets));
  const pathId = untrack(() => doc.path.id);
  // The version the form was filled from: sent with the levels, so a path changed meanwhile (a reward granted, another
  // program) is refused as a conflict instead of being overwritten with what the form still shows.
  const etag = untrack(() => doc.path.etag);

  /** The choices of a row's badge: the pictures of the path, and the one written that is not among them. */
  const badgeChoices = (row: LevelRow): string[] => (row.badge && !badges.includes(row.badge) ? [row.badge, ...badges] : badges);
  const fileName = (file: string): string => markHidden(file.slice('assets/badges/'.length) || file);

  function add(): void {
    if (rows.length >= LEVELS_MAX) return;
    rows = [...rows, nextRow(rows)];
  }
  function remove(i: number): void {
    rows = rows.filter((_, k) => k !== i);
    invalid = null;
  }
  function move(i: number, by: -1 | 1): void {
    const j = i + by;
    if (j < 0 || j >= rows.length) return;
    const next = [...rows];
    [next[i], next[j]] = [next[j]!, next[i]!];
    rows = next;
  }

  async function save(e: SubmitEvent): Promise<void> {
    e.preventDefault();
    if (busy) {
      app.tell('error', 'write.busy');
      return;
    }
    const op = levelsOp(pathId, etag, rows, done);
    if ('invalid' in op) {
      invalid = op.invalid;
      document.getElementById(`level-threshold-${op.invalid}`)?.focus();
      return;
    }
    invalid = null;
    if (await send(op)) onclose();
  }
</script>

<form class="levels-form" data-hint={w('hint.form')} aria-label={t('paths.levels.form')} data-levels-form onsubmit={(e) => void save(e)}>
  <p class="hint">{w('hint')}</p>
  {#if rows.length === 0}
    <p class="none">{w('empty')}</p>
  {/if}
  <ol class="rows">
    {#each rows as row, i (i)}
      <li class="row" data-level-row={i + 1}>
        <fieldset>
          <legend>{t('paths.level', { n: i + 1 })}</legend>
          <span class="field threshold" data-hint={w('hint.threshold')}>
            <label for="level-threshold-{i}">{w('threshold')}</label>
            <span class="pair">
              <input spellcheck="false"
                id="level-threshold-{i}"
                type="text"
                inputmode="numeric"
                maxlength="6"
                aria-required="true"
                bind:value={row.threshold}
                aria-invalid={invalid === i ? 'true' : undefined}
                aria-describedby={invalid === i ? `level-invalid-${i}` : undefined}
              />
              <select aria-label={w('unit')} bind:value={row.unit}>
                <option value="xp">XP</option>
                <option value="percent">%</option>
              </select>
            </span>
            {#if invalid === i}<span id="level-invalid-{i}" class="missing" role="alert">{w('threshold_invalid')}</span>{/if}
          </span>
          <span class="field" data-hint={w('hint.name')}>
            <label for="level-name-{i}">{w('name')}</label>
            <input spellcheck="true" id="level-name-{i}" type="text" maxlength={LEVEL_NAME_MAX} bind:value={row.name} />
          </span>
          <span class="field" data-hint={w('hint.badge')}>
            <label for="level-badge-{i}">{w('badge')}</label>
            <select id="level-badge-{i}" bind:value={row.badge}>
              <option value="">{w('no_badge')}</option>
              {#each badgeChoices(row) as file (file)}
                <option value={file}>{fileName(file)}</option>
              {/each}
            </select>
          </span>
          <span class="field" data-hint={w('hint.reward')}>
            <label for="level-reward-{i}">{w('reward')}</label>
            <input spellcheck="true" id="level-reward-{i}" type="text" maxlength={LEVEL_REWARD_MAX} bind:value={row.reward} />
          </span>
          <span class="actions">
            <button type="button" aria-label={w('up', { n: i + 1 })} disabled={i === 0} onclick={() => move(i, -1)}>↑</button>
            <button type="button" aria-label={w('down', { n: i + 1 })} disabled={i === rows.length - 1} onclick={() => move(i, 1)}>↓</button>
            <button type="button" aria-label={w('remove', { n: i + 1 })} onclick={() => remove(i)}>{w('remove_short')}</button>
          </span>
        </fieldset>
      </li>
    {/each}
  </ol>
  <p>
    <button type="button" onclick={add} disabled={rows.length >= LEVELS_MAX}>{w('add')}</button>
  </p>
  {#if badges.length === 0}
    <p class="hint">{w('no_badges')}</p>
  {/if}
  <fieldset class="done" data-hint={w('hint.done')}>
    <legend>{w('done')}</legend>
    <label class="check"><input type="checkbox" bind:checked={done.on} data-levels-done />{w('done_on')}</label>
    {#if done.on}
      <span class="field">
        <label for="level-done-reward">{w('reward')}</label>
        <input spellcheck="true" id="level-done-reward" type="text" maxlength={LEVEL_REWARD_MAX} bind:value={done.reward} />
      </span>
    {/if}
  </fieldset>
  <span class="buttons">
    <button type="submit" class="primary" aria-disabled={busy ? 'true' : undefined}>{w('save')}</button>
    <button type="button" onclick={onclose}>{w('cancel')}</button>
  </span>
</form>

<style>
  .levels-form {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    max-width: 48rem;
  }
  .hint,
  .none {
    margin: 0;
    color: var(--muted);
    font-size: 0.9em;
  }
  .rows {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  fieldset {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: 0.5rem;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.4rem 0.6rem 0.6rem;
    margin: 0;
    min-width: 0;
  }
  legend {
    font-weight: 600;
    padding: 0 0.2rem;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    flex: 1 1 9rem;
    min-width: 0;
  }
  .field.threshold {
    flex: 0 1 9rem;
  }
  .pair {
    display: flex;
    gap: 0.25rem;
  }
  .pair input {
    width: 5rem;
    min-width: 0;
  }
  input[type='text'],
  select {
    font: inherit;
    color: var(--text);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.3rem 0.4rem;
    min-height: 2rem;
  }
  .actions,
  .buttons {
    display: flex;
    gap: 0.3rem;
  }
  .check {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
  }
  button {
    background: var(--surface);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 0.25rem 0.6rem;
    min-height: 2rem;
    cursor: pointer;
  }
  button:disabled,
  button[aria-disabled='true'] {
    cursor: default;
    opacity: 0.6;
  }
  button.primary {
    background: var(--accent);
    color: var(--accent-text);
    border-color: var(--accent);
  }
  .missing {
    color: var(--bad);
  }
  @media (pointer: coarse) {
    button,
    input[type='text'],
    select {
      min-height: 2.75rem;
    }
  }
</style>
