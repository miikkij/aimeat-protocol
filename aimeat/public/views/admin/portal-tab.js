/**
 * @file portal-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Admin Portal page in the poster face (design canvas "AIMEAT Admin Portal"): what a
 *   visitor sees right now, the parts of the page beside a preview, which version wins, the links
 *   in the top menu, the operator's own HTML page, the saved texts, the paste for their own AI, and
 *   what changed.
 *
 *   THE PAGE ANSWERS IN THE ORDER SOMEONE ASKS. Section 01 says what visitors get and whether it is
 *   the default, the operator's arrangement or their own HTML, before anything can be changed. The
 *   seven cards this page used to be were all the same size and told the operator nothing about
 *   which of them mattered.
 *
 *   THE WORDS ARE PLAIN, ON PURPOSE. "Default", "your own layout", "your own HTML page", "texts you
 *   have saved". Someone who runs a node once a month should not have to work out what a sentence
 *   means (Jouni, 2026-09-12: "miksei toi voi puhua normaalia").
 *
 *   ONE DARK BUTTON, AND IT FOLLOWS YOU. The arrangement waits for Save, and the pinned row keeps
 *   the count of unsaved changes and the button itself under the topbar wherever you have scrolled.
 *   Every other save on this page belongs to something else and says so: a text is written the
 *   moment you press Add, and the menu has its own button.
 * @structure PortalTab (default) · RightNow · Strip · the section components from
 *   portal-tab.sections.js · PartsList/AddPart from portal-tab.parts.js · PagePreview
 * @usage Mounted by the admin dashboard tab router.
 * @version-history
 *   v3.0.0 — 2026-09-27 — Library components only (admin group G2): Section, Verdict and Readings,
 *     FigureStrip, SettingBox, Tabs (view) for the three pages, the library's SaveBar for the pinned
 *     row and Beside `stick` for the preview that follows the scroll, Loud and Action for the
 *     buttons. The page sheet admin-portal.css goes; the page writes no class.
 *   2026-09-13 -- Compose the shared aside role and its documented cuts.
 *   v2.1.0 — 2026-09-13 — Compose shared poster headings and external note spacing.
 *   v2.0.0 — 2026-09-12 — The poster face: eight numbered sections in the order an operator asks,
 *     the parts beside the page with the same numbers on both, the precedence ladder on screen for
 *     the first time, the pinned save row, and plain words throughout.
 *   v1.6.0 — 2026-08-31 — The preview shows the page being edited, not the operator's own home.
 *   v1.5.0 — 2026-08-29 — `exchange` leaves the configurable header links.
 *   v1.4.0 — 2026-06-19 — Header navigation section.
 *   v1.3.0 — 2026-06-03 — Portal memory keys write to the site namespace; AI bundle import.
 *   v1.2.0 — 2026-06-03 — Active-source status and "Load current page".
 *   v1.1.0 — 2026-06-02 — Admin design unification.
 */
import { h, Fragment } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { escHtml, copyToClipboard } from '/js/utils.js';
import { onLiveUpdate } from '/lib/live-updates.js';
import { num, dt, Badge, Spinner, useToast, Toast } from './shared.js';
import { useConfirm } from '/components/Modal.js';
import { Section } from '/components/Section.js';
import { Verdict, Readings } from '/components/Readings.js';
import { FigureStrip } from '/components/FigureStrip.js';
import { Tinted } from '/components/Figure.js';
import { Action, Actions, Loud } from '/components/Action.js';
import { Note } from '/components/Note.js';
import { SettingBox } from '/components/Box.js';
import { Tabs } from '/components/Tabs.js';
import { SaveBar } from '/components/SaveBar.js';
import { Beside, Stack, Space } from '/components/Layout.js';
import { swallowed } from '/js/swallowed.js';
import {
  saveSiteTemplate, deleteSiteTemplate, clearSiteCache,
  getSiteMemoryKeys, getSitePrompt, setSiteMemory, deleteSiteMemory,
  importSiteBundle, triggerLbSync, getHeaderNav, saveHeaderNav,
  getSurfaceLayout, saveSurfaceLayout, revertSurfaceLayout, resetSurfaceLayout,
  listLayoutVersions, restoreLayout, getSurfaceBlocks, getLayoutPrompt, importSurfaceLayout,
} from '/js/services/admin.js';
import { PartsList, AddPart, freeKey } from './portal-tab.parts.js';
import { PagePreview } from './portal-tab.preview.js';
import { WhichVersion, MenuLinks, OwnHtml, SavedTexts, AskAi, WhatChanged } from './portal-tab.sections.js';

