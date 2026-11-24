<script lang="ts">
  // All reminders: every task with a `remind:` day, open or finished, by day, with a mark on those whose day has
  // come (see `lib/reminders.ts`). Several can be chosen and sent to one e-mail address: the hub writes the mail from
  // its own list and leaves out the tasks of areas that may not leave it (private, or without a class), so what the
  // page shows before sending is the hub's answer, the mail word for word. A hub without a mail account shows the mail
  // and says that it cannot send. The web variant has no hub: it lists, and says so.
  import { untrack } from 'svelte';
  import type { App } from '../lib/app.svelte';
  import { ApiError } from '../lib/api';
  import { translate, type Key } from '../lib/i18n';
  import { looksLikeAddress, reminderRows, type RemindersMail } from '../lib/reminders';
  import Info from 'appkit-ui/Info.svelte';
  import { markHidden } from '../lib/text';

  let { app }: { app: App } = $props();
  const t = (key: Key, params: Record<string, string | number> = {}) => translate(app.lang, key, params);

  const rows = $derived(reminderRows(app.tasks, app.snapshot?.reminders, app.today));
  const dayFormat = $derived(new Intl.DateTimeFormat(app.lang, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }));
  const say = (day: string): string => dayFormat.format(new Date(`${day}T00:00:00Z`));
  const titleOf = (id: string): string => rows.find((r) => r.id === id)?.title ?? id;

  // The choice: ids, kept while the list changes under it (a task that lost its reminder drops out).
  let picked = $state<ReadonlySet<string>>(new Set());
  const chosen = $derived(rows.filter((r) => picked.has(r.id)).map((r) => r.id));
  let to = $state('');
  const addressOk = $derived(looksLikeAddress(to.trim()));

  // The mail the hub wrote for the choice and the address it was asked with; another choice or address asks again.
  // What is sent is this mail and no other: the send names its address, its ids and its digest (the hub refuses
  // when it would write another mail now), never the boxes and the field as they stand at that moment.
  let mail = $state<RemindersMail | null>(null);
  let busy = $state(false);
  let problem = $state('');
  let done = $state('');
  // Each question has a number: an answer that comes after the choice, the address or the list changed is dropped.
  let asked = 0;

  function forget(): void {
    asked += 1;
    busy = false;
    mail = null;
    problem = '';
    done = '';
  }
  // The list changed under the preview (a task renamed, finished, its reminder moved): what is shown is not the mail
  // of the list any more. A mail that went out stays said.
  $effect(() => {
    void app.snapshot?.rev;
    untrack(() => {
      if (mail !== null && !mail.sent) forget();
    });
  });
  function pick(ids: readonly string[]): void {
    picked = new Set(ids);
    forget();
  }
  function toggle(id: string, on: boolean): void {
    const next = new Set(picked);
    if (on) next.add(id);
    else next.delete(id);
    picked = next;
    forget();
  }

  /** The words for a refusal of the hub: its codes that the page knows, else its own message. */
  function wordsFor(error: unknown): string {
    const code = error instanceof ApiError ? error.code : '';
    if (code === 'mail_not_set_up') return t('reminders.no_account');
    if (code === 'nothing_to_send') return t('reminders.nothing');
    if (code === 'bad_address') return t('reminders.bad_address');
    if (code === 'mail_changed') return t('reminders.changed');
    return t('reminders.failed', { message: error instanceof Error ? error.message : '' });
  }
  /** Ask the hub; its answer counts only while nothing changed since the question. */
  async function through(question: () => Promise<RemindersMail>): Promise<void> {
    asked += 1;
    const mine = asked;
    busy = true;
    problem = '';
    done = '';
    try {
      const answer = await question();
      if (mine !== asked) return;
      mail = answer;
      if (answer.sent) done = t('reminders.sent', { n: answer.included.length, to: answer.to });
    } catch (error) {
      if (mine !== asked) return;
      // The mail the hub would send now is not the one shown: it is not shown as if it were.
      if (error instanceof ApiError && error.code === 'mail_changed') mail = null;
      problem = wordsFor(error);
    } finally {
      if (mine === asked) busy = false;
    }
  }
  function preview(): void {
    if (busy || chosen.length === 0 || !addressOk) return;
    const [address, ids] = [to.trim(), [...chosen]];
    void through(() => app.remindersMail(address, ids));
  }
  function send(): void {
    const shown = mail;
    if (busy || shown === null || shown.sent || !shown.account || shown.included.length === 0) return;
    void through(() => app.remindersMail(shown.to, [...shown.included], shown));
  }
