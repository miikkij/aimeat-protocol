/**
 * @file federation-tab.stands.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Sections 01 and 02 of the Federation page: where this node stands, and who may sign
 *   in here.
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
 *   v2.0.0 -- 2026-09-22 -- Composed from the shared component set: sections, the metric rows, the
 *     numeral band, the policy as boxed radio choices, scopes as tabs, open join as a switch.
 *   2026-09-13 -- Compose the shared aside role and its documented cuts.
 *   v1.1.0 — 2026-09-13 — Compose section headings from the shared poster B1 shape.
 *   v1.0.0 — 2026-09-12 — Initial (the Federation page in the poster face).
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { time as fmtTime } from '/js/format.js';
import { num, Badge, Row } from './shared.js';
import { Section, Columns, Stack, NumeralBand, Action, Surface, Text } from '/components/poster-parts.js';

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
  const tone = standing === 'waiting' ? 'watch' : standing === 'degraded' ? 'danger' : '';
  const waiting = needs.reduce((a, n) => a + n.count, 0);

  const stamp = [
    S('now.stampPeers', { n: num(peers.total) }),
    S('now.stampNode', { id: data.this_node.node_id }),
    S('now.readAt', { at: fmtTime(new Date()) }),
  ].join(' · ');

  /** One waiting thing, with the nodes it is about and the door that goes there. */
  const need = (n) => {
    const names = n.nodes.slice(0, 3).join(', ') + (n.nodes.length > 3 ? S('now.andMore', { n: n.nodes.length - 3 }) : '');
    return Row({
      title: S('now.need_' + n.kind),
      why: S('now.needWhy_' + n.kind, { nodes: names }),
      chip: html`<${Badge} type=${n.kind === 'key' ? 'danger' : 'warning'} label=${num(n.count)} />`,
      value: html`<${Action} tone="danger" onClick=${n.kind === 'request' ? onGoRequests : onGoPeers}>${S('now.needDoor_' + n.kind)}<//>`,
    });
  };

  // The line says `waiting`, the same number the strip prints. It used to be needs.length, so a
  // page with one request and two peers to switch on said "2 things" beside a strip saying 3.
  // "Nobody" is true two ways and only one of them is a fault: the policy being off is a decision,
  // the policy being set and reaching nobody is a mistake. Same word, two sentences under it, and
  // only the second one wears the coral.
  const signinWord = signin.policy === 'disabled' ? S('strip.signinOff')
    : signin.reaches_nobody ? S('strip.signinNobody')
      : signin.policy === 'all_peers' ? S('strip.signinAll')
        : S('strip.signinNamed', { n: num(signin.reaches) });
  const signinWhy = signin.policy === 'disabled'
    ? S('strip.signinWhyOff')
    : signin.reaches_nobody
      ? S('strip.signinWhyNobody')
      : S('strip.signinWhy', { n: num(signin.reaches) });

  return html`<${Section} id="adm-fed-01" title=${S('now.title')} count="01">
    <${Stack}>
      <${Columns} layout="trailing" collapse=${900}>
        <${Stack} density="compact">
          <${Text} kind="number" size="large" tone=${tone === 'danger' ? 'danger' : tone === 'watch' ? 'coral' : 'plain'}>${S('now.word_' + standing)}<//>
          <${Text} kind="lead">${S('now.line_' + standing, { n: num(waiting) })}<//>
          <${Text} kind="mono" tone="muted">${stamp}<//>
        <//>

        <div>
          ${needs.map(need)}
          ${Row({
            title: S('now.running'),
            why: S('now.runningWhy'),
            chip: peers.active > 0
              ? html`<${Badge} type="success" label=${num(peers.active)} />`
              : html`<${Badge} type="muted" label=${S('now.none')} />`,
            value: S('now.runningVal', { active: num(peers.active), degraded: num(peers.degraded), offline: num(peers.offline) }),
          })}
        </div>
      <//>

      <${NumeralBand} tone="plain" items=${[
        { label: S('strip.peers'), value: num(peers.total),
          note: S('strip.peersWhy', { active: num(peers.active), degraded: num(peers.degraded), offline: num(peers.offline) }) },
        { label: S('strip.needYou'), value: num(waiting), tone: waiting ? 'coral' : undefined,
          note: S('strip.needYouWhy', { requests: num(data.requests.pending.length), awaiting: num(peers.awaiting), keyless: num(peers.keyless) }) },
        { label: S('strip.maySignIn'), value: signinWord, note: signinWhy, tone: signin.reaches_nobody ? 'coral' : undefined },
        book.present
          ? { label: S('strip.bookAge'), value: book.age_days === null ? '—' : num(book.age_days),
            note: S('strip.bookWhy', { by: book.issued_by ?? '—', edition: num(book.edition ?? 0) }) }
          : { label: S('strip.book'), value: S('strip.bookNone'), note: S('strip.bookNoneWhy') },
      ]} />
    <//>
  <//>`;
}

