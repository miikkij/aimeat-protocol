/**
 * @file public/views/admin/prompts-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Admin System Prompts page in the poster face (design canvas "AIMEAT Admin System
 *   Prompts", direction A): what is running now, the list and the open prompt side by side, what
 *   taking the current version does, and what changed lately.
 *
 *   THE PAGE OPENED WITH EIGHTY-EIGHT PROMPTS AND NO SEARCH. Eleven accordions, all open, four
 *   counters that said 88/88/0/11, and the one destructive button in red near the top. Finding a
 *   prompt meant reading the page.
 *
 *   TAKING THE CURRENT VERSION IS THE EVERYDAY BUTTON, NOT THE EMERGENCY ONE. The software keeps
 *   improving these texts; for a prompt that is the operator's own, taking the current version is
 *   the only way a newer one gets into use. It sits on the open prompt and on every group heading,
 *   in the ordinary underline. Only the whole-site one is coral, because only it clears the version
 *   histories.
 *
 *   THREE KINDS OF PROMPT, AND THE PAGE SAYS WHICH. `source_kind` comes from the node: 'code' is
 *   rewritten from source on every boot, 'yours' is never touched by an update, and 'orphan' is one
 *   the software no longer ships, which cannot be reset at all. An operator used to learn the first
 *   of those by watching an hour's work vanish at the next deploy.
 * @structure PromptsTab (default) · RightNow · TakingCurrent · WhatChanged
 * @usage Mounted by the admin dashboard tab router.
 * @version-history
 *   v2.0.0 — 2026-09-12 — The poster face: four numbered sections, search over eighty-eight
 *     prompts, the list beside the editor, the three kinds on screen, the languages this site
 *     serves instead of Finnish alone, and the group reset kept one press away.
 *   v1.1.0 — 2026-09-09 — GROUP_NAMES covers every seeded group.
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import { h } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { useViewCSS } from '/components/useViewCSS.js';
import { onLiveUpdate } from '/lib/live-updates.js';
import { num, dt, Badge, Spinner, useToast, Toast } from './shared.js';
import { useConfirm } from '/components/Modal.js';
import { swallowed } from '/js/swallowed.js';
import {
  getSystemPrompts, getSystemPrompt, updateSystemPrompt,
  resetSystemPrompt, resetAllSystemPrompts, resetPromptGroup, getPromptVersions, restorePromptVersion,
} from '/js/services/admin.js';
import { PromptList, groupLabel } from './prompts-tab.list.js';
import { PromptEditor } from './prompts-tab.editor.js';

const html = htm.bind(h);
const P = (key, params) => t('admin.prompts.' + key, params);

/** Section 01: the word, the sentence, and the five rows behind it. */
function RightNow({ facts, number, onShowChanged }) {
  const word = facts.changed > 0 ? P('now.wordEdited') : P('now.wordFactory');
  const line = facts.changed === 0
    ? P('now.lineFactory', { n: num(facts.all) })
    : P('now.lineEdited', { n: num(facts.all), changed: num(facts.changed), code: num(facts.changedCode) });
  const row = (title, why, chip, value, last) => html`
    <div class=${'adm-mrow' + (last ? ' adm-mrow--last' : '')}>
      <span><b>${title}</b><span class="adm-why">${why}</span></span>
      <span>${chip}</span>
      <span class="adm-mval">${value}</span>
    </div>`;
  return html`
    <section class="og-sec og-sec--first" id="adm-pr-now">
      <div class="og-sec-h"><h2>${P('now.title')}<small>${number}</small></h2>
        <div class="og-doors">
          <button type="button" class="og-door og-door--quiet" onClick=${onShowChanged}>${P('now.showChanged')}</button>
        </div></div>
      <div class="adm-ov-grid">
        <div>
          <div class="adm-ov-status">${word}</div>
          <p class="adm-alert-line">${line}</p>
          <div class="adm-ov-up">${P('now.groups', { n: num(facts.groups) })}<br />${facts.lastChange}</div>
        </div>
        <div>
          ${row(P('now.yoursRow'), P('now.yoursWhy'),
            html`<${Badge} type=${facts.changedYours > 0 ? 'watch' : 'muted'}
              label=${P('now.ofValue', { n: num(facts.changedYours), total: num(facts.yours) })} />`,
            P('now.compared'))}
          ${row(P('now.codeRow'), P('now.codeWhy'),
            html`<${Badge} type=${facts.changedCode > 0 ? 'critical' : 'muted'}
              label=${P('now.ofValue', { n: num(facts.changedCode), total: num(facts.code) })} />`,
            P('now.everyBoot'))}
          ${row(P('now.orphanRow'), P('now.orphanWhy'),
            html`<${Badge} type=${facts.orphan > 0 ? 'critical' : 'healthy'} label=${num(facts.orphan)} />`,
            P('now.noFactory'))}
          ${row(P('now.offRow'), P('now.offWhy'),
            facts.off > 0
              ? html`<${Badge} type="critical" label=${num(facts.off)} />`
              : html`<${Badge} type="healthy" label=${P('now.none')} />`,
            '404')}
          ${row(P('now.langRow'), P('now.langWhy'),
            html`<${Badge} type=${facts.translated > 0 ? 'info' : 'muted'}
              label=${P('now.ofValue', { n: num(facts.translated), total: num(facts.all) })} />`,
            'Accept-Language', true)}
        </div>
      </div>
      <div class="og-strip">
        <div><b>${num(facts.all)}</b><span>${P('strip.prompts')}</span><small>${P('strip.promptsSub')}</small></div>
        <div><b class="adm-pr-coral">${num(facts.changed)}</b><span>${P('strip.changed')}</span><small>${P('strip.changedSub')}</small></div>
        <div><b>${num(facts.code)}</b><span>${P('strip.code')}</span><small>${P('strip.codeSub')}</small></div>
        <div><b>${num(facts.orphan)}</b><span>${P('strip.orphan')}</span><small>${P('strip.orphanSub')}</small></div>
      </div>
    </section>`;
}

