/**
 * @file scripts/build-ui-library.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Reads what the files say about each part of the node's own interface library and
 *   writes it to src/services/ui-library/facts.generated.ts: the classes a component's sheet defines,
 *   the theme tokens its rules read, the names its module exports, the files that use it and the
 *   pages that draw it. With --check it writes nothing and fails on a stale copy or a broken promise.
 *
 *   WHAT --check HOLDS, and why each one:
 *   - Every sheet in public/css/components/ has exactly one entry, and is linked in spa.html. A sheet
 *     with no entry is a part nobody can find; a sheet nobody links is a part that draws nothing.
 *   - Every entry's sheet and module exist, and a module that names its entry in its header names
 *     one whose module is that file. Renames otherwise leave the catalogue pointing at nothing.
 *   - Every variant class is in the part's own classes. A variant the sheet does not carry is a
 *     promise an AI will build on and a person will never see.
 *   - An active part is drawn by at least one page, and an unused one by none, with a note on where
 *     its code sits. "Active" is checked, not believed; "unused" is what Jouni's keep-or-delete
 *     list reads.
 *   - The generated facts equal what the files say today.
 *   - The design lab has a demo for every entry, and no demo for a part that is not one.
 *   - Every variant of a design-lab decision has a live sample, its proposal is one of its
 *     variants, and every crop the manifest names is a file.
 *
 *   `pnpm build:ui-library` writes, `pnpm check:ui-library` checks.
 * @structure main() · parseRules() · classesIn() · tokensIn() · importGraph() · buildFacts() · problems()
 * @usage pnpm build:ui-library · pnpm check:ui-library
 * @version-history
 *   v1.2.1 — 2026-09-24 — usesClass escapes every regex metacharacter in a class name, not only '-'.
 *   v1.2.0 — 2026-09-23 — The design lab's decisions are held to their samples and crops.
 *   v1.1.0 — 2026-09-23 — The design lab's demos are held to the catalogue (phase 2).
 *   v1.0.0 — 2026-09-23 — Initial (UI consolidation phase 1).
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { UI_ENTRY_SOURCES } from '../src/services/ui-library/entries.js';
import type { UiEntryFacts, UiEntrySource } from '../src/services/ui-library/types.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');
const OUT = path.join(ROOT, 'src', 'services', 'ui-library', 'facts.generated.ts');
const SHEETS_DIR = path.join(PUBLIC, 'css', 'components');
/** Demos in the design lab that are not catalogue entries (none since the wrapper became a decision). */
const DEMO_EXTRAS: string[] = [];

