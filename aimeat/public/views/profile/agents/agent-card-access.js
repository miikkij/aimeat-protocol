/**
 * @file agent-card-access.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What the agent may do, in the words of what went wrong: the calls your AIMEAT refused
 *   it for a missing permission, and what it asked for when it was approved beside what it got.
 *
 *   WHY. A crew on a sold seat ran to its end while every write of it was refused; the customer's
 *   task waited for good, and only the server log said why (wish
 *   `wish-agentin-ajo-onnistuu-vaikka-node-kielt-sen-kirjoitukset-scop`, 2026-09-29). The agent list
 *   now carries `refusals` and `scope_request` (services/agent-refusals.ts); this file says them on
 *   the card, with the one action that fixes a refusal: the access rights dialog.
 *
 *   A refusal is shown while it stands: the agent still lacks the permission, and it is younger than
 *   14 days. Granting the permission closes it on the next read, so the note goes away by itself.
 * @structure RefusalNote({ agent, onScopesClick }) · AccessLine({ agent }) · hasRefusals(agent) ·
 *   permissionWords(scopes, anyOf)
 *   The method and the path of a refused call are joined by a no-break space, so a narrow card never
 *   leaves the method alone at the end of a line.
 * @usage
 *   import { RefusalNote, AccessLine, hasRefusals } from './agent-card-access.js';
 *   html`<${RefusalNote} agent=${agent} onScopesClick=${onScopesClick} />`
 * @version-history
 *   v1.0.0 — 2026-09-30 — Initial.
 */
import { h } from 'preact';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { timeAgo } from '/js/utils.js';
import { scopeSentence } from '../access/frame.js';
import { CardLine } from '/components/OpenCard.js';
import { Action, Actions } from '/components/Action.js';
import { Note } from '/components/Note.js';
import { SubHeading } from '/components/SubHeading.js';

const html = htm.bind(h);

/** How many refusals the note lists before it says how many more there are. */
const SHOWN = 3;

export function hasRefusals(agent) {
  return Array.isArray(agent?.refusals) && agent.refusals.length > 0;
}

/** A permission in the reader's words with the word itself after it: “sets up your other agents” (agent:write). */
function onePermission(scope) {
  const words = scopeSentence(scope);
  return words === scope ? scope : `“${words}” (${scope})`;
}

/** Several permissions, joined by "and", or by "or" when any one of them would have been enough. */
export function permissionWords(scopes, anyOf = false) {
  const list = (Array.isArray(scopes) ? scopes : []).map(onePermission);
  if (list.length <= 1) return list[0] ?? '';
  const last = list.pop();
  return `${list.join(', ')} ${t(anyOf ? 'profile.agents.refusals.or' : 'profile.agents.refusals.and')} ${last}`;
}

/**
 * The attention note on the open card. One line per refused call: the permission it needed, how
 * many times, and when last; the call itself follows in small letters as the evidence.
 */
export function RefusalNote({ agent, onScopesClick }) {
  if (!hasRefusals(agent)) return null;
  const shown = agent.refusals.slice(0, SHOWN);
  const more = agent.refusals.length - shown.length;
  return html`
    <${Note} kind="aside" size="small">
      <${SubHeading}>${t('profile.agents.refusals.title')}<//>
      <div>${t('profile.agents.refusals.lead')}</div>
      ${shown.map((r) => html`
        <div key=${`${r.call} ${(r.needed || []).join(' ')}`}>
          ${t(r.count === 1 ? 'profile.agents.refusals.lineOne' : 'profile.agents.refusals.lineMany', {
            permission: permissionWords(r.needed, r.any_of), count: r.count, when: timeAgo(r.last_at),
          })}
          ${' '}<${Note} kind="meta" inline>${String(r.call).replace(' ', ' ')}<//>
        </div>`)}
      ${more > 0 ? html`<div>${t('profile.agents.refusals.more', { n: more })}</div>` : null}
      ${onScopesClick ? html`
        <${Actions}>
          <${Action} small onClick=${(e) => { e.stopPropagation(); onScopesClick(agent); }}>${t('profile.agents.refusals.grant')} →<//>
        <//>` : null}
    <//>`;
}

/**
 * What the agent asked for at its last approval, and what of that it did not get. Nothing when the
 * approval was not recorded (an agent approved before this existed, or through another route).
 */
export function AccessLine({ agent }) {
  const req = agent?.scope_request;
  if (!req) return null;
  const granted = new Set(agent.default_scopes ?? req.granted ?? []);
  const asked = Array.isArray(req.requested) ? req.requested : null;
  const missing = asked ? asked.filter((s) => !granted.has(s) && !granted.has('*') && !granted.has(`${s.split(':')[0]}:*`)) : [];
  return html`
    <${CardLine} label=${t('profile.agents.refusals.askedLabel')}>
      <span>
        ${asked
          ? t('profile.agents.refusals.askedNamed', { asked: permissionWords(asked) })
          : t('profile.agents.refusals.askedNothing')}
        ${missing.length ? html` ${t('profile.agents.refusals.notGranted', { missing: permissionWords(missing) })}` : null}
      </span>
    <//>`;
}
