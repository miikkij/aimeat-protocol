/**
 * @file appdev-tab.js
 * @description Profile → AppDev — the human-facing window into the AppDev knowledge base:
 *   (1) copyable start prompts (the research-first flow prompt for Claude Code/OpenHands +
 *   the canonical build-app prompt), (2) learned pitfalls with share/outdated/delete
 *   management and model/app attribution, (3) agent-proposed template proposals with
 *   derived-from links and proofs, (4) the curated node registry (read-only). Everything an
 *   owner needs to follow what agents learned and to start the next build right.
 * @structure AppDevTab (default export) — sections: StartPrompts · LearnedPitfalls ·
 *   TemplateProposals · CuratedPitfalls
 * @usage registered in views/profile.js TABS + landing-page.cards.js SIDEBAR_GROUPS (id 'appdev').
 * @version-history
 *   v1.0.0 — 2026-07-19 — initial (AppDev KB UI phase).
 *   v1.1.0 — 2026-08-08 — Copy labels now resolve from the shared common.copy / common.copied / common.copyPrompt /
 *       common.copyLink / common.copyUrl keys; the per-view copy label keys this file used were
 *       removed from both locales. Same words on screen.
 */
import { h } from 'preact';
import { useState, useEffect, useRef, useCallback } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { Spinner, KebabMenu } from './shared.js';
import { CopyButton } from '/components/CopyButton.js';
import { CardMenu } from '/components/CardMenu.js';
import { listOpenItems, addOpenItem, switchOff } from '/js/services/open-items.js';
import { swallowed } from '/js/swallowed.js';
import {
  getFlowPromptText, getBuildPromptText, getCuratedPitfalls, getLearnedPitfalls,
  updateLearnedPitfall, deleteLearnedPitfall, getTemplateProposals, deleteTemplateProposal,
} from '/js/services/appdev.js';

const SEV_CLASS = { critical: 'pf-adk-sev--critical', warn: 'pf-adk-sev--warn', info: 'pf-adk-sev--info' };

function sevBadge(severity) {
  return html`<span class="pf-adk-sev ${SEV_CLASS[severity] || SEV_CLASS.info}">${t('profile.appdev.severity.' + (severity || 'info'))}</span>`;
}

function chip(text, cls = '') {
  if (!text) return null;
  return html`<span class="pf-adk-chip ${cls}">${text}</span>`;
}

// ── Section 1: copyable start prompts ──────────────────────────────────────
function StartPrompts({ locale, showToast }) {
  const [flow, setFlow] = useState(null);
  const [build, setBuild] = useState(null);
  const [open, setOpen] = useState(null); // 'flow' | 'build' | null

  useEffect(() => {
    getFlowPromptText().then(setFlow).catch(() => setFlow(''));
    getBuildPromptText(locale).then(setBuild).catch(() => setBuild(''));
  }, [locale]);

  const box = (id, title, desc, text) => html`
    <div class="card pf-adk-prompt-card">
      <div class="pf-adk-prompt-head">
        <div>
          <div class="pf-adk-prompt-title">${title}</div>
          <div class="section-desc">${desc}</div>
        </div>
        <div class="pf-adk-prompt-actions">
          <button class="btn-ghost" onClick=${() => setOpen(open === id ? null : id)}>
            ${open === id ? t('profile.appdev.hidePrompt') : t('profile.appdev.showPrompt')}
          </button>
          ${text != null && html`<${CopyButton} text=${text} className="btn-primary" label=${t('common.copyPrompt')} onCopied=${() => showToast(t('profile.appdev.copied'))} />`}
        </div>
        ${/* The dots, in the same corner they are in on every other card. Building an app is the
             clearest case of something you decide to do now and get to later, and P12 names this
             surface. */''}
        <${PromptCardMenu} id=${id} title=${title} />
      </div>
      ${open === id && html`<pre class="pf-adk-prompt-body">${text ?? t('profile.loading')}</pre>`}
    </div>`;

  return html`
    <div class="section-title">${t('profile.appdev.promptsTitle')}</div>
    <div class="section-desc">${t('profile.appdev.promptsDesc')}</div>
    ${box('flow', t('profile.appdev.flowPromptTitle'), t('profile.appdev.flowPromptDesc'), flow)}
    ${box('build', t('profile.appdev.buildPromptTitle'), t('profile.appdev.buildPromptDesc'), build)}
  `;
}


