/**
 * @file public/views/home/overview-model.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What the overview shows, decided from GET /v1/overview and what the person has opened:
 *   which cards each lane holds, where each sits, and which card a line ends at. No markup and no
 *   words: components/OverviewMap.js draws the result and the page's phone list reads the same
 *   lanes, so the two cannot disagree about what is open.
 *
 *   FIVE BUSIEST, THE REST BEHIND "+N". An account on aimeat.io has 87 agents and 227 apps. Each lane
 *   shows its five busiest; the rest sit in one "+N more" card that opens in place, ten at a time.
 *   Agents sit in a group per computer or chat client, the group shows six and its own "+N".
 *
 *   A LINE ENDS AT WHAT CAN BE SEEN. An agent inside a closed group draws its lines from the group's
 *   card; an app behind "+N" from that card. Lines that land on the same two cards are added together,
 *   so the thickness is the sum of what happened between them.
 *
 *   THE SIZES ARE THE ACCEPTED CANVAS'S (Kokonaiskuva, board 1): lanes 38 px apart, a card 88 px, a
 *   group's head 56 px and its rows 38 px. The lanes share the page's width (232 px each on the
 *   canvas's 1312 px), never narrower than 200 px.
 * @structure buildLanes(view, state) · layoutMap(lanes, view, state, width) · laneSizes · LANE_KEYS · groupIdOf
 * @usage const lanes = buildLanes(view, state); const map = layoutMap(lanes, state);
 * @version-history
 *   v1.0.0 — 2026-10-31 — Initial (wish-kokonaiskuva-koneet-agentit-sovellukset-tieto-ja-tarjoukset-).
 */

export const LANE_KEYS = ['machines', 'agents', 'apps', 'knowledge', 'offerings'];

const TOP = 5;
const GROUP_TOP = 6;
const STEP = 10;

export const SIZES = { laneX: 270, laneW: 232, laneGap: 38, minLaneW: 200, card: 88, gap: 14, head: 56, row: 38, pad: 10, indent: 10, minH: 560 };

/**
 * The lane width for a map `width` px wide: five lanes and four gaps fill it, never narrower than
 * minLaneW (the page scrolls sideways below that). Without a width, the canvas's 232 px.
 */
export function laneSizes(width) {
  if (!width) return { laneW: SIZES.laneW, laneX: SIZES.laneX };
  const laneW = Math.max(SIZES.minLaneW, Math.floor((width - 4 * SIZES.laneGap) / 5));
  return { laneW, laneX: laneW + SIZES.laneGap };
}

const byUse = (a, b) => (b.use - a.use) || String(b.last_at || '').localeCompare(String(a.last_at || '')) || a.name.localeCompare(b.name);

/** The agent-lane group of a machine-lane item. */
export const groupIdOf = (machineId) => `group:${machineId}`;

/**
 * The lanes as cards, before positions. Each entry is a card or an open group:
 * `{ id, item?, kind: 'item'|'group'|'more', children?: entry[], count?, hidden?: item[] }`.
 * `state.open` is a Set of open ids; `state.shown` maps a "+N" id to how many of its items show.
 */
export function buildLanes(view, state) {
  const quiet = (i) => !state.showQuiet && i.quiet_days !== null && i.quiet_days !== undefined;
  const items = (view?.items || []).filter((i) => !quiet(i));
  const lane = (key) => items.filter((i) => i.lane === key);
  const out = {};

  // A lane of single cards: the busiest TOP, then "+N", which shows STEP more each time it opens.
  const flat = (key, list, moreId) => {
    const sorted = [...list].sort(byUse);
    /** @type {any[]} */
    const head = sorted.slice(0, TOP).map((item) => ({ id: item.id, kind: 'item', item }));
    const rest = sorted.slice(TOP);
    if (rest.length) {
      const shown = state.open.has(moreId) ? Math.min(rest.length, state.shown[moreId] || STEP) : 0;
      head.push({ id: moreId, kind: 'more', count: rest.length, children: rest.slice(0, shown).map((item) => ({ id: item.id, kind: 'item', item })), hidden: rest.slice(shown), use: rest.reduce((s, i) => s + i.use, 0) });
    }
    return head;
  };

  out.machines = flat('machines', lane('machines'), 'more:machines');

  // Agents: one group per computer or chat client, in the order the computers lane shows them.
  const agents = lane('agents');
  const machineOrder = [...lane('machines')].sort(byUse);
  out.agents = machineOrder.map((m) => {
    const members = agents.filter((a) => a.parent === m.id).sort(byUse);
    const gid = groupIdOf(m.id);
    const top = members.slice(0, GROUP_TOP);
    const rest = members.slice(GROUP_TOP);
    const moreId = `more:${gid}`;
    const shown = state.open.has(moreId) ? Math.min(rest.length, state.shown[moreId] || STEP) : 0;
    const children = top.map((item) => ({ id: item.id, kind: 'item', item }));
    if (rest.length) {
      children.push({ id: moreId, kind: 'more', count: rest.length - shown, hidden: rest.slice(shown), use: rest.slice(shown).reduce((s, i) => s + i.use, 0) });
      for (const item of rest.slice(0, shown)) children.splice(children.length - 1, 0, { id: item.id, kind: 'item', item });
    }
    return { id: gid, kind: 'group', machine: m, count: members.length, use: members.reduce((s, i) => s + i.use, 0), quiet: m.quiet_days != null, children, members };
  }).filter((g) => g.count > 0);

  out.apps = flat('apps', lane('apps'), 'more:apps');

  // Knowledge: organisms, each opening to its workspaces.
  const workspaces = lane('knowledge').filter((i) => i.kind === 'workspace');
  const organisms = lane('knowledge').filter((i) => i.kind === 'organism');
  out.knowledge = flat('knowledge', organisms, 'more:knowledge').map((e) => {
    if (e.kind !== 'item') return e;
    const children = workspaces.filter((w) => w.parent === e.id).sort(byUse).map((item) => ({ id: item.id, kind: 'item', item }));
    return children.length ? { ...e, children } : e;
  });

  out.offerings = flat('offerings', lane('offerings'), 'more:offerings');
  return out;
}

