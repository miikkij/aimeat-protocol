/**
 * @file src/services/workspace-doc-markdown.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The markdown half of editing a workspace document in place: where a heading's section
 *   starts and stops, and how a block of text is inserted or swapped in without disturbing a byte of
 *   the rest.
 *
 *   IT IS STRING SURGERY, NOT A PARSER. Reading markdown into a document tree and printing it back
 *   is how whitespace, list markers, table alignment and trailing newlines quietly change: the
 *   caller edited one section and the reader diffing two versions is handed a reformatted document
 *   with the real change buried in it. So nothing here ever rebuilds the text. Every operation is
 *   `text.slice(0, a) + something + text.slice(b)`, which makes "everything else is byte-identical"
 *   a property of the code rather than a promise about it.
 *
 *   APPEND INSERTS, IT NEVER REWRITES. The separator between what was there and what arrives is
 *   computed from what the two halves already end and begin with, so no existing character is
 *   removed — not even trailing blank lines nobody would miss. That is what makes an append safe to
 *   run twice from two sessions: each one adds, neither one edits.
 *
 *   HEADINGS INSIDE FENCED CODE ARE NOT HEADINGS. A design spec is full of ```-fenced blocks, and
 *   several of them contain lines starting with `#`. A scanner that missed that would find a
 *   "section" inside a shell transcript and cut the document in half there.
 * @structure
 *   - findSections() — every ATX heading outside a code fence, with the extent of its section
 *   - locateSection() — one section by exact heading text, or a refusal that names the collisions
 *   - insertAt() / replaceRange() — the two string operations everything above resolves to
 *   - isHeadingLine() — does this replacement block start with a heading (the section-edit guard)
 * @usage
 *   const found = locateSection(markdown, 'Concurrency');
 *   if ('error' in found) return refuse(found);
 *   const next = replaceRange(markdown, found.section.start, found.section.end, block);
 * @version-history
 *   v1.0.1 — 2026-09-03 — The heading pattern's text class takes `[^]` rather than `.`, so a tab
 *     run followed by a carriage return can no longer make it backtrack quadratically. One
 *     document was enough to hold the event loop for minutes, and every document here is written
 *     by a member or an agent.
 *   v1.0.0 — 2026-09-02 — Initial: append and section replace for workspace documents
 *     (wish-workspace-append-ja-osiomuokkaus).
 */

/** One ATX heading and the extent of the section it opens. Offsets are into the original string. */
export interface DocSection {
    /** `#` count, 1..6. */
    level: number;
    /** The heading text, with the `#`s, the leading space and any closing `#`s removed. */
    heading: string;
    /** 1-based line number of the heading, for a refusal that has to name two of them. */
    line: number;
    /** Offset of the first character of the heading line. */
    start: number;
    /** Offset just past the heading line's newline — where the section's BODY begins. */
    bodyStart: number;
    /** Offset of the next heading at this level or higher, or the length of the string. */
    end: number;
}

/**
 * An ATX heading: up to three spaces of indent, 1-6 `#`, then the text (or nothing).
 *
 * The text class is `[^]` — every character — and not `.`, which is the whole of the difference
 * between this running in microseconds and hanging the node. `.` does not match a carriage return.
 * With `(.*)$` the tail can FAIL, and because `[ \t]+` and the text class both accept spaces and
 * tabs, the engine then retries every way of splitting the run: one line of `#` + a tab run + a
 * bare `\r` costs O(n²). Measured on the real pattern: 1.0 ms at 1000 tabs, 5.1 at 2000, 18.4 at
 * 4000, 76.2 at 8000 — four times the work for twice the input, which at the 1024 kB a memory
 * value may hold extrapolates to about twenty minutes of blocked event loop, and Node has one.
 * `[^]*` cannot fail, so the first split wins and there is nothing to backtrack: 0.005 ms at every
 * size above. Both call sites take text a person or an agent wrote (CodeQL js/polynomial-redos,
 * alert 1601).
 */
const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+([^]*))?$/;
/** A fence line: up to three spaces of indent, then three or more backticks or tildes. */
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

