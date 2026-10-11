/**
 * @file scripts/check-doc-links.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Refuses a text the node serves, or shows a person, that sends its reader to a file
 *   in the repository's docs/ folder the node itself does not serve.
 *
 *   WHY. The documentation audit of 2026-10-11 found the node pointing AIs and people at repository
 *   files no route answers: the appdev and agent handbooks at docs/agent-workspace-contracts.md, the
 *   Boards page's guide button at /docs/app-developer-ai-guide.md, the agent connect prompt at
 *   /docs/integrations/crewai, the openclaw prompt and the CLI help at integration guides. An AI on
 *   any node that followed its own handbook ended at a file it could not open, and a person who
 *   pressed the button got a 404. Nothing checked it, because a path in a string is just a string.
 *   (wish-node-ei-linkit-repotiedostoihin-joita-se-ei-tarjoile)
 *
 *   WHAT COUNTS. In aimeat/src and aimeat/public, every string literal and template literal of a
 *   .ts, .js or .mjs file, and the text of every .html (outside HTML comments), .txt, .md, .json and
 *   .yaml file. A source comment is not read: it explains the code to a developer who has the
 *   repository, and citing a repository file there is right. CSS and SQL carry no served text.
 *   A path is `docs/...`, `/docs/...` or `aimeat/docs/...` written on its own or after a node URL
 *   (`${url}/docs/...`), and a GitHub address of a file in this repository. A vendor's own docs
 *   address (`https://code.claude.com/docs/...`) is not a path into this repository and is not read.
 *
 *   WHAT IS SERVED. GET /v1/specs/{name} serves the public record contracts named in
 *   services/contract-docs.ts, and GET /docs/specs/{name} redirects there (commit b286f62ba). A
 *   path to one of those is allowed, written either way. A GitHub address is allowed while the file
 *   it names exists in the repository: it then opens for anyone, and the check stops it the day the
 *   file goes.
 * @structure ROOTS; EXEMPT (answers, one reason each); servedTexts(): the served text of one file,
 *   with line numbers; findPaths(); main()
 * @usage
 *   cd aimeat && pnpm check:doc-links          # exits 1 on any finding
 * @version-history
 *   v1.0.1 -- 2026-10-11 -- PENDING_ELSEWHERE: the eight findings in files another session is
 *     editing print as waiting until its push lands, so main stays green in between.
 *   v1.0.0 -- 2026-10-11 -- Initial (docs cleanup phase 3).
 */
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { PUBLIC_CONTRACTS } from '../src/services/contract-docs.js';

const here = dirname(fileURLToPath(import.meta.url));
const REPO = join(here, '..', '..');

/** The trees whose text reaches an AI or a person through the node. */
const ROOTS = ['aimeat/src', 'aimeat/public'];

/**
 * Strings that look like a repository path and are something else. Each entry is an ANSWER: the
 * sentence that says why. Key: `<repo-relative file>|<the path as written>`.
 */
const EXEMPT: Record<string, string> = {
    'aimeat/src/services/ui-library/entries-fields.ts|docs/notes.txt': 'An example storage key in the UI component catalogue (a file a person uploaded under a docs/ folder of their own), not a repository path.',
    'aimeat/src/services/ui-library/entries-fields.ts|docs/plan.md': 'The same example, a second uploaded file.',
    'aimeat/src/services/ui-library/entries-settings.ts|docs/notes.txt': 'The title of an example file preview in the UI component catalogue.',
    'aimeat/public/views/design-lab/demos-fields.js|docs/notes.txt': 'The Design Lab demo of the same component, with the same example key.',
    'aimeat/public/views/design-lab/demos-fields.js|docs/plan.md': 'The same demo, the second example file.',
    'aimeat/public/views/design-lab/demos-views-knowledge.js|docs/notes.txt': 'The Design Lab demo of the file preview, with an example title.',
    'aimeat/public/views/design-lab/demos-views-knowledge.js|docs/plan.md': 'The same demo, its loading and error states.',
    'aimeat/src/routes/spec.ts|/docs/specs/': 'The declaration of the redirect route itself, which answers 301 to /v1/specs/{name}.',
    'aimeat/src/storage/providers/sqlite/schema-tables-4.ts|docs/internal/telemetria/02-design.md': 'A SQL comment inside the schema string: the database engine reads it and nobody is served it.',
};

/**
 * Findings another session fixes in its own pending change (cc-joumii-pre4-fix2, 2026-10-11): the
 * lines are in files it is editing, so changing them here would collide. Each prints as a warning
 * while it is still there and fails nothing; one that no longer matches is reported as done so the
 * entry is removed. A NEW finding is never added here: it is fixed, or answered in EXEMPT.
 */
const PENDING_ELSEWHERE: Record<string, string> = {
    'aimeat/src/services/onboarding-validator.ts|docs/building-an-aimeat-compatible-agent.md': 'cc-joumii-pre4-fix2 changes the three lines to the GitHub address in its pending commit.',
    'aimeat/src/services/handbooks/agent.ts|docs/building-an-aimeat-compatible-agent.md': 'cc-joumii-pre4-fix2 may edit the agent handbook in its pending commit; changed after its push.',
    'aimeat/public/data/everything.html|docs/visitor-geography.md': 'Generated from docs/AIMEAT-Feature-List.md, whose line cc-joumii-pre4-fix2 changes in its pending commit.',
    'aimeat/public/data/everything.json|docs/visitor-geography.md': 'The same generated line.',
    'aimeat/public/data/everything.md|docs/visitor-geography.md': 'The same generated line.',
};

/** Third-party code shipped as is. Its strings name its own vendor's documentation. */
const VENDORED = /^aimeat\/public\/lib\//;