/**
 * The corner menu for one prompt card: what state this piece of work is in, and the one thing you
 * can do about it from here.
 */
function PromptCardMenu({ id, title }) {
  const [item, setItem] = useState(null);
  const origin = `appdev.${id}`;

  const find = useCallback(async () => {
    try {
      const list = await listOpenItems();
      setItem(list.find(i => i.origin === origin) ?? null);
    // eslint-disable-next-line aimeat/no-silent-catch -- the card and its prompt work without the light
    } catch { /* no light, still a working card */ }
  }, [origin]);

  useEffect(() => { find(); }, [find]);
  useEffect(() => {
    const handler = () => find();
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
  }, [find]);

  const state = item?.status === 'working' ? 'working' : item ? 'open' : 'off';
  return html`<${CardMenu} state=${state} label=${title} actions=${[{
    label: item ? (t('openItems.toggleOff') || 'Take it off your open items')
                : (t('openItems.toggleOn') || 'Put it on your open items'),
    run: async () => {
      if (item) { await switchOff(item.id); setItem(null); }
      else { setItem(await addOpenItem({ title, kind: 'app', prompt_ref: id === 'build' ? 'build-app' : null, origin })); }
    },
  }]} />`;
}

// ── Section 2: learned pitfalls ────────────────────────────────────────────
function LearnedPitfalls({ showToast }) {
  const [data, setData] = useState(null);
  const [includeShared, setIncludeShared] = useState(false);
  const [showOutdated, setShowOutdated] = useState(false);
  const [expanded, setExpanded] = useState(null);

  async function load(shared = includeShared) {
    try { setData(await getLearnedPitfalls(shared)); } catch (err) { swallowed('appdev-tab', err); setData({ pitfalls: [], total: 0 }); }
  }
  const liveRef = useRef(load); liveRef.current = load;
  useEffect(() => { liveRef.current(includeShared); }, [includeShared]);
  useEffect(() => {
    const handler = () => liveRef.current();
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
  }, []);

  async function toggleShare(p) {
    try {
      await updateLearnedPitfall(p.category, p.slug, { share: !p.shared });
      showToast(!p.shared ? t('profile.appdev.sharedOn') : t('profile.appdev.sharedOff'));
      load();
    } catch (e) { showToast(e.message, true); }
  }
  async function toggleOutdated(p) {
    try {
      await updateLearnedPitfall(p.category, p.slug, { status: p.status === 'outdated' ? 'active' : 'outdated' });
      load();
    } catch (e) { showToast(e.message, true); }
  }
  async function remove(p) {
    try {
      await deleteLearnedPitfall(p.category, p.slug);
      showToast(t('profile.appdev.deleted'));
      load();
    } catch (e) { showToast(e.message, true); }
  }

  if (!data) return html`<${Spinner} text=${t('profile.loading')} />`;
  let rows = data.pitfalls;
  if (!showOutdated) rows = rows.filter(p => p.status !== 'outdated');

  return html`
    <div class="section-title">${t('profile.appdev.learnedTitle')}</div>
    <div class="section-desc">${t('profile.appdev.learnedDesc')}</div>
    <div class="pf-adk-filters">
      <label class="pf-adk-filter"><input type="checkbox" checked=${includeShared} onChange=${e => setIncludeShared(e.target.checked)} /> ${t('profile.appdev.showShared')}</label>
      <label class="pf-adk-filter"><input type="checkbox" checked=${showOutdated} onChange=${e => setShowOutdated(e.target.checked)} /> ${t('profile.appdev.showOutdated')}</label>
    </div>
    ${rows.length === 0 && html`<div class="card pf-adk-empty">${t('profile.appdev.learnedEmpty')}</div>`}
    ${rows.map(p => html`
      <div class="card pf-adk-row ${p.status === 'outdated' ? 'pf-adk-row--outdated' : ''}" key=${p.key + (p.owner || '')}>
        <div class="pf-adk-row-head" onClick=${() => setExpanded(expanded === p.key ? null : p.key)}>
          <div class="pf-adk-row-title">
            ${sevBadge(p.severity)}
            <span>${p.title}</span>
          </div>
          <div class="pf-adk-row-chips">
            ${chip(p.category, 'pf-adk-chip--cat')}
            ${chip(p.model, 'pf-adk-chip--model')}
            ${p.source === 'shared' && chip(t('profile.appdev.fromCommunity'), 'pf-adk-chip--shared')}
            ${p.source === 'own' && p.shared && chip(t('profile.appdev.sharedBadge'), 'pf-adk-chip--shared')}
            ${p.status === 'outdated' && chip(t('profile.appdev.outdatedBadge'), 'pf-adk-chip--outdated')}
          </div>
          ${p.source === 'own' && html`
            <${KebabMenu} label=${t('profile.appdev.actions')} items=${[
              { label: p.shared ? t('profile.appdev.unshare') : t('profile.appdev.share'), onClick: () => toggleShare(p) },
              { label: p.status === 'outdated' ? t('profile.appdev.markActive') : t('profile.appdev.markOutdated'), onClick: () => toggleOutdated(p) },
              { divider: true },
              { label: t('profile.appdev.delete'), danger: true, onClick: () => remove(p) },
            ]} />`}
        </div>
        ${expanded === p.key && html`
          <div class="pf-adk-row-body">
            <div><strong>${t('profile.appdev.symptom')}:</strong> ${p.symptom}</div>
            <div><strong>${t('profile.appdev.resolution')}:</strong> ${p.resolution}</div>
            ${p.app_ref && html`<div><strong>${t('profile.appdev.relatedApp')}:</strong> <code>${p.app_ref}</code></div>`}
            ${p.owner && html`<div><strong>${t('profile.appdev.sharedBy')}:</strong> <code>${p.owner}</code></div>`}
          </div>`}
      </div>`)}
  `;
}