/** The heading text CommonMark would render: the optional closing sequence of `#`s is not part of it. */
function headingText(raw: string | undefined): string {
    return (raw ?? '').replace(/[ \t]+#+[ \t]*$/, '').trim();
}

/**
 * Every heading in the document, in order, each with the extent of the section it owns.
 *
 * A section runs from its own heading line to the next heading at the SAME level or higher, which is
 * what "this heading and its body" means to a reader: replacing `## Tests` takes its `### Unit`
 * subsection with it, and replacing `### Unit` does not touch the `## Tests` it sits under.
 */
export function findSections(markdown: string): DocSection[] {
    const out: DocSection[] = [];
    let offset = 0;
    let line = 0;
    // The open fence's marker, so a ``` block containing ~~~ (or a longer ```` run) closes only on
    // its own kind. CommonMark: the closing fence is the same character and at least as long.
    let fence: { char: string; len: number } | null = null;

    for (const raw of markdown.split('\n')) {
        line++;
        const lineStart = offset;
        offset += raw.length + 1;                       // +1 for the '\n' split consumed
        const text = raw.endsWith('\r') ? raw.slice(0, -1) : raw;

        const fenceHit = FENCE.exec(text);
        if (fenceHit) {
            const marker = fenceHit[1];
            const char = marker[0];
            if (!fence) { fence = { char, len: marker.length }; continue; }
            // Only a bare closing fence of the same kind and length closes it; anything after the
            // run (an info string) means this is not a close.
            if (char === fence.char && marker.length >= fence.len && text.slice(fenceHit[0].length).trim() === '') fence = null;
            continue;
        }
        if (fence) continue;

        const hit = HEADING.exec(text);
        if (!hit) continue;
        out.push({
            level: hit[1].length,
            heading: headingText(hit[2]),
            line,
            start: lineStart,
            bodyStart: Math.min(lineStart + raw.length + 1, markdown.length),
            end: markdown.length,                       // closed by the next qualifying heading below
        });
    }

    // Close each section at the next heading of the same level or higher. Done afterwards because a
    // section's end is only known once the heading that ends it has been seen.
    for (let i = 0; i < out.length; i++) {
        for (let j = i + 1; j < out.length; j++) {
            if (out[j].level <= out[i].level) { out[i].end = out[j].start; break; }
        }
    }
    return out;
}

/** What went wrong looking for a section, in the words the caller shows the agent. */
export type SectionLookupFailure =
    | { error: 'NO_SUCH_SECTION'; message: string; headings: string[] }
    | { error: 'AMBIGUOUS_SECTION'; message: string; matches: Array<{ heading: string; level: number; line: number }> };

/**
 * One section by its heading TEXT, matched exactly.
 *
 * The heading is the address because it is the only one a reader can see. An invented id would be a
 * second addressing scheme to keep correct, and nobody could read it off the document to use it.
 *
 * Two headings with the same text is a REFUSAL that names both with their line numbers — the same
 * rule a bare agent name already follows on a two-owner daemon. Guessing which one the caller meant
 * is how an edit lands in the wrong half of a long spec and is found weeks later.
 */
export function locateSection(markdown: string, heading: string): { section: DocSection } | SectionLookupFailure {
    const want = heading.replace(/^ {0,3}#{1,6}[ \t]*/, '').trim();
    const sections = findSections(markdown);
    const matches = sections.filter(s => s.heading === want);

    if (matches.length === 1) return { section: matches[0] };
    if (matches.length === 0) {
        const headings = sections.map(s => `${'#'.repeat(s.level)} ${s.heading}`);
        return {
            error: 'NO_SUCH_SECTION',
            message: `No heading reads exactly "${want}" in this document. It has ${sections.length === 0 ? 'no headings at all' : `these: ${headings.join(' | ')}`}.`,
            headings,
        };
    }
    return {
        error: 'AMBIGUOUS_SECTION',
        message: `"${want}" is the heading of ${matches.length} sections in this document (${matches.map(m => `line ${m.line}, ${'#'.repeat(m.level)}`).join('; ')}). Rename one of them, or edit the document as a whole — this tool will not pick for you.`,
        matches: matches.map(m => ({ heading: m.heading, level: m.level, line: m.line })),
    };
}

/** Does this block open with an ATX heading? The guard on a section replacement — see replaceRange. */
export function isHeadingLine(markdown: string): boolean {
    for (const raw of markdown.split('\n')) {
        const text = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
        if (text.trim() === '') continue;
        return HEADING.test(text);
    }
    return false;
}

/**
 * Put `block` into `text` at `pos` without removing a single existing character.
 *
 * The blank lines around it are worked out from what the two halves already end and begin with, so
 * the result is well-formed markdown and `text.slice(0, pos)` is still a byte-identical prefix of
 * the answer, `text.slice(pos)` still a byte-identical suffix. That is the whole safety property of
 * an append: it cannot damage what it did not write.
 */
export function insertAt(text: string, pos: number, block: string): string {
    const head = text.slice(0, pos);
    const rest = text.slice(pos);
    const body = block.replace(/[ \t\r\n]+$/, '').replace(/^[\r\n]+/, '');
    if (body === '') return text;

    const before = head === '' ? ''
        : head.endsWith('\n\n') ? ''
            : head.endsWith('\n') ? '\n'
                : '\n\n';
    const after = rest === '' ? '\n'
        : rest.startsWith('\n\n') ? ''
            : rest.startsWith('\n') ? '\n'
                : '\n\n';
    return head + before + body + after + rest;
}

/**
 * Swap the half-open range [start, end) for `block`, keeping the range's own trailing whitespace.
 *
 * Reusing the tail is what keeps the seam invisible: the blank line that separated this section from
 * the next one is the same blank line afterwards, so a diff shows the section's text changing and
 * nothing at its edges. Everything outside the range is untouched by construction.
 */
export function replaceRange(text: string, start: number, end: number, block: string): string {
    const replaced = text.slice(start, end);
    const tail = /\s*$/.exec(replaced)?.[0] ?? '';
    const body = block.replace(/[ \t\r\n]+$/, '');
    return text.slice(0, start) + body + tail + text.slice(end);
}
