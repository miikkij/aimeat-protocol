/**
 * @file federation-tab.stands.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Sections 01 and 02 of the Federation page: where this node stands, and who may sign
 *   in here. The sections draw library components and pass them data; they write no class.
 *
 *   01 IS A LIST OF THINGS WAITING ON A PERSON, not a row of counters. Adding a peer connects
 *   nothing — the direct door writes `pending`, approving a peering request writes `approved`, and
 *   Activate takes either — so the commonest state on this page is a peer somebody added and never
 *   switched on. The old page counted active, degraded, offline and pending REQUESTS, so both roads
 *   into a peer ended with a screen that looked finished. Every entry in `needs` carries the nodes
 *   it is about and a door that goes there.
 *
 *   02 IS TWO DECISIONS AND BOTH HAVE TO SAY YES. The node-wide policy is here; the per-peer switch
 *   is in section 03. `specific_peers` with no peer carrying its own switch reads as configured and
 *   admits nobody, which is the shape the organisation sign-in page had before it started counting
 *   its own steps, so the reach is stated as a number rather than implied by a dropdown.
 *
 *   AND WHAT THIS NODE GIVES. An action, agent, board or service reaches the federation only when
 *   somebody ticks Federate on it. Zero across all four means this node reads the federation and
 *   puts nothing back — a decision people make by accident, written `0a · 0g · 0b · 0c` in a column
 *   called Resources until now. → services/federation-overview.ts
 * @structure
 *   - WhereWeStand (01) — the word, the needs, the strip
 *   - WhoMaySignIn (02) — the policy, the scopes, and what this node offers
 * @usage Imported by views/admin/federation-tab.js.
 * @version-history
 *   v2.0.0 — 2026-09-27 — Library components, no class: the standing is the Verdict with the needs
 *     as Readings (each need's door at the row's end), the strip is the FigureStrip (the waiting
 *     count in coral, the sign-in word in capitals and in coral when it reaches nobody), the policy
 *     is three radio Check lines, the scopes are toggle tabs, the open join is a Check line.
 *   2026-09-13 -- Compose the shared aside role and its documented cuts.
 *   v1.1.0 — 2026-09-13 — Compose section headings from the shared poster B1 shape.
 *   v1.0.0 — 2026-09-12 — Initial (the Federation page in the poster face).
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { time as fmtTime } from '/js/format.js';
import { num, Badge } from './shared.js';
import { Section } from '/components/Section.js';
import { Verdict, Readings } from '/components/Readings.js';
import { FigureStrip } from '/components/FigureStrip.js';
import { Check } from '/components/Check.js';
import { Tabs } from '/components/Tabs.js';
import { SettingBox } from '/components/Box.js';
import { Action, Actions } from '/components/Action.js';
import { Beside, Stack, Split } from '/components/Layout.js';
import { Note } from '/components/Note.js';
import { Label } from '/components/Mark.js';

const S = (key, params) => t('admin.fed.' + key, params);

/** Every scope the node-wide policy can hand a federated visitor on arrival. */
export const SCOPES = [
  'memory:read', 'memory:write', 'catalogue:read', 'social:read',
  'social:write', 'work:request', 'boards:read', 'boards:write',
];

/**
 * Section 01: where this node stands, and what is waiting.
 *
 * The word is the worst true thing, and "something needs you" beats "a peer is down" because one is
 * your move and the other is theirs.
 */
