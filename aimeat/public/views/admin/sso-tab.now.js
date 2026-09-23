/**
 * @file sso-tab.now.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Section 01 of the Organisation sign-in page, in both of its lives.
 *
 *   THIS PAGE HAS TWO STATES AND THE OLD ONE HAD DESIGN FOR NEITHER. With nothing connected it
 *   showed a grey sentence naming two protocols and a button; with a company connected it showed a
 *   row of ticks. So `Nothing` and `RightNow` are the two branches, and each answers the question
 *   its own reader actually has.
 *
 *   NOTHING CONNECTED is the normal state, not an edge case: it is what aimeat.io has always
 *   looked like. It leads with what the operator gets — their people use the account they already
 *   have, their IT keeps the list, you decide who counts — because the old opening sentence
 *   answered a question nobody has yet, in the vocabulary of the mechanism.
 *
 *   CONNECTED leads on whatever is in the way. Almost always that is the node-wide switch, which
 *   is not on this page: a connection can be complete and reach nobody because sso.enabled is off
 *   and both public doors answer 503. The old page could not say that anywhere except one row of
 *   its troubleshooting table.
 * @structure
 *   - Nothing — the empty state: what it buys, and the four things to gather
 *   - RightNow — the word, the five rows, the strip
 *   - Locked — the notice that connection management is frozen (also used by the detail view)
 * @usage Imported by views/admin/sso-tab.js.
 * @version-history
 *   v1.2.0 — 2026-09-22 — Composed from the shared component set (Section, Columns, NumeralBand,
 *     Surface): no class of its own, so a theme change reaches it. The icons carry their stroke as
 *     SVG attributes now that no sheet dresses them.
 *   v1.1.0 — 2026-09-13 — Compose existing section headings from shared poster B1.
 *   v1.0.0 — 2026-09-12 — Initial (the Organisation sign-in page in the poster face).
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { time as fmtTime } from '/js/format.js';
import { num, Badge, Row } from './shared.js';
import { Section, Columns, Stack, NumeralBand, Surface, Action, Text } from '/components/poster-parts.js';

const S = (key, params) => t('admin.sso.' + key, params);

/** Stroke icons on a 24px grid, one style. Never an emoji: these scale and recolour. */
const ICONS = {
  key: html`<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" /><path d="M10 17l5-5-5-5" /><path d="M15 12H3" /></svg>`,
  people: html`<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 11h-6" /></svg>`,
  shield: html`<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><path d="M9 12l2 2 4-4" /></svg>`,
};

/**
 * Section 01 with nothing connected.
 *
 * No numbered rows and no strip of zeros: there is nothing to report yet, and a row of noughts is
 * the shape that made the old page feel like a dead end. What belongs here is the offer and the
 * preparation.
 */
export function Nothing({ node, onConnect }) {
  const gets = [
    { icon: ICONS.key, title: S('gets.workAccount'), body: S('gets.workAccountWhy') },
    { icon: ICONS.people, title: S('gets.theirIt'), body: S('gets.theirItWhy') },
    { icon: ICONS.shield, title: S('gets.youDecide'), body: S('gets.youDecideWhy') },
  ];
  const gather = ['shortName', 'domains', 'someone', 'visibility'];

  return html`
    <${Section} id="adm-sso-01" title=${S('now.title')} count="01"
      actions=${html`<${Action} kind="primary" disabled=${node.locked} onClick=${onConnect}>${S('now.connect')}<//>`}>
      <${Stack}>
        <${Columns} layout="trailing" collapse=${900}>
          <${Stack} density="compact">
            <${Text} kind="heading">${S('empty.word')}<//>
            <${Text}>${node.accounts
    ? S('empty.line', { n: num(node.accounts) })
    : S('empty.lineNoCount')}<//>
            ${node.locked ? html`<${Locked} setting=${node.locked_setting} />` : null}
          <//>
          <${Columns} layout="thirds" collapse=${640}>
            ${gets.map(g => html`
              <${Stack} key=${g.title} density="compact">
                <${Text} kind="label">${g.icon}<//>
                <strong>${g.title}</strong>
                <${Text} tone="muted">${g.body}<//>
              <//>`)}
          <//>
        <//>

        <${NumeralBand} tone="plain" items=${[
    { label: S('strip.organisations'), value: '0', note: S('strip.organisationsNone'), tone: 'muted' },
    { label: S('strip.accounts'), value: num(node.accounts || 0), note: S('strip.accountsSub') },
    { label: S('strip.switch'), value: S('strip.off'), note: S('strip.switchLater'), tone: 'muted' },
    { label: S('strip.gather'), value: String(gather.length), note: S('strip.gatherSub') },
  ]} />
      <//>
    <//>`;
}

/** Connection management is frozen: every write below is refused, and this says which setting did it. */
export function Locked({ setting }) {
  return html`<${Surface} kind="aside" tone="coral" density="compact"><${Text}>${S('now.lockedWhy', { setting })}<//><//>`;
}