// ── Section 3: template proposals ──────────────────────────────────────────
function TemplateProposals({ showToast }) {
  const [data, setData] = useState(null);
  const [expanded, setExpanded] = useState(null);

  async function load() {
    try { setData(await getTemplateProposals()); } catch (err) { swallowed('appdev-tab', err); setData({ templates: [], total: 0 }); }
  }
  useEffect(() => { load(); }, []);
  const liveRef = useRef(load); liveRef.current = load;
  useEffect(() => {
    const handler = () => liveRef.current();
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
  }, []);

  async function remove(tpl) {
    try {
      await deleteTemplateProposal(tpl.id);
      showToast(t('profile.appdev.deleted'));
      load();
    } catch (e) { showToast(e.message, true); }
  }

  if (!data) return html`<${Spinner} text=${t('profile.loading')} />`;

  return html`
    <div class="section-title">${t('profile.appdev.templatesTitle')}</div>
    <div class="section-desc">${t('profile.appdev.templatesDesc')}</div>
    ${data.templates.length === 0 && html`<div class="card pf-adk-empty">${t('profile.appdev.templatesEmpty')}</div>`}
    ${data.templates.map(tpl => html`
      <div class="card pf-adk-row" key=${tpl.id}>
        <div class="pf-adk-row-head" onClick=${() => setExpanded(expanded === tpl.id ? null : tpl.id)}>
          <div class="pf-adk-row-title">
            ${chip(tpl.tier, 'pf-adk-chip--tier')}
            <span>${tpl.title}</span>
          </div>
          <div class="pf-adk-row-chips">
            ${chip(tpl.model, 'pf-adk-chip--model')}
            ${chip(tpl.startMode, 'pf-adk-chip--cat')}
            ${(tpl.proofs || []).length > 0 && chip(t('profile.appdev.proofsCount', { count: tpl.proofs.length }), 'pf-adk-chip--proof')}
          </div>
          <${KebabMenu} label=${t('profile.appdev.actions')} items=${[
            { label: t('profile.appdev.openSourceApp'), onClick: () => window.open(`/v1/apps/${encodeURIComponent(tpl.derivedFrom.owner)}/${encodeURIComponent(tpl.derivedFrom.filename)}`, '_blank') },
            { divider: true },
            { label: t('profile.appdev.delete'), danger: true, onClick: () => remove(tpl) },
          ]} />
        </div>
        ${expanded === tpl.id && html`
          <div class="pf-adk-row-body">
            <div>${tpl.description}</div>
            <div><strong>${t('profile.appdev.derivedFrom')}:</strong> <code>${tpl.derivedFrom.owner}/${tpl.derivedFrom.filename}</code> v${tpl.derivedFrom.version}</div>
            <div><strong>${t('profile.appdev.reuseNotes')}:</strong> ${tpl.reuseNotes}</div>
            ${(tpl.packs || []).length > 0 && html`<div><strong>${t('profile.appdev.packs')}:</strong> ${tpl.packs.map(pk => chip(pk, 'pf-adk-chip--cat'))}</div>`}
            ${(tpl.proofs || []).length > 0 && html`
              <div><strong>${t('profile.appdev.proofs')}:</strong>
                ${tpl.proofs.map(pr => chip(`${pr.model}: ${pr.verdict}`, pr.verdict === 'pass' ? 'pf-adk-chip--proof' : 'pf-adk-chip--outdated'))}
              </div>`}
          </div>`}
      </div>`)}
  `;
}