const read = (p: string): string => readFileSync(p, 'utf8');
const pub = (publicPath: string): string => path.join(PUBLIC, publicPath.replace(/^\//, ''));
const rel = (abs: string): string => path.relative(PUBLIC, abs).split(path.sep).join('/');
const uniqSorted = (xs: Iterable<string>): string[] => [...new Set(xs)].sort();

interface Rule { selector: string; body: string }

/** Every rule with declarations, at any depth of @media or @supports. Keyframes are skipped. */
export function parseRules(css: string): Rule[] {
    const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const rules: Rule[] = [];
    let i = 0;
    let start = 0;
    while (i < text.length) {
        const ch = text[i];
        if (ch === ';' ) { start = i + 1; i++; continue; }
        if (ch !== '{') { i++; continue; }
        const prelude = text.slice(start, i).trim();
        let depth = 1;
        let j = i + 1;
        while (j < text.length && depth > 0) {
            if (text[j] === '{') depth++;
            else if (text[j] === '}') depth--;
            j++;
        }
        const inner = text.slice(i + 1, j - 1);
        if (/^@(media|supports|container|layer)\b/.test(prelude)) rules.push(...parseRules(inner));
        else if (!prelude.startsWith('@')) rules.push({ selector: prelude, body: inner });
        i = j;
        start = j;
    }
    return rules;
}

export function classesIn(selector: string): string[] {
    return [...selector.matchAll(/\.(-?[a-zA-Z_][\w-]*)/g)].map(m => m[1]);
}

export function tokensIn(body: string): string[] {
    return [...body.matchAll(/var\(\s*(--[\w-]+)/g)].map(m => m[1]);
}

function walkFiles(dir: string, ext: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
        const abs = path.join(dir, name);
        if (statSync(abs).isDirectory()) walkFiles(abs, ext, out);
        else if (name.endsWith(ext)) out.push(abs);
    }
    return out;
}
const walkJs = (dir: string): string[] => walkFiles(dir, '.js');

/**
 * The files the SPA is made of: views, components and the shared scripts. The design lab's own
 * files are left out: the lab draws every part to show it, and counting it as a user would make
 * every part look used by the admin page.
 */
function sourceFiles(): string[] {
    return ['views', 'components', 'js'].flatMap(d => walkJs(path.join(PUBLIC, d)))
        .filter(f => !rel(f).startsWith('views/design-lab/') && !/^views\/admin\/design-lab-/.test(rel(f)));
}

/** The shell: spa.html draws the top bar, the page base and the footer on every page itself. */
const SHELL = 'spa.html';

/**
 * Modules under /components that are not interface parts, each with what it is instead. Every other
 * module there is a part and has a catalogue entry.
 */
export const NOT_PARTS: Record<string, string> = {
    '/components/index.js': 'The barrel that re-exports the parts for older imports; it draws nothing itself.',
    '/components/useViewCSS.js': 'A hook that loads a view\'s stylesheet; it draws nothing.',
    '/components/data-map/model.js': 'The data model of the data map (what is where), no markup.',
    '/components/ai-label-icons.js': 'The icon data the AI label draws; the part is ai-label.',
};

/** What a person does with a part: the fixed words `use` takes (08-component-rules.md). */
export const USE_WORDS = ['view', 'edit', 'list', 'pick', 'compare', 'status', 'navigate', 'converse',
    'act', 'copy', 'explain', 'count', 'search', 'notify', 'wait', 'layout', 'open', 'confirm'] as const;

/** importer lists, keyed by the imported file (public-relative). */
function importGraph(files: string[]): Map<string, Set<string>> {
    const importers = new Map<string, Set<string>>();
    for (const abs of files) {
        // Block comments out: a header's @usage line shows an import without being one.
        const src = read(abs).replace(/\/\*[\s\S]*?\*\//g, '');
        for (const m of src.matchAll(/(?:from\s+|import\s*\(\s*)['"]([^'"]+\.js)['"]/g)) {
            const spec = m[1];
            let target: string;
            if (spec.startsWith('/')) target = spec.slice(1);
            else if (spec.startsWith('.')) target = rel(path.resolve(path.dirname(abs), spec));
            else continue;
            if (target === rel(abs)) continue;
            if (!importers.has(target)) importers.set(target, new Set());
            importers.get(target)!.add(rel(abs));
        }
    }
    return importers;
}

/** The page modules: what the router in spa.html loads for a URL. */
function routeModules(): Set<string> {
    const spa = read(path.join(PUBLIC, 'spa.html'));
    return new Set([...spa.matchAll(/import\(\s*'\/(views\/[^']+\.js)'/g)].map(m => m[1]));
}

/**
 * The layout engine loads every block through one map, and both the front page and the home load
 * the map. Following imports through it would say the front page draws the home's steps, so the
 * walk stops at the map and a block file counts for the surface its blocks are made for.
 */
const BLOCK_MAP = 'views/surface/block-map.js';
const BLOCK_SURFACES: Record<string, string[]> = {
    'views/surface/blocks-portal.js': ['views/landing.js'],
    'views/surface/blocks-home.js': ['views/home/index.js'],
    'views/surface/freeform.js': ['views/landing.js', 'views/home/index.js'],
};

/** The pages that draw what `start` holds, following importers upward. */
function pagesFrom(start: string[], importers: Map<string, Set<string>>, routes: Set<string>): string[] {
    const seen = new Set<string>();
    const queue = [...start];
    const pages = new Set<string>();
    while (queue.length) {
        const f = queue.shift()!;
        if (seen.has(f) || f === BLOCK_MAP) continue;
        seen.add(f);
        // The shell is a page of its own: what it draws is on every page.
        if (routes.has(f) || f === SHELL) pages.add(f);
        for (const p of BLOCK_SURFACES[f] ?? []) pages.add(p);
        for (const up of importers.get(f) ?? []) queue.push(up);
    }
    return uniqSorted(pages);
}

function exportsOf(src: string): string[] {
    return uniqSorted([...src.matchAll(/export\s+(?:async\s+)?(?:function|const|let|class)\s+([A-Za-z_$][\w$]*)/g)].map(m => m[1]));
}

// Every regex metacharacter escaped, the backslash included: a class name is text to find, and a
// hand-picked list (only '-' until 2026-09-24, CodeQL js/incomplete-sanitization) misses the rest.
const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');
const usesClass = (src: string, cls: string): boolean =>
    new RegExp(`(?<![\\w-])${escapeRegExp(cls)}(?![\\w-])`).test(src);

export function buildFacts(entries: UiEntrySource[]): Record<string, UiEntryFacts> {
    const files = sourceFiles();
    const texts = new Map(files.map(f => [rel(f), read(f)]));
    texts.set(SHELL, read(path.join(PUBLIC, SHELL)));
    const importers = importGraph([...files, path.join(PUBLIC, SHELL)]);
    const routes = routeModules();
    // Which stylesheets name each class. A sheet OWNS a class no other sheet names; a class it
    // shares (another part's, styled in context) says nothing about who draws this part.
    const namedIn = new Map<string, Set<string>>();
    for (const css of walkFiles(path.join(PUBLIC, 'css'), '.css')) {
        for (const c of parseRules(read(css)).flatMap(r => classesIn(r.selector))) {
            if (!namedIn.has(c)) namedIn.set(c, new Set());
            namedIn.get(c)!.add(rel(css));
        }
    }
    const facts: Record<string, UiEntryFacts> = {};

    for (const e of entries) {
        const rules = parseRules(read(pub(e.sheet)));
        // A shape, and a part that shares a sheet with others, is the rules naming its own classes;
        // a part that owns its sheet is the whole sheet.
        const owns = e.kind === 'component' && e.sheet === `/css/components/${e.id}.css`;
        const own = e.classes && !owns
            ? rules.filter(r => classesIn(r.selector).some(c => e.classes!.includes(c)))
            : rules;
        const classes = e.kind === 'shape' ? uniqSorted(e.classes!) : uniqSorted(own.flatMap(r => classesIn(r.selector)));
        const tokens = uniqSorted(own.flatMap(r => tokensIn(r.body)));
        const moduleRel = e.module ? e.module.replace(/^\//, '') : null;
        // A part is drawn by importing its module or by writing its classes as markup; both count.
        // The probe is the classes the entry names; failing that, the classes its sheet owns.
        const sheetRel = e.sheet.replace(/^\//, '');
        const probe = e.classes ?? classes.filter(c => namedIn.get(c)?.size === 1 && namedIn.get(c)!.has(sheetRel) && c.includes('-'));
        const writers = [...texts]
            .filter(([f, src]) => f !== moduleRel && probe.some(c => usesClass(src, c)))
            .map(([f]) => f);
        const usedBy = uniqSorted([...(moduleRel ? importers.get(moduleRel) ?? [] : []), ...writers]);
        // An unused part without a module is markup inside a function no page mounts, which an
        // import walk cannot see; its pages are empty by the entry's word, and its note says where.
        const pages = e.status === 'unused' && !moduleRel ? [] : pagesFrom(moduleRel ? [moduleRel, ...writers] : writers, importers, routes);
        facts[e.id] = {
            classes, tokens,
            exports: moduleRel ? exportsOf(read(pub(e.module!))) : [],
            usedBy, pages,
        };
    }
    return facts;
}

function render(facts: Record<string, UiEntryFacts>): string {
    // One entry per line: a diff still shows which part changed, and the file stays short.
    const body = `{\n${Object.keys(facts).sort().map(k => `    ${JSON.stringify(k)}: ${JSON.stringify(facts[k])},`).join('\n')}\n}`;
    return `/**
 * @file src/services/ui-library/facts.generated.ts
 * @description GENERATED by scripts/build-ui-library.ts — do not edit. What the files say about each
 *   catalogue entry: its classes, the theme tokens it reads, its exports, its users and its pages.
 *   \`pnpm build:ui-library\` rewrites it; \`pnpm check:ui-library\` refuses a stale copy.
 */
import type { UiEntryFacts } from './types.js';

export const UI_FACTS: Record<string, UiEntryFacts> = ${body};
`;
}

export function problems(entries: UiEntrySource[], facts: Record<string, UiEntryFacts>): string[] {
    const out: string[] = [];
    const ids = new Set<string>();
    for (const e of entries) {
        if (ids.has(e.id)) out.push(`${e.id}: two entries share this id`);
        ids.add(e.id);
        if (!existsSync(pub(e.sheet))) { out.push(`${e.id}: sheet ${e.sheet} does not exist`); continue; }
        if (e.module && !existsSync(pub(e.module))) out.push(`${e.id}: module ${e.module} does not exist`);
        if (e.status === 'unused' && !e.note) out.push(`${e.id}: an unused part says in note where its code sits`);
        if (e.kind === 'shape' && !e.classes?.length) out.push(`${e.id}: a shape names its classes`);
        const f = facts[e.id];
        if (e.kind === 'shape') {
            const defined = new Set(parseRules(read(pub(e.sheet))).flatMap(r => classesIn(r.selector)));
            for (const c of e.classes ?? []) if (!defined.has(c)) out.push(`${e.id}: class ${c} is not in ${e.sheet}`);
        }
        for (const v of e.variants) {
            if (v.class && !f.classes.includes(v.class)) out.push(`${e.id}: variant "${v.name}" names ${v.class}, which its sheet does not carry`);
        }
        if (e.status === 'active' && f.pages.length === 0) out.push(`${e.id}: marked active but no page draws it (mark it unused, with a note)`);
        if (e.status === 'unused' && f.pages.length > 0) out.push(`${e.id}: marked unused but ${f.pages.join(', ')} draws it`);
    }
    const sheets = readdirSync(SHEETS_DIR).filter(n => n.endsWith('.css'));
    const spa = read(path.join(PUBLIC, 'spa.html'));
    for (const name of sheets) {
        const p = `/css/components/${name}`;
        // One entry OWNS a sheet (its id is the sheet's name); a part with no look of its own (a copy
        // button wears the button's) may name another part's sheet as where its look lives.
        const owners = entries.filter(e => e.sheet === p && e.id === name.replace(/\.css$/, '')).length;
        if (owners !== 1) out.push(`${p}: ${owners} owning catalogue entries (exactly one expected, its id "${name.replace(/\.css$/, '')}")`);
        if (!spa.includes(`href="${p}"`)) out.push(`${p}: not linked in spa.html`);
    }
    // Every module under /components is a part with an entry, or named in NOT_PARTS with what it is.
    const modules = new Set(entries.map(e => e.module).filter(Boolean));
    for (const abs of walkJs(path.join(PUBLIC, 'components'))) {
        const mod = '/' + rel(abs);
        if (!modules.has(mod) && !NOT_PARTS[mod]) out.push(`${mod}: a component module with no catalogue entry (add one, or name it in NOT_PARTS with what it is)`);
    }
    for (const mod of Object.keys(NOT_PARTS)) if (!existsSync(pub(mod))) out.push(`NOT_PARTS: ${mod} does not exist`);
    // `use` is what a person does with the part, from the fixed words; `useFor` says it in a sentence.
    for (const e of entries) {
        if (!e.use.length) out.push(`${e.id}: use names at least one word (${USE_WORDS.join(', ')})`);
        for (const w of e.use) if (!(USE_WORDS as readonly string[]).includes(w)) out.push(`${e.id}: use "${w}" is not one of the words (${USE_WORDS.join(', ')})`);
    }
    // The design lab draws every entry: each has a demo, and each demo is an entry or a named extra.
    const demoDir = path.join(PUBLIC, 'views', 'design-lab');
    const demoIds = new Set<string>();
    for (const name of readdirSync(demoDir).filter(n => /^demos-.*\.js$/.test(n))) {
        // A demo is a top-level key (two spaces in): `'id': {` or `id: one(…)`.
        for (const m of read(path.join(demoDir, name)).matchAll(/^ {2}'?([\w-]+)'?: (?:\{|one\()/gm)) demoIds.add(m[1]);
    }
    for (const e of entries) if (!demoIds.has(e.id)) out.push(`${e.id}: no demo in views/design-lab/demos-*.js, so the design lab cannot draw it`);
    for (const d of demoIds) {
        if (!ids.has(d) && !DEMO_EXTRAS.includes(d)) out.push(`views/design-lab: demo "${d}" is not a catalogue entry or a named extra`);
    }
    out.push(...decisionProblems());
    for (const abs of walkJs(path.join(PUBLIC, 'components'))) {
        const m = /the catalogue entry is\s*`([\w-]+)`/.exec(read(abs).slice(0, 3000));
        if (!m) continue;
        const e = entries.find(x => x.id === m[1]);
        const mod = '/' + rel(abs);
        if (!e) out.push(`${mod}: names catalogue entry "${m[1]}", which does not exist`);
        else if (e.module !== mod) out.push(`${mod}: names catalogue entry "${m[1]}", whose module is ${e.module ?? 'none'}`);
    }
    return out;
}

/**
 * The design lab's decisions: every variant in decisions-data.js has a live sample in
 * decision-samples.js (and no sample is left without a variant), and every crop the manifest names
 * is a file. The samples file imports browser paths, so its ids are read as text.
 */
export function decisionProblems(): string[] {
    const out: string[] = [];
    const dir = path.join(PUBLIC, 'views', 'design-lab');
    const data = read(path.join(dir, 'decisions-data.js'));
    const samples = read(path.join(dir, 'decision-samples.js'));
    const blocks = (src: string, marker: RegExp): Map<string, string> => {
        const map = new Map<string, string>();
        const parts = src.split(marker);
        for (let i = 1; i < parts.length; i += 2) map.set(parts[i], parts[i + 1] ?? '');
        return map;
    };
    const decisions = blocks(data, /^ {4}id: '([\w-]+)',$/m);
    const sampleBlocks = blocks(samples, /^ {2}'?([\w-]+)'?: \[$/m);
    // By indentation: a variant is a line of its own at six spaces, a sample at four, so an id inside
    // a sample's own data (a thread, a card) is not taken for either.
    const ids = (src: string, indent: number) => [...src.matchAll(new RegExp(`^ {${indent}}\\{ id: '([\\w-]+)'`, 'gm'))].map(m => m[1]);
    for (const [id, body] of decisions) {
        const wanted = ids(/^ {4}variants: \[$([\s\S]*?)^ {4}\],$/m.exec(body)?.[1] ?? '', 6);
        const have = ids(sampleBlocks.get(id) ?? '', 4);
        for (const v of wanted) if (!have.includes(v)) out.push(`decision ${id}: variant "${v}" has no sample in decision-samples.js`);
        for (const v of have) if (!wanted.includes(v)) out.push(`decision ${id}: sample "${v}" is not a variant in decisions-data.js`);
        const proposed = /proposal: \{\s*variant: '([\w-]+)'/.exec(body)?.[1];
        if (proposed === 'proposal') {
            // A new composition: its picture is in PROPOSALS, under the decision's id.
            const proposals = samples.split(/^export const PROPOSALS/m)[1] ?? '';
            if (!new RegExp(`^ {2}'?${id}'?: \\{$`, 'm').test(proposals)) out.push(`decision ${id}: the proposal is a new composition but PROPOSALS has no picture for it`);
        } else if (!proposed || !wanted.includes(proposed)) {
            out.push(`decision ${id}: the proposal names "${proposed}", which is not one of its variants`);
        }
    }
    for (const id of sampleBlocks.keys()) if (!decisions.has(id)) out.push(`decision-samples.js: "${id}" is not a decision`);
    const manifestPath = path.join(PUBLIC, 'img', 'design-lab', 'crops.json');
    if (existsSync(manifestPath)) {
        const manifest = JSON.parse(read(manifestPath)) as Record<string, Record<string, Record<string, string>>>;
        for (const [d, vs] of Object.entries(manifest)) for (const [v, e] of Object.entries(vs)) {
            if (e.context && !existsSync(pub(e.context))) out.push(`crop ${d}/${v}: ${e.context} is not a file`);
        }
    }
    return out;
}

function main(): void {
    const check = process.argv.includes('--check');
    const facts = buildFacts(UI_ENTRY_SOURCES);
    const found = problems(UI_ENTRY_SOURCES, facts);
    const text = render(facts);
    if (check) {
        const current = existsSync(OUT) ? read(OUT).replace(/\r\n/g, '\n') : '';
        if (current !== text) found.push('src/services/ui-library/facts.generated.ts is stale: run pnpm build:ui-library');
    } else {
        writeFileSync(OUT, text);
    }
    if (found.length) {
        console.error(`✗ ui-library: ${found.length} problem(s)`);
        for (const p of found) console.error(`  - ${p}`);
        process.exit(1);
    }
    const comps = UI_ENTRY_SOURCES.filter(e => e.kind === 'component');
    console.log(`✓ ui-library ${check ? 'in sync' : 'written'}: ${comps.length} components (${comps.filter(e => e.status === 'unused').length} unused), ${UI_ENTRY_SOURCES.length - comps.length} shapes`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
