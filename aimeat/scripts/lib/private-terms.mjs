/**
 * @file scripts/lib/private-terms.mjs
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The matching behind check-private-terms.mjs: which words name an organisation node's
 *   people, apps and organisms, and which lines of a commit carry one.
 *
 *   WHY. This repository is public, and an organisation node's members, apps, organisms and address
 *   reached it through code comments, test fixtures and commit messages written as evidence for a
 *   fix (2026-11-04). The history had to be rewritten three times to take them out. The list of
 *   words cannot live in the repository, because the list itself would be the leak, so it is a file
 *   in git's common directory that this module reads and the hooks apply.
 *
 *   A TERM is one line of that file. It matches case-insensitively and as a whole word: letters and
 *   digits on either side make it a different word, so a surname that is also part of a compound
 *   does not match inside it. A term ending in `*` matches as a word prefix, for a name that is
 *   inflected. `#` starts a comment line.
 * @version-history
 *   v1.0.0 — 2026-11-04 — Initial.
 */

/** @param {string} text the terms file */
export function parseTerms(text) {
    const seen = new Set();
    const terms = [];
    for (const raw of text.split(/\r?\n/)) {
        const line = raw.trim();
        if (!line || line.startsWith('#')) continue;
        const key = line.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        terms.push(line);
    }
    return terms;
}

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** @param {string[]} terms */
export function compileTerms(terms) {
    return terms.map((term) => {
        const prefix = term.endsWith('*');
        const body = escape(prefix ? term.slice(0, -1) : term);
        const tail = prefix ? '' : '(?![\\p{L}\\p{N}])';
        const needle = (prefix ? term.slice(0, -1) : term).toLowerCase();
        return { term, needle, re: new RegExp(`(?<![\\p{L}\\p{N}])${body}${tail}`, 'iu') };
    });
}

/**
 * The lines that carry a term, each with the term it carries.
 * @param {Iterable<{ where: string, text: string }>} lines
 * @param {{ term: string, re: RegExp }[]} compiled
 */
export function findHits(lines, compiled) {
    const hits = [];
    for (const line of lines) {
        // A substring test first: the regex runs only on a line that holds the letters at all, which
        // keeps a push that adds a minified library from testing every term against every megabyte.
        const lower = line.text.toLowerCase();
        for (const { term, needle, re } of compiled) {
            if (lower.includes(needle) && re.test(line.text)) { hits.push({ where: line.where, term, text: line.text }); break; }
        }
    }
    return hits;
}

/**
 * The lines of `git log -p` or `git diff` output that a push or a commit ADDS: commit messages and
 * added lines, with the file each added line belongs to. Removed lines and diff headers are skipped,
 * since removing a name is the cure, not the leak.
 * @param {string} out
 */
export function addedLines(out) {
    const lines = [];
    let file = '';
    let commit = '';
    for (const raw of out.split(/\r?\n/)) {
        if (raw.startsWith('\u0000commit ')) { commit = raw.slice(8, 20); file = ''; continue; }
        if (raw.startsWith('diff --git ')) { file = raw.replace(/^diff --git a\/.* b\//, ''); continue; }
        if (!file) { lines.push({ where: `${commit ? commit + ' ' : ''}message`, text: raw }); continue; }
        if (raw.startsWith('+++ ')) { lines.push({ where: `${commit ? commit + ' ' : ''}path`, text: raw.slice(4) }); continue; }
        if (raw.startsWith('--- ') || raw.startsWith('index ') || raw.startsWith('@@') || raw.startsWith('-')) continue;
        if (raw.startsWith('new file mode') || raw.startsWith('deleted file mode') || raw.startsWith('similarity ') || raw.startsWith('rename ')) {
            if (raw.startsWith('rename to ')) lines.push({ where: `${commit ? commit + ' ' : ''}path`, text: raw.slice(10) });
            continue;
        }
        if (raw.startsWith('+')) lines.push({ where: `${commit ? commit + ' ' : ''}${file}`, text: raw.slice(1) });
    }
    return lines;
}

/**
 * The terms an organisation node's own lists give: every person's full name, each part of it and
 * their account name; every app's name and file name; every organism's name; the node's address and
 * id. Parts shorter than four letters are left out, since they match too much.
 * @param {{ host?: string, nodeId?: string, people?: { name?: string, id?: string }[],
 *   apps?: { name?: string, filename?: string }[], organisms?: string[], extra?: string[] }} input
 */
export function deriveTerms(input) {
    const out = [];
    const add = (s) => { const t = String(s ?? '').trim(); if (t.replace(/\*$/, '').length >= 4) out.push(t); };
    add(input.host);
    add(input.nodeId);
    for (const p of input.people ?? []) {
        add(p.name);
        for (const part of String(p.name ?? '').split(/\s+/)) add(part);
        add(String(p.id ?? '').split('@')[0]);
    }
    for (const a of input.apps ?? []) { add(a.name); add(String(a.filename ?? '').replace(/\.html$/, '')); }
    for (const o of input.organisms ?? []) add(o);
    for (const e of input.extra ?? []) add(e);
    return parseTerms(out.join('\n'));
}
