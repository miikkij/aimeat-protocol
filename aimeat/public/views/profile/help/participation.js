/**
 * @file public/views/profile/help/participation.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The "Taking part" view of the page Ask someone who knows: may others ask the person and
 *   about what (topics suggested from their business card, never from their private interview), who may
 *   ask, how often, their status, what their AI may do with a question, and whether they ask and let
 *   their AI ask for them. One save, PUT /v1/help/me. The design canvas board "Osallistuminen"
 *   (2026-11-14) is the model.
 * @structure Participation · TopicPicker
 * @usage html`<${Participation} me=${me} onSaved=${reload} showToast=${showToast} />` (views/profile/help-tab.js)
 * @version-history
 *   v1.0.0 — 2026-11-14 — Initial (wish-pyyd-apua-nodessa-yhteinen-avunpyynt-v-yl-ihmisille-ja-heid-).
 */
import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { swallowed } from '/js/swallowed.js';
import { saveHelpMe } from '/js/services/help.js';
import { Section } from '/components/Section.js';
import { Check } from '/components/Check.js';
import { Choice } from '/components/Choice.js';
import { Select } from '/components/Select.js';
import { TextField } from '/components/TextField.js';
import { Mark, Marks } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { Loud } from '/components/Action.js';
import { FormActions, Fields } from '/components/Field.js';
import { Stack } from '/components/Layout.js';

const html = htm.bind(h);
const x = (key, vars) => t(`help.page.${key}`, vars);
const same = (a, b) => a.toLowerCase() === b.toLowerCase();

/** The person's topics as removable tags, the card's suggestions as tags to add, and a field for their own. */
function TopicPicker({ topics, suggested, onChange }) {
  const [own, setOwn] = useState('');
  const add = (tp) => {
    const v = tp.trim();
    if (!v || topics.some((x2) => same(x2, v))) return;
    onChange([...topics, v]);
  };
  return html`
    <${Stack} gap="medium">
      <${Marks}>
        ${topics.map((tp) => html`<${Mark} key=${tp} onRemove=${() => onChange(topics.filter((x2) => x2 !== tp))} removeLabel=${x('removeTopic', { topic: tp })}>${tp}<//>`)}
        ${suggested.filter((s) => !topics.some((x2) => same(x2, s))).map((s) => html`
          <${Mark} key=${`s:${s}`} tone="dim" title=${x('addSuggested')} onClick=${() => add(s)}>+ ${s}<//>`)}
      <//>
      <${TextField} label=${x('ownTopic')} value=${own} onInput=${setOwn}
        onEnter=${() => { add(own); setOwn(''); }} />
    <//>`;
}

/** @param {{ me: any, onSaved: () => void, showToast?: (m: string) => void }} props */
export function Participation({ me, onSaved, showToast }) {
  const p = me.participant;
  const [form, setForm] = useState(p);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => setForm(p), [p]);
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const autoAllowed = me.node?.aiAutoAllowed !== false;

  const save = async () => {
    setBusy(true); setError('');
    try {
      await saveHelpMe({
        helper: form.helper, asker: form.asker, topics: form.topics, audience: form.audience,
        cap_per_week: Number(form.capPerWeek), status: form.status, status_until: form.statusUntil || '',
        ai_mode: form.aiMode, auto_topics: form.autoTopics.filter((a) => form.topics.some((tp) => same(tp, a))),
        ai_may_send: form.aiMaySend, agents_may_ask: form.agentsMayAsk,
      });
      showToast?.(x('saved'));
      onSaved?.();
    } catch (err) { swallowed('help participation: save', err); setError(err?.message || x('saveFailed')); }
    finally { setBusy(false); }
  };

  return html`
    <${Section} id="hp-me" num="04" title=${x('secMe')}>
      <${Stack} gap="section">
        <${Note} kind="lead">${x('meLead')}<//>

        <${Stack} gap="medium">
          <${Check} checked=${form.helper} onChange=${(v) => set({ helper: v })} help="help.helper">${x('helper')}<//>
          ${form.helper ? html`
            <${Note} kind="hint">${x('topicsHint')}<//>
            <${TopicPicker} topics=${form.topics} suggested=${me.suggestedTopics ?? []} onChange=${(topics) => set({ topics })} />
            <${Choice} label=${x('audience')} value=${form.audience} onChange=${(v) => set({ audience: v })}
              options=${[['node', x('audienceNode')], ['organisms', x('audienceOrganisms')]]} />
            <${Fields} cols=${2}>
              <${Select} label=${x('cap')} help="help.cap_per_week" value=${String(form.capPerWeek)} onChange=${(v) => set({ capPerWeek: Number(v) })}
                options=${[1, 2, 3, 5, 10, 20].map((n) => [String(n), x('capOption', { n })])} />
              <${Select} label=${x('status')} value=${form.status} onChange=${(v) => set({ status: v })}
                options=${[['available', x('statusAvailable')], ['busy', x('statusBusy')], ['away', x('statusAway')]]} />
            <//>
          ` : null}
        <//>

        ${form.helper ? html`
          <${Stack} gap="medium">
            <${Choice} boxed dot label=${x('aiMode')} help="help.ai_mode" value=${form.aiMode} onChange=${(v) => set({ aiMode: v })}
              options=${[
                { value: 'off', label: x('aiOff'), hint: x('aiOffHint') },
                { value: 'draft', label: x('aiDraft'), hint: x('aiDraftHint') },
                ...(autoAllowed ? [{ value: 'auto', label: x('aiAuto'), hint: x('aiAutoHint') }] : []),
              ]} />
            ${form.aiMode === 'auto' ? html`
              <${Note} kind="hint">${x('autoTopicsHint')}<//>
              <${Marks}>
                ${form.topics.map((tp) => {
                  const on = form.autoTopics.some((a) => same(a, tp));
                  return html`<${Mark} key=${tp} tone=${on ? 'sun' : 'dim'} onClick=${() => set({ autoTopics: on ? form.autoTopics.filter((a) => !same(a, tp)) : [...form.autoTopics, tp] })}>${on ? '✓ ' : ''}${tp}<//>`;
                })}
              <//>` : null}
          <//>` : null}

        <${Stack} gap="medium">
          <${Check} checked=${form.asker !== false} onChange=${(v) => set({ asker: v })}>${x('asker')}<//>
          ${form.asker !== false ? html`
            <${Check} checked=${form.aiMaySend} onChange=${(v) => set({ aiMaySend: v })}>${x('aiMaySend')}<//>
            <${Check} checked=${form.agentsMayAsk} onChange=${(v) => set({ agentsMayAsk: v })}>${x('agentsMayAsk')}<//>` : null}
        <//>

        <${Note} kind="hint">${x('operatorSees')}<//>
        ${error ? html`<${Note} kind="message" error>${error}<//>` : null}
        <${FormActions}><${Loud} control disabled=${busy} onClick=${save}>${x('save')}<//><//>
      <//>
    <//>`;
}