const html = htm.bind(h);
const P = (key, params) => t('admin.portal.' + key, params);

/**
 * The three pages an operator can arrange. The front page is the one this tab always had; the two
 * member pages arrived with the layout engine, and they live here rather than in a tab of their own
 * because the editor, the preview, the prompt and the change log are the same for all three.
 */
const SURFACES = ['portal', 'home', 'home-onboarding'];

/**
 * Public header link ids → their nav i18n label key (mirror of PUBLIC_NAV_LINKS in spa.html and
 * PUBLIC_NAV_LINK_IDS in src/services/site.ts). Gated links are not configurable. These are the
 * LOGGED-OUT bar (plus Help, which shows in both states); a signed-in person's links are forced by
 * the session and the role.
 */
const HEADER_LINK_LABELS = {
  howItWorks: 'nav.howItWorks',
  learn: 'nav.learn',
  business: 'nav.business',
  help: 'nav.help',
};

/** Section 01: the word, the sentence, and the five rows behind it. */
function RightNow({ facts, number, onOpenPage, onClearCache }) {
  const { hasCustom, source, parts, hidden, texts, navTotal, navHidden, baseUrl, lastChange, cacheTtl } = facts;
  const word = hasCustom ? P('now.wordHtml') : source === 'stored' ? P('now.wordYours') : P('now.wordDefault');
  // "and 0 of them are hidden" is a sentence nobody would write, and neither is "1 of them are",
  // so nothing-hidden and one-hidden each get their own line rather than a number dropped into one.
  const suffix = hidden === 0 ? 'None' : hidden === 1 ? 'One' : '';
  const key = (hasCustom ? 'lineHtml' : source === 'stored' ? 'lineYours' : 'lineDefault') + suffix;
  const line = P('now.' + key, { n: num(parts), hidden: num(hidden) });
  return html`
    <${Section} first id="adm-pt-now" num=${number} title=${P('now.title')}
      doors=${html`
        <${Action} small soft onClick=${onOpenPage}>${P('now.openPage')}<//>
        <${Action} small soft onClick=${onClearCache}>${P('now.clearCache')}<//>`}>
      <${Verdict} word=${word} line=${line} stamp=${html`${baseUrl}<br />${lastChange}`}>
        <${Readings} rows=${[
          { key: 'page', name: P('now.pageRow'), why: P('now.pageWhy'),
            mark: hasCustom
              ? html`<${Badge} type="info" label=${P('now.badgeHtml')} />`
              : source === 'stored'
                ? html`<${Badge} type="healthy" label=${P('now.badgeYours')} />`
                : html`<${Badge} type="info" label=${P('now.badgeDefault')} />`,
            value: baseUrl },
          { key: 'layout', name: P('now.layoutRow'), why: source === 'stored' ? P('now.layoutWhyYours') : P('now.layoutWhyDefault'),
            mark: source === 'stored'
              ? html`<${Badge} type="healthy" label=${P('now.badgeSaved')} />`
              : html`<${Badge} type="muted" label=${P('now.badgeNotSaved')} />`,
            value: P('now.partsValue', { n: num(parts) }) },
          { key: 'html', name: P('now.htmlRow'), why: hasCustom ? P('now.htmlWhyYes') : P('now.htmlWhyNo'),
            mark: hasCustom
              ? html`<${Badge} type="healthy" label=${P('now.badgeHtml')} />`
              : html`<${Badge} type="muted" label=${P('now.badgeNone')} />`,
            value: '__site_template__' },
          { key: 'menu', name: P('now.menuRow'), why: P('now.menuWhy'),
            mark: navHidden > 0
              ? html`<${Badge} type="info" label=${P('now.badgeHidden', { n: num(navHidden) })} />`
              : html`<${Badge} type="healthy" label=${P('now.badgeAllShown')} />`,
            value: P('now.menuValue', { n: num(navTotal) }) },
          { key: 'texts', name: P('now.textsRow'), why: P('now.textsWhy'),
            mark: texts > 0
              ? html`<${Badge} type="info" label=${P('now.badgeTexts', { n: num(texts) })} />`
              : html`<${Badge} type="muted" label=${P('now.badgeNone')} />`,
            value: 'portal/*', last: true },
        ]} />
      <//>
      <${FigureStrip} wrap items=${[
        { key: 'parts', n: num(parts), label: P('strip.parts'), sub: P('strip.partsSub') },
        { key: 'hidden', n: num(hidden), label: P('strip.hidden'), sub: P('strip.hiddenSub') },
        { key: 'texts', n: num(texts), label: P('strip.texts'), sub: P('strip.textsSub') },
        { key: 'delay', n: `${cacheTtl} s`, label: P('strip.delay'), sub: P('strip.delaySub') },
      ]} />
    <//>`;
}