const TEXT_EXT = /\.(html|txt|md|json|ya?ml)$/;
const CODE_EXT = /\.(ts|js|mjs)$/;

interface Piece { line: number; text: string }

/** The served text of one file: literals of a code file, everything but comments of an HTML file. */
function servedTexts(file: string, source: string): Piece[] {
    if (TEXT_EXT.test(file)) {
        const text = file.endsWith('.html') ? source.replace(/<!--[\s\S]*?-->/g, m => m.replace(/[^\n]/g, ' ')) : source;
        return [{ line: 1, text }];
    }
    const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true,
        file.endsWith('.ts') ? ts.ScriptKind.TS : ts.ScriptKind.JS);
    const pieces: Piece[] = [];
    const visit = (node: ts.Node): void => {
        if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
            || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)
            || node.kind === ts.SyntaxKind.JsxText) {
            const start = node.getStart(sf);
            pieces.push({ line: sf.getLineAndCharacterOfPosition(start).line + 1, text: source.slice(start, node.getEnd()) });
        }
        ts.forEachChild(node, visit);
    };
    visit(sf);
    return pieces;
}

/**
 * A path into docs/, on its own, after a node URL written as a variable (`${url}/docs/...`) or after
 * an aimeat.io address, and not inside someone else's address (`https://cursor.com/docs/mcp`).
 */
const LOCAL_PATH = /(?:https?:\/\/(?:[a-z0-9-]+\.)*aimeat\.io|(?<![A-Za-z0-9_.\-/]))(?:\/?aimeat)?\/?docs\/[A-Za-z0-9_][A-Za-z0-9_.\-/]*/g;
const GITHUB_PATH = /https?:\/\/github\.com\/[^/\s"'`]+\/aimeat-protocol\/(?:blob|tree)\/[^/\s"'`]+\/([^\s"'`<>)#?\\]+)/g;

function isServedSpec(path: string): boolean {
    const m = /^\/(?:docs|v1)\/specs\/([^/]+)$/.exec(path);
    return !!m && (PUBLIC_CONTRACTS as readonly string[]).includes(m[1]);
}

interface Finding { file: string; line: number; path: string; why: string }

function findPaths(file: string, piece: Piece): Finding[] {
    const out: Finding[] = [];
    const lineOf = (index: number) => piece.line + (piece.text.slice(0, index).match(/\n/g)?.length ?? 0);
    for (const m of piece.text.matchAll(GITHUB_PATH)) {
        const target = m[1].replace(/[.,;:]+$/, '');
        if (!existsSync(join(REPO, target))) out.push({ file, line: lineOf(m.index!), path: m[0], why: `names ${target}, which is not in the repository` });
    }
    const withoutGithub = piece.text.replace(GITHUB_PATH, m => ' '.repeat(m.length));
    for (const m of withoutGithub.matchAll(LOCAL_PATH)) {
        const path = m[0].replace(/[.,;:]+$/, '');
        if (isServedSpec(path)) continue;
        if (EXEMPT[`${file}|${path}`]) continue;
        out.push({ file, line: lineOf(m.index!), path, why: 'the node serves no such path' });
    }
    return out;
}

function main(): void {
    const files = execFileSync('git', ['ls-files', ...ROOTS], { cwd: REPO, encoding: 'utf8' })
        .split('\n').map(f => f.trim()).filter(f => f && (CODE_EXT.test(f) || TEXT_EXT.test(f)) && !f.endsWith('.d.ts') && !VENDORED.test(f));
    const findings: Finding[] = [];
    const usedExempt = new Set<string>();
    for (const file of files) {
        const abs = join(REPO, file);
        if (!existsSync(abs)) continue;
        const source = readFileSync(abs, 'utf8');
        if (!/docs\//.test(source)) continue;
        for (const piece of servedTexts(file, source)) {
            for (const m of piece.text.matchAll(LOCAL_PATH)) {
                const key = `${file}|${m[0].replace(/[.,;:]+$/, '')}`;
                if (EXEMPT[key]) usedExempt.add(key);
            }
            findings.push(...findPaths(file, piece));
        }
    }
    const stale = Object.keys(EXEMPT).filter(k => !usedExempt.has(k));
    const waiting = findings.filter(f => PENDING_ELSEWHERE[`${f.file}|${f.path}`]);
    for (const f of waiting) {
        console.warn(`  waiting: ${f.file}:${f.line}  ${f.path}  (${PENDING_ELSEWHERE[`${f.file}|${f.path}`]})`);
        findings.splice(findings.indexOf(f), 1);
    }
    const waitingKeys = new Set(waiting.map(f => `${f.file}|${f.path}`));
    for (const k of Object.keys(PENDING_ELSEWHERE)) {
        if (!waitingKeys.has(k)) console.warn(`  done elsewhere, remove from PENDING_ELSEWHERE: ${k}`);
    }
    for (const f of findings) console.error(`  ${f.file}:${f.line}  ${f.path}  (${f.why})`);
    for (const k of stale) console.error(`  EXEMPT entry matches nothing any more: ${k} (remove it)`);
    if (findings.length || stale.length) {
        console.error(`\n✗ ${findings.length} served text(s) send the reader to a repository file the node does not serve.`
            + '\n  Point them at a built-in skill (aimeat_skill_get, GET /v1/skills/{name}?scope=node), a route the node serves, or'
            + '\n  /v1/specs/{name} for a public contract. A source comment may cite a repository file; a string may not.');
        process.exit(1);
    }
    console.log(`✓ no served text links a repository file the node does not serve (${files.length} files)`);
}

main();
