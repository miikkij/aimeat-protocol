import { h } from 'preact';
import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml, copyToClipboard, handleImgError } from '/js/utils.js';
import { apiGet, apiPut } from '/js/api.js';

const NODE_URL = typeof window !== 'undefined' ? window.location.origin : '';

/* ── Auth helpers ── */
function getSession() {
  const a = window.AIMEAT?.auth;
  if (!a || typeof a.getSession !== 'function') return null;
  const s = a.getSession();
  if (!s || !s.jwt) return null;
  return s;
}

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

/* ── Prompt Builder ── */
function buildPortfolioPrompt({ session, catalog, selectedImages, selectedApps, selectedBoards, selectedCortex, selectedMemories, portfolioType, designStyle, authGates }) {
  const ghii = session.ghii || (session.owner + '@unknown');
  const url = NODE_URL;

  let prompt = `You are a portfolio website builder for AIMEAT.

The user wants to create a personal portfolio website. Generate a single, self-contained, downloadable HTML file.

**CRITICAL RULE: Only use data that is explicitly provided below.** Do NOT invent, fabricate, or hallucinate ANY content — no fake projects, no fake work experience, no fake skills, no fake contact info, no fake social links. If a section has no data provided for it, either omit that section entirely or show a clear placeholder like "Add your [projects/experience/skills] here" that the user can edit later.

## User Context
- GHII: ${ghii}
- Display Name: ${session.displayName || session.owner}
- Node URL: ${url}
`;

  // Selected images
  if (selectedImages.length > 0) {
    prompt += `\n## Selected Images (from AIMEAT storage)\nThese are the ONLY image URLs you may use. Do NOT reference any other image URLs.\n`;
    for (const img of selectedImages) {
      const sizeKb = Math.round(img.size / 1024);
      prompt += `- ${img.key} (${sizeKb}KB, ${img.mimeType}) → ${url}${img.url}\n`;
    }
  } else {
    prompt += `\n## Images\nNo images were selected. You have NO image URLs available. Use inline SVG placeholders, CSS shapes, or gradients for all visual elements. Do NOT reference any image URLs.\n`;
  }

  // Selected apps
  if (selectedApps.length > 0) {
    prompt += `\n## Published Apps\n`;
    for (const app of selectedApps) {
      prompt += `- ${app.filename} → ${url}${app.url}\n`;
    }
  }

  // Selected boards
  if (selectedBoards.length > 0) {
    prompt += `\n## Boards (published discussions)\n`;
    for (const board of selectedBoards) {
      prompt += `- ${board.name} (${board.visibility}) → ${url}/v1/boards/${board.id}/posts\n`;
    }
  }

  // Selected cortex extensions
  if (selectedCortex.length > 0) {
    prompt += `\n## Cortex Extensions\n`;
    for (const ext of selectedCortex) {
      prompt += `- ${ext.name} v${ext.version} — "${ext.description}"\n`;
      prompt += `  Components: ${ext.componentTypes.join(', ')}\n`;
    }
  }

  // Selected memory entries
  if (selectedMemories.length > 0) {
    prompt += `\n## Memory Entries\n`;
    prompt += `These entries can be fetched live from the node API for dynamic portfolio content:\n`;
    for (const mem of selectedMemories) {
      prompt += `- ${mem.key} (${mem.visibility}) → GET ${url}/v1/memory/${encodeURIComponent(mem.key)}\n`;
    }
  }

  // Portfolio requirements
  const typeLabels = { cv: 'Professional / CV', creative: 'Creative / Art Showcase', dev: 'Developer / Technical', personal: 'Personal / Blog-style', custom: 'Custom' };
  const styleLabels = { minimal: 'Minimal & Clean', bold: 'Bold & Colorful', dark: 'Dark & Modern', classic: 'Classic & Elegant' };

  prompt += `
## Portfolio Requirements
- Type: ${typeLabels[portfolioType] || portfolioType}
- Design Style: ${styleLabels[designStyle] || designStyle}
`;

  // Auth-gated sections
  if (authGates.length > 0) {
    const gateLabels = { contact: 'Contact information', projectDetails: 'Project details', downloads: 'Download links', custom: 'Custom sections (ask user)' };
    prompt += `- Auth-gated sections (show only to logged-in viewers):\n`;
    for (const gate of authGates) {
      prompt += `  - ${gateLabels[gate] || gate}\n`;
    }
  }

  // Build resource availability warnings
  const hasAvatar = selectedImages.some(i => /avatar|profile|photo|headshot/i.test(i.key));
  const hasResume = selectedImages.some(i => /resume|cv/i.test(i.key));

  let resourceNotes = '';
  if (!hasAvatar) {
    resourceNotes += `- NO avatar/profile photo was provided. Generate an inline SVG placeholder avatar (e.g. colored circle with initials "${(session.displayName || session.owner).charAt(0).toUpperCase()}"). Do NOT reference any image URL for the avatar.\n`;
  }
  if (!hasResume) {
    resourceNotes += `- NO resume/CV file was provided. Do NOT include a "Download Resume" link. Instead, omit the resume section entirely or show a placeholder note like "Resume available upon request."\n`;
  }

  // Build section availability summary
  let sectionNotes = '';
  if (selectedApps.length === 0) {
    sectionNotes += `- NO apps/projects were provided. Do NOT create a "Projects" section with fake projects. Either omit the section or show a single placeholder: "Projects coming soon."\n`;
  }
  if (selectedBoards.length === 0 && selectedMemories.length === 0 && selectedApps.length === 0) {
    sectionNotes += `- Very little content was provided. Generate a clean, minimal portfolio with: header/hero with the display name, an "About" placeholder section the user can edit, and any selected images as a gallery. Do NOT fill empty space with invented content.\n`;
  }

  prompt += `
## Technical Requirements
- Generate a SINGLE downloadable HTML file with ALL CSS and JS inline (no external dependencies)
- **CRITICAL — No fabricated content:** ONLY show information that is explicitly provided in the sections above. Never invent projects, work history, skills, contact details, social links, testimonials, or any other content. If data for a section is not provided, omit the section or use an editable placeholder.
- **CRITICAL — Images and files:** ONLY use URLs listed in the "Selected Images" section above. Do NOT invent, guess, or fabricate any URLs. If a resource (avatar, resume, screenshot, etc.) is not listed above, it does not exist.
${resourceNotes}${sectionNotes}- For missing images: Use inline SVG placeholders, CSS gradients, or emoji — never a broken image URL
- For project screenshots: If no screenshot URL is provided for a project, use a styled CSS placeholder card instead of an <img> tag
- If memory entries are selected: Fetch them live with fetch() calls to the node API URLs above
- Mobile-responsive design (works on phone, tablet, desktop)
- Include proper <meta> tags for SEO and social sharing (og:title, og:description, og:image)
- **IMPORTANT — CSP compatibility:** The portfolio HTML will be rendered inside a sandboxed iframe. All JavaScript MUST be inside a single \`<script>\` tag at the end of \`<body>\`. Do NOT use inline event handlers (onclick=, onload=, etc.) — use addEventListener instead. Do NOT use external script/CSS CDN links.
`;

  if (authGates.length > 0) {
    prompt += `
## Auth-Gated Sections Implementation
Sections marked as auth-gated should be hidden by default and only shown when the viewer is
logged in to the AIMEAT node. Use this detection pattern:

\`\`\`javascript
// Check if the viewer is authenticated on this AIMEAT node
const isLoggedIn = window.AIMEAT?.auth?.hasSession?.() || false;
document.querySelectorAll('[data-auth-required]').forEach(el => {
  el.style.display = isLoggedIn ? '' : 'none';
});
// Show placeholder for unauthenticated viewers
document.querySelectorAll('[data-auth-placeholder]').forEach(el => {
  el.style.display = isLoggedIn ? 'none' : '';
});
\`\`\`

Wrap auth-gated content in \`<div data-auth-required>\` and add a placeholder:
\`<div data-auth-placeholder>Log in to see more content</div>\`

NOTE: This is a convenience feature, not a security boundary. The content is in the HTML source.
For truly private data, use the AIMEAT consent system.
`;
  }

  prompt += `
## Debug Panel
Include a hidden debug panel (toggle with Ctrl+Shift+D keyboard shortcut via addEventListener).
Show: auth state, image load status, API fetch log, section visibility, JS errors.
Style: fixed overlay, semi-transparent dark background, monospace font.
All debug JS must be in the single <script> block at end of body — no inline handlers.

## Delivery
After generating the HTML, tell the user:
1. Save the HTML file
2. Go to their AIMEAT profile page
3. Navigate to the Portfolio tab
4. Upload the HTML file to publish it at: ${url}/v1/portfolio/${session.owner}
`;

  return prompt;
}


