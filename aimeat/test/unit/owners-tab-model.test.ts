/**
 * @file owners-tab-model.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The arithmetic behind the admin Owners page, held to the numbers the page prints:
 *   the figures under the first section, the counts behind the five filter chips, the search, the
 *   reading order, and which doors a row may draw. The door rules matter most — the node refuses a
 *   self-revoke, the last operator and a self-deactivation, and this is what keeps the page from
 *   drawing a word it would be refused for. The node's own refusals are proved in
 *   test/e2e-admin-doors-2.ts; this is the page's fold over the list it already fetches.
 * @usage cd aimeat && pnpm exec vitest run test/unit/owners-tab-model.test.ts
 * @version-history
 *   v1.0.0 — 2026-09-12 — Initial (the Owners page in the poster face).
 */
import { describe, it, expect } from 'vitest';
import { decorate, summarise, counts, search, FILTERS, PAGE } from '../../public/views/admin/owners-tab.model.js';

const NOW = Date.parse('2026-09-12T08:00:00.000Z');
const DAYS = (n: number) => new Date(NOW - n * 24 * 60 * 60 * 1000).toISOString();

const OWNERS = [
  { name: 'jouni', display_name: 'jouni', roles: ['owner', 'operator'], agents: [{ gaii: 'a' }, { gaii: 'b' }], created_at: DAYS(180) },
  { name: 'happydude500001', display_name: 'happydude500001', roles: ['owner', 'operator'], agents: [{ gaii: 'c' }], created_at: DAYS(179) },
  { name: 'anonymous', display_name: 'Anonymous Node', roles: ['owner'], agents: [{ gaii: 'd' }], created_at: DAYS(182) },
  { name: 'kanderss', display_name: 'kanderss', roles: ['owner'], agents: [], created_at: DAYS(40) },
  { name: 't25', display_name: 't25', roles: ['owner'], agents: [], created_at: DAYS(30), disabled_at: DAYS(3) },
  { name: 'happy2', display_name: 'happy2', roles: ['owner'], agents: [], created_at: DAYS(2), managed_by: 'conn-entra-1' },
];

describe('the rows', () => {
  it('reads oldest registration first, whatever order the node served', () => {
    expect(decorate(OWNERS, 'jouni').map((r) => r.name))
      .toEqual(['anonymous', 'jouni', 'happydude500001', 'kanderss', 't25', 'happy2']);
  });

  it('keeps a display name only when it differs from the name', () => {
    const rows = decorate(OWNERS, 'jouni');
    expect(rows.find((r) => r.name === 'anonymous')!.display).toBe('Anonymous Node');
    expect(rows.find((r) => r.name === 'kanderss')!.display).toBeNull();
  });

  it('survives a list the node served without the optional fields', () => {
    const rows = decorate([{ name: 'bare' }], 'jouni');
    expect(rows[0]).toMatchObject({ name: 'bare', display: null, roles: [], operator: false, agents: 0, disabledAt: null, managedBy: null });
  });

  it('is empty for nothing at all', () => {
    expect(decorate(undefined, 'jouni')).toEqual([]);
    expect(decorate([], null)).toEqual([]);
  });
});

describe('the doors a row may draw', () => {
  const rows = decorate(OWNERS, 'jouni');
  const row = (name: string) => rows.find((r) => r.name === name)!;

  it('draws nothing on your own row: the node refuses both acts there', () => {
    expect(row('jouni')).toMatchObject({ you: true, canRevoke: false, canGrant: false, canDisable: false, canEnable: false });
  });

  it('offers revoke on another operator, because one operator is left after it', () => {
    expect(row('happydude500001')).toMatchObject({ operator: true, canRevoke: true, canGrant: false, canDisable: true });
  });

  it('offers no revoke when a single operator holds the node, even to a session that does not know its own name', () => {
    const alone = decorate([OWNERS[0], OWNERS[2]], null);
    expect(alone.find((r) => r.name === 'jouni')!.canRevoke).toBe(false);
  });

  it('offers grant on an ordinary owner and never on a deactivated one', () => {
    expect(row('kanderss')).toMatchObject({ canGrant: true, canDisable: true, canEnable: false });
    expect(row('t25')).toMatchObject({ canGrant: false, canDisable: false, canEnable: true });
  });

  it('keeps both doors on a directory-managed account, which the operator may still offboard', () => {
    expect(row('happy2')).toMatchObject({ managedBy: 'conn-entra-1', canGrant: true, canDisable: true });
  });
});

describe('the figures', () => {
  const s = summarise(decorate(OWNERS, 'jouni'), NOW);

  it('counts what the strip prints', () => {
    expect(s.total).toBe(6);
    expect(s.operators).toBe(2);
    expect(s.withAgents).toBe(3);
    expect(s.quiet).toBe(3);
    expect(s.off).toBe(1);
  });

  it('counts a week from the newest registration backwards, and nothing older', () => {
    expect(s.joinedWeek).toBe(1);
  });

  it('names the operators in reading order', () => {
    expect(s.operatorRows.map((r) => r.name)).toEqual(['jouni', 'happydude500001']);
  });

  it('ignores an unparsable registration date rather than counting it as today', () => {
    expect(summarise(decorate([{ name: 'x', created_at: 'not a date' }], null), NOW).joinedWeek).toBe(0);
  });
});

describe('the filters and the search', () => {
  const rows = decorate(OWNERS, 'jouni');

  it('counts every chip, and the chips cover the list twice over', () => {
    const c = counts(rows);
    expect(c).toEqual({ all: 6, operators: 2, agents: 3, quiet: 3, off: 1 });
    expect(c.agents + c.quiet).toBe(c.all);
    expect(FILTERS).toEqual(['all', 'operators', 'agents', 'quiet', 'off']);
  });

  it('leaves the rows each chip names', () => {
    expect(search(rows, 'operators', '').map((r) => r.name)).toEqual(['jouni', 'happydude500001']);
    expect(search(rows, 'quiet', '').map((r) => r.name)).toEqual(['kanderss', 't25', 'happy2']);
    expect(search(rows, 'off', '').map((r) => r.name)).toEqual(['t25']);
    expect(search(rows, 'all', '').length).toBe(6);
  });

  it('matches the name and the display name, ignoring case and surrounding space', () => {
    expect(search(rows, 'all', '  HAPPY ').map((r) => r.name)).toEqual(['happydude500001', 'happy2']);
    expect(search(rows, 'all', 'anonymous node').map((r) => r.name)).toEqual(['anonymous']);
    expect(search(rows, 'all', 'nobody')).toEqual([]);
  });

  it('applies the chip before the term', () => {
    expect(search(rows, 'operators', 'happy').map((r) => r.name)).toEqual(['happydude500001']);
  });

  it('shows a first page an operator can read without scrolling past it', () => {
    expect(PAGE).toBe(20);
  });
});
