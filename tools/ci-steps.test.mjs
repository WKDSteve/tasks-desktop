// Tests of the step conditions in .github/workflows/ci.yml:  node --test "tools/*.test.mjs"
//
// A red step skips every later step of its job unless that step says otherwise. In the job rust the Rust tests came
// after the web steps, so a red web step hid a stale test of hub-testkit for several runs (run 45029064794). These hold
// the workflow to the rule: the checks of a job do not wait for unrelated checks before them, and the checks that read
// what the tests left run only after the tests ran through.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ci = readFileSync(fileURLToPath(new URL("../.github/workflows/ci.yml", import.meta.url)), "utf8").replace(/\r\n/g, "\n");

/** The steps of a job as text blocks, without comment lines. */
function steps(job) {
  const start = ci.indexOf(`\n  ${job}:\n`);
  assert.ok(start >= 0, `no job ${job}`);
  const rest = ci.slice(start + 1);
  const next = rest.slice(1).search(/\n {2}[a-z][\w-]*:\n/);
  const body = next < 0 ? rest : rest.slice(0, next + 1);
  const lines = body.split("\n").filter((l) => !/^\s*#/.test(l));
  const out = [];
  for (const line of lines) {
    if (line.startsWith("      - ")) out.push(line);
    else if (out.length && line.startsWith("        ")) out[out.length - 1] += `\n${line}`;
  }
  return out;
}

const condition = (step) => (step.match(/^ {6}- if: (.*)$|^ {8}if: (.*)$/m) ?? []).slice(1).find(Boolean) ?? "";
const find = (list, text) => {
  const i = list.findIndex((s) => s.includes(text));
  assert.ok(i >= 0, `no step with ${text}`);
  return i;
};

const NEEDS_HUB = ["steps.engine.outcome == 'success'", "steps.ui_build.outcome == 'success'", "steps.mobile.outcome == 'success'"];

test("rust: every step after the web steps runs even when a web step was red", () => {
  const list = steps("rust");
  const web = find(list, "pnpm web:e2e");
  const after = list.slice(web + 1);
  assert.ok(after.length > 5, "the steps after the web steps were not found");
  for (const step of after) assert.match(condition(step), /!cancelled\(\)/, `step without !cancelled():\n${step}`);
});

test("rust: what builds the hub waits for the engine, the interface and the phone page", () => {
  const list = steps("rust");
  for (const text of ["cargo clippy", "cargo test --workspace", "cargo test --locked -p hub-testkit", "--test window_program", "Temp dir of this job"]) {
    const step = list[find(list, text)];
    for (const need of NEEDS_HUB) assert.ok(condition(step).includes(need), `${text} does not wait for ${need}`);
  }
  for (const [id, text] of [["engine", "Fetch the pinned engine"], ["ui_build", "Build the interface"], ["mobile", "Build the phone page"]]) {
    assert.match(list[find(list, text)], new RegExp(`\\n {8}id: ${id}\\n`), `${text} has no id ${id}`);
  }
});

test("rust: the temp dir is counted only after all tests ran through", () => {
  const list = steps("rust");
  const check = condition(list[find(list, "check-temp-leftovers.mjs")]);
  for (const id of ["job_temp", "test_workspace", "test_testkit", "window_program"]) {
    assert.ok(check.includes(`steps.${id}.outcome == 'success'`), `the count does not wait for ${id}`);
  }
});

test("ui and hygiene: the checks do not wait for each other", () => {
  const ui = steps("ui");
  const install = find(ui, "pnpm install --frozen-lockfile");
  for (const step of ui.slice(install + 1)) assert.match(condition(step), /!cancelled\(\)/, `ui step without !cancelled():\n${step}`);
  assert.ok(condition(ui[find(ui, "check-bundle-size.py")]).includes("steps.build.outcome == 'success'"), "the budget does not wait for the build");
  for (const step of steps("hygiene").filter((s) => /\brun: /.test(s))) {
    assert.match(condition(step), /!cancelled\(\)/, `hygiene step without !cancelled():\n${step}`);
  }
});