/**
 * Positions, and the lines between visible cards. Returns
 * `{ nodes, boxes, edges, hostH, rep }`; `rep` maps any item id to the card its lines end at.
 */
export function layoutMap(lanes, view, state, width) {
  const S = { ...SIZES, ...laneSizes(width) };
  const nodes = [];
  const boxes = [];
  const pos = new Map();
  const rep = new Map();
  let maxY = 0;

  LANE_KEYS.forEach((key, li) => {
    const x = li * S.laneX;
    let y = 0;
    for (const e of lanes[key] || []) {
      const openable = (e.kind === 'group') || (e.kind === 'more') || (e.kind === 'item' && e.children?.length);
      const isOpen = openable && state.open.has(e.id);
      if (isOpen) {
        const rows = e.kind === 'more' ? e.children : e.children;
        const moreLeft = e.kind === 'more' && e.hidden.length > 0;
        const n = rows.length + (moreLeft ? 1 : 0);
        const h = S.head + n * S.row + S.pad;
        boxes.push({ id: e.id, x, y, w: S.laneW, h });
        nodes.push({ id: e.id, entry: e, role: 'head', lane: key, x, y, w: S.laneW, h: S.head });
        pos.set(e.id, { x, y, w: S.laneW, h: S.head });
        rows.forEach((c, i) => {
          const cy = y + S.head + i * S.row;
          const p = { x: x + S.indent, y: cy, w: S.laneW - 2 * S.indent, h: S.row - 6 };
          nodes.push({ id: c.id, entry: c, role: 'row', lane: key, parent: e.id, ...p });
          pos.set(c.id, p);
          if (c.item) rep.set(c.item.id, c.id);
          for (const h2 of c.hidden || []) rep.set(h2.id, c.id);
        });
        if (moreLeft) {
          const cy = y + S.head + rows.length * S.row;
          const p = { x: x + S.indent, y: cy, w: S.laneW - 2 * S.indent, h: S.row - 6 };
          const moreRow = { id: `${e.id}:next`, kind: 'next', count: e.hidden.length, of: e.id };
          nodes.push({ id: moreRow.id, entry: moreRow, role: 'row', lane: key, parent: e.id, ...p });
          pos.set(moreRow.id, p);
          for (const h2 of e.hidden) rep.set(h2.id, moreRow.id);
        }
        if (e.item) rep.set(e.item.id, e.id);
        y += h + S.gap;
      } else {
        const p = { x, y, w: S.laneW, h: S.card };
        nodes.push({ id: e.id, entry: e, role: 'card', lane: key, ...p });
        pos.set(e.id, p);
        if (e.item) rep.set(e.item.id, e.id);
        for (const c of e.children || []) if (c.item) rep.set(c.item.id, e.id);
        for (const m of e.members || []) rep.set(m.id, e.id);
        for (const h2 of e.hidden || []) rep.set(h2.id, e.id);
        y += S.card + S.gap;
      }
    }
    maxY = Math.max(maxY, y);
  });

  // An agent's group is where its machine's "runs" lines end; the machine card itself is the start.
  const merged = new Map();
  for (const ed of view?.edges || []) {
    let a = rep.get(ed.from);
    const b = rep.get(ed.to);
    if (ed.kind === 'runs') {
      a = rep.get(ed.from);
      const g = rep.get(ed.to);
      if (!a || !g || a === g) continue;
      const k = `${a}>${g}`;
      const cur = merged.get(k) || { from: a, to: g, weight: 0, kinds: new Set() };
      cur.weight += ed.weight; cur.kinds.add(ed.kind);
      merged.set(k, cur);
      continue;
    }
    if (!a || !b || a === b) continue;
    const k = `${a}>${b}`;
    const cur = merged.get(k) || { from: a, to: b, weight: 0, kinds: new Set() };
    cur.weight += ed.weight; cur.kinds.add(ed.kind);
    merged.set(k, cur);
  }
  const edges = [...merged.values()].map((e) => {
    const p = pos.get(e.from); const q = pos.get(e.to);
    if (!p || !q) return null;
    const leftToRight = p.x <= q.x;
    const x1 = leftToRight ? p.x + p.w : p.x; const y1 = p.y + p.h / 2;
    const x2 = leftToRight ? q.x : q.x + q.w; const y2 = q.y + q.h / 2;
    const dx = Math.max(40, Math.abs(x2 - x1) / 2) * (leftToRight ? 1 : -1);
    return { ...e, d: `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}` };
  }).filter(Boolean);

  return { nodes, boxes, edges, hostH: Math.max(S.minH, maxY + 24), rep, laneW: S.laneW, laneX: S.laneX, width: 4 * S.laneX + S.laneW };
}
