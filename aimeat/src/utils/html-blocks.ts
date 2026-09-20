/**
 * @file src/utils/html-blocks.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Reading the `<style>` and `<script>` bodies out of a single-file app, in one pass.
 *
 *   WHY NOT THE ONE-LINE REGULAR EXPRESSION. `<style[^>]*>([\s\S]*?)<\/style>` is the obvious way
 *   to write this and it is quadratic on the bytes a stranger uploaded: the engine restarts at
 *   every `<style` in the file, and each start scans forward for a closing tag that a hostile page
 *   simply never writes. CodeQL reports it as js/polynomial-redos (alerts 1641 and 1642 on
 *   2026-09-20, in the publish-time checks that read every app at publish). Scanning with indexOf
 *   gives the same bodies in one pass, whatever the page contains.
 *
 *   AN UNCLOSED BLOCK ENDS THE READING, which is what the regular expression did too: with no
 *   closing tag it matched nothing from there on. It is also what a browser does, so a page cannot
 *   hide code from these checks by leaving a tag open.
 * @structure
 *   - elementBodies(html, tag, keep?) — the bodies of one element, in document order
 *   - withoutBlockComments(code) — JavaScript with its `/* … *\/` comments blanked
 * @usage
 *   import { elementBodies } from '../utils/html-blocks.js';
 *   const css = elementBodies(html, 'style').join('\n');
 *   const js = elementBodies(html, 'script', attrs => !/\bsrc\s*=/i.test(attrs)).join('\n');
 * @version-history
 *   v1.0.0 — 2026-09-20 — Initial. Three copies of the same quadratic pattern in two services,
 *     replaced by one scan they share.
 */

/**
 * The bodies of every `<tag>…</tag>` in the page, in document order.
 *
 * `keep` is asked about the raw attribute text of each opening tag, which is how a caller skips the
 * blocks it must not read: a `<script src=…>` has no body of its own, and parsing one as this
 * page's code would be a claim about somebody else's file.
 */
export function elementBodies(html: string, tag: string, keep?: (attrs: string) => boolean): string[] {
    const out: string[] = [];
    const lower = html.toLowerCase();
    const open = `<${tag.toLowerCase()}`;
    const close = `</${tag.toLowerCase()}`;

    let at = lower.indexOf(open);
    while (at !== -1) {
        const gt = html.indexOf('>', at + open.length);
        if (gt === -1) break;
        // `<styles>` is not `<style>`: the name has to end where the name ends.
        const nameEnd = html[at + open.length] ?? '>';
        const isTag = nameEnd === '>' || nameEnd === '/' || /\s/.test(nameEnd);
        const end = lower.indexOf(close, gt + 1);
        if (end === -1) break;
        if (isTag && (!keep || keep(html.slice(at + open.length, gt)))) out.push(html.slice(gt + 1, end));
        at = lower.indexOf(open, end + close.length);
    }
    return out;
}

/**
 * The same code with every `/* … *\/` comment replaced by one space.
 *
 * A comment that is never closed takes the rest of the file with it, which is what a JavaScript
 * parser does with it as well. The regular expression this replaces left such a comment in place
 * and cost quadratic time to decide that.
 */
export function withoutBlockComments(code: string): string {
    let out = '';
    let at = 0;
    for (;;) {
        const start = code.indexOf('/*', at);
        if (start === -1) return out + code.slice(at);
        out += code.slice(at, start) + ' ';
        const end = code.indexOf('*/', start + 2);
        if (end === -1) return out;
        at = end + 2;
    }
}