/** Section 02: who may sign in here, and what this node gives back. */
export function WhoMaySignIn({ data, saving, onPolicy, onScope, onOpenJoin, onGoBoards }) {
  const { signin, offer } = data;

  const choice = (value, why) => html`<${Action} key=${value} kind="choice" semantics="radio"
    selected=${signin.policy === value} disabled=${!!saving} title=${S('signin.policy_' + value)}
    onClick=${() => onPolicy(value)}>${why}<//>`;

  return html`<${Section} id="adm-fed-02" title=${S('signin.title')} count="02" description=${S('signin.lead')}>
    <${Columns} collapse=${900}>
      <${Stack}>
        <${Stack} density="compact">
          <${Text} kind="label">${S('signin.accepts')}<//>
          <${Stack} role="radiogroup" label=${S('signin.accepts')} density="compact">
            ${choice('disabled', S('signin.policyWhy_disabled'))}
            ${choice('all_peers', S('signin.policyWhy_all_peers', { n: num(data.peers.active) }))}
            ${choice('specific_peers', S('signin.policyWhy_specific_peers', { n: num(signin.named), total: num(data.peers.active) }))}
          <//>
        <//>

        <${Stack} density="compact">
          <${Text} kind="label">${S('signin.scopes')}<//>
          <${Stack} direction="wrap" density="compact">
            ${SCOPES.map(sc => html`<${Action} key=${sc} kind="tab" selected=${signin.scopes.includes(sc)}
              disabled=${!!saving} onClick=${() => onScope(sc)}>${sc}<//>`)}
          <//>
        <//>

        <${Action} kind="choice" semantics="switch" selected=${!!signin.open_join} disabled=${!!saving}
          title=${S('signin.openJoin')} onClick=${() => onOpenJoin(!signin.open_join)}>${S('signin.openJoinWhy')}<//>
      <//>

      <${Stack}>
        <${Text} kind="label">${S('offer.title')}<//>
        <div>
          ${Row({ title: S('offer.actions'), why: null, chip: null, value: S('offer.of', { n: num(offer.actions), total: num(offer.actions_total) }) })}
          ${Row({ title: S('offer.agents'), why: null, chip: null, value: S('offer.of', { n: num(offer.agents), total: num(offer.agents_total) }) })}
          ${Row({ title: S('offer.boards'), why: null, chip: null, value: S('offer.of', { n: num(offer.boards), total: num(offer.boards_total) }) })}
          ${Row({ title: S('offer.csms'), why: null, chip: null, value: S('offer.of', { n: num(offer.csms), total: num(offer.csms_total) }) })}
        </div>

        ${offer.gives_nothing && html`<${Surface} kind="aside"><${Stack} density="compact">
          <${Text} kind="label">${S('offer.nothingLabel')}<//>
          <${Text}>${S('offer.nothingBody')}<//>
          <${Stack} direction="wrap">
            <${Action} href="/v1/admin?tab=boards" onClick=${onGoBoards}>${S('offer.goBoards')}<//>
            <${Action} href="/v1/admin?tab=capabilities">${S('offer.goCapabilities')}<//>
          <//>
        <//><//>`}
      <//>
    <//>
  <//>`;
}
