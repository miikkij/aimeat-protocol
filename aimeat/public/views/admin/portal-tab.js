/**
 * @file portal-tab.js
 * @description Admin dashboard Portal tab — landing-page template editor,
 *   site memory keys, KV pairs, AI prompt, and changelog (with LB-mode banner).
 * @structure PortalTab (default)
 * @usage Mounted by the admin dashboard tab router.
 * @version-history
 *   v1.1.0 — 2026-06-02 — Admin design unification: raw template textarea →
 *     adm-textarea adm-input-full (drop inline mono/border/background styles).
 *   v1.2.0 — 2026-06-03 — Active-source status (custom template vs built-in SPA)
 *     + "Load current page" button that seeds the editor with the live / HTML.
 *   v1.3.0 — 2026-06-03 — Fix portal memory keys writing to the wrong namespace
 *     (now /v1/site/memory → __site__ so {{memory:portal/*}} resolves); add AI
 *     bundle import (/v1/site/import) so the AI-Assisted result no longer 422s in
 *     the template box; reload the preview iframe after every change + Clear Cache.
 *   v1.4.0 — 2026-06-19 — Add Header Navigation section: operator show/hide + reorder
 *     of the public header links (persisted via /v1/site/header-nav).
 */
import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml, copyToClipboard } from '/js/utils.js';
import { dt, Badge, ExpandableHelp, useToast, Toast } from './shared.js';
import {
  saveSiteTemplate, deleteSiteTemplate, clearSiteCache,
  getSiteMemoryKeys, getSitePrompt, setSiteMemory, deleteSiteMemory,
  importSiteBundle, triggerLbSync, getHeaderNav, saveHeaderNav,
} from '/js/services/admin.js';
import { useConfirm } from '/components/Modal.js';
import { swallowed } from '/js/swallowed.js';

// Public header link ids → their nav i18n label key (mirror of PUBLIC_NAV_LINKS in spa.html
// and PUBLIC_NAV_LINK_IDS in src/services/site.ts). Gated links are not configurable.
// These are the LOGGED-OUT bar (plus Help, which shows in both states). A signed-in person's
// links — Apps, Profile, Admin — are forced by the session and role, and the pages that left
// the header on 2026-08-09 (For Developers, Members) are site-footer links now, so neither set
// appears here.
const HEADER_LINK_LABELS = {
  howItWorks: 'nav.howItWorks',
  // learn/exchange render only when this node configured AIMEAT_SITE_LEARN_URL /
  // AIMEAT_SITE_EXCHANGE_URL; hiding them here is a second, independent switch.
  learn: 'nav.learn',
  exchange: 'nav.exchange',
  business: 'nav.business',
  help: 'nav.help',
};

