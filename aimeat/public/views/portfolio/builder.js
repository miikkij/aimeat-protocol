/**
 * @file views/portfolio/builder.js
 * @description Portfolio builder component — select content, generate the AI
 *   prompt, and upload/publish the resulting HTML. Extracted from portfolio.js
 *   to satisfy max-file-lines.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from portfolio.js (max-file-lines)
 *   v1.1.0 — 2026-08-08 — Copy labels now resolve from the shared common.copy / common.copied / common.copyPrompt /
 *       common.copyLink / common.copyUrl keys; the per-view copy label keys this file used were
 *       removed from both locales. Same words on screen.
 */
import { h } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml, handleImgError } from '/js/utils.js';
import { apiGet, apiPut } from '/js/api.js';
import TagCloud from '/js/components/tag-cloud.js';
import { CopyButton } from '/components/CopyButton.js';
import { NODE_URL, tr, stampCspNonce } from './shared.js';
import { buildPortfolioPrompt } from './prompt.js';

/* ── Portfolio Types ── */
const PORTFOLIO_TYPES = [
  { id: 'cv', key: 'portfolio.builder.typeCV' },
  { id: 'creative', key: 'portfolio.builder.typeCreative' },
  { id: 'dev', key: 'portfolio.builder.typeDev' },
  { id: 'personal', key: 'portfolio.builder.typePersonal' },
  { id: 'custom', key: 'portfolio.builder.typeCustom' },
];

const DESIGN_STYLES = [
  { id: 'minimal', key: 'portfolio.builder.styleMinimal' },
  { id: 'bold', key: 'portfolio.builder.styleBold' },
  { id: 'dark', key: 'portfolio.builder.styleDark' },
  { id: 'classic', key: 'portfolio.builder.styleClassic' },
];

const AUTH_GATES = [
  { id: 'contact', key: 'portfolio.builder.gateContact' },
  { id: 'projectDetails', key: 'portfolio.builder.gateProjectDetails' },
  { id: 'downloads', key: 'portfolio.builder.gateDownloads' },
  { id: 'custom', key: 'portfolio.builder.gateCustom' },
];

/* ── Memory key formatting ── */
function formatMemoryKey(key) {
  // packages/UUID/section → section (capitalize)
  const pkgMatch = key.match(/^packages\/[0-9a-f-]+\/(.+)$/);
  if (pkgMatch) {
    return pkgMatch[1].replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }
  // For other slash-separated keys, show last segment
  if (key.includes('/')) {
    const last = key.split('/').pop();
    return last.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }
  return key;
}

