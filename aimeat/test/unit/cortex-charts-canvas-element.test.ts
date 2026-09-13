/**
 * @file cortex-charts-canvas-element.test.ts
 * @description AIMEAT.charts.ChartBuilder draws into a <canvas> when elementId names one. The lib always
 *   emptied the element and appended its own wrapper and canvas, so a canvas id (what most Chart.js
 *   examples use) nested a canvas inside a canvas: the browser draws nothing there, no error was
 *   shown and nothing was logged (appdev pitfall chartbuilder-wants-container-not-canvas,
 *   2026-07-25). A container id keeps working exactly as before.
 *
 *   The DOM here is a stub with the members the pack touches, because what is under test is which
 *   canvas Chart.js is handed and where an error lands, not how anything paints.
 * @version-history
 *   v1.0.0 — 2026-09-13 — Initial.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { fileURLToPath } from 'node:url';

const SRC = readFileSync(fileURLToPath(new URL('../../public/cortex-bundled/aimeat-charts.js', import.meta.url)), 'utf8');

type El = Record<string, any>;

function makeEl(tag: string): El {
    const e: El = {
        tagName: tag.toUpperCase(), children: [] as El[], parentElement: null, parentNode: null,
        className: '', style: {}, attrs: {} as Record<string, string>, isConnected: true, textContent: '', _html: '',
        get innerHTML() { return this._html; },
        set innerHTML(v: string) { this._html = v; this.children = []; },
        appendChild(c: El) { if (c.parentElement) c.parentElement.removeChild(c); this.children.push(c); c.parentElement = this; c.parentNode = this; return c; },
        insertBefore(c: El, ref: El | null) {
            if (c.parentElement) c.parentElement.removeChild(c);
            const i = ref ? this.children.indexOf(ref) : -1;
            if (i < 0) this.children.push(c); else this.children.splice(i, 0, c);
            c.parentElement = this; c.parentNode = this; return c;
        },
        removeChild(c: El) { this.children = this.children.filter((x: El) => x !== c); c.parentElement = null; c.parentNode = null; return c; },
        get nextSibling() { const p = this.parentElement; return p ? p.children[p.children.indexOf(this) + 1] ?? null : null; },
        get nextElementSibling() { return this.nextSibling; },
        setAttribute(k: string, v: string) { this.attrs[k] = String(v); },
        getAttribute(k: string) { return k in this.attrs ? this.attrs[k] : null; },
        hasAttribute(k: string) { return k in this.attrs; },
        remove() { if (this.parentElement) this.parentElement.removeChild(this); },
    };
    return e;
}

let byId: Record<string, El>;
let constructed: Array<{ canvas: El; cfg: any }>;
let destroyed: number;
let AIMEAT: any;

beforeEach(() => {
    byId = {};
    constructed = [];
    destroyed = 0;
    const registry = new Map<El, any>();
    class Chart {
        canvas: El; options: any; data: any;
        constructor(canvas: El, cfg: any) {
            // Chart.js refuses a canvas that already carries a chart, and says so by throwing.
            if (registry.has(canvas)) throw new Error('Canvas is already in use.');
            this.canvas = canvas; this.options = cfg.options; this.data = cfg.data;
            registry.set(canvas, this);
            constructed.push({ canvas, cfg });
        }
        static getChart(c: El) { return registry.get(c); }
        destroy() { registry.delete(this.canvas); destroyed++; }
        update() {}
        resize() {}
    }
    const head = makeEl('head');
    const document = {
        head, documentElement: makeEl('html'),
        getElementById: (id: string) => byId[id] ?? null,
        createElement: (t: string) => makeEl(t),
        createTextNode: (t: string) => ({ nodeType: 3, textContent: t }),
    };
    const window: any = { Chart, getComputedStyle: () => ({ getPropertyValue: () => '' }), AIMEAT: {} };
    runInNewContext(SRC, { window, document, console: { error() {}, warn() {}, log() {} } });
    AIMEAT = window.AIMEAT;
});

const data = { labels: ['a', 'b'], datasets: [{ label: 'n', data: [1, 2] }] };

function mount(tag: string, id: string) {
    const card = makeEl('div');
    const target = makeEl(tag);
    target.setAttribute('id', id);
    card.appendChild(target);
    byId[id] = target;
    return { card, target };
}

describe('ChartBuilder with a canvas id', () => {
    it('hands Chart.js that canvas, not a new one nested inside it', () => {
        const { card, target } = mount('canvas', 'c');
        const chart = AIMEAT.charts.ChartBuilder({ elementId: 'c', type: 'bar', data });
        expect(chart, 'ChartBuilder returned null').toBeTruthy();
        expect(constructed).toHaveLength(1);
        expect(constructed[0].canvas).toBe(target);
        expect(target.children, 'something was appended inside the canvas').toHaveLength(0);
        expect(card.children).toEqual([target]);
    });

    it('draws again into the same canvas by replacing the chart it holds', () => {
        mount('canvas', 'c');
        AIMEAT.charts.ChartBuilder({ elementId: 'c', type: 'bar', data });
        const second = AIMEAT.charts.ChartBuilder({ elementId: 'c', type: 'line', data });
        expect(second, 'the second render failed').toBeTruthy();
        expect(destroyed).toBe(1);
        expect(constructed).toHaveLength(2);
    });

    it('shows an error beside the canvas, where it can be seen', () => {
        const { card, target } = mount('canvas', 'c');
        AIMEAT.charts.ChartBuilder({ elementId: 'c', type: 'nonsense', data });
        const note = card.children.find((x: El) => x !== target);
        expect(note, 'no error element next to the canvas').toBeTruthy();
        expect(note.className).toBe('aimeat-chart-error');
        expect(card.children.indexOf(note)).toBe(card.children.indexOf(target) + 1);
    });

    it('clears that error once a chart draws', () => {
        const { card, target } = mount('canvas', 'c');
        AIMEAT.charts.ChartBuilder({ elementId: 'c', type: 'nonsense', data });
        AIMEAT.charts.ChartBuilder({ elementId: 'c', type: 'bar', data });
        expect(card.children).toEqual([target]);
    });
});

describe('ChartBuilder with a container id (unchanged)', () => {
    it('builds its own wrapper and canvas inside the container', () => {
        const { target } = mount('div', 'box');
        AIMEAT.charts.ChartBuilder({ elementId: 'box', type: 'bar', data });
        expect(constructed).toHaveLength(1);
        expect(target.children).toHaveLength(1);
        expect(target.children[0].className).toBe('aimeat-chart-container');
        expect(constructed[0].canvas.parentElement).toBe(target.children[0]);
    });
});
