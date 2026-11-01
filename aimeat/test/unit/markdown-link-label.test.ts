/**
 * @file test/unit/markdown-link-label.test.ts
 * @description A link whose label is itself an address renders as ONE link. The label was parsed again
 *   and its bare host autolinked, so the help page's [modelcontextprotocol.io](https://…) became an
 *   <a> nested inside an <a>.
 * @usage pnpm test -- markdown-link-label
 * @version-history
 *   v1.0.0 — 2026-11-01 — Initial, with the help page's MCP link as the case.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// The component imports preact from a browser path, so the inline parser and the helpers above it are
// read out of the source and evaluated with a stand-in for h() that returns plain objects.
const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(resolve(here, '../../public/components/Markdown.js'), 'utf-8');
const start = src.indexOf('const SAFE_SCHEME');
const end = src.indexOf('function parseTableRow');
type VNode = { tag: string; props: Record<string, unknown> | null; children: unknown[] };
const h = (tag: string, props: Record<string, unknown> | null, ...children: unknown[]): VNode => ({ tag, props, children });
const body = src.slice(start, end).replace(/^export /gm, '');
const parseInline = new Function('h', `${body}; return parseInline;`)(h) as
    (text: string, onWikiLink?: unknown) => unknown[];

function anchors(nodes: unknown[]): VNode[] {
    const found: VNode[] = [];
    const walk = (n: unknown) => {
        if (Array.isArray(n)) { n.forEach(walk); return; }
        if (n && typeof n === 'object' && 'tag' in n) {
            const v = n as VNode;
            if (v.tag === 'a') found.push(v);
            v.children.forEach(walk);
        }
    };
    walk(nodes);
    return found;
}

describe('a link whose label is an address', () => {
    it('renders one anchor, not one nested in another', () => {
        const out = anchors(parseInline('Lue lisää: [modelcontextprotocol.io](https://modelcontextprotocol.io) (englanniksi).'));
        expect(out).toHaveLength(1);
        expect(out[0].props?.href).toBe('https://modelcontextprotocol.io');
    });

    it('keeps a full URL in the label as text too', () => {
        expect(anchors(parseInline('[https://aimeat.io](https://aimeat.io)'))).toHaveLength(1);
    });

    it('keeps bold inside a label free of a second anchor', () => {
        expect(anchors(parseInline('[**aimeat.io**](https://aimeat.io)'))).toHaveLength(1);
    });
});

describe('outside a label the autolink still works', () => {
    it('a bare host and a bare URL each become one link', () => {
        expect(anchors(parseInline('Open aimeat.io or https://example.com now'))).toHaveLength(2);
    });
});
