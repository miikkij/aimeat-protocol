/**
 * @file public/views/admin/help-tab.settings.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The Settings view of Admin › Ask someone who knows: the help.* config rows
 *   (services/config/schema-help.ts), grouped as the design canvas board "Asetukset-apu" (2026-11-14)
 *   groups them, read from GET /v1/admin/config?section=help and saved with one PUT /v1/admin/config.
 *   Every setting has its question mark (`help.<setting>`), whose words are in explain.help.*.
 * @structure GROUPS · SettingControl · HelpSettings
 * @usage html`<${HelpSettings} showOk=${showOk} showErr=${showErr} />` (views/admin/help-tab.js)
 * @version-history
 *   v1.0.0 — 2026-11-14 — Initial (wish-pyyd-apua-nodessa-yhteinen-avunpyynt-v-yl-ihmisille-ja-heid-).
 */
import { h } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { apiGet, apiPut } from '/js/api.js';
import { onLiveUpdate } from '/lib/live-updates.js';
import { swallowed } from '/js/swallowed.js';
import { Section } from '/components/Section.js';
import { Check } from '/components/Check.js';
import { Select } from '/components/Select.js';
import { TextField, TextArea } from '/components/TextField.js';
import { Fields, FormActions } from '/components/Field.js';
import { Loud } from '/components/Action.js';
import { Note } from '/components/Note.js';
import { Stack } from '/components/Layout.js';

const html = htm.bind(h);
const x = (key, vars) => t(`admin.help.${key}`, vars);

/** The settings by group, in the order the operator reads them. */
const GROUPS = [
  { id: 'general', keys: ['enabled', 'participation', 'board_enabled'] },
  { id: 'defaults', keys: ['asker_default', 'helper_default', 'cap_per_week_default', 'ai_auto_allowed'] },
  { id: 'morsels', keys: ['reward_enabled', 'reward', 'reward_knowledge', 'reward_ai', 'reward_monthly_cap', 'reward_pair_cap'] },
  { id: 'times', keys: ['question_days', 'reroute_hours', 'review_months', 'topic_review_days'] },
  { id: 'report', keys: ['report_cadence', 'report_writer', 'report_reads', 'report_recipients', 'report_retention_months', 'backlog_workspace', 'report_prompt'] },
  { id: 'extensions', keys: ['routing_extension'] },
];

function SettingControl({ k, field, value, onChange }) {
  const label = x(`set.${k}`);
  const help = `help.${k}`;
  const disabled = field.editable === false;
  if (field.type === 'boolean') return html`<${Check} checked=${!!value} disabled=${disabled} help=${help} onChange=${onChange}>${label}<//>`;
  if (field.choices) {
    return html`<${Select} label=${label} help=${help} disabled=${disabled} value=${String(value ?? '')} onChange=${onChange}
      options=${field.choices.map((c) => [c, x(`choice.${k}.${c}`)])} />`;
  }
  if (k === 'report_prompt') return html`<${TextArea} label=${label} help=${help} disabled=${disabled} rows=${5} value=${value ?? ''} onInput=${onChange} />`;
  if (Array.isArray(value) || k === 'report_recipients') {
    return html`<${TextField} label=${label} help=${help} disabled=${disabled} value=${Array.isArray(value) ? value.join(', ') : (value ?? '')}
      onInput=${(v) => onChange(v.split(',').map((s) => s.trim()).filter(Boolean))} />`;
  }
  if (field.type === 'integer' || field.type === 'number') {
    return html`<${TextField} label=${label} help=${help} disabled=${disabled} type="number" value=${String(value ?? '')} onInput=${(v) => onChange(v === '' ? '' : Number(v))} />`;
  }
  return html`<${TextField} label=${label} help=${help} disabled=${disabled} value=${value ?? ''} onInput=${onChange} />`;
}

/** @param {{ showOk: (m: string) => void, showErr: (m: string) => void }} props */
export function HelpSettings({ showOk, showErr }) {
  const [schema, setSchema] = useState(null);
  const [draft, setDraft] = useState({});
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      const r = await apiGet('/v1/admin/config?section=help');
      setSchema(r?.data?.schema ?? {});
      setDraft({});
    } catch (e) { swallowed('admin help: settings', e); setSchema({}); }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => onLiveUpdate(['config'], () => load()), [load]);

  if (!schema) return html`<${Note} kind="loading" />`;
  const valueOf = (k) => (k in draft ? draft[k] : schema[`help.${k}`]?.value);
  const changed = Object.keys(draft);
  const save = async () => {
    setBusy(true);
    try {
      const r = await apiPut('/v1/admin/config', { changes: changed.map((k) => ({ path: `help.${k}`, value: draft[k] })) });
      const errors = r?.data?.errors ?? [];
      if (errors.length) showErr(errors.map((e) => e.message || e.path).join('; '));
      else showOk(x('saved'));
      await load();
    } catch (e) { swallowed('admin help: save', e); showErr(e?.message || t('common.error')); }
    finally { setBusy(false); }
  };

  return html`
    <${Stack} gap="section">
      ${GROUPS.map((g, i) => html`
        <${Section} key=${g.id} id=${`ah-${g.id}`} num=${String(i + 1).padStart(2, '0')} title=${x(`group.${g.id}`)}>
          <${Note} kind="hint">${x(`groupHint.${g.id}`)}<//>
          <${Fields} cols=${g.id === 'general' || g.id === 'defaults' ? 1 : 2}>
            ${g.keys.filter((k) => schema[`help.${k}`]).map((k) => html`
              <${SettingControl} key=${k} k=${k} field=${schema[`help.${k}`]} value=${valueOf(k)}
                onChange=${(v) => setDraft((d) => ({ ...d, [k]: v }))} />`)}
          <//>
        <//>`)}
      <${FormActions}>
        <${Loud} control disabled=${busy || changed.length === 0} onClick=${save}>${x('save')}<//>
      <//>
      ${changed.length ? html`<${Note} kind="quiet">${x('unsaved', { n: changed.length })}<//>` : null}
    <//>`;
}
