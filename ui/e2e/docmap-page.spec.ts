import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expectAccessible, watchViolations } from './a11y';
import { expect, test } from './fixtures';
import { env, exe, prepareVault } from './hub';
import { freePort } from 'appkit-web/e2e-node';
import { removeTree } from '../web/tmp.mjs';

// "Open in DocMap" where docmap-desktop is not installed: the button opens the page docmap.nvim generated in the repo
// (`<out_dir>/index.html`, `out_dir` from its `.docmap.json`), at the node a `code-ref` block names, and shows only for
// a repo that has the page. The hub all the tests share has a stand-in for docmap-desktop, so this one has a hub of its
// own: no docmap-desktop, a log for the page it would open, a free port.

test.use({ locale: 'en-US' });

test('without docmap-desktop the button opens the generated page of the repo at the node, and only where the page is', async ({
  page,
}) => {
  test.slow();
  const { root, vault, config } = prepareVault();
  const port = await freePort();
  const log = join(root, 'docmap-page.log');
  const environment: NodeJS.ProcessEnv = { ...env(config), TASKS_DESKTOP_PORT: String(port), TASKS_DESKTOP_DOCMAP_PAGE_LOG: log };
  delete environment.TASKS_DESKTOP_DOCMAP_LOG;
  // Not the machine of the person: the work machine never shows the button.
  delete environment.NVIM_MACHINE_ROLE;
  let child: ChildProcess | undefined;
  try {
    // The repo of the tile (`docmap-e2e`) has its page in the folder its `.docmap.json` names; a second repo has none.
    const repo = join(root, 'repos', 'docmap-e2e');
    writeFileSync(join(repo, '.docmap.json'), JSON.stringify({ out_dir: 'build/site/' }));
    mkdirSync(join(repo, 'build', 'site'), { recursive: true });
    writeFileSync(join(repo, 'build', 'site', 'index.html'), '<!doctype html><title>map</title>');
    const bare = join(root, 'repos', 'bare-e2e');
    mkdirSync(join(bare, 'lua'), { recursive: true });
    writeFileSync(join(bare, 'lua', 'b.lua'), 'return 2\n');
    const repos = join(config, 'repos.json');
    const doc = JSON.parse(readFileSync(repos, 'utf8')) as { repos: Record<string, { path: string; name: string }> };
    doc.repos['bare0e2e'] = { path: bare, name: 'bare-e2e' };
    writeFileSync(repos, JSON.stringify(doc));
    writeFileSync(
      join(vault, 'lib.nvim', 'ROADMAP', 'tasks', 'docmap-page-e2e.md'),
      [
        '---',
        'title: A place with a page',
        'status: open',
        'kind: task',
        'created: 2026-01-01',
        'updated: 2026-01-01',
        '---',
        '',
        '## Kontext',
        '',
        '```code-ref',
        '{ "schema": "code-ref/1", "repo": "docmap-e2e", "file": "lua/a.lua", "lines": [3, 9], "docmap": { "node": "e2e.core" } }',
        '```',
        '',
        'The same repo without a node, and a repo that has no page:',
        '',
        '```code-ref',
        '{ "schema": "code-ref/1", "repo": "docmap-e2e", "file": "lua/a.lua", "lines": [1, 1] }',
        '```',
        '',
        '```code-ref',
        '{ "schema": "code-ref/1", "repo": "bare-e2e", "file": "lua/b.lua", "lines": [1, 1] }',
        '```',
        '',
      ].join('\n'),
    );

    child = spawn(exe, ['serve'], { env: environment, stdio: 'ignore' });
    const origin = `http://127.0.0.1:${port}`;
    const deadline = Date.now() + 20_000;
    for (;;) {
      const ready = await fetch(`${origin}/api/tasks/hello`).then(
        async (r) => r.ok && ((await r.json()) as { engine: { ready: boolean } }).engine.ready,
        () => false,
      );
      if (ready && existsSync(join(config, 'hub.json'))) break;
      if (Date.now() > deadline) throw new Error('the hub of this test did not come up');
      await new Promise((r) => setTimeout(r, 200));
    }
    const out = execFileSync(exe, ['link'], { env: environment, encoding: 'utf8' });
    const link = out.trim().split(/\r?\n/)[0] ?? '';

    await watchViolations(page);
    await page.goto(link);
    await expect(page.getByRole('menubar')).toBeVisible();
    await page.evaluate(() => {
      location.hash = '#view=list';
    });
    const id = 'lib.nvim/docmap-page-e2e';
    await page.locator('button.row', { hasText: id }).first().click();
    await expect(page.locator('aside.detail .id')).toHaveText(id);

    // Two buttons (the place of the repo with a page, with and without a node), none for the repo without a page.
    const buttons = page.locator('aside.detail').getByRole('button', { name: /Open in DocMap/ });
    await expect(buttons).toHaveCount(2);
    await expect(buttons.first()).toHaveAttribute('data-way', 'page');
    await buttons.first().click();
    await expect.poll(() => (existsSync(log) ? readFileSync(log, 'utf8') : '')).toContain('e2e.core');
    const [folder, relative, node] = (readFileSync(log, 'utf8').trim().split('\n')[0] ?? '').split('\t');
    expect((folder ?? '').replaceAll('\\', '/')).toMatch(/\/repos\/docmap-e2e$/);
    expect([relative, node]).toEqual(['build/site/index.html', 'e2e.core']);
    // The page of the hub never saw the folder of the repo or the path of the page.
    const text = await page.locator('body').innerText();
    expect(text).not.toContain('repos/docmap-e2e');
    expect(text).not.toContain('index.html');
    await expectAccessible(page, 'the detail of a task with the buttons "Open in DocMap" that open the page of a repo');
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) {
      const gone = new Promise<void>((done) => child?.once('exit', () => done()));
      child.kill();
      await Promise.race([gone, new Promise((done) => setTimeout(done, 10_000))]);
    }
    removeTree(root, { retries: 30, delay: 200 });
  }
});
