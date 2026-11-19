// Tests of tools/check-installed-kit.mjs:  node --test "tools/*.test.mjs"
import assert from "node:assert/strict";
import { test } from "node:test";
import { differences, kitCommits } from "./check-installed-kit.mjs";

const A = "126a5a5a28ffd4c13dd6c4079d96d9e651aee214";
const B = "08a7443000000000000000000000000000000000";
const lock = (ui, web) =>
  [
    `  appkit-ui@https://codeload.github.com/WKDSteve/appkit/tar.gz/${ui}#path:ui-kit:`,
    `  appkit-ui@https://codeload.github.com/WKDSteve/appkit/tar.gz/${ui}#path:ui-kit(svelte@5.57.1):`,
    `  appkit-web@https://codeload.github.com/WKDSteve/appkit/tar.gz/${web}#path:web-kit:`,
  ].join("\n");

test("reads the commit of each package of the kit", () => {
  assert.deepEqual(kitCommits(lock(A, B)), { "appkit-ui": A, "appkit-web": B });
});

test("is quiet when the installed kit is the one of the lockfile", () => {
  assert.deepEqual(differences(lock(A, A), lock(A, A)), []);
});

test("names the package that is installed at another commit (a pull raised the pin)", () => {
  assert.deepEqual(differences(lock(A, A), lock(B, A)), [
    `appkit-ui is installed at ${B.slice(0, 7)}, the lockfile names ${A.slice(0, 7)}`,
  ]);
});

test("says the kit is not installed when node_modules has no lockfile", () => {
  assert.equal(differences(lock(A, A), null).length, 2);
});
