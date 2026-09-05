/**
 * @file test/unit/living-machine.test.ts
 * @description The statechart under a living document, on its own: transitions, guards that
 *   refuse one, entry and exit actions as assignments, `after` timers driven by hand rather than
 *   by a real clock, nested states, and the crossings that turn a formula going over a threshold
 *   into an event — ONCE, on the rising edge, not on every recompute while it holds.
 *
 *   The interpreter decides and does not write: send() and tick() hand back the assignments they
 *   want made, which is what lets this file test the whole of it with no graph, no DOM and no
 *   waiting.
 * @usage cd aimeat && pnpm vitest run test/unit/living-machine.test.ts
 * @version-history
 *   v1.1.0 — 2026-09-05 — start(): the initial state is ENTERED, nested initials included, and no
 *     exit is produced for a state nothing ever left (living 0.3.0).
 *   v1.0.0 — 2026-09-05 — Initial (the living document, stage 1).
 */
import { describe, it, expect } from 'vitest';
import { createMachine } from '../../src/static/sdk-libs/living/machine.js';
import { evaluate } from '../../src/static/sdk-libs/living/formula-eval.js';

function scopeOf(map: Record<string, unknown>) {
  return { get: (id: string) => (Object.prototype.hasOwnProperty.call(map, id) ? map[id] : undefined) };
}
/** What the engine does with the assignments a transition hands back. */
function applied(out: { assigns: Array<{ id: string; tree: unknown }> }, scope: ReturnType<typeof scopeOf>) {
  const written: Record<string, unknown> = {};
  for (const a of out.assigns) written[a.id] = evaluate(a.tree, scope);
  return written;
}

const THREE = {
  initial: 'fine',
  states: {
    cold: { on: { WARM: 'fine' }, entry: { advice: '"lämmitä"' } },
    fine: { on: { HOT: 'hot', COLD: 'cold' }, entry: { advice: '""' } },
    hot: {
      entry: { advice: '"tuuleta"' },
      exit: { seen: 'seen + 1' },
      on: { COOL: { target: 'fine', guard: 't < 30' } },
    },
  },
  when: [{ expr: 't > 30', send: 'HOT' }, { expr: 't < 30', send: 'COOL' }, { expr: 't < 5', send: 'COLD' }],
};

describe('createMachine: where it starts', () => {
  it('starts in its declared initial state', () => {
    expect(createMachine(THREE).path()).toBe('fine');
  });

  it('refuses a machine with no states, and one whose initial is not one of them', () => {
    expect(createMachine({ states: {} } as never).errors.join(' ')).toMatch(/no states/);
    expect(createMachine({ initial: 'nowhere', states: { a: {} } } as never).errors.join(' ')).toMatch(/initial state/);
  });

  it('names the expression it could not read, rather than throwing on the first send', () => {
    const m = createMachine({ initial: 'a', states: { a: { on: { GO: { target: 'b', guard: '2 * * 3' } } }, b: {} } } as never);
    expect(m.errors.length).toBe(1);
    expect(m.errors[0]).toMatch(/guard/);
  });
});

/**
 * THE STATE IT STARTS IN IS ENTERED. Without this the entry action of the initial state never
 * ran, so a value the machine writes sat blank until the first crossing and a document opened
 * saying nothing — correct only once somebody had touched a control.
 */
describe('createMachine: it enters the state it starts in', () => {
  it('hands back the initial state entry, once', () => {
    const m = createMachine(THREE);
    const scope = scopeOf({ t: 20, seen: 0 });
    const out = m.start();
    expect(out.path).toBe('fine');
    expect(applied(out, scope)).toEqual({ advice: '' });
    // A second call has nothing left to hand out.
    expect(m.start().assigns).toEqual([]);
  });

  it('an initial state with something to say says it on the first paint', () => {
    const m = createMachine({
      initial: 'cold',
      states: { cold: { entry: { advice: '"lämmitä"' }, on: { WARM: 'fine' } }, fine: {} },
    } as never);
    expect(applied(m.start(), scopeOf({}))).toEqual({ advice: 'lämmitä' });
  });

  it('runs the nested initial states too, outermost first', () => {
    const m = createMachine({
      initial: 'running',
      states: {
        running: {
          entry: { mode: '"running"' },
          initial: 'slow',
          states: { slow: { entry: { pace: '"slow"' } }, fast: {} },
        },
      },
    } as never);
    const out = m.start();
    expect(out.path).toBe('running.slow');
    expect(out.assigns.map((a) => a.id)).toEqual(['mode', 'pace']);
  });

  it('no exit action is produced for a state that was never entered', () => {
    const m = createMachine({
      initial: 'fine',
      states: { fine: { entry: { advice: '""' } }, hot: { exit: { seen: 'seen + 1' } } },
    } as never);
    expect(m.start().assigns.map((a) => a.id)).toEqual(['advice']);
  });

  it('a machine that could not be read hands back nothing rather than throwing', () => {
    expect(createMachine({ states: {} } as never).start().assigns).toEqual([]);
  });

  it('a reset puts it back on the line', () => {
    const m = createMachine(THREE);
    m.start();
    m.reset();
    expect(applied(m.start(), scopeOf({}))).toEqual({ advice: '' });
  });
});