/* ── Builder Component ── */
export function PortfolioBuilder({ session, navigate }) {
  const [catalog, setCatalog] = useState(null);
  const [loading, setLoading] = useState(true);
  const [errMsg, setErrMsg] = useState(null);

  // Selections
  const [selectedImages, setSelectedImages] = useState(new Set());
  const [selectedApps, setSelectedApps] = useState(new Set());
  const [selectedBoards, setSelectedBoards] = useState(new Set());
  const [selectedCortex, setSelectedCortex] = useState(new Set());
  const [selectedMemories, setSelectedMemories] = useState(new Set());
  const [imageTagFilter, setImageTagFilter] = useState(new Set());
  const [memoryTagFilter, setMemoryTagFilter] = useState(new Set());

  // Style
  const [portfolioType, setPortfolioType] = useState('dev');
  const [designStyle, setDesignStyle] = useState('dark');
  const [authGates, setAuthGates] = useState(new Set());

  // Prompt
  const [generatedPrompt, setGeneratedPrompt] = useState('');

  // Upload
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState(null);
  const fileInputRef = useRef(null);
  const [dragover, setDragover] = useState(false);

  // Existing portfolio state
  const [existingConfig, setExistingConfig] = useState(null);
  // Standalone portfolio-origin URL (<username>.portfolio.<apex>) — null when
  // the node has the portfolio origin disabled.
  const [standaloneUrl, setStandaloneUrl] = useState(null);
  // Whether the standalone page shows the aimeat attribution badge (default on).
  const [showBadge, setShowBadge] = useState(true);

  // Load catalog + existing config
  useEffect(() => {
    if (!session) return;
    Promise.all([
      apiGet('/v1/portfolio/catalog'),
      apiGet('/v1/portfolio/config'),
    ]).then(([catRes, cfgRes]) => {
      if (catRes.ok !== false && catRes.data) setCatalog(catRes.data);
      else setErrMsg('Failed to load content catalog');
      if (cfgRes.ok !== false && cfgRes.data?.config) {
        setExistingConfig(cfgRes.data.config);
        setShowBadge(cfgRes.data.config.showBadge !== false);
      }
      if (cfgRes.ok !== false && cfgRes.data?.standalone_url) setStandaloneUrl(cfgRes.data.standalone_url);
      setLoading(false);
    }).catch(() => {
      setErrMsg('Network error');
      setLoading(false);
    });
  }, [session]);

  // Persist the badge toggle immediately (it only affects the standalone page).
  const handleBadgeToggle = async (value) => {
    setShowBadge(value);
    const next = { ...(existingConfig || {}), enabled: existingConfig?.enabled || false, showBadge: value, tags: ['portfolio'] };
    setExistingConfig(next);
    await apiPut('/v1/portfolio/config', next);
  };

  // Toggle helpers
  const toggleSet = (setter, value) => {
    setter(prev => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value); else next.add(value);
      return next;
    });
  };

  // Custom descriptions (step 2 "Custom" type / step 3 "Custom sections")
  const [customTypeDesc, setCustomTypeDesc] = useState('');
  const [customGateDesc, setCustomGateDesc] = useState('');

  // Group <summary> with selected/total + a select-all checkbox. The checkbox click
  // must not toggle the <details> open state (stopPropagation + preventDefault on the
  // summary's default toggle is handled by stopping the click at the input).
  const groupSummary = (label, ids, selectedSet, setter) => {
    const selCount = ids.filter(id => selectedSet.has(id)).length;
    const all = ids.length > 0 && selCount === ids.length;
    return html`
      <summary>
        <input type="checkbox" class="portfolio-group-checkall" checked=${all}
          title=${tr('portfolio.builder.selectAll', 'Select all')}
          onClick=${(e) => e.stopPropagation()}
          onChange=${() => setter(prev => {
            const next = new Set(prev);
            if (all) ids.forEach(i => next.delete(i)); else ids.forEach(i => next.add(i));
            return next;
          })} />
        ${label} — ${tr('portfolio.builder.selectedOf', '{sel}/{total} selected').replace('{sel}', String(selCount)).replace('{total}', String(ids.length))}
      </summary>`;
  };

  // Generate prompt
  const handleGenerate = () => {
    if (!catalog) return;
    const imgList = catalog.images.filter(i => selectedImages.has(i.key));
    const appList = catalog.apps.filter(a => selectedApps.has(a.filename));
    const boardList = catalog.boards.filter(b => selectedBoards.has(b.id));
    const cortexList = catalog.cortex.filter(c => selectedCortex.has(c.name));
    const memList = catalog.memories.filter(m => selectedMemories.has(m.key));

    const prompt = buildPortfolioPrompt({
      session,
      selectedImages: imgList,
      selectedApps: appList,
      selectedBoards: boardList,
      selectedCortex: cortexList,
      selectedMemories: memList,
      portfolioType,
      designStyle,
      authGates: [...authGates],
      customTypeDesc: customTypeDesc.trim(),
      customGateDesc: customGateDesc.trim(),
    });
    setGeneratedPrompt(prompt);

    // Save config
    apiPut('/v1/portfolio/config', {
      enabled: existingConfig?.enabled || false,
      portfolioType,
      designStyle,
      authGates: [...authGates],
      selectedImages: [...selectedImages],
      selectedApps: [...selectedApps],
      selectedBoards: [...selectedBoards],
      selectedCortex: [...selectedCortex],
      selectedMemories: [...selectedMemories],
      showBadge,
      tags: ['portfolio'],
    });
  };

  // Download prompt as .txt
  const handleDownloadPrompt = () => {
    const blob = new Blob([generatedPrompt], { type: 'text/plain' });
    const u = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = u;
    a.download = 'portfolio-prompt.txt';
    a.click();
    URL.revokeObjectURL(u);
  };

  // Paste HTML
  const [pastedHtml, setPastedHtml] = useState('');
  const [showPreview, setShowPreview] = useState(false);

  const handlePublishPaste = async () => {
    const text = pastedHtml.trim();
    if (!text) {
      setUploadStatus({ ok: false, msg: tr('portfolio.builder.pasteEmpty', 'Paste HTML content first') });
      return;
    }
    await publishHtml(text);
  };

  // Publish raw HTML text to API
  const publishHtml = async (text) => {
    const sizeKb = Math.round(text.length / 1024);

    setUploading(true);
    setUploadStatus(null);

    try {
      const resp = await fetch('/v1/portfolio/upload', {
        method: 'PUT',
        headers: {
          'Authorization': 'Bearer ' + session.jwt,
          'Content-Type': 'text/html',
        },
        body: text,
      });
      const result = await resp.json();
      if (resp.ok) {
        // Enable portfolio
        await apiPut('/v1/portfolio/config', {
          ...(existingConfig || {}),
          enabled: true,
          portfolioType,
          designStyle,
          authGates: [...authGates],
          publishedAt: new Date().toISOString(),
          htmlSizeKb: sizeKb,
          showBadge,
          tags: ['portfolio'],
        });
        setExistingConfig({ ...(existingConfig || {}), enabled: true });
        setUploadStatus({ ok: true, msg: t('portfolio.builder.uploadSuccess') });
        setPastedHtml('');
      } else {
        setUploadStatus({ ok: false, msg: result.error?.message || 'Upload failed' });
      }
    } catch (err) {
      setUploadStatus({ ok: false, msg: err.message || 'Network error' });
    }
    setUploading(false);
  };

  // Unpublish: flip enabled off — the public route 404s until the next publish.
  const handleUnpublish = async () => {
    setUploading(true);
    try {
      await apiPut('/v1/portfolio/config', { ...(existingConfig || {}), enabled: false, tags: ['portfolio'] });
      setExistingConfig({ ...(existingConfig || {}), enabled: false });
      setUploadStatus({ ok: true, msg: tr('portfolio.builder.unpublished', 'Portfolio unpublished') });
    } catch (err) {
      setUploadStatus({ ok: false, msg: err.message || 'Failed' });
    }
    setUploading(false);
  };

  // Upload HTML file (reads text from file, then publishes)
  const handleUpload = async (file) => {
    if (!file || !file.name.endsWith('.html')) {
      setUploadStatus({ ok: false, msg: 'Please select an HTML file' });
      return;
    }
    const text = await file.text();
    await publishHtml(text);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragover(false);
    const file = e.dataTransfer?.files?.[0];
    if (file) handleUpload(file);
  };

  // Render
  if (loading) return html`<div class="portfolio-container"><div class="view-loading">${t('loading') || 'Loading...'}</div></div>`;
  if (errMsg) return html`<div class="portfolio-container"><div class="alert alert-error">${escHtml(errMsg)}</div></div>`;
  if (!session) return html`<div class="portfolio-container"><div class="portfolio-not-found"><h2>${t('nav.signIn')}</h2><p>Sign in to build your portfolio.</p></div></div>`;

  const hasContent = catalog && (catalog.images.length || catalog.apps.length || catalog.boards.length || catalog.cortex.length || catalog.memories.length);

  const totalSelected = selectedImages.size + selectedApps.size + selectedBoards.size + selectedCortex.size + selectedMemories.size;
  const publicUrl = `${NODE_URL}/v1/portfolio/${encodeURIComponent(session.owner)}`;

  return html`
    <div class="portfolio-container">
      <h1>${t('portfolio.builder.heading')}</h1>
      <p class="portfolio-subtitle-text">${t('portfolio.builder.subtitle')}</p>

      <!-- The loop is the whole point: AIMEAT composes a prompt, YOUR AI chat builds the
           HTML, you paste it back. Without this banner step 1 gives no hint of steps 4-5. -->
      <div class="portfolio-flow">
        <span class="portfolio-flow-step"><span class="portfolio-flow-num">①</span> ${tr('portfolio.builder.flow1', 'Select your content and style')}</span>
        <span class="portfolio-flow-arrow">→</span>
        <span class="portfolio-flow-step"><span class="portfolio-flow-num">②</span> ${tr('portfolio.builder.flow2', 'Generate a prompt and run it in your AI chat (Claude, ChatGPT, …)')}</span>
        <span class="portfolio-flow-arrow">→</span>
        <span class="portfolio-flow-step"><span class="portfolio-flow-num">③</span> ${tr('portfolio.builder.flow3', 'Paste the resulting HTML back here and publish')}</span>
      </div>

      ${existingConfig?.enabled && html`
        <div class="portfolio-published-bar">
          <span class="portfolio-published-dot">●</span>
          <span>${t('portfolio.builder.enabled')}</span>
          <a href=${publicUrl} target="_blank" class="portfolio-published-link">${t('portfolio.builder.viewPublic')}</a>
          ${standaloneUrl && html`
            <a href=${standaloneUrl} target="_blank" rel="noopener" class="portfolio-published-link">${tr('portfolio.builder.viewStandalone', 'Own address')} ↗</a>
          `}
          <button class="btn-ghost btn-sm" disabled=${uploading} onClick=${handleUnpublish}>
            ${tr('portfolio.builder.unpublish', 'Unpublish')}
          </button>
        </div>
      `}

      <div class="portfolio-builder">

        <!-- Step 1: Select Content -->
        <div class="portfolio-step">
          <h3><span class="portfolio-step-number">1</span> ${t('portfolio.builder.step1Title')}</h3>

          ${!hasContent && html`<p style="color:var(--text-dim);">${t('portfolio.builder.noContent')}</p>`}

          ${catalog.images.length > 0 && html`
            <details class="portfolio-source-group" open>
              ${groupSummary(t('portfolio.builder.imagesGroup'), catalog.images.map(i => i.key), selectedImages, setSelectedImages)}
              ${(() => {
                const allImgTags = new Set();
                for (const img of catalog.images) {
                  if (img.tags) for (const tag of img.tags) allImgTags.add(tag);
                }
                const filteredImgs = imageTagFilter.size === 0 ? catalog.images : catalog.images.filter(img =>
                  img.tags && [...imageTagFilter].every(tag => img.tags.includes(tag))
                );
                const toggleImgTag = (tag) => {
                  setImageTagFilter(prev => {
                    const next = new Set(prev);
                    if (next.has(tag)) next.delete(tag); else next.add(tag);
                    return next;
                  });
                };
                return html`
                  <${TagCloud} tags=${[...allImgTags]} selected=${imageTagFilter} onToggle=${toggleImgTag} onClear=${() => setImageTagFilter(new Set())} />
                  <div class="portfolio-source-list">
                    ${filteredImgs.map(img => html`
                      <div class="portfolio-source-item portfolio-img-item">
                        <input type="checkbox" id=${'img-' + img.key} checked=${selectedImages.has(img.key)}
                          onChange=${() => toggleSet(setSelectedImages, img.key)} />
                        <img class="portfolio-img-thumb" src=${img.url} alt=${img.key} loading="lazy" onError=${handleImgError} />
                        <label for=${'img-' + img.key}>${img.key}</label>
                        <span class="portfolio-source-meta">${Math.round(img.size / 1024)}KB · ${img.mimeType.split('/')[1]}</span>
                      </div>
                    `)}
                    ${filteredImgs.length === 0 && imageTagFilter.size > 0 && html`
                      <div style="padding:.5rem;font-size:.8rem;color:var(--text-dim)">${t('tags.noMatch') || 'No items match selected tags'}</div>
                    `}
                  </div>
                `;
              })()}
            </details>
          `}

          ${catalog.apps.length > 0 && html`
            <details class="portfolio-source-group">
              ${groupSummary(t('portfolio.builder.appsGroup'), catalog.apps.map(a => a.filename), selectedApps, setSelectedApps)}
              <div class="portfolio-source-list">
                ${catalog.apps.map(app => html`
                  <div class="portfolio-source-item">
                    <input type="checkbox" id=${'app-' + app.filename} checked=${selectedApps.has(app.filename)}
                      onChange=${() => toggleSet(setSelectedApps, app.filename)} />
                    <label for=${'app-' + app.filename}>${app.filename}</label>
                    <span class="portfolio-source-meta">${Math.round(app.size / 1024)}KB</span>
                  </div>
                `)}
              </div>
            </details>
          `}

          ${catalog.boards.length > 0 && html`
            <details class="portfolio-source-group">
              ${groupSummary(t('portfolio.builder.boardsGroup'), catalog.boards.map(b => b.id), selectedBoards, setSelectedBoards)}
              <div class="portfolio-source-list">
                ${catalog.boards.map(board => html`
                  <div class="portfolio-source-item">
                    <input type="checkbox" id=${'brd-' + board.id} checked=${selectedBoards.has(board.id)}
                      onChange=${() => toggleSet(setSelectedBoards, board.id)} />
                    <label for=${'brd-' + board.id}>${board.name}</label>
                    <span class="portfolio-source-meta">${board.visibility}</span>
                  </div>
                `)}
              </div>
            </details>
          `}

          ${catalog.cortex.length > 0 && html`
            <details class="portfolio-source-group">
              ${groupSummary(t('portfolio.builder.cortexGroup'), catalog.cortex.map(c => c.name), selectedCortex, setSelectedCortex)}
              <div class="portfolio-source-list">
                ${catalog.cortex.map(ext => html`
                  <div class="portfolio-source-item">
                    <input type="checkbox" id=${'ctx-' + ext.name} checked=${selectedCortex.has(ext.name)}
                      onChange=${() => toggleSet(setSelectedCortex, ext.name)} />
                    <label for=${'ctx-' + ext.name}>${ext.name} v${ext.version}</label>
                    <span class="portfolio-source-meta">${ext.componentTypes.join(', ')}</span>
                  </div>
                `)}
              </div>
            </details>
          `}

          ${catalog.memories.length > 0 && html`
            <details class="portfolio-source-group">
              ${groupSummary(t('portfolio.builder.memoriesGroup'), catalog.memories.map(m => m.key), selectedMemories, setSelectedMemories)}
              ${(() => {
                const allMemTags = new Set();
                for (const mem of catalog.memories) {
                  if (mem.tags) for (const tag of mem.tags) allMemTags.add(tag);
                }
                const filteredMems = memoryTagFilter.size === 0 ? catalog.memories : catalog.memories.filter(mem =>
                  mem.tags && [...memoryTagFilter].every(tag => mem.tags.includes(tag))
                );
                const toggleMemTag = (tag) => {
                  setMemoryTagFilter(prev => {
                    const next = new Set(prev);
                    if (next.has(tag)) next.delete(tag); else next.add(tag);
                    return next;
                  });
                };
                return html`
                  <${TagCloud} tags=${[...allMemTags]} selected=${memoryTagFilter} onToggle=${toggleMemTag} onClear=${() => setMemoryTagFilter(new Set())} />
                  <div class="portfolio-source-list">
                    ${filteredMems.map(mem => {
                      const displayKey = formatMemoryKey(mem.key);
                      return html`
                        <div class="portfolio-mem-item">
                          <div class="portfolio-mem-header">
                            <input type="checkbox" id=${'mem-' + mem.key} checked=${selectedMemories.has(mem.key)}
                              onChange=${() => toggleSet(setSelectedMemories, mem.key)} />
                            <label for=${'mem-' + mem.key} title=${mem.key}>${displayKey}</label>
                            <span class="portfolio-source-meta">${mem.visibility}</span>
                          </div>
                          ${mem.preview && html`<p class="portfolio-mem-preview">${mem.preview}</p>`}
                        </div>
                      `;
                    })}
                    ${filteredMems.length === 0 && memoryTagFilter.size > 0 && html`
                      <div style="padding:.5rem;font-size:.8rem;color:var(--text-dim)">${t('tags.noMatch') || 'No items match selected tags'}</div>
                    `}
                  </div>
                `;
              })()}
            </details>
          `}
        </div>

        <!-- Step 2: Style & Purpose -->
        <div class="portfolio-step">
          <h3><span class="portfolio-step-number">2</span> ${t('portfolio.builder.step2Title')}</h3>

          <p style="color:var(--text-bright); font-size:0.95rem; margin-bottom:0.5rem;">${t('portfolio.builder.portfolioType')}</p>
          <div class="portfolio-options">
            ${PORTFOLIO_TYPES.map(pt => html`
              <div class="portfolio-option ${portfolioType === pt.id ? 'selected' : ''}"
                onClick=${() => setPortfolioType(pt.id)}>
                <input type="radio" name="ptype" checked=${portfolioType === pt.id} />
                <span>${t(pt.key)}</span>
              </div>
            `)}
          </div>
          ${portfolioType === 'custom' && html`
            <textarea class="portfolio-custom-desc" rows="3"
              placeholder=${tr('portfolio.builder.customTypePlaceholder', 'Describe what kind of portfolio you want…')}
              value=${customTypeDesc} onInput=${(e) => setCustomTypeDesc(e.target.value)}></textarea>
          `}

          <p style="color:var(--text-bright); font-size:0.95rem; margin:1.5rem 0 0.5rem;">${t('portfolio.builder.designStyle')}</p>
          <div class="portfolio-options">
            ${DESIGN_STYLES.map(ds => html`
              <div class="portfolio-option ${designStyle === ds.id ? 'selected' : ''}"
                onClick=${() => setDesignStyle(ds.id)}>
                <input type="radio" name="dstyle" checked=${designStyle === ds.id} />
                <span>${t(ds.key)}</span>
              </div>
            `)}
          </div>
        </div>

        <!-- Step 3: Auth-Gated Sections -->
        <div class="portfolio-step">
          <h3><span class="portfolio-step-number">3</span> ${t('portfolio.builder.step3Title')}</h3>
          <p style="color:var(--text-dim); font-size:0.9rem; margin-bottom:0.75rem;">${t('portfolio.builder.authGateLabel')}</p>
          <div class="portfolio-auth-gates">
            ${AUTH_GATES.map(gate => html`
              <div class="portfolio-source-item">
                <input type="checkbox" id=${'gate-' + gate.id} checked=${authGates.has(gate.id)}
                  onChange=${() => toggleSet(setAuthGates, gate.id)} />
                <label for=${'gate-' + gate.id}>${t(gate.key)}</label>
              </div>
            `)}
          </div>
          ${authGates.has('custom') && html`
            <textarea class="portfolio-custom-desc" rows="2"
              placeholder=${tr('portfolio.builder.customGatePlaceholder', 'Describe the custom auth-gated sections…')}
              value=${customGateDesc} onInput=${(e) => setCustomGateDesc(e.target.value)}></textarea>
          `}
        </div>

        <!-- Step 4: Generate Prompt -->
        <div class="portfolio-step">
          <h3><span class="portfolio-step-number">4</span> ${t('portfolio.builder.step4Title')}</h3>

          <div class="portfolio-generate-row">
            <button class="btn-primary" disabled=${totalSelected === 0} onClick=${handleGenerate}>
              ${t('portfolio.builder.generateBtn')}
            </button>
            ${totalSelected === 0 && html`
              <span class="portfolio-generate-hint">${tr('portfolio.builder.generateDisabledHint', 'Select at least one item in step 1')}</span>
            `}
          </div>

          ${generatedPrompt && html`
            <div class="portfolio-prompt-output">${generatedPrompt}</div>
            <div class="portfolio-prompt-meta">${tr('portfolio.builder.charCount', '{n} characters').replace('{n}', generatedPrompt.length.toLocaleString())}</div>
            <div class="portfolio-prompt-actions">
              <${CopyButton} text=${generatedPrompt} className="btn-primary"
                label=${t('portfolio.builder.copyPrompt')} copiedLabel=${t('common.copied')} />
              <button class="btn-ghost" onClick=${handleDownloadPrompt}>
                ${t('portfolio.builder.downloadPrompt')}
              </button>
            </div>

            <div class="portfolio-instructions">
              <strong>${t('portfolio.builder.instructions')}</strong>
              <ol>
                <li>${t('portfolio.builder.inst1')}</li>
                <li>${t('portfolio.builder.inst2')}</li>
                <li>${t('portfolio.builder.inst3')}</li>
                <li>${t('portfolio.builder.inst4')}</li>
              </ol>
            </div>
          `}
        </div>

        <!-- Step 5: Upload Portfolio HTML -->
        <div class="portfolio-step">
          <h3><span class="portfolio-step-number">5</span> ${t('portfolio.builder.step5Title')}</h3>

          <div class="portfolio-publish-target">
            ${tr('portfolio.builder.publishTarget', 'Will be published at:')}
            <a href=${publicUrl} target="_blank" class="portfolio-publish-url">${publicUrl}</a>
          </div>
          ${standaloneUrl && html`
            <div class="portfolio-publish-target">
              ${tr('portfolio.builder.standaloneTarget', 'Also served standalone at:')}
              <a href=${standaloneUrl} target="_blank" rel="noopener" class="portfolio-publish-url">${standaloneUrl}</a>
            </div>
            <div class="portfolio-source-item portfolio-badge-toggle">
              <input type="checkbox" id="pf-show-badge" checked=${showBadge}
                onChange=${(e) => handleBadgeToggle(e.target.checked)} />
              <label for="pf-show-badge">${tr('portfolio.builder.showBadge', 'Show the aimeat.io badge on the standalone page')}</label>
            </div>
          `}

          <div class="portfolio-upload-zone ${dragover ? 'dragover' : ''}"
            onClick=${() => fileInputRef.current?.click()}
            onDragOver=${(e) => { e.preventDefault(); setDragover(true); }}
            onDragLeave=${() => setDragover(false)}
            onDrop=${handleDrop}>
            <input type="file" accept=".html" ref=${fileInputRef}
              onChange=${(e) => { const f = e.target.files?.[0]; if (f) handleUpload(f); }} />
            <p style="margin:0; color:var(--text-dim);">
              ${uploading ? '...' : t('portfolio.builder.uploadDragDrop')}
            </p>
          </div>

          <div style="display:flex; align-items:center; gap:0.75rem; margin:1rem 0; color:var(--text-dim); font-size:0.9rem;">
            <hr style="flex:1; border:none; border-top:1px solid var(--border-dim);" />
            <span>${tr('portfolio.builder.orPaste', 'or paste HTML directly')}</span>
            <hr style="flex:1; border:none; border-top:1px solid var(--border-dim);" />
          </div>

          <textarea class="portfolio-paste-area"
            placeholder=${tr('portfolio.builder.pasteHint', 'Paste your portfolio HTML here from AI chat...')}
            value=${pastedHtml}
            onInput=${(e) => setPastedHtml(e.target.value)}
            rows="6"
          ></textarea>
          ${pastedHtml.trim() && html`
            <div class="portfolio-paste-actions">
              <button class="btn-primary"
                onClick=${handlePublishPaste} disabled=${uploading}>
                ${uploading ? '...' : tr('portfolio.builder.publishPaste', 'Publish pasted HTML')}
              </button>
              <button class="btn-ghost" onClick=${() => setShowPreview(p => !p)}>
                ${showPreview ? tr('portfolio.builder.closePreview', 'Close preview') : tr('portfolio.builder.previewBtn', 'Preview')}
              </button>
            </div>
          `}
          ${showPreview && pastedHtml.trim() && html`
            <!-- Same sandbox as the public viewer: opaque origin, no session access. -->
            <iframe class="portfolio-viewer-frame portfolio-preview-frame" srcdoc=${stampCspNonce(pastedHtml)}
              sandbox="allow-scripts"></iframe>
          `}

          ${uploadStatus && html`
            <div style="margin-top:0.75rem; padding:0.5rem 1rem; border-radius:8px;
              background:${uploadStatus.ok ? 'rgba(80,200,120,0.08)' : 'rgba(255,80,80,0.08)'};
              border:1px solid ${uploadStatus.ok ? 'rgba(80,200,120,0.2)' : 'rgba(255,80,80,0.2)'};
              color:${uploadStatus.ok ? '#50c878' : '#ff5050'};">
              ${uploadStatus.msg}
            </div>
          `}
        </div>

      </div>

      <div style="margin-top:2rem;">
        <button class="btn-ghost" onClick=${() => navigate('/v1/profile')}>
          ← ${tr('portfolio.builder.backToProfile', 'Profile')}
        </button>
      </div>
    </div>
  `;
}
