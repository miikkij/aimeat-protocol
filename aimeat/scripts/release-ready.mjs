#!/usr/bin/env node
/**
 * @file scripts/release-ready.mjs
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Refuses a release of a commit that GitHub has not seen green: the commit must be on
 *   origin/main, and each named workflow must have a successful finished run of that exact commit.
 *
 *   WHY. No publish path read a test result. The v4.0.0 tag published to the MCP registry 95 seconds
 *   after CI started on the same commit, and that CI run ended red; the nightly sweep had been red
 *   seven nights; the release evidence was a sentence about a sweep seven commits earlier (QA audit
 *   2026-10-16, P2-02, P6-01, S9-04). The release criterion is now held by this script, which the
 *   tag workflows run first and `npm publish` runs in prepublishOnly:
 *
 *     node scripts/release-ready.mjs --require=ci.yml,e2e-full.yml      the node (npm, MCP registry, desktop)
 *     node scripts/release-ready.mjs --require=ci.yml,python-aimeat-crewai.yml   the Python package
 *
 *   A NIGHTLY OF THE SAME COMMIT. The nightly sweep runs on main at 00:00 UTC; when main has moved
 *   past the commit to release, start the sweep for it from the Actions tab (workflow_dispatch on the
 *   tag or on main while it still points there), then re-run the release workflow. A red or missing
 *   run refuses with the run's address, never with a guess.
 *
 *   NO NETWORK, NO RELEASE. Where the read-only reporters (ci-state.mjs) degrade to "unknown", this
 *   refuses: a release must not pass on an answer it could not read.
 * @usage
 *   node scripts/release-ready.mjs [--sha=<commit>] [--require=ci.yml,e2e-full.yml] [--no-main-check]
 * @version-history
 *   v1.0.0 -- 2026-10-16 -- Initial (QA audit W08: P2-02, P6-01, S9-04).
 */
import { execFileSync } from 'node:child_process';
import { repoSlug, runsForCommit } from './lib/ci-runs.mjs';

const args = process.argv.slice(2);
const flag = (name) => args.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const git = (...a) => execFileSync('git', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

function refuse(lines) {
    console.error('\n✖ release-ready: this commit may not be released yet.');
    for (const l of lines) console.error(`  ${l}`);
    console.error('');
    process.exit(1);
}

async function main() {
    const sha = git('rev-parse', flag('sha') ?? 'HEAD');
    const required = (flag('require') ?? 'ci.yml,e2e-full.yml').split(',').map(s => s.trim()).filter(Boolean);
    const slug = repoSlug();
    console.log(`release-ready: ${sha.slice(0, 9)} in ${slug}; required green: ${required.join(', ')}`);

    // The commit is on main: a tag on a side branch or an unpushed commit names code nobody reviewed
    // on main and no CI run describes.
    if (!args.includes('--no-main-check')) {
        try { git('fetch', '-q', 'origin', 'main'); } catch { /* the cached ref answers; a stale one refuses below */ }
        try { git('merge-base', '--is-ancestor', sha, 'origin/main'); } catch {
            refuse([`${sha.slice(0, 9)} is not on origin/main. Push it to main first; a release names a commit main carries.`]);
        }
    }

    const problems = [];
    for (const workflow of required) {
        let runs;
        try { runs = await runsForCommit(slug, workflow, sha); } catch (e) {
            problems.push(`${workflow}: GitHub could not be read (${e instanceof Error ? e.message : String(e)}). A release does not pass on an unread answer; try again.`);
            continue;
        }
        const done = runs.filter(r => r.status === 'completed');
        const green = done.find(r => r.conclusion === 'success');
        if (green) { console.log(`  ✓ ${workflow}: green (${green.html_url})`); continue; }
        const running = runs.find(r => r.status !== 'completed');
        const red = done[0];
        if (red) problems.push(`${workflow}: the newest finished run of this commit is ${red.conclusion}: ${red.html_url}`);
        else if (running) problems.push(`${workflow}: a run of this commit is still in progress: ${running.html_url}. Wait for it, then run the release again.`);
        else problems.push(`${workflow}: no run of this commit exists. ${workflow === 'e2e-full.yml'
            ? 'Start the nightly sweep for it (Actions, "E2E full sweep", Run workflow), then run the release again.'
            : 'Push the commit to main so the workflow runs on it.'}`);
    }
    if (problems.length > 0) refuse(problems);
    console.log('release-ready: every required workflow is green on this commit.');
}

main().catch((e) => refuse([`could not decide: ${e instanceof Error ? e.message : String(e)}`]));
