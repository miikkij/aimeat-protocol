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
 *   A SECURITY RELEASE MAY GO OUT OVER A RED NIGHTLY, WITH A NAMED REASON (Jouni, 2026-10-16). The
 *   nightly sweep takes two hours and can be red for a cause the release does not touch; a security
 *   fix must not wait for it. The same emergency path the pre-push hook has for a red CI (a
 *   `Red-CI:` trailer or AIMEAT_RED_CI_REASON): the release names its reason, either as a
 *   one-line `Red-Nightly: <reason>` line in the message of the annotated tag on the commit (the release
 *   record keeps it), or in AIMEAT_RELEASE_RED_REASON (the release workflows' `red_reason` input
 *   sets it, and `npm publish` reads it from the shell). With a reason, a nightly run of the commit
 *   that is red, missing or still running passes with a loud line naming the reason and the run;
 *   the reason goes to the job summary and to the step output `red_reason`, which the desktop
 *   release writes into its release notes. The reason covers the nightly sweep only (NIGHTLY_WORKFLOWS):
 *   CI and a package's own tests still have to be green, and an unread answer from GitHub still
 *   refuses. Without a reason the check refuses as before.
 *
 *   THE VERSION BUMP BEFORE IT is `pnpm release:bump <x.y.z>` (scripts/release-bump.ts): it writes
 *   the version into every file that carries it, regenerates the notices and the capability map, and
 *   runs the checks that read the version, so the commit this script is asked about is green. Four
 *   red periods on main started at a bump made by hand.
 *
 *   NO NETWORK, NO RELEASE. Where the read-only reporters (ci-state.mjs) degrade to "unknown", this
 *   refuses: a release must not pass on an answer it could not read.
 * @usage
 *   node scripts/release-ready.mjs [--sha=<commit>] [--require=ci.yml,e2e-full.yml] [--no-main-check]
 *   AIMEAT_RELEASE_RED_REASON="<why this release cannot wait for the nightly>" npm publish
 * @version-history
 *   v1.3.0 -- 2026-10-30 -- A node release (one that requires e2e-full.yml) is refused while
 *     ADOPTION_CUTOFF in the released commit's aimeat/src/cli/connect/adoption-cutoff.ts is null; a
 *     commit without that file is not checked; `pnpm release:trust-cutoff` or
 *     `pnpm release:bump` writes it (secaudit2026oct26 round 8c, connector-04).
 *   v1.2.0 -- 2026-10-20 -- The nightly also passes with a green run of an earlier commit on main that
 *     started within 24 hours; the commits since are printed, and CI must be green on the exact
 *     commit (Jouni, 2026-10-20, after 4.1.2 waited for a sweep of test-only commits).
 *   v1.1.1 -- 2026-10-20 -- The header names pnpm release:bump as the step before a release.
 *   v1.1.0 -- 2026-10-16 -- A named reason (a `Red-Nightly:` line in the tag message, or
 *     AIMEAT_RELEASE_RED_REASON) lets a release go out over a red, missing or running nightly sweep,
 *     with a loud line, the job summary and the step output `red_reason` (Jouni, decision 2026-10-16).
 *   v1.0.0 -- 2026-10-16 -- Initial (QA audit W08: P2-02, P6-01, S9-04).
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { apiGet, repoSlug, runsForCommit } from './lib/ci-runs.mjs';
import { CUTOFF_PATH, readAdoptionCutoff } from './lib/adoption-cutoff.mjs';

/** The workflows a named reason may release over: the nightly sweep only. */
const NIGHTLY_WORKFLOWS = ['e2e-full.yml'];
/**
 * A green nightly of an EARLIER commit on main counts when it started at most this long ago (Jouni,
 * 2026-10-20: a release waited four hours for a sweep because another session pushed tests after the
 * bump). CI must still be green on the exact commit, and the commits in between are printed.
 */
const NIGHTLY_ANCESTOR_MAX_AGE_MS = 24 * 3600_000;