export default function PortalTab({ data, reload }) {
  const [surface, setSurface] = useState('portal');
  const [toast, showErr, showOk, clearToast] = useToast();
  const { confirm, ConfirmUI } = useConfirm();

  const p = data.portal || {};
  const meta = p.meta || {};
  const tmpl = p.template || {};
  const changes = (p.changelog?.entries) || [];
  const isLb = meta.lb_mode?.enabled;
  const hasCustom = !!meta.has_custom_template;

  // The layout of the page being arranged, and what this node can put on it.
  const [blocks, setBlocks] = useState(null);
  const [catalog, setCatalog] = useState([]);
  const [passages, setPassages] = useState({});
  const [source, setSource] = useState('default');
  const [problems, setProblems] = useState([]);
  const [openPart, setOpenPart] = useState(null);
  // How many changes are waiting. A count of edits rather than a diff: the operator asked for
  // "three unsaved changes", and three moves that happen to end where they started are still three
  // things this page did and the node has not been told about.
  const [pending, setPending] = useState(0);
  const [touched, setTouched] = useState(() => new Set());
  const unsaved = pending + touched.size;
  const dirty = unsaved > 0;
  const [saving, setSaving] = useState(false);
  const [showPending, setShowPending] = useState(false);
  const [versions, setVersions] = useState(null);

  const [template, setTemplate] = useState(tmpl.template || '');
  const [memKeys, setMemKeys] = useState(null);
  const [newKey, setNewKey] = useState('');
  const [newVal, setNewVal] = useState('');
  const [paste, setPaste] = useState('');
  const [navLinks, setNavLinks] = useState(null);
  const [navSaving, setNavSaving] = useState(false);
  // Bumped after any change so the preview re-fetches the page instead of showing a cached copy.
  const [previewNonce, setPreviewNonce] = useState(0);
  const bumpPreview = () => setPreviewNonce(n => n + 1);

  const loadLayout = useCallback(async () => {
    try {
      const [layoutRes, blocksRes] = await Promise.all([getSurfaceLayout(surface), getSurfaceBlocks(surface)]);
      setBlocks(layoutRes.data?.layout?.blocks ?? []);
      setPassages(layoutRes.data?.freeform ?? {});
      setSource(layoutRes.data?.source ?? 'default');
      setProblems(layoutRes.data?.problems ?? []);
      setCatalog(blocksRes.data?.blocks ?? []);
      setPending(0);
      setTouched(new Set());
      setVersions(null);
    } catch (err) {
      swallowed('portal-tab: layout', err);
      showErr(err.message);
      setBlocks([]);
    }
    // showErr comes from useToast and is stable for the life of this component; listing it would
    // re-create the loader on every toast and re-fetch the page underneath the operator.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [surface]);

  const loadMemKeys = useCallback(async () => {
    try {
      const res = await getSiteMemoryKeys();
      setMemKeys(res.data?.keys || []);
    } catch (err) { swallowed('portal-tab: texts', err); setMemKeys([]); }
  }, []);

  const loadNav = useCallback(async () => {
    try {
      const res = await getHeaderNav();
      const order = res.data?.order || Object.keys(HEADER_LINK_LABELS);
      const hidden = new Set(res.data?.hidden || []);
      setNavLinks(order.filter(id => HEADER_LINK_LABELS[id]).map(id => ({ id, visible: !hidden.has(id) })));
    } catch (err) { swallowed('portal-tab: menu', err); setNavLinks([]); }
  }, []);

  useEffect(() => { loadLayout(); }, [loadLayout]);
  useEffect(() => { loadMemKeys(); loadNav(); }, [loadMemKeys, loadNav]);
  useEffect(() => onLiveUpdate(['config', 'features'], () => { loadMemKeys(); }), [loadMemKeys]);

  // ── the arrangement: everything here is local until Save ──
  const edit = (fn) => { setBlocks(bs => fn(bs.slice())); setPending(c => c + 1); };
  const move = (idx, dir) => edit(bs => {
    const j = idx + dir;
    if (j < 0 || j >= bs.length) return bs;
    [bs[idx], bs[j]] = [bs[j], bs[idx]];
    return bs;
  });
  const toggleHidden = (idx) => edit(bs => { bs[idx] = { ...bs[idx], hidden: !bs[idx].hidden }; return bs; });
  const removePart = (idx) => edit(bs => { bs.splice(idx, 1); return bs; });
  const setProp = (idx, name, value) => edit(bs => {
    const props = { ...(bs[idx].props ?? {}) };
    if (value === undefined) delete props[name]; else props[name] = value;
    bs[idx] = { ...bs[idx], ...(Object.keys(props).length ? { props } : { props: undefined }) };
    return bs;
  });
  const addPart = (id) => edit(bs => [...bs, { id, key: freeKey(bs, id) }]);
  // Typing counts as ONE waiting change however many keys are pressed: a per-keystroke count would
  // read as a runaway number and say nothing.
  const setPassage = (key, value) => {
    setPassages(ps => ({ ...ps, [key]: value }));
    setTouched(prev => (prev.has(key) ? prev : new Set(prev).add(key)));
  };

  async function saveLayout() {
    setSaving(true);
    try {
      // Passages travel inline on their part; the node splits them out to their own records.
      const payload = blocks.map(b => (b.id === 'common.freeform' && passages[b.key] !== undefined
        ? { ...b, body: passages[b.key] }
        : b));
      await saveSurfaceLayout(surface, { v: 1, blocks: payload });
      showOk(P('saved'));
      setPending(0);
      setTouched(new Set());
      setShowPending(false);
      await loadLayout();
      bumpPreview();
    } catch (e) { showErr(e.message); }
    finally { setSaving(false); }
  }

  const undoAll = () => confirm(P('undoAsk'), async () => { await loadLayout(); bumpPreview(); });

  const startFromDefault = () => confirm(P('resetAsk'), async () => {
    try { await resetSurfaceLayout(surface); await loadLayout(); bumpPreview(); showOk(P('resetDone')); }
    catch (e) { showErr(e.message); }
  });

  const backToDefault = () => confirm(P('revertAsk'), async () => {
    try { await revertSurfaceLayout(surface); await loadLayout(); bumpPreview(); showOk(P('revertDone')); }
    catch (e) { showErr(e.message); }
  }, { danger: true });

  async function showVersions() {
    try { const r = await listLayoutVersions(surface); setVersions(r.data?.versions ?? []); }
    catch (e) { showErr(e.message); }
  }

  const goBackTo = (version) => confirm(P('log.restoreAsk'), async () => {
    try { await restoreLayout(surface, version); await loadLayout(); bumpPreview(); showOk(P('log.restoreDone')); }
    catch (e) { showErr(e.message); }
  });

  // ── the menu above the page: its own list, its own button ──
  const toggleNav = (id) => setNavLinks(links => links.map(l => (l.id === id ? { ...l, visible: !l.visible } : l)));
  const moveNav = (idx, dir) => setNavLinks(links => {
    const next = links.slice();
    const j = idx + dir;
    if (j < 0 || j >= next.length) return next;
    [next[idx], next[j]] = [next[j], next[idx]];
    return next;
  });
  async function saveNav() {
    if (!navLinks) return;
    setNavSaving(true);
    try {
      await saveHeaderNav(navLinks.map(l => l.id), navLinks.filter(l => !l.visible).map(l => l.id));
      showOk(P('menu.saved'));
      bumpPreview();
    } catch (e) { showErr(e.message); }
    finally { setNavSaving(false); }
  }

  // ── the operator's own HTML page ──
  async function saveTemplate() {
    // The AI paste produces a JSON bundle, not raw HTML. If that was pasted here, the template
    // route would answer 422 — point at the section that takes it instead.
    if (template.trimStart().startsWith('{')) { showErr(P('html.looksLikeJson')); return; }
    try { await saveSiteTemplate(template); bumpPreview(); reload(); showOk(P('html.saved')); }
    catch (e) { showErr(e.message); }
  }
  async function loadCurrentAsTemplate() {
    const run = async () => {
      try {
        const resp = await fetch('/', { headers: { Accept: 'text/html' }, cache: 'no-store' });
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        setTemplate(await resp.text());
        showOk(P('html.loaded'));
      } catch (e) { showErr(e.message); }
    };
    if (template && template.trim()) confirm(P('html.loadAsk'), run); else run();
  }
  function downloadTemplate() {
    if (!template) return;
    const blob = new Blob([template], { type: 'text/html' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'portal-template.html';
    a.click();
  }
  const deleteTemplate = () => confirm(P('html.deleteAsk'), async () => {
    try { await deleteSiteTemplate(); setTemplate(''); bumpPreview(); reload(); showOk(P('html.deleted')); }
    catch (e) { showErr(e.message); }
  }, { danger: true });

  // ── the saved texts ──
  async function addText() {
    if (!newKey.trim()) return;
    try {
      await setSiteMemory(newKey.trim(), newVal);
      setNewKey(''); setNewVal('');
      showOk(P('texts.saved'));
      loadMemKeys(); bumpPreview();
    } catch (e) { showErr(e.message); }
  }
  const deleteText = (key) => confirm(P('texts.deleteAsk', { key }), async () => {
    try { await deleteSiteMemory(key); loadMemKeys(); bumpPreview(); }
    catch (e) { showErr(e.message); }
  }, { danger: true });

  // ── the paste for an operator whose AI cannot reach this node ──
  async function copyLayoutPrompt() {
    try { await copyToClipboard(await getLayoutPrompt(surface)); showOk(P('ai.copied')); }
    catch (e) { showErr(e.message); }
  }
  async function copySitePrompt() {
    try {
      const res = await getSitePrompt();
      await copyToClipboard(res.data?.prompt || '');
      showOk(P('ai.copied'));
    } catch (e) { showErr(e.message); }
  }
  async function applyPaste() {
    let bundle;
    try { bundle = JSON.parse(paste); }
    catch { showErr(P('ai.invalid')); return; }
    if (!bundle || typeof bundle !== 'object') { showErr(P('ai.invalid')); return; }
    try {
      if (bundle.layout) {
        await importSurfaceLayout(bundle);
        await loadLayout();
      } else if (bundle.template || bundle.memory || bundle.kv) {
        const res = await importSiteBundle(bundle);
        const d = res.data || {};
        if (typeof bundle.template === 'string') setTemplate(bundle.template);
        showOk(P('ai.appliedBundle', {
          template: d.template_stored ? 1 : 0,
          memory: d.memory_keys_written || 0,
          kv: d.kv_pairs_updated || 0,
        }));
        loadMemKeys();
        reload();
      } else { showErr(P('ai.invalid')); return; }
      setPaste('');
      bumpPreview();
      if (bundle.layout) showOk(P('ai.applied'));
    } catch (e) { showErr(e.message); }
  }

  async function doClearCache() {
    try { await clearSiteCache(); bumpPreview(); showOk(P('now.cacheCleared')); }
    catch (e) { showErr(e.message); }
  }
  async function doLbSync() {
    try {
      const res = await triggerLbSync();
      const d = res.data || {};
      showOk(P('lb.synced', { template: d.template_updated ? 1 : 0, memory: d.memory_keys_synced || 0 }));
      reload();
    } catch (e) { showErr(e.message); }
  }

  if (blocks === null) {
    return html`
      ${toast && html`<${Toast} ...${toast} onDismiss=${clearToast} />`}
      <${Spinner} text=${t('dashboard.loading')} />`;
  }

  const hiddenCount = blocks.filter(b => b.hidden).length;
  const facts = {
    hasCustom,
    source,
    parts: blocks.length,
    hidden: hiddenCount,
    texts: (memKeys ?? []).length,
    navTotal: (navLinks ?? []).length,
    navHidden: (navLinks ?? []).filter(l => !l.visible).length,
    baseUrl: meta.base_url || '/',
    cacheTtl: meta.cache_ttl_seconds ?? 0,
    lastChange: changes[0]
      ? P('now.lastChange', { when: dt(changes[0].changed_at || changes[0].changedAt), who: changes[0].changed_by || changes[0].changedBy || '-' })
      : P('now.noChange'),
  };

  // The numbers run in the order the sections are rendered, so a page with fewer sections (a member
  // page has no menu, no HTML of its own and no texts) still counts 01, 02, 03 rather than skipping.
  let counter = 0;
  const n = () => String(++counter).padStart(2, '0');
  const isPortal = surface === 'portal';
  const openPage = () => window.open(hasCustom ? '/' : '/v1/portal', '_blank', 'noopener');

  return html`
    <${Fragment}>
      ${toast && html`<${Toast} ...${toast} onDismiss=${clearToast} />`}
      <${Note} kind="hint">${P('intro', { url: meta.base_url || '/' })}<//>

      ${isLb && html`
        <${SettingBox} label=${P('lb.title')}>
          ${P('lb.lead', { origin: escHtml(meta.lb_mode.origin_url || '-') })}
          <${Space} above="medium">
            <${Actions}>
              <${Action} small soft onClick=${doLbSync}>${P('lb.sync')}<//>
              <${Note} kind="hint" inline>${meta.lb_mode.last_sync ? P('lb.lastSync', { when: dt(meta.lb_mode.last_sync) }) : P('lb.never')}<//>
            <//>
          <//>
        <//>`}

      <${SaveBar} label=${P('save')}>
        <${Loud} control disabled=${saving || !dirty} onClick=${saveLayout}>
          ${saving ? P('saving') : P('save')}
        <//>
        ${dirty
          ? html`
            <${Tinted} strong tone="notice">${unsaved === 1 ? P('unsavedOne') : P('unsaved', { n: num(unsaved) })}<//>
            <${Action} small soft expanded=${showPending} onClick=${() => setShowPending(s => !s)}>
              ${showPending ? P('hideWhat') : P('seeWhat')}
            <//>
            <${Action} small soft onClick=${undoAll}>${P('undo')}<//>`
          : html`<${Note} kind="hint" inline>${P('nothingUnsaved')}<//>`}
        ${dirty && html`<${Note} kind="hint" inline>${P('unsavedNote')}<//>`}
      <//>

      ${showPending && dirty && html`
        <${Note} kind="aside">
          <${Stack} list gap="none">
            ${blocks.map((b, i) => html`<span key=${b.key}>${i + 1}. ${b.id}${b.hidden ? ` · ${P('parts.chipHidden')}` : ''}</span>`)}
          <//>
        <//>`}

      <${RightNow} facts=${facts} number=${n()} onOpenPage=${openPage} onClearCache=${doClearCache} />

      <${Section} id="adm-pt-parts" num=${n()} title=${P('parts.title')}
        doors=${html`
          <${Action} small soft onClick=${startFromDefault}>${P('parts.startDefault')}<//>
          ${source === 'stored' && html`
            <${Action} small soft tone="danger" onClick=${backToDefault}>${P('parts.backDefault')}<//>`}`}>

        <${Tabs} kind="view" value=${surface} label=${P('parts.title')}
          onSelect=${(s) => { setSurface(s); setOpenPart(null); }}
          items=${SURFACES.map(s => ({ value: s, label: P('surface.' + s) }))} />
        <${Note} kind="hint">${P('surface.' + surface + 'Note')}<//>

        ${problems.length > 0 && html`
          <${SettingBox} label=${P('parts.leftOut')}>
            <${Stack} list gap="tight">
              ${problems.map((pr, i) => html`<span key=${i}>${pr}</span>`)}
            <//>
          <//>`}

        <${Beside} wide stick side=${html`
          <${PagePreview} surface=${surface} hasCustom=${hasCustom} nonce=${previewNonce}
            unsaved=${unsaved} shown=${blocks.filter(b => !b.hidden).length} />`}>
          <${PartsList} blocks=${blocks} catalog=${catalog} passages=${passages} open=${openPart}
            onOpen=${setOpenPart} onMove=${move} onToggle=${toggleHidden} onRemove=${removePart}
            onProp=${setProp} onPassage=${setPassage} />
          <${AddPart} catalog=${catalog} blocks=${blocks} onAdd=${addPart} />
        <//>
      <//>

      ${isPortal && html`
        <${WhichVersion} hasCustom=${hasCustom} source=${source} parts=${blocks.length} number=${n()} />
        <${MenuLinks} links=${navLinks} labels=${HEADER_LINK_LABELS} saving=${navSaving}
          onToggle=${toggleNav} onMove=${moveNav} onSave=${saveNav} number=${n()} />
        <${OwnHtml} hasCustom=${hasCustom} updatedAt=${tmpl.updated_at} template=${template}
          onTemplate=${setTemplate} onSave=${saveTemplate} onLoadCurrent=${loadCurrentAsTemplate}
          onDownload=${downloadTemplate} onDelete=${deleteTemplate} number=${n()} />
        <${SavedTexts} memKeys=${memKeys} kv=${meta.kv} newKey=${newKey} newVal=${newVal}
          onKey=${setNewKey} onVal=${setNewVal} onAdd=${addText} onDelete=${deleteText} number=${n()} />`}

      <${AskAi} paste=${paste} onPaste=${setPaste} onCopyLayout=${copyLayoutPrompt}
        onCopySite=${copySitePrompt} onApply=${applyPaste} busy=${saving} number=${n()} />

      <${WhatChanged} changes=${changes} versions=${versions} onVersions=${showVersions}
        onRestore=${goBackTo} number=${n()} />

      <${ConfirmUI} />
    <//>`;
}