/* ── Builder Component ── */
function PortfolioBuilder({ session, navigate }) {
  const [catalog, setCatalog] = useState(null);
  const [loading, setLoading] = useState(true);
  const [errMsg, setErrMsg] = useState(null);

  // Selections
  const [selectedImages, setSelectedImages] = useState(new Set());
  const [selectedApps, setSelectedApps] = useState(new Set());
  const [selectedBoards, setSelectedBoards] = useState(new Set());
  const [selectedCortex, setSelectedCortex] = useState(new Set());
  const [selectedMemories, setSelectedMemories] = useState(new Set());

  // Style
  const [portfolioType, setPortfolioType] = useState('dev');
  const [designStyle, setDesignStyle] = useState('dark');
  const [authGates, setAuthGates] = useState(new Set());

  // Prompt
  const [generatedPrompt, setGeneratedPrompt] = useState('');
  const [promptCopied, setPromptCopied] = useState(false);

  // Upload
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState(null);
  const fileInputRef = useRef(null);
  const [dragover, setDragover] = useState(false);

  // Existing portfolio state
  const [existingConfig, setExistingConfig] = useState(null);

  // Load catalog + existing config
  useEffect(() => {
    if (!session) return;
    Promise.all([
      apiGet('/v1/portfolio/catalog'),
      apiGet('/v1/portfolio/config'),
    ]).then(([catRes, cfgRes]) => {
      if (catRes.ok !== false && catRes.data) setCatalog(catRes.data);
      else setErrMsg('Failed to load content catalog');
      if (cfgRes.ok !== false && cfgRes.data?.config) setExistingConfig(cfgRes.data.config);
      setLoading(false);
    }).catch(() => {
      setErrMsg('Network error');
      setLoading(false);
    });
  }, [session]);

  // Toggle helpers
  const toggleSet = (setter, value) => {
    setter(prev => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value); else next.add(value);
      return next;
    });
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
      catalog,
      selectedImages: imgList,
      selectedApps: appList,
      selectedBoards: boardList,
      selectedCortex: cortexList,
      selectedMemories: memList,
      portfolioType,
      designStyle,
      authGates: [...authGates],
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
      tags: ['portfolio'],
    });
  };

  // Copy prompt
  const handleCopyPrompt = async () => {
    await copyToClipboard(generatedPrompt);
    setPromptCopied(true);
    setTimeout(() => setPromptCopied(false), 2000);
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

  const handlePublishPaste = async () => {
    const text = pastedHtml.trim();
    if (!text) {
      setUploadStatus({ ok: false, msg: t('portfolio.builder.pasteEmpty') || 'Paste HTML content first' });
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

  return html`
    <div class="portfolio-container">
      <h1>${t('portfolio.builder.heading')}</h1>
      <p style="color:var(--text-dim); margin-bottom:2rem;">${t('portfolio.builder.subtitle')}</p>

      ${existingConfig?.enabled && html`
        <div style="margin-bottom:1.5rem; padding:0.75rem 1rem; background:rgba(80,200,120,0.08); border:1px solid rgba(80,200,120,0.2); border-radius:8px; display:flex; align-items:center; gap:0.75rem; flex-wrap:wrap;">
          <span style="color:#50c878;">●</span>
          <span>${t('portfolio.builder.enabled')}</span>
          <a href="/v1/portfolio/${encodeURIComponent(session.owner)}" target="_blank" style="margin-left:auto;">${t('portfolio.builder.viewPublic')}</a>
        </div>
      `}

      <div class="portfolio-builder">

        <!-- Step 1: Select Content -->
        <div class="portfolio-step">
          <h3><span class="portfolio-step-number">1</span> ${t('portfolio.builder.step1Title')}</h3>

          ${!hasContent && html`<p style="color:var(--text-dim);">${t('portfolio.builder.noContent')}</p>`}

          ${catalog.images.length > 0 && html`
            <details class="portfolio-source-group" open>
              <summary>${t('portfolio.builder.imagesGroup')} (${catalog.images.length})</summary>
              <div class="portfolio-source-list">
                ${catalog.images.map(img => html`
                  <div class="portfolio-source-item portfolio-img-item">
                    <input type="checkbox" id=${'img-' + img.key} checked=${selectedImages.has(img.key)}
                      onChange=${() => toggleSet(setSelectedImages, img.key)} />
                    <img class="portfolio-img-thumb" src=${img.url} alt=${img.key} loading="lazy" onError=${handleImgError} />
                    <label for=${'img-' + img.key}>${img.key}</label>
                    <span class="portfolio-source-meta">${Math.round(img.size / 1024)}KB · ${img.mimeType.split('/')[1]}</span>
                  </div>
                `)}
              </div>
            </details>
          `}

          ${catalog.apps.length > 0 && html`
            <details class="portfolio-source-group">
              <summary>${t('portfolio.builder.appsGroup')} (${catalog.apps.length})</summary>
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
              <summary>${t('portfolio.builder.boardsGroup')} (${catalog.boards.length})</summary>
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
              <summary>${t('portfolio.builder.cortexGroup')} (${catalog.cortex.length})</summary>
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
              <summary>${t('portfolio.builder.memoriesGroup')} (${catalog.memories.length})</summary>
              <div class="portfolio-source-list">
                ${catalog.memories.map(mem => {
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
                `})}
              </div>
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
        </div>

        <!-- Step 4: Generate Prompt -->
        <div class="portfolio-step">
          <h3><span class="portfolio-step-number">4</span> ${t('portfolio.builder.step4Title')}</h3>

          <button class="btn btn-primary" onClick=${handleGenerate} style="margin-bottom:1rem;">
            ${t('portfolio.builder.generateBtn')}
          </button>

          ${generatedPrompt && html`
            <div class="portfolio-prompt-output">${generatedPrompt}</div>
            <div class="portfolio-prompt-actions">
              <button class="btn btn-primary" onClick=${handleCopyPrompt}>
                ${promptCopied ? t('portfolio.builder.promptCopied') : t('portfolio.builder.copyPrompt')}
              </button>
              <button class="btn btn-ghost" onClick=${handleDownloadPrompt}>
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
            <span>${t('portfolio.builder.orPaste') || 'or paste HTML directly'}</span>
            <hr style="flex:1; border:none; border-top:1px solid var(--border-dim);" />
          </div>

          <textarea class="portfolio-paste-area"
            placeholder=${t('portfolio.builder.pasteHint') || 'Paste your portfolio HTML here from AI chat...'}
            value=${pastedHtml}
            onInput=${(e) => setPastedHtml(e.target.value)}
            rows="6"
          ></textarea>
          ${pastedHtml.trim() && html`
            <button class="btn btn-primary" style="margin-top:0.5rem;"
              onClick=${handlePublishPaste} disabled=${uploading}>
              ${uploading ? '...' : (t('portfolio.builder.publishPaste') || 'Publish pasted HTML')}
            </button>
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
        <button class="btn btn-ghost" onClick=${() => navigate('/v1/profile')}>
          ${t('portfolio.viewer.backToPortal')}
        </button>
      </div>
    </div>
  `;
}


/* ── Viewer Component ── */
function PortfolioViewer({ username, navigate }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [errMsg, setErrMsg] = useState(null);

  useEffect(() => {
    fetch(`${NODE_URL}/v1/portfolio/data/${encodeURIComponent(username)}`)
      .then(r => r.json())
      .then(result => {
        if (result.ok === false) {
          setErrMsg(result.error?.message || 'Not found');
        } else {
          setData(result.data);
        }
        setLoading(false);
      })
      .catch(() => {
        setErrMsg('Network error');
        setLoading(false);
      });
  }, [username]);

  if (loading) return html`<div class="portfolio-container"><div class="view-loading">Loading portfolio...</div></div>`;

  if (errMsg || !data) {
    return html`
      <div class="portfolio-container">
        <div class="portfolio-not-found">
          <h2>${t('portfolio.viewer.notFound')}</h2>
          <p>${t('portfolio.viewer.notFoundDesc')}</p>
          <button class="btn btn-ghost" style="margin-top:1rem;" onClick=${() => navigate('/v1/portal')}>
            ${t('portfolio.viewer.backToPortal')}
          </button>
        </div>
      </div>
    `;
  }

  // If portfolio HTML exists, render it in a sandboxed iframe
  if (data.has_html && data.portfolio_html) {
    return html`
      <div class="portfolio-container portfolio-viewer">
        <div style="display:flex; align-items:center; gap:1rem; margin-bottom:1rem; flex-wrap:wrap;">
          <button class="btn btn-ghost" onClick=${() => navigate('/v1/portal')}>
            ← ${t('portfolio.viewer.backToPortal')}
          </button>
          <span style="color:var(--text-dim);">${escHtml(data.display_name || username)}'s portfolio</span>
        </div>
        <iframe class="portfolio-viewer-frame" srcdoc=${data.portfolio_html}
          sandbox="allow-scripts"
          onLoad=${(e) => {
            try {
              const h = e.target.contentDocument?.body?.scrollHeight;
              if (h) e.target.style.height = h + 40 + 'px';
            } catch (_) { /* cross-origin — ignore */ }
          }}
        ></iframe>
      </div>
    `;
  }

  // No portfolio HTML — show basic profile info
  return html`
    <div class="portfolio-container">
      <div class="portfolio-not-found">
        <h2>${escHtml(data.display_name || username)}</h2>
        <p>${data.bio ? escHtml(data.bio) : t('portfolio.viewer.notFoundDesc')}</p>
        <button class="btn btn-ghost" style="margin-top:1rem;" onClick=${() => navigate('/v1/portal')}>
          ${t('portfolio.viewer.backToPortal')}
        </button>
      </div>
    </div>
  `;
}


/* ── Main Export ── */
export default function Portfolio({ navigate, locale }) {
  const [session, setSession] = useState(null);

  useEffect(() => {
    const s = getSession();
    if (s) setSession(s);
    const handler = () => setSession(getSession());
    window.addEventListener('aimeat-auth-change', handler);
    return () => window.removeEventListener('aimeat-auth-change', handler);
  }, []);

  // Determine mode from URL
  const path = typeof window !== 'undefined' ? window.location.pathname : '';
  const match = path.match(/^\/v1\/portfolio\/(.+)$/);
  const username = match ? decodeURIComponent(match[1]) : null;

  // /v1/portfolio/:username → viewer mode
  if (username) {
    return html`<${PortfolioViewer} username=${username} navigate=${navigate} />`;
  }

  // /v1/portfolio → builder mode (requires auth)
  return html`<${PortfolioBuilder} session=${session} navigate=${navigate} />`;
}
