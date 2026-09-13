/**
 * @file cortex-ui-motion-stagger-collision.test.ts
 * @description Two aimeat-ui-motion primitives on one element leave it visible. `.aum-stagger-item`
 *   carried a STATIC `opacity: 0; transform: translateY(8px)` and relied on its `aum-enter` animation
 *   to lift it; highlightRow() and pulse() set the `animation` shorthand too, so the later class
 *   replaced aum-enter and the static opacity:0 stayed for good. The class was never removed either.
 *   Found in an app as a card with real height and computed opacity 0 (appdev pitfall
 *   motion-primitives-collide-invisible-content, 2026-07-25).
 *
 *   A unit test has no cascade, so this holds the two properties that make the collision harmless:
 *   no static motion rule hides anything (the hidden start state lives in the keyframes, where
 *   losing the animation also loses the hiding), and the one-off classes are taken off when their own
 *   animation ends. The cascade itself was measured in Chromium when the fix was made: after
 *   staggerIn + highlightRow on one element, opacity was 0 before and 1 after.
 * @version-history
 *   v1.0.0 — 2026-09-13 — Initial.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { fileURLToPath } from 'node:url';

const SRC = readFileSync(fileURLToPath(new URL('../../public/cortex-bundled/aimeat-ui-motion.js', import.meta.url)), 'utf8');

type El = Record<string, any>;

function makeEl(tag = 'div'): El {
    const classes = new Set<string>();
    const listeners: Record<string, Array<(e: any) => void>> = {};
    const e: El = {
        tagName: tag.toUpperCase(), style: {}, children: [] as El[], textContent: '', offsetWidth: 10,
        classList: {
            add: (c: string) => classes.add(c), remove: (c: string) => classes.delete(c), contains: (c: string) => classes.has(c),
        },
        get className() { return [...classes].join(' '); },
        setAttribute() {}, removeAttribute() {},
        appendChild(c: El) { this.children.push(c); return c; },
        addEventListener(type: string, fn: (ev: any) => void) { (listeners[type] = listeners[type] || []).push(fn); },
        removeEventListener(type: string, fn: (ev: any) => void) { listeners[type] = (listeners[type] || []).filter(f => f !== fn); },
        fire(type: string, props: Record<string, unknown>) {
            const ev = { type, target: e, currentTarget: e, ...props };
            (listeners[type] || []).slice().forEach(f => f(ev));
        },
    };
    return e;
}

let css = '';
let motion: any;

beforeEach(() => {
    css = '';
    const head = makeEl('head');
    head.appendChild = (c: El) => { css += c.textContent; return c; };
    const document = {
        head, body: makeEl('body'),
        createElement: (t: string) => makeEl(t),
        querySelector: () => null,
    };
    const sandbox: Record<string, any> = { document, setTimeout, clearTimeout, console };
    sandbox.matchMedia = () => ({ matches: false });
    runInNewContext(SRC, sandbox);
    motion = sandbox.AIMEAT.ui.motion;
});

/** Every rule outside @keyframes, as [selector, declarations]. The reduced-motion block counts too. */
function staticRules(text: string): Array<[string, string]> {
    const withoutKeyframes = text.replace(/@keyframes[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '');
    const out: Array<[string, string]> = [];
    const re = /([^{}]+)\{([^{}]*)\}/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(withoutKeyframes))) out.push([m[1].replace(/@media[^{]*\{/, '').trim(), m[2]]);
    return out;
}

describe('aimeat-ui-motion stagger entrance', () => {
    it('hides nothing with a static rule, so losing the animation cannot leave content invisible', () => {
        const list = makeEl('ul');
        list.children = [makeEl('li')];
        motion.staggerIn(list);
        expect(css.length, 'no CSS was injected').toBeGreaterThan(0);
        const hiding = staticRules(css).filter(([, decl]) => /opacity\s*:\s*0(?![.\d])/.test(decl));
        expect(hiding.map(([sel]) => sel), 'these rules set opacity:0 outside a keyframe').toEqual([]);
    });

    it('still starts the entrance from hidden, inside the keyframes', () => {
        motion.staggerIn(Object.assign(makeEl('ul'), { children: [makeEl('li')] }));
        expect(css).toMatch(/@keyframes aum-enter\s*\{\s*from\s*\{[^}]*opacity:\s*0/);
    });

    it('takes the entrance class and delay off when the entrance has ended', () => {
        const item = makeEl('li');
        motion.staggerIn(Object.assign(makeEl('ul'), { children: [makeEl('li'), item] }));
        expect(item.classList.contains('aum-stagger-item')).toBe(true);
        expect(item.style.animationDelay).toBe('35ms');
        item.fire('animationend', { animationName: 'aum-enter' });
        expect(item.classList.contains('aum-stagger-item')).toBe(false);
        expect(item.style.animationDelay).toBe('');
    });

    it('leaves the entrance class alone when some other animation ends', () => {
        const item = makeEl('li');
        motion.staggerIn(Object.assign(makeEl('ul'), { children: [item] }));
        item.fire('animationend', { animationName: 'aum-pulse' });
        expect(item.classList.contains('aum-stagger-item')).toBe(true);
    });
});

describe('aimeat-ui-motion highlightRow', () => {
    it('takes its class off when the flash has ended, so it cannot sit on the element', () => {
        const row = makeEl('tr');
        motion.highlightRow(row);
        expect(row.classList.contains('aum-highlight')).toBe(true);
        row.fire('animationend', { animationName: 'aum-highlight' });
        expect(row.classList.contains('aum-highlight')).toBe(false);
    });

    it('a stagger then a highlight on one element ends with neither class left', () => {
        const item = makeEl('li');
        motion.staggerIn(Object.assign(makeEl('ul'), { children: [item] }));
        motion.highlightRow(item);
        item.fire('animationend', { animationName: 'aum-highlight' });
        expect(item.className).toBe('');
    });
});

describe('aimeat-ui-motion pulse', () => {
    it('supersedes an entrance still sitting on the element, and stop() leaves nothing behind', () => {
        const item = makeEl('li');
        motion.staggerIn(Object.assign(makeEl('ul'), { children: [item] }));
        const stop = motion.pulse(item);
        expect(item.classList.contains('aum-stagger-item')).toBe(false);
        expect(item.classList.contains('aum-pulse')).toBe(true);
        stop();
        expect(item.className).toBe('');
    });
});
