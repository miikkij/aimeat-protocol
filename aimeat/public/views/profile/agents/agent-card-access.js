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
 * @structure RefusalNote({ agent, onScopesClick }) · AccessLine({ agent }) · InvitesLine({ agent }) ·
 *   RequiredLine({ agent }) · OperatorServiceLines · hasRefusals(agent) · permissionWords(scopes, anyOf)
 *   The method and the path of a refused call are joined by a no-break space, so a narrow card never
 *   leaves the method alone at the end of a line.
 * @usage
 *   import { RefusalNote, AccessLine, hasRefusals } from './agent-card-access.js';
 *   html`<${RefusalNote} agent=${agent} onScopesClick=${onScopesClick} showToast=${showToast} />`
 * @version-history
 *   v1.5.2 — 2026-11-27 — The lines of a service's agent in one order: Service, Required (RequiredLine, when
 *     required), Private records, How you can help, Permissions.
 *   v1.5.1 — 2026-11-27 — How to help is read from set_by_operator, so the card makes no request of its own.
 *   v1.5.0 — 2026-11-26 — Phase 2: the private read in a line of its own with the operator's reason (and out
 *     of the permission list), how the person can help the service, and RequiredLine for a required agent.
 *   v1.4.0 — 2026-11-26 — Above the permissions of an agent the operator set up, a line with the service's
 *     name and the operator's own description.
 *   v1.3.1 — 2026-11-26 — Those permissions in one form: each word's sentence in the language's quotation
 *     marks with the word in brackets (namedPermissions), as the operator-service notice names them.
 *   v1.3.0 — 2026-11-26 — AccessLine: an agent the operator set up says that the operator's setting named
 *     its permissions, in place of what it asked for (it asked for nothing itself).
 *   v1.2.0 — 2026-10-18 — InvitesLine: the agent may invite people and an invitation can create an
 *     account, when its permissions cover organism:invite (wish-datakarttaan-ja-agentin-kuvaukseen-tieto-kutsuista-ja-tilien).
 *   v1.1.0 — 2026-09-30 — "Give the permission" opens the list of every needed permission
 *     (agent-refusal-grant.js): give all, some, or decline. The full dialog is one step further.
 *   v1.0.0 — 2026-09-30 — Initial.
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { timeAgo } from '/js/utils.js';
import { scopeSentence } from '../access/frame.js';
import { CardLine } from '/components/OpenCard.js';
import { Action, Actions } from '/components/Action.js';
import { Note } from '/components/Note.js';
import { SubHeading } from '/components/SubHeading.js';
import { RefusalGrantModal } from './agent-refusal-grant.js';
import { invitesPeople, invitesSentence } from '/js/consent-vocab.js';

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
export function RefusalNote({ agent, onScopesClick, showToast }) {
  // The answer is a list of every permission the refusals needed (agent-refusal-grant.js), opened
  // here rather than by the page, so the card carries its own question and its own answer.
  const [answering, setAnswering] = useState(false);
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
          <${Action} small onClick=${(e) => { e.stopPropagation(); setAnswering(true); }}>${t('profile.agents.refusals.grant')} →<//>
        <//>` : null}
      ${answering ? html`<${RefusalGrantModal} agent=${agent} showToast=${showToast}
        onClose=${() => setAnswering(false)} onEditAll=${onScopesClick} />` : null}
    <//>`;
}

/**
 * That the agent may invite people, and that an invitation can create a new account, when its
 * permissions cover organism:invite. The node's own answer (`invites_people`) where the list
 * carries it, else read from the permissions; nothing when the agent cannot invite.
 */
export function InvitesLine({ agent }) {
  const may = agent?.invites_people ?? invitesPeople(agent?.default_scopes ?? ['*']);
  if (!may) return null;
  return html`
    <${CardLine} label=${t('profile.agents.refusals.invitesLabel')}>
      <span>${invitesSentence(t)}</span>
    <//>`;
}

/**
 * Permissions as the operator-service notice names them: each word's sentence from the agent page in
 * the language's quotation marks (notiftext.operator_service_on.quoted), the word itself in brackets,
 * separated by semicolons. One form for every word, never a mix of short phrases and sentences.
 */
function namedPermissions(words) {
  return words.map((w) => {
    const [d, a] = String(w).split(':');
    const key = `profile.agents.scopeUi.scopeText.${d}.${a}`;
    const sentence = t(key);
    const text = (sentence && sentence !== key ? sentence : w).replace(/\.$/, '');
    return `${t('notiftext.operator_service_on.quoted', { text })} (${w})`;
  }).join('; ');
}

/** An operator's text as a sentence that ends once. */
const asSentence = (raw) => {
  const text = (raw || '').trim();
  return text && !/[.!?]$/.test(text) ? `${text}.` : text;
};

/**
 * The lines of an agent the operator set up, in this order: the service (its name and the operator's
 * own description), that it reads the person's private records and the operator's reason (apart from
 * the permissions, never inside them), how the person can help it (`set_by_operator.how_to_help`),
 * and the permissions the operator's
 * setting named, without the private read already stated above.
 */
function OperatorServiceLines({ agent, by, req }) {
  const help = by.how_to_help || null;
  const all = Array.isArray(req?.granted) && req.granted.length ? req.granted : (agent.default_scopes ?? []);
  const named = by.private_read ? all.filter((w) => w !== PRIVATE_READ_WORD) : all;
  const description = asSentence(by.description);
  return html`
    <${CardLine} label=${t('profile.agents.operatorService.serviceLabel')}>
      <span>${by.display_name}.${description ? ` ${t('notiftext.operator_service_on.about', { description })}` : ''}
        ${' '}<${Action} small href="/v1/help#operator-agent">${t('profile.agents.operatorService.helpLink')} →<//></span>
    <//>
    <${RequiredLine} agent=${agent} />
    ${by.private_read ? html`
      <${CardLine} label=${t('profile.agents.operatorService.privateReadLabel')}>
        <span>${t('notiftext.operator_service_on.private_read', { reason: asSentence(by.private_read_reason) })}</span>
      <//>` : null}
    ${help ? html`
      <${CardLine} label=${t('profile.agents.operatorService.helpLabel')}>
        <span>${t('notiftext.operator_service_on.how_to_help', { how_to_help: asSentence(help) })}</span>
      <//>` : null}
    <${CardLine} label=${t('profile.agents.operatorService.namedLabel')}>
      <span>${t('profile.agents.operatorService.namedBy', { service: by.display_name, permissions: namedPermissions(named) })}</span>
    <//>`;
}

/** The word an operator service holds only by the operator's setting, stated apart from the other permissions. */
const PRIVATE_READ_WORD = 'memory:read-as-owner';

/**
 * In place of the stop, task-start, narrowing and clearance controls of an agent the operator requires:
 * the operator requires the service, only the operator turns it off or limits it, and whom to ask.
 */
export function RequiredLine({ agent }) {
  const by = agent?.set_by_operator;
  if (!by?.required) return null;
  return html`
    <${CardLine} label=${t('profile.agents.operatorService.requiredLabel')}>
      <span>${t('profile.agents.operatorService.requiredLine', { service: by.display_name, contact: 'support@operators' })}</span>
    <//>`;
}

/**
 * What the agent asked for at its last approval, and what of that it did not get. Nothing when the
 * approval was not recorded (an agent approved before this existed, or through another route).
 */
export function AccessLine({ agent }) {
  const req = agent?.scope_request;
  // An agent the operator set up asked for nothing itself: the operator's setting named its permissions.
  const by = agent?.set_by_operator;
  if (by) return html`<${OperatorServiceLines} agent=${agent} by=${by} req=${req} />`;
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