/** Section 03: what the everyday button does, and the one that is not safe. */
function TakingCurrent({ facts, number, onResetAll }) {
  const step = (n, key, value, last) => html`
    <div class=${'adm-pr-step' + (last ? ' adm-pr-step--last' : '')}>
      <span class="adm-pr-stepn">${n}</span>
      <span><b>${P('taking.' + key)}</b><span class="adm-why">${P('taking.' + key + 'Why')}</span></span>
      <span class="adm-mval">${value}</span>
    </div>`;
  return html`
    <section class="og-sec" id="adm-pr-taking">
      <div class="og-sec-h"><h2>${P('taking.title')}<small>${number}</small></h2></div>
      <p class="adm-pr-lead">${P('taking.lead')}</p>
      ${step(1, 'writes', P('taking.keepsHistory'))}
      ${step(2, 'languages', P('taking.worthAWarning'))}
      ${step(3, 'group', P('taking.wholeGroup'))}
      ${step(4, 'orphan', P('taking.orphanValue', { n: num(facts.orphan) }), true)}
      <div class="og-box" style="margin-top: 16px">
        <span class="og-box-label">${P('taking.dangerLabel')}</span>
        ${P('taking.danger')}
        <div class="og-doors" style="margin-top: 10px">
          <button type="button" class="og-door og-door--quiet og-door--danger" onClick=${onResetAll}>${P('taking.takeAll')}</button>
        </div>
      </div>
    </section>`;
}

/** Section 04: what changed lately, across every group. */
function WhatChanged({ prompts, number, onOpen }) {
  const recent = prompts
    .filter(p => p.differs_from_default || p.version > 1)
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
    .slice(0, 8);
  return html`
    <section class="og-sec" id="adm-pr-log">
      <div class="og-sec-h"><h2>${P('log.title')}<small>${number}</small></h2></div>
      ${recent.length === 0
        ? html`<p class="adm-pr-note">${P('log.none')}</p>`
        : recent.map((p, i) => html`
          <div class=${'adm-mrow' + (i === recent.length - 1 ? ' adm-mrow--last' : '')} key=${p.id}>
            <span>
              <b>${p.name}</b>
              <span class="adm-why">${groupLabel(p.group)} · ${p.differs_from_default ? P('log.differs') : P('log.matches')}</span>
            </span>
            <span><button type="button" class="og-door og-door--quiet" onClick=${() => onOpen(p.id)}>${P('log.open')}</button></span>
            <span class="adm-mval">v${num(p.version)} · ${dt(p.updatedAt)} · ${p.updatedBy || '-'}</span>
          </div>`)}
    </section>`;
}

