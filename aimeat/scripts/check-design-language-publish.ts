/**
 * @file check-design-language-publish.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The node copy of skill aimeat-design-language is the repository copy, published: the
 *   gate notices when the repository text changes and the node has not been given it.
 *
 *   WHY. The skill lives in two places: `.claude/skills/aimeat-design-language/` in this tree,
 *   which every Claude Code session here loads, and `node:aimeat-design-language` on aimeat.io,
 *   which CLAUDE.md tells a session is "also on the node" and which any other AI reads. On
 *   2026-11-14 the node copy was 1.0.11 of 2026-10-11 and five repository commits behind it: it
 *   lacked the 11 px floor, eight of the served font families, the second theme and the 44 px
 *   touch area, and nothing had said so. The developer ruled that the repository is the source and
 *   the node gets it after every change (decision P7 of the instruction audit of 2026-11-14).
 *
 *   HOW. security/design-language-publish.json holds the digest of the skill folder (SKILL.md and
 *   every file under references/) as it stood when it was last published, the node version the
 *   publish answered with, and the day. The gate fails when the folder's digest differs, and the
 *   message says how to publish and how to record it. Digests, not a call to the node: CI has no
 *   credentials for aimeat.io and the gate runs offline, so the ledger is the claim that a person
 *   or a session published, recorded in the same commit as the text.
 *   Line endings are folded before hashing, because the same file is CRLF on Windows and LF in CI.
 * @structure filesOf() · digestOf() · main: check | --record <node version> | --show
 * @usage
 *   pnpm check:design-language-publish                      # gate (check:fast, CI)
 *   pnpm check:design-language-publish --record 1.0.12      # after aimeat_skill_publish answered 1.0.12
 *   pnpm check:design-language-publish --show               # the files and their digests now
 * @version-history
 *   v1.0.0 — 2026-11-15 — Initial (TP8.3 of the instruction audit of 2026-11-14).
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const REPO = join(here, '..', '..');
const SKILL = 'aimeat-design-language';
const SKILL_DIR = join(REPO, '.claude', 'skills', SKILL);
const LEDGER = join(here, '..', 'security', 'design-language-publish.json');

interface Ledger {
    about: string;
    skill: string;
    nodeRef: string;
    /** The version aimeat_skill_publish answered with. */
    publishedVersion: string;
    /** ISO date of the publish. */
    publishedOn: string;
    /** sha256 over the folder's files as they were published. */
    digest: string;
    /** Per file, the first 16 hex of its own sha256, so a failure names the file that moved. */
    files: Record<string, string>;
}

const sha = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex');

/** Every file of the skill folder, as paths relative to it with forward slashes, sorted. */
function filesOf(dir: string, prefix = ''): string[] {
    return readdirSync(dir).sort().flatMap(name => {
        const full = join(dir, name);
        const rel = prefix ? `${prefix}/${name}` : name;
        return statSync(full).isDirectory() ? filesOf(full, rel) : [rel];
    });
}

function digestOf(): { digest: string; files: Record<string, string> } {
    const files: Record<string, string> = {};
    for (const rel of filesOf(SKILL_DIR)) {
        const text = readFileSync(join(SKILL_DIR, rel), 'utf8').replace(/\r\n/g, '\n');
        files[rel] = sha(text).slice(0, 16);
    }
    const lines = Object.keys(files).sort().map(f => `${f} ${files[f]}`).join('\n');
    return { digest: 'sha256:' + sha(lines).slice(0, 24), files };
}

const today = (): string => new Date().toISOString().slice(0, 10);

function howToPublish(files: Record<string, string>): string {
    const others = Object.keys(files).filter(f => f !== 'SKILL.md');
    return [
        `    Publish the repository copy to the node, then record it:`,
        `      1. aimeat_skill_publish { scope: "node", visibility: "public", skill_md: <.claude/skills/${SKILL}/SKILL.md>,`,
        `           files: { ${others.map(f => `"${f}": <its text>`).join(', ')} } }`,
        `         or, without the texts in context, the same call with no skill_md and a PUT of a ZIP of the`,
        `         folder (SKILL.md at its root) to the upload_url it answers with`,
        `         (an operator's session; the answer's skill.version is the new node version)`,
        `      2. pnpm check:design-language-publish --record <that version>`,
        `    Commit the ledger with the text. The repository is the source: never edit the node copy by hand.`,
    ].join('\n');
}

function main(): void {
    const argv = process.argv.slice(2);
    if (!existsSync(join(SKILL_DIR, 'SKILL.md'))) {
        console.error(`✗ .claude/skills/${SKILL}/SKILL.md is missing. If the skill was removed on purpose, remove this check and its ledger too.`);
        process.exit(1);
    }
    const now = digestOf();

    if (argv.includes('--show')) {
        for (const [f, d] of Object.entries(now.files)) console.log(`${d}  ${f}`);
        console.log(now.digest);
        return;
    }

    const ri = argv.indexOf('--record');
    if (ri >= 0) {
        const version = argv[ri + 1];
        if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
            console.error('✗ Say which node version the publish answered with: --record <x.y.z> (skill.version in the aimeat_skill_publish answer).');
            process.exit(1);
        }
        const ledger: Ledger = {
            about: 'The digest of .claude/skills/aimeat-design-language/ (SKILL.md and references/) as last published to the node as node:aimeat-design-language, and the version the node gave it. The repository copy is the source (decision P7, 2026-11-14). pnpm check:design-language-publish fails when the folder changes without a publish recorded here. Reasoning: aimeat/scripts/check-design-language-publish.ts.',
            skill: SKILL,
            nodeRef: `node:${SKILL}`,
            publishedVersion: version,
            publishedOn: today(),
            digest: now.digest,
            files: now.files,
        };
        writeFileSync(LEDGER, JSON.stringify(ledger, null, 2) + '\n');
        console.log(`recorded node:${SKILL}@${version}: ${now.digest}`);
        return;
    }

    if (!existsSync(LEDGER)) {
        console.error(`✗ security/design-language-publish.json is missing: nothing says which text node:${SKILL} holds.\n${howToPublish(now.files)}`);
        process.exit(1);
    }
    const ledger = JSON.parse(readFileSync(LEDGER, 'utf8')) as Ledger;
    if (ledger.digest === now.digest) {
        console.log(`✓ node:${SKILL}@${ledger.publishedVersion} (${ledger.publishedOn}) holds the repository copy`);
        return;
    }
    const changed = [...new Set([...Object.keys(now.files), ...Object.keys(ledger.files ?? {})])]
        .filter(f => now.files[f] !== ledger.files?.[f]);
    console.error(
        `✗ .claude/skills/${SKILL}/ changed after it was published to the node `
        + `(node:${SKILL}@${ledger.publishedVersion}, ${ledger.publishedOn})${changed.length ? `: ${changed.join(', ')}` : ''}.\n`
        + howToPublish(now.files),
    );
    process.exit(1);
}

main();