describe('createMachine: transitions and guards', () => {
  it('an event moves it, and an event it has no handler for does not', () => {
    const m = createMachine(THREE);
    const scope = scopeOf({ t: 20, seen: 0 });
    expect(m.send('HOT', scope).changed).toBe(true);
    expect(m.path()).toBe('hot');
    expect(m.send('WARM', scope).changed).toBe(false);
    expect(m.path()).toBe('hot');
  });

  it('a guard refuses the transition, and lets it through once it is true', () => {
    const m = createMachine(THREE);
    m.send('HOT', scopeOf({ t: 33 }));
    expect(m.send('COOL', scopeOf({ t: 33 })).changed).toBe(false);
    expect(m.path()).toBe('hot');
    expect(m.send('COOL', scopeOf({ t: 12 })).changed).toBe(true);
    expect(m.path()).toBe('fine');
  });

  it('entry and exit hand back assignments, in exit-then-entry order', () => {
    const m = createMachine(THREE);
    const scope = scopeOf({ t: 33, seen: 0 });
    expect(applied(m.send('HOT', scope), scope)).toEqual({ advice: 'tuuleta' });
    const out = m.send('COOL', scopeOf({ t: 12, seen: 0 }));
    expect(out.assigns.map((a) => a.id)).toEqual(['seen', 'advice']);
    expect(applied(out, scopeOf({ t: 12, seen: 4 }))).toEqual({ seen: 5, advice: '' });
  });
});

describe('createMachine: crossings', () => {
  it('fires on the rising edge and not again while the condition holds', () => {
    const m = createMachine(THREE);
    expect(m.crossings(scopeOf({ t: 20 }))).toEqual(['COOL']);
    expect(m.crossings(scopeOf({ t: 21 }))).toEqual([]);
    expect(m.crossings(scopeOf({ t: 31 }))).toEqual(['HOT']);
    expect(m.crossings(scopeOf({ t: 32 }))).toEqual([]);
    expect(m.crossings(scopeOf({ t: 3 }))).toEqual(['COOL', 'COLD']);
  });

  it('a reset forgets where the crossings were', () => {
    const m = createMachine(THREE);
    m.crossings(scopeOf({ t: 31 }));
    m.reset();
    expect(m.path()).toBe('fine');
    expect(m.crossings(scopeOf({ t: 31 }))).toEqual(['HOT']);
  });
});

describe('createMachine: timers', () => {
  const TIMED = {
    initial: 'idle',
    states: { idle: { on: { GO: 'busy' } }, busy: { after: { 3000: 'idle' }, entry: { runs: 'runs + 1' } } },
  };

  it('says how long is left, and fires when the time is up', () => {
    const m = createMachine(TIMED);
    const scope = scopeOf({ runs: 0 });
    m.send('GO', scope, 1000);
    expect(m.path()).toBe('busy');
    expect(m.nextDue(1000)).toBe(3000);
    expect(m.nextDue(2500)).toBe(1500);
    expect(m.tick(2500).changed).toBe(false);
    expect(m.tick(4000).changed).toBe(true);
    expect(m.path()).toBe('idle');
    expect(m.nextDue(4000)).toBe(null);
  });
});

describe('createMachine: nested states', () => {
  const NESTED = {
    initial: 'running',
    states: {
      stopped: { on: { START: 'running' } },
      running: {
        initial: 'slow',
        states: { slow: { on: { FASTER: 'fast' } }, fast: { on: { SLOWER: 'slow' } } },
        on: { STOP: 'stopped' },
      },
    },
  };

  it('settles into the child initial and reports the whole path', () => {
    const m = createMachine(NESTED);
    expect(m.path()).toBe('running.slow');
    expect(m.states()).toEqual(['running', 'running.slow']);
  });

  it('a child transition moves the child and leaves the parent where it is', () => {
    const m = createMachine(NESTED);
    m.send('FASTER', scopeOf({}));
    expect(m.path()).toBe('running.fast');
  });

  it('an event the child cannot handle is offered to the parent', () => {
    const m = createMachine(NESTED);
    m.send('FASTER', scopeOf({}));
    expect(m.send('STOP', scopeOf({})).changed).toBe(true);
    expect(m.path()).toBe('stopped');
    m.send('START', scopeOf({}));
    expect(m.path()).toBe('running.slow');
  });
});
