/**
 * @file test/unit/notifications-sender-push-switch.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Which rows of the Notifications page's "Who may notify you" carry a push switch
 *   (public/views/profile/notifications/frame.js senderRows). The node's own notifications are pushed
 *   or not per group (prefsFor in src/services/notification-settings.ts), so the "AIMEAT itself" row,
 *   which has no group, draws no switch; each group under By group and every other sender does, and
 *   pressing a group's switch saves that group's push.
 * @usage cd aimeat && pnpm exec vitest run test/unit/notifications-sender-push-switch.test.ts
 * @version-history
 *   v1.0.0 — 2026-11-08 — Initial: the AIMEAT itself row's switch showed on and saved nothing.
 */
import { describe, it, expect, vi } from 'vitest';
import { senderRows, Switch } from '../../public/views/profile/notifications/frame.js';
import { prefsFor, defaultSettings } from '../../src/services/notification-settings.js';

interface VNode { type: unknown; key?: unknown; props: Record<string, unknown> & { children?: unknown } }
const isVNode = (x: unknown): x is VNode => !!x && typeof x === 'object' && 'type' in x && 'props' in x;

/** Every vnode of `type` under `node`, without rendering the components (props.children only). */
function findAll(node: unknown, type: unknown, out: VNode[] = []): VNode[] {
  if (Array.isArray(node)) { for (const n of node) findAll(n, type, out); return out; }
  if (!isVNode(node)) return out;
  if (node.type === type) out.push(node);
  findAll(node.props.children, type, out);
  return out;
}

/** The Row vnodes of one senderRows list, by their key. */
function rowsByKey(list: unknown): Map<string, VNode> {
  const m = new Map<string, VNode>();
  const rows = isVNode(list) ? list.props.children : [];
  for (const r of (Array.isArray(rows) ? rows.flat() : [rows])) if (isVNode(r)) m.set(String(r.key), r);
  return m;
}

const ctx = (setPref = vi.fn()) => ({ busy: false, setPref });
const aimeatRow = { key: 'aimeat', kind: 'aimeat', name: 'AIMEAT itself', sub: '', what: 'push by group', prefs: {}, door: null };
const groupRow = { key: 'group:messages', kind: 'aimeat', group: 'messages', name: 'Messages', sub: '', what: '', prefs: {}, door: null };
const appRow = { key: 'app:alice/notes.html', kind: 'app', id: 'alice/notes.html', name: 'Notes', sub: '', what: '', prefs: {}, door: null };

describe('Who may notify you: the push switch', () => {
  it('the AIMEAT itself row has no push switch: the node has no push decision for itself, only per group', () => {
    const rows = rowsByKey(senderRows(ctx(), [aimeatRow]));
    expect(rows.has('aimeat')).toBe(true);
    expect(findAll(rows.get('aimeat'), Switch)).toHaveLength(0);
  });

  it('each group under By group and every other sender still has its switch', () => {
    const rows = rowsByKey(senderRows(ctx(), [groupRow, appRow]));
    expect(findAll(rows.get('group:messages'), Switch)).toHaveLength(1);
    expect(findAll(rows.get('app:alice/notes.html'), Switch)).toHaveLength(1);
  });

  it("a group's switch saves that group's push, and the server then reads it for the node's own notifications of that group", () => {
    const setPref = vi.fn();
    const [sw] = findAll(senderRows(ctx(setPref), [groupRow]), Switch);
    expect(sw.props.on).toBe(true);
    (sw.props.onToggle as () => void)();
    expect(setPref).toHaveBeenCalledWith(groupRow, { push: false });
    // What the page then saves for that group decides the push for a node notification of that
    // group and no other group: the per-group key the AIMEAT itself row could never have written.
    const s = { ...defaultSettings(), groups: { messages: { push: false } } };
    expect(prefsFor(s, { kind: 'aimeat', name: 'AIMEAT' }, 'direct_message').push).toBe(false);
    expect(prefsFor(s, { kind: 'aimeat', name: 'AIMEAT' }, 'workflow_finished').push).toBe(true);
  });
});
