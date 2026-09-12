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
 *   v1.0.0 — 2026-09-12 — Initial (the Federation page in the poster face).
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { num, Badge, Row } from './shared.js';

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
    S('now.readAt', { at: new Date().toLocaleTimeString() }),
  ].join(' · ');

  /** One waiting thing, with the nodes it is about and the door that goes there. */
  const need = (n) => {
    const names = n.nodes.slice(0, 3).join(', ') + (n.nodes.length > 3 ? S('now.andMore', { n: n.nodes.length - 3 }) : '');
    return Row({
      title: S('now.need_' + n.kind),
      why: S('now.needWhy_' + n.kind, { nodes: names }),
      chip: html`<${Badge} type=${n.kind === 'key' ? 'danger' : 'warning'} label=${num(n.count)} />`,
      value: html`<button type="button" class="og-door og-door--quiet og-door--danger"
        onClick=${n.kind === 'request' ? onGoRequests : onGoPeers}>${S('now.needDoor_' + n.kind)}</button>`,
    });
  };

  return html`
    <section class="og-sec og-sec--first" id="adm-fed-01">
      <div class="og-sec-h">
        <h2>${S('now.title')}<small>01</small></h2>
      </div>

      <div class="adm-ov-grid">
        <div>
          <div class="adm-ov-status ${tone}">${S('now.word_' + standing)}</div>
          <!-- The same number the strip prints. It used to be needs.length, so a page with one
               request and two peers to switch on said "2 things" beside a strip saying 3. -->
          <p class="adm-alert-line">${S('now.line_' + standing, { n: num(waiting) })}</p>
          <div class="adm-ov-up">${stamp}</div>
        </div>

        <div>
          ${needs.map(need)}
          ${Row({
    title: S('now.running'),
    why: S('now.runningWhy'),
    chip: peers.active > 0
      ? html`<${Badge} type="success" label=${num(peers.active)} />`
      : html`<${Badge} type="muted" label=${S('now.none')} />`,
    value: S('now.runningVal', { active: num(peers.active), degraded: num(peers.degraded), offline: num(peers.offline) }),
    last: true,
  })}
        </div>
      </div>

      <div class="og-strip">
        <div>
          <b>${num(peers.total)}</b><span>${S('strip.peers')}</span>
          <small>${S('strip.peersWhy', { active: num(peers.active), degraded: num(peers.degraded), offline: num(peers.offline) })}</small>
        </div>
        <div>
          <b class=${waiting ? 'adm-fed-coral' : ''}>${num(waiting)}</b>
          <span>${S('strip.needYou')}</span>
          <small>${S('strip.needYouWhy', {
    requests: num(data.requests.pending.length), awaiting: num(peers.awaiting), keyless: num(peers.keyless),
  })}</small>
        </div>
        <div>
          <b class="adm-fed-word ${signin.reaches_nobody ? 'adm-fed-coral' : ''}">
            ${signin.policy === 'disabled' ? S('strip.signinOff')
    : signin.reaches_nobody ? S('strip.signinNobody')
      : signin.policy === 'all_peers' ? S('strip.signinAll')
        : S('strip.signinNamed', { n: num(signin.reaches) })}
          </b>
          <span>${S('strip.maySignIn')}</span>
          <!-- "Nobody" is true two ways and only one of them is a fault: the policy being off is a
               decision, the policy being set and reaching nobody is a mistake. Same word, two
               sentences under it, and only the second one wears the coral. -->
          <small>${signin.policy === 'disabled'
    ? S('strip.signinWhyOff')
    : signin.reaches_nobody
      ? S('strip.signinWhyNobody')
      : S('strip.signinWhy', { n: num(signin.reaches) })}</small>
        </div>
        <div>
          ${book.present
    ? html`<b>${book.age_days === null ? '—' : num(book.age_days)}</b><span>${S('strip.bookAge')}</span>`
    : html`<b class="adm-fed-word">${S('strip.bookNone')}</b><span>${S('strip.book')}</span>`}
          <small>${book.present
    ? S('strip.bookWhy', { by: book.issued_by ?? '—', edition: num(book.edition ?? 0) })
    : S('strip.bookNoneWhy')}</small>
        </div>
      </div>
    </section>`;
}

/** Section 02: who may sign in here, and what this node gives back. */
export function WhoMaySignIn({ data, saving, onPolicy, onScope, onOpenJoin, onGoBoards }) {
  const { signin, offer } = data;

  const choice = (value, disabled) => html`
    <label class="adm-fed-pick ${value === 'specific_peers' ? 'adm-fed-pick--last' : ''}">
      <input type="radio" name="adm-fed-policy" checked=${signin.policy === value}
        disabled=${!!saving} onChange=${() => onPolicy(value)} />
      <span><b>${S('signin.policy_' + value)}</b><span>${disabled}</span></span>
    </label>`;

  return html`
    <section class="og-sec" id="adm-fed-02">
      <div class="og-sec-h">
        <h2>${S('signin.title')}<small>02</small></h2>
      </div>
      <p class="adm-intro">${S('signin.lead')}</p>

      <div class="adm-two">
        <div class="adm-half">
          <div class="adm-fed-lbl">${S('signin.accepts')}</div>
          ${choice('disabled', S('signin.policyWhy_disabled'))}
          ${choice('all_peers', S('signin.policyWhy_all_peers', { n: num(data.peers.active) }))}
          ${choice('specific_peers', S('signin.policyWhy_specific_peers', { n: num(signin.named), total: num(data.peers.active) }))}

          <div class="adm-fed-lbl adm-fed-lbl--gap">${S('signin.scopes')}</div>
          <div class="adm-fed-scopes">
            ${SCOPES.map(s => html`
              <button type="button" class="adm-fed-scope ${signin.scopes.includes(s) ? 'on' : ''}"
                disabled=${!!saving} onClick=${() => onScope(s)}>${s}</button>`)}
          </div>

          <label class="adm-fed-switch">
            <input type="checkbox" checked=${signin.open_join} disabled=${!!saving}
              onChange=${(e) => onOpenJoin(e.target.checked)} />
            <span><b>${S('signin.openJoin')}</b><span>${S('signin.openJoinWhy')}</span></span>
          </label>
        </div>

        <div class="adm-half">
          <div class="adm-fed-lbl">${S('offer.title')}</div>
          ${Row({ title: S('offer.actions'), why: null, chip: null, value: S('offer.of', { n: num(offer.actions), total: num(offer.actions_total) }) })}
          ${Row({ title: S('offer.agents'), why: null, chip: null, value: S('offer.of', { n: num(offer.agents), total: num(offer.agents_total) }) })}
          ${Row({ title: S('offer.boards'), why: null, chip: null, value: S('offer.of', { n: num(offer.boards), total: num(offer.boards_total) }) })}
          ${Row({ title: S('offer.csms'), why: null, chip: null, value: S('offer.of', { n: num(offer.csms), total: num(offer.csms_total) }), last: true })}

          ${offer.gives_nothing && html`
            <div class="og-box adm-fed-box--afterRows">
              <span class="og-box-label">${S('offer.nothingLabel')}</span>
              ${S('offer.nothingBody')}
              <div class="adm-fed-acts">
                <a class="og-door og-door--quiet" href="/v1/admin?tab=boards" onClick=${onGoBoards}>${S('offer.goBoards')}</a>
                <a class="og-door og-door--quiet" href="/v1/admin?tab=capabilities">${S('offer.goCapabilities')}</a>
              </div>
            </div>`}
        </div>
      </div>
    </section>`;
}