/**
 * Section 01 with at least one company connected.
 *
 * The word names whatever is in the way, in the order the operator can act on it: a frozen page
 * first (nothing else here is possible), then the node-wide switch, then a connection that is not
 * finished, then the good case.
 */
export function RightNow({ data, onConnect, toSection }) {
  const node = data.node;
  const s = data.summary;
  const blocked = s.blocked_by_switch > 0 && !node.enabled;
  const first = data.connections[0];

  const word = node.locked ? S('now.wordLocked')
    : blocked ? S('now.wordBlocked')
      : s.incomplete > 0 ? S('now.wordUnfinished', { n: s.incomplete })
        : s.logins_seen > 0 ? S('now.wordWorking', { n: num(s.logins_seen) })
          : S('now.wordReady', { n: s.can_sign_in });

  const line = node.locked ? S('now.lineLocked', { setting: node.locked_setting })
    : blocked ? S('now.lineBlocked', { name: first?.name || '' })
      : s.incomplete > 0 ? S('now.lineUnfinished')
        : s.logins_seen > 0 ? S('now.lineWorking')
          : S('now.lineReady');

  const stamp = [
    S('now.stampOrgs', { n: s.total }),
    S('now.stampArrived', { n: s.logins_seen }),
    S('now.readAt', { at: fmtTime(new Date()) }),
  ].join(' · ');

  return html`
    <${Section} id="adm-sso-01" title=${S('now.title')} count="01"
      actions=${html`<${Action} disabled=${node.locked} onClick=${onConnect}>${S('now.connect')}<//>`}>
      <${Stack}>
      <${Columns} collapse=${900}>
        <${Stack} density="compact">
          <${Text} kind="heading" tone=${blocked || node.locked ? 'danger' : 'plain'}>${word}<//>
          <${Text}>${line}<//>
          <${Text} kind="mono" tone="muted">${stamp}<//>
          ${blocked ? html`
            <${Stack} direction="wrap">
              <${Action} tone="danger" href="/v1/admin?tab=config">${S('now.openConfig')}<//>
            <//>` : null}
        <//>

        <div>
          ${Row({
    title: S('now.masterSwitch'),
    why: S('now.masterSwitchWhy'),
    chip: html`<${Badge} type=${node.enabled ? 'success' : 'danger'}
      label=${node.enabled ? S('now.on') : S('now.off')} />`,
    value: node.enabled_setting,
  })}
          ${Row({
    title: S('now.changing'),
    why: S('now.changingWhy'),
    chip: html`<${Badge} type=${node.locked ? 'warning' : 'success'}
      label=${node.locked ? S('now.frozen') : S('now.open')} />`,
    value: node.locked_setting,
  })}
          ${Row({
    title: S('now.connected'),
    why: S('now.connectedWhy'),
    chip: html`<${Badge} type="info" label=${String(s.total)} />`,
    value: data.connections.map(c => c.id).slice(0, 3).join(' · '),
  })}
          ${Row({
    title: S('now.buttons'),
    why: S('now.buttonsWhy'),
    chip: s.buttons_showing > 0
      ? html`<${Badge} type="success" label=${S('now.showingN', { n: s.buttons_showing })} />`
      : html`<${Badge} type="danger" label=${S('now.showingNone')} />`,
    value: s.buttons_showing > 0
      ? S('now.buttonsValue', { n: s.buttons_showing })
      : S('now.buttonsWould', { n: s.blocked_by_switch }),
  })}
          ${Row({
    title: S('now.arriving'),
    why: S('now.arrivingWhy'),
    chip: s.directories_calling > 0
      ? html`<${Badge} type="success" label=${S('now.calling', { n: s.directories_calling })} />`
      : html`<${Badge} type="muted" label=${S('now.notYet')} />`,
    value: S('now.arrivingValue', { logins: num(s.logins_seen), dirs: num(s.directories_calling) }),
  })}
        </div>
      <//>

      <${NumeralBand} tone="plain" items=${[
    { label: S('strip.switch'), value: node.enabled ? S('now.on') : S('now.off'),
      note: node.enabled ? S('strip.switchOnSub') : S('strip.switchOffSub'), tone: node.enabled ? undefined : 'coral' },
    { label: S('strip.organisations'), value: String(s.total), note: data.connections.map(c => c.name).slice(0, 2).join(' · ') },
    { label: S('strip.arrived'), value: num(s.logins_seen), note: s.logins_seen ? S('strip.arrivedSub') : S('strip.arrivedNone'),
      tone: s.logins_seen ? undefined : 'muted' },
    { label: S('strip.steps'), value: S('strip.stepsValue', { done: first?.steps_done ?? 0, total: s.steps_total }),
      note: node.enabled ? S('strip.stepsSub') : S('strip.stepsSixth') },
  ]} />

      ${blocked ? html`
        <${Stack} direction="wrap" align="center" density="compact">
          <${Text} kind="caption" tone="muted">${S('now.blockedNote')}<//>
          <${Action} onClick=${() => toSection('02')}>${S('now.seeSteps')}<//>
        <//>` : null}
      <//>
    <//>`;
}