// ── Section 4: curated registry (read-only) ────────────────────────────────
function CuratedPitfalls() {
  const [data, setData] = useState(null);
  const [filter, setFilter] = useState('');
  const [expanded, setExpanded] = useState(null);
  const [show, setShow] = useState(false);

  const dataRef = useRef(data); dataRef.current = data;
  useEffect(() => {
    if (show && !dataRef.current) getCuratedPitfalls().then(setData).catch(() => setData({ pitfalls: [], facets: {} }));
  }, [show]);

  const areas = data?.facets?.applies_to ? Object.keys(data.facets.applies_to) : [];
  let rows = data?.pitfalls ?? [];
  if (filter) rows = rows.filter(p => (p.appliesTo || []).includes(filter));

  return html`
    <div class="section-title">${t('profile.appdev.curatedTitle')}</div>
    <div class="section-desc">${t('profile.appdev.curatedDesc')}</div>
    ${!show && html`<button class="btn-outline" onClick=${() => setShow(true)}>${t('profile.appdev.showCurated')}</button>`}
    ${show && !data && html`<${Spinner} text=${t('profile.loading')} />`}
    ${show && data && html`
      <div class="pf-adk-filters">
        <button class="btn-ghost ${filter === '' ? 'pf-adk-filter--active' : ''}" onClick=${() => setFilter('')}>${t('profile.appdev.allAreas')}</button>
        ${areas.map(a => html`<button class="btn-ghost ${filter === a ? 'pf-adk-filter--active' : ''}" onClick=${() => setFilter(filter === a ? '' : a)}>${a} (${data.facets.applies_to[a]})</button>`)}
      </div>
      ${rows.map(p => html`
        <div class="card pf-adk-row" key=${p.id}>
          <div class="pf-adk-row-head" onClick=${() => setExpanded(expanded === p.id ? null : p.id)}>
            <div class="pf-adk-row-title">${sevBadge(p.severity)}<span>${p.title}</span></div>
            <div class="pf-adk-row-chips">${(p.appliesTo || []).map(a => chip(a, 'pf-adk-chip--cat'))}</div>
          </div>
          ${expanded === p.id && html`
            <div class="pf-adk-row-body">
              <div><strong>${t('profile.appdev.symptom')}:</strong> ${p.symptom}</div>
              <div><strong>${t('profile.appdev.resolution')}:</strong> ${p.fix}</div>
            </div>`}
        </div>`)}
    `}
  `;
}

// ── The tab ────────────────────────────────────────────────────────────────
export default function AppDevTab({ showToast, locale }) {
  return html`
    <div class="pf-adk">
      <div class="section-title">${t('profile.appdev.title')}</div>
      <div class="section-desc">${t('profile.appdev.desc')}</div>
      <${StartPrompts} locale=${locale} showToast=${showToast} />
      <${LearnedPitfalls} showToast=${showToast} />
      <${TemplateProposals} showToast=${showToast} />
      <${CuratedPitfalls} />
    </div>
  `;
}
