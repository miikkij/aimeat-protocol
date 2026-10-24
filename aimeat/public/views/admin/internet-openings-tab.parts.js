/**
 * @file public/views/admin/internet-openings-tab.parts.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The words and the first two sections of the admin page "Open to the internet"
 *   (internet-openings-tab.js): who did a thing, in words (an agent principal `x#owner@node` reads as
 *   the owner's agent), the forms as typewriter chips, the history kinds and states in words; the
 *   section "How apps are opened" (the node setting visibility.app_internet_opening as three boxed
 *   choices, and visibility.app_internet_opening_max_days), written through the same config route the
 *   Config tab uses (PUT /v1/admin/config); and the section "May open on their own" (the owners an
 *   operator trusts to open without asking, PUT and DELETE /v1/admin/internet-openers/:owner).
 *   Every part is a library component; the page passes data and writes no class.
 * @structure O · whoWords · formChips · formsLine · daysWords · underWords · stateTone · ModeSection ·
 *   OpenersSection (OpenerForm)
 * @usage import { ModeSection, OpenersSection, whoWords } from './internet-openings-tab.parts.js';
 * @version-history
 *   v1.0.0 — 2026-10-25 — Initial (wish-corp-moodissa-julkaistu-app-ulosp-in-vahdittuna-ja-listattun).
 */
import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { date } from '/js/format.js';
import { num } from './shared.js';
import { Section } from '/components/Section.js';
import { List, Row, Name, Who, Doors } from '/components/List.js';
import { Action } from '/components/Action.js';
import { Note } from '/components/Note.js';
import { Marks, Code } from '/components/Mark.js';
import { Choice } from '/components/Choice.js';
import { TextField } from '/components/TextField.js';
import { Fields, FormActions } from '/components/Field.js';
import { PickField } from '/components/PickField.js';
import { Space } from '/components/Layout.js';

const html = htm.bind(h);
/** One word of this page. */
export const O = (key, params) => t('admin.internetOpenings.' + key, params);

/** The three ways an app is opened, in the order the page offers them. */
const MODES = ['operator', 'self', 'off'];

/**
 * Who did a thing, in words: an account by its name, an agent as the owner's agent, an ecosystem app
 * as the owner's app, and nobody (the node closed it at its end date) as the node.
 */
export function whoWords(principal) {
  if (!principal || /^system@/.test(principal)) return O('who.node');
  const p = String(principal);
  const hash = p.indexOf('#');
  if (hash > 0) {
    const name = p.slice(0, hash);
    const owner = p.slice(hash + 1).split('@')[0];
    return name.startsWith('eco:')
      ? O('who.app', { app: name.slice(4), owner })
      : O('who.agent', { agent: name, owner });
  }
  return p.split('@')[0];
}

/** The forms as typewriter chips (`org/ws/form_id`), or the line that says there are none. */
export function formChips(forms) {
  if (!forms || !forms.length) return html`<${Note} kind="quiet" inline>${O('forms.none')}<//>`;
  return html`<${Marks}>${forms.map(f => html`<${Code} key=${`${f.org}/${f.ws}/${f.form_id}`}>${f.org}/${f.ws}/${f.form_id}<//>`)}<//>`;
}

/** The forms in one line of words, for a row's line. */
export function formsLine(forms) {
  return forms && forms.length ? forms.map(f => `${f.org}/${f.ws}/${f.form_id}`).join(', ') : O('forms.none');
}

/** "90 days", "1 day". */
export const daysWords = (n) => (n === 1 ? O('daysOne') : O('daysMany', { n: num(n) }));

/** How an open opening came to be open: who approved it, or that it needed nobody's approval. */
export function underWords(o) {
  switch (o.opened_under) {
    case 'operator-approval': return o.decided_by ? O('under.approvedBy', { who: whoWords(o.decided_by) }) : O('under.approved');
    case 'operator': return O('under.operator');
    case 'trusted-opener': return O('under.trusted');
    case 'self-mode': return O('under.self');
    default: return '';
  }
}

/** The status tone of a state's chip. */
export const stateTone = (state) => (state === 'open' ? 'fine' : state === 'requested' ? 'attention' : state === 'declined' ? 'danger' : 'off');

/**
 * "How apps are opened": the three choices with one sentence each, and the longest opening in days.
 * `onSet(path, value)` writes one setting and resolves true when the node saved it.
 */