/** A green nightly run of an ancestor of `sha` that started within the window, newest first, or null. */
async function recentAncestorNightly(slug, workflow, sha) {
    const body = await apiGet(`/repos/${slug}/actions/workflows/${workflow}/runs`, 'branch=main&status=success&per_page=20');
    const now = Date.now();
    for (const r of body.workflow_runs ?? []) {
        if (r.status !== 'completed' || r.conclusion !== 'success') continue;
        if (now - Date.parse(r.created_at) > NIGHTLY_ANCESTOR_MAX_AGE_MS) continue;
        try { git('merge-base', '--is-ancestor', r.head_sha, sha); } catch { continue; }
        return r;
    }
    return null;
}
/** The line in an annotated tag's message that names the reason. */
const TAG_REASON_LINE = /^Red-Nightly:[ \t]*(.+)$/im;

const args = process.argv.slice(2);
const flag = (name) => args.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const git = (...a) => execFileSync('git', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

function refuse(lines) {
    console.error('\n✖ release-ready: this commit may not be released yet.');
    for (const l of lines) console.error(`  ${l}`);
    console.error('');
    process.exit(1);
}

/**
 * The reason this release names for going out over a red nightly, and where it was found: the
 * environment first, then a `Red-Nightly:` line in an annotated tag on the commit. One line, or null.
 */
function namedReason(sha) {
    const env = (process.env.AIMEAT_RELEASE_RED_REASON ?? '').replace(/\s+/g, ' ').trim();
    if (env) return { reason: env, source: 'AIMEAT_RELEASE_RED_REASON' };
    // actions/checkout can leave the tag that started the run as a lightweight ref, which has no
    // message; in a workflow the tags are fetched again as they are on the remote.
    if (process.env.GITHUB_ACTIONS === 'true') {
        try { git('fetch', '-q', '--force', 'origin', '+refs/tags/*:refs/tags/*'); } catch { /* the local tags answer */ }
    }
    let tags = '';
    try { tags = git('for-each-ref', `--points-at=${sha}`, '--format=%(refname:short)', 'refs/tags'); } catch { /* no tags: no reason */ }
    for (const tag of tags.split('\n').filter(Boolean)) {
        let message = '';
        try { message = git('tag', '-l', '--format=%(contents)', tag); } catch { /* an unreadable tag names nothing */ }
        const m = TAG_REASON_LINE.exec(message);
        if (m && m[1].trim()) return { reason: m[1].trim(), source: `the message of tag ${tag}` };
    }
    return null;
}

/** In a workflow: the reason in the job summary, and in the step output `red_reason` for the release notes. */
function recordReason(reason, overridden) {
    const out = process.env.GITHUB_OUTPUT;
    const summary = process.env.GITHUB_STEP_SUMMARY;
    try {
        if (out) appendFileSync(out, `red_reason=${reason.reason}\n`);
        if (summary) {
            appendFileSync(summary, `### Released over a nightly sweep that is not green\n\nReason (${reason.source}): ${reason.reason}\n\n`
                + overridden.map(o => `- ${o}`).join('\n') + '\n');
        }
    } catch (e) {
        console.error(`release-ready: the reason could not be written to the job summary (${e instanceof Error ? e.message : String(e)}); it is in this log.`);
    }
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
    // A node release carries the release time of the first version whose connector keeps a record of
    // trusted commands; until it is written, a fresh install would adopt a folder that arrived after
    // the release (secaudit2026oct26 round 8c, connector-04). The Python package does not carry it.
    // It is read from the commit being released; a commit that has no such file predates it.
    if (required.includes('e2e-full.yml')) {
        let text = null;
        try { text = git('show', `${sha}:${CUTOFF_PATH}`); } catch { /* not in this commit: nothing to check */ }
        if (text !== null) {
            let cutoff = '';
            try { cutoff = readAdoptionCutoff(text); } catch (e) {
                problems.push(`${CUTOFF_PATH} could not be read (${e instanceof Error ? e.message : String(e)}).`);
            }
            if (cutoff === null) {
                problems.push(`ADOPTION_CUTOFF in ${CUTOFF_PATH} is not set. This is the first release whose connector keeps a record of trusted commands, and it carries its own time: run \`pnpm release:trust-cutoff\`, commit the file to main, and release that commit. \`pnpm release:bump\` writes it too.`);
            } else if (cutoff) {
                console.log(`  ✓ adoption cut-off: ${cutoff}`);
            }
        }
    }
    /** Problems a named reason may release over: the nightly's red, missing or running run. */
    const nightly = [];
    for (const workflow of required) {
        let runs;
        try { runs = await runsForCommit(slug, workflow, sha); } catch (e) {
            problems.push(`${workflow}: GitHub could not be read (${e instanceof Error ? e.message : String(e)}). A release does not pass on an unread answer; try again.`);
            continue;
        }
        const done = runs.filter(r => r.status === 'completed');
        const green = done.find(r => r.conclusion === 'success');
        if (green) { console.log(`  ✓ ${workflow}: green (${green.html_url})`); continue; }
        if (NIGHTLY_WORKFLOWS.includes(workflow)) {
            let earlier = null;
            try { earlier = await recentAncestorNightly(slug, workflow, sha); } catch { /* the exact-commit answer below decides */ }
            if (earlier) {
                const between = git('log', '--format=%h %s', `${earlier.head_sha}..${sha}`).split('\n').filter(Boolean);
                console.log(`  ✓ ${workflow}: green on the earlier commit ${earlier.head_sha.slice(0, 9)} at ${earlier.created_at} (${earlier.html_url}); `
                    + `${between.length} commit(s) since, each with CI on main:`);
                for (const line of between) console.log(`      ${line}`);
                continue;
            }
        }
        const running = runs.find(r => r.status !== 'completed');
        const red = done[0];
        const into = NIGHTLY_WORKFLOWS.includes(workflow) ? nightly : problems;
        if (red) into.push(`${workflow}: the newest finished run of this commit is ${red.conclusion}: ${red.html_url}`);
        else if (running) into.push(`${workflow}: a run of this commit is still in progress: ${running.html_url}. Wait for it, then run the release again.`);
        else into.push(`${workflow}: no run of this commit exists. ${workflow === 'e2e-full.yml'
            ? 'Start the nightly sweep for it (Actions, "E2E full sweep", Run workflow), then run the release again.'
            : 'Push the commit to main so the workflow runs on it.'}`);
    }

    if (nightly.length > 0) {
        const reason = problems.length === 0 ? namedReason(sha) : null;
        if (reason) {
            console.log('');
            console.log('!'.repeat(78));
            console.log(`! RELEASED OVER A NIGHTLY SWEEP THAT IS NOT GREEN. Reason, from ${reason.source}:`);
            console.log(`!   ${reason.reason}`);
            for (const n of nightly) console.log(`!   ${n}`);
            console.log('!'.repeat(78));
            if (process.env.GITHUB_ACTIONS === 'true') console.log(`::warning title=Released over a red nightly::${reason.reason}`);
            recordReason(reason, nightly);
        } else {
            problems.push(...nightly);
            problems.push('A security release that cannot wait for the nightly names its reason: a line "Red-Nightly: <reason>" in the annotated tag message, the workflow input red_reason, or AIMEAT_RELEASE_RED_REASON for npm publish. CI still has to be green.');
        }
    }
    if (problems.length > 0) refuse(problems);
    console.log(nightly.length > 0
        ? 'release-ready: every other required workflow is green on this commit; the nightly sweep is released over with the reason above.'
        : 'release-ready: every required workflow is green on this commit.');
}

main().catch((e) => refuse([`could not decide: ${e instanceof Error ? e.message : String(e)}`]));