export default function PortalTab({ data, reload }) {
  const [toast, showErr, showOk, clearToast] = useToast();
  const p = data.portal || {};
  const meta = p.meta || {};
  const tmpl = p.template || {};
  const changes = (p.changelog?.entries) || [];
  const isLb = meta.lb_mode?.enabled;
  const hasCustom = !!meta.has_custom_template;

  const { confirm, ConfirmUI } = useConfirm();
  const [template, setTemplate] = useState(tmpl.template || '');
  const [memKeys, setMemKeys] = useState(null);
  const [newKey, setNewKey] = useState('');
  const [newVal, setNewVal] = useState('');
  const [aiBundle, setAiBundle] = useState('');
  // Header nav: ordered list of { id, visible }. null while loading.
  const [navLinks, setNavLinks] = useState(null);
  const [navSaving, setNavSaving] = useState(false);
  // Bumped after any change so the preview iframe re-fetches `/` (busts browser cache).
  const [previewNonce, setPreviewNonce] = useState(0);
  const bumpPreview = () => setPreviewNonce(n => n + 1);

  useEffect(() => { loadMemKeys(); loadNav(); }, []);

  async function loadMemKeys() {
    try {
      const res = await getSiteMemoryKeys();
      setMemKeys(res.data?.keys || []);
    } catch (err) { swallowed('portal-tab', err); setMemKeys([]); }
  }

  async function loadNav() {
    try {
      const res = await getHeaderNav();
      const order = res.data?.order || Object.keys(HEADER_LINK_LABELS);
      const hidden = new Set(res.data?.hidden || []);
      setNavLinks(order
        .filter(id => HEADER_LINK_LABELS[id])
        .map(id => ({ id, visible: !hidden.has(id) })));
    } catch (err) { swallowed('portal-tab', err); setNavLinks([]); }
  }

  function toggleNav(id) {
    setNavLinks(links => links.map(l => l.id === id ? { ...l, visible: !l.visible } : l));
  }

  function moveNav(idx, dir) {
    setNavLinks(links => {
      const next = links.slice();
      const j = idx + dir;
      if (j < 0 || j >= next.length) return next;
      [next[idx], next[j]] = [next[j], next[idx]];
      return next;
    });
  }

  async function saveNav() {
    if (!navLinks) return;
    setNavSaving(true);
    try {
      const order = navLinks.map(l => l.id);
      const hidden = navLinks.filter(l => !l.visible).map(l => l.id);
      await saveHeaderNav(order, hidden);
      showOk(t('dashboard.portalNavSaved'));
      bumpPreview();
    } catch (e) { showErr(e.message); }
    finally { setNavSaving(false); }
  }

  async function saveTemplate() {
    // The AI-Assisted prompt produces a JSON import bundle, not raw HTML. If the
    // user pasted that here, the template route would 422 — point them to Import.
    if (template.trimStart().startsWith('{')) {
      showErr(t('dashboard.portalSaveLooksLikeJson'));
      return;
    }
    try { await saveSiteTemplate(template); bumpPreview(); reload(); }
    catch (e) { showErr(e.message); }
  }

  async function importAiBundle() {
    let bundle;
    try { bundle = JSON.parse(aiBundle); }
    catch { showErr(t('dashboard.portalImportInvalid')); return; }
    if (!bundle || typeof bundle !== 'object' || (!bundle.template && !bundle.memory && !bundle.kv)) {
      showErr(t('dashboard.portalImportInvalid'));
      return;
    }
    try {
      const res = await importSiteBundle(bundle);
      const d = res.data || {};
      const parts = [];
      if (d.template_stored) parts.push('template');
      if (d.memory_keys_written) parts.push(d.memory_keys_written + ' memory');
      if (d.kv_pairs_updated) parts.push(d.kv_pairs_updated + ' KV');
      showOk(t('dashboard.portalImportDone').replace('{summary}', parts.join(', ') || '—'));
      if (typeof bundle.template === 'string') setTemplate(bundle.template);
      setAiBundle('');
      loadMemKeys();
      bumpPreview();
      reload();
    } catch (e) { showErr(e.message); }
  }

  async function loadCurrentAsTemplate() {
    const run = async () => {
      try {
        const resp = await fetch('/', { headers: { Accept: 'text/html' }, cache: 'no-store' });
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        setTemplate(await resp.text());
        showOk(t('dashboard.portalLoadedCurrent'));
      } catch (e) { showErr(e.message); }
    };
    if (template && template.trim()) {
      confirm(t('dashboard.portalLoadCurrentConfirm'), run);
    } else {
      run();
    }
  }

  function downloadTemplate() {
    if (!template) return;
    const blob = new Blob([template], { type: 'text/html' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = 'portal-template.html'; a.click();
  }

  function resetTemplate() {
    confirm(t('dashboard.portalResetDefault') + '?', async () => {
      try { await deleteSiteTemplate(); setTemplate(''); bumpPreview(); reload(); }
      catch (e) { showErr(e.message); }
    }, { danger: true });
  }

  async function doClearCache() {
    try { await clearSiteCache(); bumpPreview(); } catch (e) { showErr(e.message); }
  }

  async function addMem() {
    if (!newKey.trim()) return;
    try {
      await setSiteMemory(newKey.trim(), newVal);
      setNewKey(''); setNewVal('');
      showOk(t('dashboard.portalMemorySaved'));
      loadMemKeys(); bumpPreview();
    } catch (e) { showErr(e.message); }
  }

  function delMem(key) {
    confirm(t('dashboard.portalDeleteKeyConfirm').replace('{key}', key), async () => {
      try { await deleteSiteMemory(key); loadMemKeys(); bumpPreview(); }
      catch (e) { showErr(e.message); }
    }, { danger: true });
  }

  async function copyPrompt() {
    try {
      const res = await getSitePrompt();
      const prompt = res.data?.prompt || 'No prompt available';
      await copyToClipboard(prompt);
      showOk(t('dashboard.portalAiCopied'));
    } catch (e) { showErr(e.message); }
  }

  async function doLbSync() {
    try {
      const res = await triggerLbSync();
      const d = res.data || {};
      showOk(t('dashboard.portalLbSyncDone') + ' (template: ' + (d.template_updated ? 'yes' : 'no') + ', memory: ' + (d.memory_keys_synced || 0) + ')');
      reload();
    } catch (e) { showErr(e.message); }
  }

  const kv = meta.kv || {};
  const kvKeys = Object.keys(kv);

  return html`
    ${toast && html`<${Toast} ...${toast} onDismiss=${clearToast} />`}
    <p class="adm-text-dim adm-mb-lg">${t('dashboard.portalDesc')}</p>

    <!-- LB mode banner -->
    ${isLb && html`
      <div class="adm-card adm-mb-lg" style="border:1px solid #eab308">
        <h3>\u{1F504} ${t('dashboard.portalLbMode')}</h3>
        <p class="adm-text-dim adm-mb-sm">${t('dashboard.portalLbReadOnly')}</p>
        <div class="adm-erow"><span class="adm-elabel">${t('dashboard.portalLbOrigin')}</span><span class="adm-eval">${escHtml(meta.lb_mode.origin_url || '-')}</span></div>
        <div class="adm-erow"><span class="adm-elabel">${t('dashboard.portalLbLastSync')}</span><span class="adm-eval">${meta.lb_mode.last_sync ? dt(meta.lb_mode.last_sync) : '-'}</span></div>
        ${meta.lb_mode.last_error && html`<div class="adm-erow"><span class="adm-elabel">${t('dashboard.portalLbError')}</span><span class="adm-text-error">${escHtml(meta.lb_mode.last_error)}</span></div>`}
        <button class="adm-btn-action adm-mt-sm" onClick=${doLbSync}>\u{1F504} ${t('dashboard.portalLbSyncNow')}</button>
      </div>
    `}

    <!-- Preview -->
    <div class="adm-card">
      <h3>${t('dashboard.portalPreview')}</h3>
      <iframe src=${'/?_preview=' + previewNonce} style="width:100%;height:400px;border:1px solid var(--glass-border);border-radius:8px;background:#fff" sandbox="allow-same-origin allow-scripts"></iframe>
      <div class="adm-flex adm-mt-sm">
        <button class="adm-btn-action" onClick=${doClearCache}>\u{1F6AB} ${t('dashboard.portalClearCache')}</button>
      </div>
    </div>

    <!-- Header navigation -->
    <div class="adm-card">
      <h3>${t('dashboard.portalNavTitle')}</h3>
      <p class="adm-text-dim adm-text-base adm-mb-sm">${t('dashboard.portalNavExplain')}</p>
      ${navLinks === null
        ? html`<div class="adm-text-dim">${t('dashboard.loading')}...</div>`
        : html`
          <table>
            <thead><tr>
              <th>${t('dashboard.portalNavLink')}</th>
              <th>${t('dashboard.portalNavVisible')}</th>
              <th>${t('dashboard.portalNavOrder')}</th>
            </tr></thead>
            <tbody>
              ${navLinks.map((l, idx) => html`<tr key=${l.id}>
                <td>${t(HEADER_LINK_LABELS[l.id]) || l.id}</td>
                <td>
                  <label class="adm-flex-center">
                    <input type="checkbox" checked=${l.visible} onChange=${() => toggleNav(l.id)} />
                    <span class="adm-text-dim">${l.visible ? t('dashboard.portalNavShown') : t('dashboard.portalNavHidden')}</span>
                  </label>
                </td>
                <td>
                  <button class="adm-btn-sm" disabled=${idx === 0} onClick=${() => moveNav(idx, -1)} title=${t('dashboard.portalNavMoveUp')}>↑</button>
                  <button class="adm-btn-sm" disabled=${idx === navLinks.length - 1} onClick=${() => moveNav(idx, 1)} title=${t('dashboard.portalNavMoveDown')}>↓</button>
                </td>
              </tr>`)}
            </tbody>
          </table>
          <div class="adm-flex adm-mt-sm">
            <button class="adm-btn-action" disabled=${navSaving} onClick=${saveNav}>\u{1F4BE} ${t('dashboard.portalNavSave')}</button>
          </div>
        `}
    </div>

    <!-- Template editor -->
    <div class="adm-card">
      <h3>${t('dashboard.portalTemplate')}</h3>
      <div class="adm-erow">
        <span class="adm-elabel">${t('dashboard.portalActiveSource')}</span>
        <span class="adm-eval">
          ${hasCustom
            ? html`<span class="adm-badge adm-badge-active">${t('dashboard.portalCustomActive')}</span>${tmpl.updated_at ? html` · ${dt(tmpl.updated_at)}` : ''}`
            : html`<span class="adm-badge adm-badge-info">${t('dashboard.portalDefaultActive')}</span>`}
        </span>
      </div>
      <p class="adm-text-dim adm-text-base adm-mb-sm">
        ${hasCustom
          ? t('dashboard.portalCustomExplain')
          : t('dashboard.portalDefaultExplain').replace('{action}', t('dashboard.portalLoadCurrent'))}
      </p>
      <div class="adm-mb-sm">
        <button class="adm-btn-action" onClick=${loadCurrentAsTemplate}>\u{1F4C4} ${t('dashboard.portalLoadCurrent')}</button>
      </div>
      <${ExpandableHelp} title=${t('dashboard.portalTagHelpTitle')}>
        <p>${t('dashboard.portalTagHelpDetail')}</p>
        <table>
          <thead><tr><th>Tag</th><th>${t('dashboard.details')}</th></tr></thead>
          <tbody>
            <tr><td><code>\{\{config:node_id\}\}</code></td><td>${t('dashboard.tagExConfig')}</td></tr>
            <tr><td><code>\{\{memory:portal/welcome\}\}</code></td><td>${t('dashboard.tagExMemory')}</td></tr>
            <tr><td><code>\{\{storage:type\}\}</code></td><td>${t('dashboard.tagExStorage')}</td></tr>
            <tr><td><code>\{\{kv:site_name\}\}</code></td><td>${t('dashboard.tagExKv')}</td></tr>
            <tr><td><code>\{\{board:general\}\}</code></td><td>${t('dashboard.tagExBoard')}</td></tr>
          </tbody>
        </table>
      </${ExpandableHelp}>
      <textarea class="adm-textarea adm-input-full" rows="20" value=${template} onInput=${e => setTemplate(e.target.value)}
        style="font-size:13px"></textarea>
      <div class="adm-flex adm-mt-sm">
        <button class="adm-btn-action" onClick=${saveTemplate}>\u{1F4BE} ${t('dashboard.portalSaveTemplate')}</button>
        <button class="adm-btn-action" onClick=${downloadTemplate}>\u{1F4E5} ${t('dashboard.portalDownload')}</button>
        <button class="adm-btn-action" onClick=${resetTemplate}>\u{1F504} ${t('dashboard.portalResetDefault')}</button>
      </div>
    </div>

    <!-- Memory keys -->
    <div class="adm-card">
      <h3>${t('dashboard.portalMemoryKeys')}</h3>
      <p class="adm-text-dim adm-text-base adm-mb-sm">${t('dashboard.portalMemoryKeysExplain')}</p>
      ${memKeys === null
        ? html`<div class="adm-text-dim">${t('dashboard.loading')}...</div>`
        : memKeys.length === 0
          ? html`<div class="adm-text-dim">${t('dashboard.portalNoMemoryKeys')}</div>`
          : html`<table>
            <thead><tr><th>${t('dashboard.portalKeyLabel')}</th><th>${t('dashboard.portalValueLabel')}</th><th></th></tr></thead>
            <tbody>
              ${memKeys.map(k => html`<tr>
                <td><code>${escHtml(k.key)}</code></td>
                <td style="max-width:300px;overflow:hidden;text-overflow:ellipsis">${escHtml(String(k.value || ''))}</td>
                <td><button class="adm-btn-sm" onClick=${() => delMem(k.key)}>\u274C</button></td>
              </tr>`)}
            </tbody>
          </table>`
      }
      <div class="adm-flex-center adm-mt-sm">
        <input class="adm-input" value=${newKey} onInput=${e => setNewKey(e.target.value)} placeholder="portal/key" style="flex:1" />
        <input class="adm-input" value=${newVal} onInput=${e => setNewVal(e.target.value)} placeholder="value" style="flex:2" />
        <button class="adm-btn-action" onClick=${addMem}>+ ${t('dashboard.portalUpload')}</button>
      </div>
    </div>

    <!-- KV pairs -->
    <div class="adm-card">
      <h3>${t('dashboard.portalKvPairs')}</h3>
      <p class="adm-text-dim adm-text-base adm-mb-sm">${t('dashboard.portalKvExplain')}</p>
      ${kvKeys.length === 0
        ? html`<div class="adm-text-dim">${t('dashboard.portalNoKvPairs')}</div>`
        : html`<table>
          <thead><tr><th>${t('dashboard.portalKeyLabel')}</th><th>${t('dashboard.portalValueLabel')}</th></tr></thead>
          <tbody>${kvKeys.map(k => html`<tr><td><code>${escHtml(k)}</code></td><td class="adm-eval">${escHtml(kv[k])}</td></tr>`)}</tbody>
        </table>`
      }
    </div>

    <!-- AI Chat -->
    <div class="adm-card">
      <h3>${t('dashboard.portalAiChat')}</h3>
      <p class="adm-text-dim adm-text-base">${t('dashboard.portalAiExplain')}</p>
      <div class="adm-mt-sm adm-mb-sm">
        <button class="adm-btn-action" onClick=${copyPrompt}>\u{1F4CB} ${t('dashboard.portalAiLoadPrompt')}</button>
      </div>
      <p class="adm-text-dim adm-text-base adm-mb-sm">${t('dashboard.portalAiBundleExplain')}</p>
      <textarea class="adm-textarea adm-input-full" rows="6" value=${aiBundle}
        onInput=${e => setAiBundle(e.target.value)}
        placeholder=${t('dashboard.portalAiBundlePlaceholder')} style="font-size:13px"></textarea>
      <div class="adm-flex adm-mt-sm">
        <button class="adm-btn-action" onClick=${importAiBundle}>\u{1F4E5} ${t('dashboard.portalAiImport')}</button>
      </div>
    </div>

    <!-- Changelog -->
    <div class="adm-card">
      <h3>${t('dashboard.portalChangelog')}</h3>
      ${changes.length === 0
        ? html`<div class="adm-text-dim">${t('dashboard.portalNoChanges')}</div>`
        : html`<table>
          <thead><tr><th>${t('dashboard.action')}</th><th>${t('dashboard.by')}</th><th>${t('dashboard.created')}</th></tr></thead>
          <tbody>
            ${changes.slice(0, 20).map(c => html`<tr>
              <td><${Badge} type=${c.action} /></td>
              <td class="mono" style="font-size:.75rem">${escHtml(c.changed_by || c.changedBy || '-')}</td>
              <td class="adm-text-dim">${dt(c.changed_at || c.changedAt)}</td>
            </tr>`)}
          </tbody>
        </table>`
      }
    </div>
    <${ConfirmUI} />
  `;
}