export function WhereWeStand({ data, onGoPeers, onGoRequests }) {
  const { standing, needs, peers, signin, book } = data;
  const tone = standing === 'waiting' ? 'watch' : standing === 'degraded' ? 'danger' : undefined;
  const waiting = needs.reduce((a, n) => a + n.count, 0);

  const stamp = [
    S('now.stampPeers', { n: num(peers.total) }),
    S('now.stampNode', { id: data.this_node.node_id }),
    S('now.readAt', { at: fmtTime(new Date()) }),
  ].join(' · ');

  /** One waiting thing, with the nodes it is about and the door that goes there. */
  const need = (n) => {
    const names = n.nodes.slice(0, 3).join(', ') + (n.nodes.length > 3 ? S('now.andMore', { n: n.nodes.length - 3 }) : '');
    return {
      key: n.kind,
      name: S('now.need_' + n.kind),
      why: S('now.needWhy_' + n.kind, { nodes: names }),
      mark: html`<${Badge} type=${n.kind === 'key' ? 'danger' : 'warning'} label=${num(n.count)} />`,
      end: html`<${Action} small soft tone="danger"
        onClick=${n.kind === 'request' ? onGoRequests : onGoPeers}>${S('now.needDoor_' + n.kind)}<//>`,
    };
  };

  // "Nobody" is true two ways and only one of them is a fault: the policy being off is a decision,
  // the policy being set and reaching nobody is a mistake. Same word, two sentences under it, and
  // only the second one wears the coral.
  const signinWord = signin.policy === 'disabled' ? S('strip.signinOff')
    : signin.reaches_nobody ? S('strip.signinNobody')
      : signin.policy === 'all_peers' ? S('strip.signinAll')
        : S('strip.signinNamed', { n: num(signin.reaches) });
  const signinWhy = signin.policy === 'disabled'
    ? S('strip.signinWhyOff')
    : signin.reaches_nobody ? S('strip.signinWhyNobody') : S('strip.signinWhy', { n: num(signin.reaches) });

  return html`
    <${Section} id="adm-fed-01" num="01" title=${S('now.title')} first>
      <${Verdict} word=${S('now.word_' + standing)} tone=${tone}
        line=${/* The same number the strip prints. It used to be needs.length, so a page with one
                 request and two peers to switch on said "2 things" beside a strip saying 3. */
          S('now.line_' + standing, { n: num(waiting) })}
        stamp=${stamp}>
        <${Readings} rows=${[
          ...needs.map(need),
          {
            key: 'running',
            name: S('now.running'),
            why: S('now.runningWhy'),
            mark: peers.active > 0
              ? html`<${Badge} type="success" label=${num(peers.active)} />`
              : html`<${Badge} type="muted" label=${S('now.none')} />`,
            value: S('now.runningVal', { active: num(peers.active), degraded: num(peers.degraded), offline: num(peers.offline) }),
            last: true,
          },
        ]} />
      <//>

      <${FigureStrip} wrap items=${[
        { key: 'peers', n: num(peers.total), label: S('strip.peers'),
          sub: S('strip.peersWhy', { active: num(peers.active), degraded: num(peers.degraded), offline: num(peers.offline) }) },
        { key: 'wait', n: num(waiting), tone: waiting ? 'notice' : undefined, label: S('strip.needYou'),
          sub: S('strip.needYouWhy', { requests: num(data.requests.pending.length), awaiting: num(peers.awaiting), keyless: num(peers.keyless) }) },
        { key: 'signin', n: signinWord, tone: signin.reaches_nobody ? 'coral' : 'word', label: S('strip.maySignIn'), sub: signinWhy },
        book.present
          ? { key: 'book', n: book.age_days === null ? '—' : num(book.age_days), label: S('strip.bookAge'),
            sub: S('strip.bookWhy', { by: book.issued_by ?? '—', edition: num(book.edition ?? 0) }) }
          : { key: 'book', n: S('strip.bookNone'), tone: 'word', label: S('strip.book'), sub: S('strip.bookNoneWhy') },
      ]} />
    <//>`;
}

/** Section 02: who may sign in here, and what this node gives back. */
export function WhoMaySignIn({ data, saving, onPolicy, onScope, onOpenJoin, onGoBoards }) {
  const { signin, offer } = data;

  const choice = (value, why) => html`
    <${Check} key=${value} radio name="adm-fed-policy" checked=${signin.policy === value}
      disabled=${!!saving} hint=${why} onChange=${() => onPolicy(value)}>
      <b>${S('signin.policy_' + value)}</b>
    <//>`;

  const offered = html`
    <${Stack} gap="none">
      <${Label} block>${S('offer.title')}<//>
      <${Readings} rows=${[
        { key: 'actions', name: S('offer.actions'), why: null, mark: null, value: S('offer.of', { n: num(offer.actions), total: num(offer.actions_total) }) },
        { key: 'agents', name: S('offer.agents'), why: null, mark: null, value: S('offer.of', { n: num(offer.agents), total: num(offer.agents_total) }) },
        { key: 'boards', name: S('offer.boards'), why: null, mark: null, value: S('offer.of', { n: num(offer.boards), total: num(offer.boards_total) }) },
        { key: 'csms', name: S('offer.csms'), why: null, mark: null, value: S('offer.of', { n: num(offer.csms), total: num(offer.csms_total) }), last: true },
      ]} />
      ${offer.gives_nothing && html`
        <${SettingBox} label=${S('offer.nothingLabel')}>
          ${S('offer.nothingBody')}
          <${Actions}>
            <${Action} small soft href="/v1/admin?tab=boards" onClick=${onGoBoards}>${S('offer.goBoards')}<//>
            <${Action} small soft href="/v1/admin?tab=capabilities">${S('offer.goCapabilities')}<//>
          <//>
        <//>`}
    <//>`;

  return html`
    <${Section} id="adm-fed-02" num="02" title=${S('signin.title')}>
      <${Note} kind="lead">${S('signin.lead')}<//>

      <${Beside} wide side=${offered}>
        <${Stack} gap="large">
          <${Stack} gap="none">
            <${Label} block>${S('signin.accepts')}<//>
            ${choice('disabled', S('signin.policyWhy_disabled'))}
            ${choice('all_peers', S('signin.policyWhy_all_peers', { n: num(data.peers.active) }))}
            ${choice('specific_peers', S('signin.policyWhy_specific_peers', { n: num(signin.named), total: num(data.peers.active) }))}
          <//>

          <${Stack} gap="none">
            <${Label} block>${S('signin.scopes')}<//>
            <${Tabs} kind="toggle" tone="filter" value=${signin.scopes} disabled=${!!saving} label=${S('signin.scopes')}
              onSelect=${onScope} items=${SCOPES.map((s) => ({ value: s, label: s }))} />
          <//>

          <${Split}>
            <${Check} checked=${signin.open_join} disabled=${!!saving} hint=${S('signin.openJoinWhy')}
              onChange=${(checked) => onOpenJoin(checked)}>
              <b>${S('signin.openJoin')}</b>
            <//>
          <//>
        <//>
      <//>
    <//>`;
}