</script>

<section class="reminders" aria-label={t('nav.reminders')}>
  <header class="intro">
    <div class="head">
      <h2>{t('reminders.title')}</h2>
      <Info hint={t('reminders.intro')} label={t('hint.about', { what: t('nav.reminders') })} />
    </div>
  </header>

  {#if rows.length === 0}
    <p class="none">{t('reminders.none')}</p>
  {:else}
    <div class="choose" role="group" aria-label={t('reminders.choose')}>
      <button type="button" data-pick="all" onclick={() => pick(rows.map((r) => r.id))}>{t('reminders.pick.all')}</button>
      <button type="button" data-pick="due" onclick={() => pick(rows.filter((r) => r.due).map((r) => r.id))}>{t('reminders.pick.due')}</button>
      <button type="button" data-pick="none" onclick={() => pick([])} disabled={chosen.length === 0}>{t('reminders.pick.none')}</button>
      <span role="status">{t('reminders.count', { n: chosen.length, total: rows.length })}</span>
    </div>
    <table>
      <thead>
        <tr>
          <th scope="col"><span class="sr-only">{t('reminders.col.pick')}</span></th>
          <th scope="col">{t('reminders.col.day')}</th>
          <th scope="col">{t('reminders.col.task')}</th>
          <th scope="col">{t('reminders.col.area')}</th>
          <th scope="col">{t('reminders.col.to')}</th>
        </tr>
      </thead>
      <tbody>
        {#each rows as row (row.id)}
          <tr class:due={row.due} class:finished={row.finished} data-reminder={row.id}>
            <td data-hint={t('hint.form.reminders.pick')}>
              <input
                type="checkbox"
                checked={picked.has(row.id)}
                aria-label={t('reminders.pick.one', { title: row.title })}
                onchange={(e) => toggle(row.id, e.currentTarget.checked)}
              />
            </td>
            <td class="day">
              {say(row.day)}{#if row.at}, {row.at}{/if}
              {#if row.due}<strong class="mark" data-due>{t('reminders.due')}</strong>{/if}
            </td>
            <th scope="row">
              {#if row.finished}
                <span>{markHidden(row.title)}</span> <small>({t('remind.finished')})</small>
              {:else}
                <button type="button" class="link" onclick={() => app.peek(row.id)}>{markHidden(row.title)}</button>
              {/if}
            </th>
            <td>{row.area}</td>
            <td class="to">{row.to.join(', ')}</td>
          </tr>
        {/each}
      </tbody>
    </table>

    {#if app.machineActions}
      <form
        class="mail"
        aria-label={t('reminders.mail')}
        onsubmit={(e) => {
          e.preventDefault();
          preview();
        }}
      >
        <label data-hint={t('hint.form.reminders.to')}>
          <span>{t('reminders.to')}</span>
          <input
            type="email"
            autocomplete="email"
            spellcheck="false"
            maxlength="254"
            bind:value={to}
            oninput={forget}
            aria-invalid={to.trim() !== '' && !addressOk}
          />
        </label>
        <button type="submit" data-preview disabled={busy || chosen.length === 0 || !addressOk}>{t('reminders.preview')}</button>
        <small class="rule">{t('reminders.rule')}</small>
      </form>
    {:else}
      <p class="note" data-reminders-web>{t('reminders.web')}</p>
    {/if}

    <!-- Always in the page, so that a screen reader hears them fill. -->
    <p class="problem" role="alert">{problem}</p>
    <p class="done" role="status" data-reminders-sent>{done}</p>

    {#if mail}
      <section class="preview" aria-label={t('reminders.preview.title')} data-reminders-preview>
        <h3>{t('reminders.preview.title')}</h3>
        <dl>
          <dt>{t('reminders.to')}</dt>
          <dd>{mail.to}</dd>
          <dt>{t('reminders.subject')}</dt>
          <dd>{mail.subject}</dd>
        </dl>
        {#if mail.included.length > 0}
          <pre translate="yes">{mail.text}</pre>
        {:else}
          <p class="note">{t('reminders.nothing')}</p>
        {/if}
        {#if mail.leftOut.length > 0}
          <h4>{t('reminders.left_out', { n: mail.leftOut.length })}</h4>
          <ul class="left-out">
            {#each mail.leftOut as out (out.id)}
              <li data-left-out={out.id}>{markHidden(titleOf(out.id))}: {t(`reminders.reason.${out.reason}` as Key)}</li>
            {/each}
          </ul>
        {/if}
        {#if !mail.account}<p class="note" data-no-account>{t('reminders.no_account')}</p>{/if}
        {#if !mail.sent}
          <button type="button" data-send disabled={busy || !mail.account || mail.included.length === 0} onclick={send}>
            {t('reminders.send', { n: mail.included.length })}
          </button>
        {/if}
      </section>
    {/if}
  {/if}
</section>

<style>
  .reminders {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    min-width: 0;
  }
  .intro .head {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  h2,
  h3,
  h4 {
    margin: 0;
  }
  h4 {
    margin-top: 0.5rem;
    font-size: 0.95rem;
  }
  .choose,
  .mail {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem 0.8rem;
  }
  .mail label {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }
  button:not(.link),
  input[type='email'] {
    background: var(--surface-2);
    color: var(--text);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: 0.25rem 0.6rem;
  }
  button:not(.link) {
    cursor: pointer;
  }
  button:disabled {
    cursor: default;
    opacity: 0.6;
  }
  input[type='email'] {
    min-width: min(18rem, 60vw);
  }
  input[aria-invalid='true'] {
    border-color: var(--warn);
  }
  table {
    border-collapse: collapse;
    width: 100%;
  }
  th,
  td {
    text-align: left;
    padding: 0.25rem 0.5rem;
    border-bottom: 1px solid var(--line);
    font-weight: normal;
    vertical-align: top;
  }
  thead th {
    color: var(--muted);
    font-weight: 600;
  }
  tr.due .day {
    font-weight: 600;
  }
  tr.finished th {
    color: var(--muted);
  }
  .mark {
    margin-left: 0.4rem;
    padding: 0 0.35rem;
    border: 1px solid var(--warn);
    border-radius: 999px;
    color: var(--warn);
    font-size: 0.8rem;
    white-space: nowrap;
  }
  .to {
    overflow-wrap: anywhere;
    color: var(--muted);
  }
  .link {
    background: none;
    border: 0;
    padding: 0;
    color: var(--accent);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .none,
  .note,
  .rule {
    color: var(--muted);
    font-size: 0.85rem;
    margin: 0;
  }
  .problem,
  .done {
    margin: 0;
  }
  .problem:empty,
  .done:empty {
    display: none;
  }
  .problem {
    color: var(--bad);
  }
  .preview {
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: 0.6rem;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    align-items: flex-start;
  }
  dl {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 0.1rem 0.8rem;
    margin: 0;
  }
  dt {
    color: var(--muted);
  }
  dd {
    margin: 0;
    overflow-wrap: anywhere;
  }
  pre {
    margin: 0;
    padding: 0.5rem;
    max-width: 100%;
    overflow: auto;
    background: var(--surface);
    border-radius: var(--radius);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .left-out {
    margin: 0;
    padding-left: 1.2rem;
  }
  @media (max-width: 40rem) {
    .to,
    thead th:last-child {
      display: none;
    }
  }
</style>