export function ModeSection({ number, mode, maxDays, onSet, switchPage }) {
  const [days, setDays] = useState(String(maxDays));
  // A value saved here or on the Config page comes back with the list; the field shows it.
  useEffect(() => { setDays(String(maxDays)); }, [maxDays]);
  const daysValue = parseInt(days, 10);
  const daysOk = Number.isInteger(daysValue) && daysValue >= 1 && daysValue <= 365;
  const saveDays = () => { if (daysOk && daysValue !== maxDays) onSet('visibility.app_internet_opening_max_days', daysValue); };
  return html`
    <${Section} id="adm-io-mode" num=${number} title=${O('mode.title')}
      doors=${html`<${Action} small soft onClick=${() => switchPage('config')}>${O('mode.toConfig')}<//>`}>
      <${Note} kind="lead">${O('mode.lead')}<//>
      <${Choice} boxed dot cols=${3} name="adm-io-mode" ariaLabel=${O('mode.title')} value=${mode}
        onChange=${(v) => { if (v !== mode) onSet('visibility.app_internet_opening', v); }}
        options=${MODES.map(m => ({ value: m, label: O('mode.' + m), hint: O('mode.' + m + 'Hint') }))} />
      <${Space} above="section">
        <${Fields}>
          <${TextField} type="number" size="short" min=${1} max=${365} label=${O('mode.maxDays')}
            help="config.visibility.app_internet_opening_max_days" hint=${O('mode.maxDaysHint')}
            value=${days} invalid=${!daysOk} onInput=${setDays} onEnter=${saveDays}
            actions=${html`<${Action} small control disabled=${!daysOk || daysValue === maxDays} onClick=${saveDays}>${O('mode.save')}<//>`} />
        <//>
      <//>
    <//>`;
}

/** The form under the trusted owners: who, why, and until when (optional). */
function OpenerForm({ candidates, onGive }) {
  const [who, setWho] = useState(null);
  const [reason, setReason] = useState('');
  const [until, setUntil] = useState('');
  const [round, setRound] = useState(0);
  const ready = !!who && reason.trim().length >= 3;
  const give = async () => {
    if (!ready) return;
    if (await onGive(who, reason.trim(), until)) { setWho(null); setReason(''); setUntil(''); setRound(n => n + 1); }
  };
  return html`
    <${Space} above="section">
      <${Fields} cols=${3}>
        <${PickField} key=${round} keep label=${O('openers.who')} items=${candidates} placeholder=${O('openers.whoPlaceholder')}
          emptyLabel=${O('openers.allTrusted')} noMatchLabel=${O('openers.noMatch')}
          onPick=${(c) => setWho(c ? c.id : null)} onType=${() => { if (who) setWho(null); }} />
        <${TextField} label=${O('openers.reason')} value=${reason} maxLength=${500} placeholder=${O('openers.reasonPlaceholder')}
          onInput=${setReason} onEnter=${give} />
        <${TextField} type="date" label=${O('openers.until')} hint=${O('openers.untilHint')} value=${until} onInput=${setUntil} />
      <//>
      <${Space} above="large">
        <${FormActions} apart>
          <${Action} small control disabled=${!ready} onClick=${give}>${O('openers.give')}<//>
          <${Note} kind="hint" inline>${O('openers.formHint')}<//>
        <//>
      <//>
    <//>`;
}

/**
 * "May open on their own": the owners an operator trusts to open apps without asking (only while
 * the node's way is "an operator approves"), each with the reason, who gave the right and when, and
 * until when; "Remove the right" asks first. Under them the form that gives the right.
 */
export function OpenersSection({ number, openers, people, onGive, onRemove }) {
  const trusted = new Set(openers.map(o => o.owner));
  const candidates = people.filter(p => !trusted.has(p.id));
  return html`
    <${Section} id="adm-io-openers" num=${number} title=${O('openers.title')}>
      <${Note} kind="lead">${O('openers.lead')}<//>
      <${List} cols="name-who-doors" empty=${O('openers.none')}>
        ${openers.map(o => html`
          <${Row} key=${o.owner}>
            <${Name} desc=${o.reason ? `“${o.reason}”` : undefined}>${o.owner}<//>
            <${Who} sub=${o.until ? O('openers.untilDate', { date: date(o.until) }) : O('openers.noEnd')}>
              ${O('openers.grantedBy', { who: whoWords(o.granted_by), date: date(o.granted_at) })}
            <//>
            <${Doors}><${Action} small row tone="danger" onClick=${() => onRemove(o.owner)}>${O('openers.remove')}<//><//>
          <//>`)}
      <//>
      <${OpenerForm} candidates=${candidates} onGive=${onGive} />
    <//>`;
}
