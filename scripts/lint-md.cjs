#!/usr/bin/env node
// scripts/lint-md.cjs
//
// Markdown CI lint.
//
// Fails the build if any tracked Markdown file contains the literal
// pattern `\b53[- ]bond\b` — a regression guard for the previously hard-
// coded "53 sample bonds" copy that drifted out of sync when the bundled
// sample portfolio was rewritten with fewer entries.
//
// Run directly: `npm run lint:md`.
// Run as part of the main lint: it's also chained into `npm run lint`,
// so the existing GitHub Actions step (which already runs `npm run lint
// && npm run build`) picks this up automatically without any workflow
// changes.
//
// Matches (and FAILS on):
//   "53-bond portfolio", "53 bond portfolio", "53-bond sample", etc.
// Does NOT match:
//   "5 bonds" (current sample size), or any "53" not followed by hyphen/space.
//
const { execFileSync } = require('child_process');

// Targets are tracked Markdown files at the repo root. Extend this list
// if/when more .md files are added — the script is the single source of
// truth for what gets guarded.
const TARGETS = ['README.md'];
const PATTERN = '\\b53[- ]bond\\b';

let collectedMatches = '';

for (const file of TARGETS) {
  let result;
  try {
    result = execFileSync('grep', ['-nE', PATTERN, file], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    // grep exit codes:
    //   0 = match(es) found      (handled below — result is set)
    //   1 = no match             (target is clean — continue)
    //   2 = error (file missing / unreadable) — FAIL loudly so a
    //      deleted README.md or a typo in TARGETS does not silently
    //      bypass the guard.
    if (err.status === 1) continue;
    process.stderr.write(
      `\n✗ Markdown lint failed — could not read target: ${file}\n` +
        `  ${(err.stderr || err.message || '').toString().trim()}\n` +
        `  The lint cannot verify this file. Either restore it or remove it from TARGETS.\n`,
    );
    process.exit(2);
  }
  collectedMatches += result.toString();
}

if (collectedMatches.length > 0) {
  process.stderr.write(
    '\n✗ Markdown lint failed — stale sample-bond count references found:\n' +
      collectedMatches +
      '\n  Replace with prose describing the bundled sample portfolio.\n' +
      '  See scripts/lint-md.cjs for the guard pattern.\n',
  );
  process.exit(1);
}

// All clear.
process.stdout.write('✓ Markdown lint passed (no stale sample-bond counts in README.md).\n');