export default function PromptsTab({ data }) {
  useViewCSS('/css/views/admin-prompts.css');
  const [toast, showErr, showOk, clearToast] = useToast();
  const { confirm, ConfirmUI } = useConfirm();

  const [prompts, setPrompts] = useState(data?.systemPrompts?.prompts || []);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [openId, setOpenId] = useState(null);
  const [open, setOpen] = useState(null);
  const [draft, setDraft] = useState({ content: '', locales: {}, changeNote: '' });
  const [versions, setVersions] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await getSystemPrompts();
      setPrompts(res.data?.prompts || []);
    } catch (e) { swallowed('prompts-tab: list', e); showErr(e.message); }
    // showErr is stable for the life of this component; listing it would re-create the loader on
    // every toast and re-read the page underneath the operator.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => onLiveUpdate(['config'], () => load()), [load]);

  /** Open one prompt: its own read, its versions, and a draft the operator can type into. */
  const openPrompt = useCallback(async (id) => {
    setOpenId(id);
    setLoading(true);
    setVersions(null);
    try {
      const res = await getSystemPrompt(id);
      const p = res.data.prompt;
      setOpen(p);
      setDraft({ content: p.content, locales: { ...(p.locales || {}) }, changeNote: '' });
    } catch (e) {
      swallowed('prompts-tab: open', e);
      showErr(e.message);
      setOpen(null);
    }
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setDraftField = (field, value) => setDraft(d => ({ ...d, [field]: value }));
  const setLocale = (tag, value) => setDraft(d => ({ ...d, locales: { ...d.locales, [tag]: value } }));

  /** One write, one re-read of the list, one word to the operator. */
  async function write(fn, word) {
    setSaving(true);
    try {
      const res = await fn();
      const p = res.data?.prompt;
      if (p) {
        setOpen(p);
        setDraft({ content: p.content, locales: { ...(p.locales || {}) }, changeNote: '' });
      }
      if (versions !== null && openId) {
        const v = await getPromptVersions(openId);
        setVersions(v.data?.versions || []);
      }
      await load();
      showOk(typeof word === 'string' ? P(word) : word);
    } catch (e) {
      // The refusal is in the toast and the boxes keep what was typed.
      swallowed('prompts-tab: write', e);
      showErr(e.message);
    }
    setSaving(false);
  }

  const save = () => write(() => updateSystemPrompt(openId, {
    content: draft.content,
    locales: draft.locales,
    active: open.active,
    ...(draft.changeNote ? { changeNote: draft.changeNote } : {}),
  }), 'saved');

  const toggleActive = () => {
    const turningOff = open.active;
    const run = () => write(() => updateSystemPrompt(openId, { active: !open.active }), turningOff ? 'switchedOff' : 'switchedOn');
    if (turningOff) confirm(P('switchOffAsk', { name: open.name }), run, { danger: true });
    else run();
  };

  const takeCurrent = () => confirm(
    P('takeOneAsk', { name: open.name }) + (hasLocales(open) ? ' ' + P('takeDropsLanguages') : ''),
    () => write(() => resetSystemPrompt(openId), 'took'),
  );

  const takeGroup = (group, n) => confirm(
    P('takeGroupAsk', { group: groupLabel(group), n: num(n) }),
    async () => {
      setSaving(true);
      try {
        const res = await resetPromptGroup(group);
        const d = res.data || {};
        await load();
        if (openId) await openPrompt(openId);
        showOk(P('tookGroup', {
          n: num(d.resetCount || 0),
          group: groupLabel(group),
          on: num(d.switchedOn || 0),
          langs: num(d.localesDropped || 0),
        }));
      } catch (e) { swallowed('prompts-tab: group', e); showErr(e.message); }
      setSaving(false);
    },
  );

  const takeAll = () => confirm(P('takeAllAsk'), async () => {
    setSaving(true);
    try {
      await resetAllSystemPrompts();
      setOpenId(null); setOpen(null); setVersions(null);
      await load();
      showOk(P('tookAll'));
    } catch (e) { swallowed('prompts-tab: all', e); showErr(e.message); }
    setSaving(false);
  }, { danger: true });

  async function showVersions() {
    try {
      const v = await getPromptVersions(openId);
      setVersions(v.data?.versions || []);
    } catch (e) { showErr(e.message); }
  }

  const restore = (version) => confirm(P('restoreAsk', { v: num(version) }),
    () => write(() => restorePromptVersion(openId, version), 'restored'));

  const hasLocales = (p) => !!(p && p.locales && Object.values(p.locales).some(v => typeof v === 'string' && v.length > 0));

  // ── the page's own arithmetic, from the two fields the node sends ──
  const facts = {
    all: prompts.length,
    changed: prompts.filter(p => p.differs_from_default).length,
    yours: prompts.filter(p => p.source_kind === 'yours').length,
    changedYours: prompts.filter(p => p.source_kind === 'yours' && p.differs_from_default).length,
    code: prompts.filter(p => p.source_kind === 'code').length,
    changedCode: prompts.filter(p => p.source_kind === 'code' && p.differs_from_default).length,
    orphan: prompts.filter(p => p.source_kind === 'orphan').length,
    off: prompts.filter(p => !p.active).length,
    translated: prompts.filter(hasLocales).length,
    groups: new Set(prompts.map(p => p.group)).size,
  };
  const newest = prompts.slice().sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))[0];
  facts.lastChange = newest
    ? P('now.lastChange', { when: dt(newest.updatedAt), who: newest.updatedBy || '-' })
    : P('now.noChange');

  const needle = query.trim().toLowerCase();
  const shown = prompts.filter(p => {
    if (filter === 'changed' && !p.differs_from_default) return false;
    if (filter === 'off' && p.active) return false;
    if (filter === 'orphan' && p.source_kind !== 'orphan') return false;
    if (!needle) return true;
    return (p.name || '').toLowerCase().includes(needle)
      || (p.id || '').toLowerCase().includes(needle)
      || (p.description || '').toLowerCase().includes(needle)
      || (p.usedIn || []).some(u => String(u).toLowerCase().includes(needle))
      || (p.content || '').toLowerCase().includes(needle);
  });

  if (prompts.length === 0) {
    return html`
      ${toast && html`<${Toast} ...${toast} onDismiss=${clearToast} />`}
      <${Spinner} text=${t('dashboard.loading')} />`;
  }

  let counter = 0;
  const n = () => String(++counter).padStart(2, '0');

  return html`
    <div class="adm-pr">
      ${toast && html`<${Toast} ...${toast} onDismiss=${clearToast} />`}
      <p class="adm-pr-intro">${P('intro')}</p>

      <${RightNow} facts=${facts} number=${n()} onShowChanged=${() => { setFilter('changed'); setQuery(''); }} />

      <section class="og-sec" id="adm-pr-find">
        <div class="og-sec-h"><h2>${P('find.title')}<small>${n()}</small></h2>
          <div class="og-doors"><span class="adm-pr-note">${P('find.count', { n: num(shown.length), total: num(facts.all) })}</span></div></div>
        <div class="adm-pr-bench">
          <${PromptList} prompts=${shown} counts=${{ all: facts.all, changed: facts.changed, off: facts.off, orphan: facts.orphan }}
            query=${query} filter=${filter} openId=${openId}
            onQuery=${setQuery} onFilter=${setFilter} onOpen=${openPrompt} onResetGroup=${takeGroup} />
          <${PromptEditor} prompt=${open} draft=${draft} versions=${versions} saving=${saving} loading=${loading}
            onDraft=${setDraftField} onLocale=${setLocale} onSave=${save} onTakeCurrent=${takeCurrent}
            onToggleActive=${toggleActive} onVersions=${showVersions} onRestore=${restore} />
        </div>
      </section>

      <${TakingCurrent} facts=${facts} number=${n()} onResetAll=${takeAll} />
      <${WhatChanged} prompts=${prompts} number=${n()} onOpen=${openPrompt} />

      <${ConfirmUI} />
    </div>`;
}
