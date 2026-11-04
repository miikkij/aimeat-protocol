#!/usr/bin/env node
/**
 * @file scripts/check-private-terms.mjs
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Refuses a commit or a push that adds the name of an organisation node's person, app,
 *   organism or address to this public repository, in a file or in a commit message.
 *
 *   WHY. Evidence for platform fixes was written with the real case in it: a node's address, its
 *   members' names, its apps and what they hold, the state of its compliance register. On
 *   2026-11-04 all of it was on GitHub, and main's history was rewritten three times to take it
 *   out. A rule in CLAUDE.md says where such a case goes instead; this is the part that does not
 *   depend on a session having read the rule.
 *
 *   THE LIST IS NOT IN THE REPOSITORY, since the list would itself be the leak. It is one term per
 *   line in git's common directory (`aimeat-private-terms.txt` beside the objects, shared by every
 *   worktree of the clone, never pushed), or the file AIMEAT_PRIVATE_TERMS names. `build` writes it
 *   from an organisation node's own lists, and leaves out every term the public tree already holds,
 *   since such a word is ordinary vocabulary here and refusing it would refuse every commit.
 *
 *   WHO IS REFUSED. A term found refuses everybody. A missing list refuses a Claude Code session
 *   (CLAUDECODE=1) and warns a person, whose commit from VS Code must not stop on a machine where
 *   nobody built the list yet.
 * @usage
 *   node scripts/check-private-terms.mjs --commit .git/COMMIT_EDITMSG     # the commit-msg hook
 *   node scripts/check-private-terms.mjs --push origin < refs             # the pre-push hook
 *   node scripts/check-private-terms.mjs build node-lists.json            # write the list
 *   node scripts/check-private-terms.mjs --where                          # where the list is
 *
 *   node-lists.json: { "host", "nodeId", "people": [{ "name", "id" }], "apps": [{ "name",
 *   "filename" }], "organisms": ["name"], "extra": ["term", "prefix*"] }, put together from the
 *   node's aimeat_contact_list, aimeat_app_list and aimeat_organism_list answers.
 * @version-history
 *   v1.0.0 — 2026-11-04 — Initial.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { addedLines, compileTerms, deriveTerms, findHits, parseTerms } from './lib/private-terms.mjs';

const args = process.argv.slice(2);
const git = (gitArgs, input) => execFileSync('git', gitArgs, { encoding: 'utf8', input, maxBuffer: 512 * 1024 * 1024, stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'ignore'] });
const ZERO = /^0+$/;

function listPath() {
    if (process.env.AIMEAT_PRIVATE_TERMS) return process.env.AIMEAT_PRIVATE_TERMS;
    return `${git(['rev-parse', '--path-format=absolute', '--git-common-dir']).trim()}/aimeat-private-terms.txt`;
}

function loadTerms() {
    const path = listPath();
    if (existsSync(path)) return parseTerms(readFileSync(path, 'utf8'));
    const say = `[private-terms] no list at ${path}. Build it from the organisation node's lists: node scripts/check-private-terms.mjs build <node-lists.json> (the file's header says how).`;
    if (process.env.CLAUDECODE) { console.error(say); process.exit(1); }
    console.error(`${say} Going on without the check.`);
    process.exit(0);
}

function report(hits) {
    if (!hits.length) return;
    console.error('[private-terms] this adds an organisation node\'s name to a public repository:');
    for (const h of hits.slice(0, 40)) console.error(`  ${h.where}: "${h.term}" in: ${h.text.trim().slice(0, 140)}`);
    if (hits.length > 40) console.error(`  ...and ${hits.length - 40} more`);
    console.error('Write the case in general words ("an organisation node", "an app that keeps colleagues\' ratings") and put the real case in a Platform Development Notes document (CLAUDE.md, "This repository is public").');
    process.exit(1);
}

/** The pushed ranges from the pre-push hook's stdin: `<local ref> <local sha> <remote ref> <remote sha>`. */
function pushRanges(remote, stdin) {
    const ranges = [];
    for (const line of stdin.split(/\r?\n/)) {
        const [, local, , remoteSha] = line.trim().split(/\s+/);
        if (!local || ZERO.test(local)) continue;
        let known = false;
        if (remoteSha && !ZERO.test(remoteSha)) { try { git(['cat-file', '-e', `${remoteSha}^{commit}`]); known = true; } catch { /* not fetched here */ } }
        ranges.push(known ? [`${remoteSha}..${local}`] : [local, '--not', `--remotes=${remote}`]);
    }
    return ranges.length ? ranges : [[`refs/remotes/${remote}/main..HEAD`]];
}

const mode = args[0];
if (mode === '--where') {
    console.log(listPath());
} else if (mode === '--commit') {
    const compiled = compileTerms(loadTerms());
    const msg = existsSync(args[1] ?? '') ? readFileSync(args[1], 'utf8').split(/^# -+ >8 -+$/m)[0] : '';
    const lines = msg.split(/\r?\n/).filter(l => !l.startsWith('#')).map(text => ({ where: 'message', text }));
    lines.push(...addedLines(git(['diff', '--cached', '-U0', '--no-color', '--no-ext-diff', '--no-textconv'])));
    report(findHits(lines, compiled));
} else if (mode === '--push') {
    const compiled = compileTerms(loadTerms());
    const stdin = process.stdin.isTTY ? '' : readFileSync(0, 'utf8');
    const hits = [];
    for (const range of pushRanges(args[1] ?? 'origin', stdin)) {
        const out = git(['log', '-p', '-U0', '--no-color', '--no-ext-diff', '--no-textconv', '--format=%x00commit %H%n%B', ...range]);
        hits.push(...findHits(addedLines(out), compiled));
    }
    report(hits);
} else if (mode === 'build') {
    const input = JSON.parse(readFileSync(args[1], 'utf8'));
    const terms = deriveTerms(input);
    // The public tree's own vocabulary: one fixed-string pass over every tracked text file, then the
    // whole-word rule on the lines it returns.
    let treeLines = [];
    try { treeLines = git(['grep', '-I', '-h', '-i', '-F', '-f', '-', 'HEAD'], terms.map(t => t.replace(/\*$/, '')).join('\n')).split(/\r?\n/); } catch { /* no line matched */ }
    const lower = treeLines.map(l => l.toLowerCase());
    const inTree = new Set(compileTerms(terms).filter(c => lower.some((l, i) => l.includes(c.needle) && c.re.test(treeLines[i]))).map(c => c.term));
    const kept = terms.filter(t => !inTree.has(t));
    const path = listPath();
    writeFileSync(path, `# Organisation node terms this public repository refuses (scripts/check-private-terms.mjs).\n# Built ${new Date().toISOString()}. Never commit this file.\n${kept.join('\n')}\n`);
    console.log(`[private-terms] ${kept.length} terms written to ${path}`);
    if (inTree.size) console.log(`[private-terms] left out, already in the public tree: ${[...inTree].join(', ')}`);
} else {
    console.error('usage: check-private-terms.mjs --commit <msgfile> | --push <remote> | build <node-lists.json> | --where');
    process.exit(2);
}
