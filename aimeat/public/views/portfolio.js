/**
 * @file portfolio.js
 * @description Portfolio view — builder (select content, generate AI prompt,
 *   upload HTML) and public viewer (sandboxed iframe render).
 * @version-history
 *   v1.4.0 — 2026-07-03 — Viewer bridge: the trusted parent posts login state
 *     ('aimeat-portfolio-auth') into the sandboxed portfolio and serves a narrow
 *     fetch RPC ('aimeat-portfolio-fetch' → '...-fetch-result') that reads the
 *     portfolio owner's records with the VISITOR's session — enabling the new
 *     'members' memory visibility (logged-in-only content, never in the HTML).
 *     Requests are allowlisted to data.owner_gaiis; the visitor's JWT never
 *     enters the iframe. Prompt documents the protocol + members entries.
 *   v1.3.2 — 2026-07-03 — Builder prompt fixes for the sandboxed viewer reality:
 *     memory fetch URLs now use the anonymous public route /v1/memory/:gaii/:key
 *     (old /v1/memory/:key always 401s without auth) and only for public-visibility
 *     records; forbid credentialed fetch() (Origin:null + wildcard CORS rejects it);
 *     auth-gate pattern defaults to logged-out placeholder + listens for an
 *     'aimeat-portfolio-auth' postMessage instead of window.AIMEAT (unreachable
 *     from the opaque-origin sandbox).
 *   v1.3.1 — 2026-07-03 — Stamp the SPA's CSP nonce onto <script> tags before setting
 *     srcdoc (viewer + builder preview): about:srcdoc inherits the parent document's
 *     CSP (script-src 'self' 'nonce-…'), so the portfolio's nonce-less inline script
 *     never executed. The sandbox (opaque origin, no allow-same-origin) remains the
 *     security boundary — same trust level as the app-launch 'unsafe-inline' CSP.
 *   v1.3.0 — 2026-07-03 — Public viewer renders full-bleed: portfolio iframe fills the
 *     viewport below the nav (no more 900px column), slim toolbar with back link + owner
 *     name + a native Fullscreen button; drop the dead contentDocument autosize hack
 *     (opaque-origin sandbox always threw). Campsite: btn btn-* → btn-*.
 *   v1.2.0 — 2026-06-10 — Workflow round: ①②③ flow banner explains the AI-chat round-trip;
 *     group summaries show selected/total + select-all checkbox; Generate disabled with a hint
 *     when nothing is selected; "Custom" type and custom auth-gate open describe-textareas that
 *     feed the prompt; prompt output shows a character count; step 5 shows the publish URL,
 *     gains a sandboxed preview (same allow-scripts srcdoc sandbox as the public viewer) and an
 *     Unpublish in the published banner; bottom button says Profile (where it actually goes).
 *   v1.1.0 — 2026-06-02 — Migrate bespoke prompt-copy button to canonical CopyButton component
 */
import { h } from 'preact';
import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml, handleImgError } from '/js/utils.js';

// t() echoes the key when a translation is missing (e.g. a server still serving
// pre-update locales) — fall back to readable English instead of raw keys.
const tr = (key, fallback) => { const v = t(key); return v && v !== key ? v : fallback; };
import { apiGet, apiPut } from '/js/api.js';
import TagCloud from '/js/components/tag-cloud.js';
import { CopyButton } from '/components/CopyButton.js';

const NODE_URL = typeof window !== 'undefined' ? window.location.origin : '';

/* ── CSP nonce stamping for srcdoc iframes ──
   about:srcdoc inherits the SPA document's CSP, whose script-src is
   'self' + a per-request nonce (no 'unsafe-inline') — so a portfolio's
   inline <script> is blocked unless it carries that nonce. Stamp the
   SPA's own nonce onto the portfolio's script tags before rendering
   (client-side mirror of src/utils/csp-nonce.ts). Isolation does not
   rest on CSP here: the sandbox (allow-scripts only → opaque origin,
   no session/cookies/storage) is the security boundary, matching the
   'unsafe-inline' CSP the app-launch endpoint grants published apps. */
function stampCspNonce(htmlStr) {
  let nonce = '';
  for (const s of document.scripts) {
    if (s.nonce) { nonce = s.nonce; break; }
  }
  if (!nonce) return htmlStr;
  return htmlStr.replace(/<script(?=[\s>])/gi, `<script nonce="${nonce}"`);
}

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
function buildPortfolioPrompt({ session, catalog, selectedImages, selectedApps, selectedBoards, selectedCortex, selectedMemories, portfolioType, designStyle, authGates, customTypeDesc, customGateDesc }) {
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

  // Selected memory entries — three delivery paths, decided by record visibility:
  //   public  → plain anonymous fetch from /v1/memory/:gaii/:key
  //   members → requested from the hosting viewer over the postMessage bridge
  //             (the viewer fetches with the VISITOR's session; anonymous → no data)
  //   other   → not deliverable to visitors at all; bake preview or placeholder
  const publicMems = selectedMemories.filter(m => m.visibility === 'public');
  const memberMems = selectedMemories.filter(m => m.visibility === 'members');
  const gatedMems = selectedMemories.filter(m => m.visibility !== 'public' && m.visibility !== 'members');
  if (selectedMemories.length > 0) {
    prompt += `\n## Memory Entries\n`;
    if (publicMems.length > 0) {
      prompt += `These PUBLIC entries can be fetched live (anonymously, no auth) for dynamic portfolio content:\n`;
      for (const mem of publicMems) {
        prompt += `- ${mem.key} → GET ${url}/v1/memory/${encodeURIComponent(mem.gaii || ghii)}/${encodeURIComponent(mem.key)}\n`;
      }
    }
    if (memberMems.length > 0) {
      prompt += `These MEMBERS-ONLY entries are readable by logged-in node members. Do NOT fetch them directly (an anonymous fetch returns 404). Request each from the hosting viewer over the postMessage bridge (see "Viewer Bridge" below) and render the value inside a [data-auth-required] section, keeping a [data-auth-placeholder] fallback:\n`;
      for (const mem of memberMems) {
        prompt += `- key: ${mem.key} · gaii: ${mem.gaii || ghii}\n`;
      }
    }
    if (gatedMems.length > 0) {
      prompt += `These entries are NOT readable by visitors at all (any fetch attempt returns 401/404). Represent each with its preview text baked into the HTML, or a placeholder the user can edit:\n`;
      for (const mem of gatedMems) {
        prompt += `- ${mem.key} (visibility: ${mem.visibility})${mem.preview ? ` — preview: ${mem.preview}` : ''}\n`;
      }
    }
  }

  // Portfolio requirements
  const typeLabels = { cv: 'Professional / CV', creative: 'Creative / Art Showcase', dev: 'Developer / Technical', personal: 'Personal / Blog-style', custom: 'Custom' };
  const styleLabels = { minimal: 'Minimal & Clean', bold: 'Bold & Colorful', dark: 'Dark & Modern', classic: 'Classic & Elegant' };

  prompt += `
## Portfolio Requirements
- Type: ${typeLabels[portfolioType] || portfolioType}${portfolioType === 'custom' && customTypeDesc ? ` — ${customTypeDesc}` : ''}
- Design Style: ${styleLabels[designStyle] || designStyle}
`;

  // Auth-gated sections
  if (authGates.length > 0) {
    const gateLabels = { contact: 'Contact information', projectDetails: 'Project details', downloads: 'Download links', custom: customGateDesc ? `Custom sections: ${customGateDesc}` : 'Custom sections (ask user)' };
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
- If PUBLIC memory entries are listed above: fetch them live with plain \`fetch(url)\` calls to those exact URLs
- **CRITICAL — fetch() must stay credential-free:** always call \`fetch(url)\` with no options object — never set \`credentials\` ('include'/'same-origin'), and never send an Authorization header. The portfolio runs in an opaque-origin sandbox (the browser sends \`Origin: null\`); the node answers CORS with a wildcard, and browsers reject credentialed requests to wildcard responses. Only the anonymous public URLs listed above are reachable.
- Mobile-responsive design (works on phone, tablet, desktop)
- Include proper <meta> tags for SEO and social sharing (og:title, og:description, og:image)
- **IMPORTANT — CSP compatibility:** The portfolio HTML will be rendered inside a sandboxed iframe. All JavaScript MUST be inside a single \`<script>\` tag at the end of \`<body>\`. Do NOT use inline event handlers (onclick=, onload=, etc.) — use addEventListener instead. Do NOT use external script/CSS CDN links.
`;

  if (authGates.length > 0 || memberMems.length > 0) {
    prompt += `
## Viewer Bridge (auth state + members-only data)
The portfolio renders inside a sandboxed iframe with an opaque origin: it has NO access to the
hosting page's session, cookies, or \`window.AIMEAT\` — login state cannot be read directly.
The hosting AIMEAT viewer bridges over postMessage. Two message flows:

1. Viewer → portfolio: \`{ type: 'aimeat-portfolio-auth', loggedIn: boolean }\` — posted on load
   and whenever the visitor's login state changes.
2. Portfolio → viewer: \`{ type: 'aimeat-portfolio-fetch', gaii: string, key: string, id: number }\`
   (id = your own correlation number). The viewer answers with
   \`{ type: 'aimeat-portfolio-fetch-result', id, ok: boolean, gaii, key, value }\` — \`value\` is the
   memory record's value when \`ok\` is true, otherwise null (not logged in / no access).
   The viewer only serves the gaii+key pairs listed in "Memory Entries" above.

Implementation pattern — default to logged-out, activate on the viewer's signal:

\`\`\`javascript
function applyAuthState(isLoggedIn) {
  document.querySelectorAll('[data-auth-required]').forEach(el => {
    el.style.display = isLoggedIn ? '' : 'none';
  });
  document.querySelectorAll('[data-auth-placeholder]').forEach(el => {
    el.style.display = isLoggedIn ? 'none' : '';
  });
}
applyAuthState(false);

// Members-only data: ask the viewer, resolve by correlation id.
let bridgeSeq = 0;
const bridgePending = {};
function fetchMemberData(gaii, key) {
  return new Promise((resolve) => {
    const id = ++bridgeSeq;
    bridgePending[id] = resolve;
    window.parent.postMessage({ type: 'aimeat-portfolio-fetch', gaii, key, id }, '*');
  });
}

window.addEventListener('message', (e) => {
  const d = e.data;
  if (!d) return;
  if (d.type === 'aimeat-portfolio-auth') {
    applyAuthState(!!d.loggedIn);
    // (Re-)request members-only data when the viewer reports a logged-in visitor.
    if (d.loggedIn) loadMemberSections();
  } else if (d.type === 'aimeat-portfolio-fetch-result' && bridgePending[d.id]) {
    bridgePending[d.id](d.ok ? d.value : null);
    delete bridgePending[d.id];
  }
});

async function loadMemberSections() {
  // Example: const contact = await fetchMemberData('<gaii>', '<key>');
  // if (contact) { render it into the [data-auth-required] section }
}
\`\`\`

Wrap gated content in \`<div data-auth-required>\` and add a placeholder:
\`<div data-auth-placeholder>Log in to see more content</div>\`

Rules:
- Show the placeholder until data actually arrives — no spinners waiting on the bridge
  (an older viewer never answers, and the placeholder is the correct fallback).
- Members-only values arrive ONLY via the bridge — never bake them into the HTML and never
  fetch them directly.
- Content that is merely wrapped in [data-auth-required] but baked into the HTML is a
  convenience, not a security boundary — it is visible in the HTML source. Keep truly
  private data out of the portfolio entirely.
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
      catalog,
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
                        <span class="portfolio-source-meta">${Math.round(img.size / 1024)}KB \u00B7 ${img.mimeType.split('/')[1]}</span>
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
                label=${t('portfolio.builder.copyPrompt')} copiedLabel=${t('portfolio.builder.promptCopied')} />
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


/* ── Viewer Component ── */
function PortfolioViewer({ username, navigate }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [errMsg, setErrMsg] = useState(null);
  const frameRef = useRef(null);

  // ── Portfolio bridge ──
  // The sandboxed portfolio (opaque origin) cannot see the visitor's session.
  // This trusted parent brokers two things over postMessage:
  //   1. 'aimeat-portfolio-auth' {loggedIn} — posted on frame load + auth change,
  //      so HTML-baked [data-auth-required] sections can toggle (convenience).
  //   2. 'aimeat-portfolio-fetch' {gaii, key, id} → 'aimeat-portfolio-fetch-result'
  //      {id, ok, gaii, key, value} — the parent fetches the record with the
  //      VISITOR's JWT (which never enters the iframe) via the public read route,
  //      so 'members'-visibility records reach logged-in viewers only. Requests
  //      are allowlisted to the portfolio owner's identities (data.owner_gaiis)
  //      so portfolio JS cannot spend the visitor's token on anything else.
  const postAuthState = (win) => {
    // '*' targetOrigin: an opaque-origin frame is not addressable any other way;
    // the payload is just a boolean.
    win?.postMessage({ type: 'aimeat-portfolio-auth', loggedIn: !!getSession() }, '*');
  };

  useEffect(() => {
    if (!data?.has_html) return undefined;
    const ownerGaiis = Array.isArray(data.owner_gaiis) ? data.owner_gaiis : [];

    const onAuthChange = () => postAuthState(frameRef.current?.contentWindow);

    const onMessage = async (e) => {
      const win = frameRef.current?.contentWindow;
      if (!win || e.source !== win) return; // only our portfolio frame
      const d = e.data;
      if (!d || d.type !== 'aimeat-portfolio-fetch') return;
      const reply = (ok, value) => win.postMessage({
        type: 'aimeat-portfolio-fetch-result',
        id: d.id ?? null, ok, gaii: d.gaii ?? null, key: d.key ?? null, value,
      }, '*');
      if (typeof d.gaii !== 'string' || typeof d.key !== 'string' || !ownerGaiis.includes(d.gaii)) {
        reply(false, null);
        return;
      }
      const s = getSession();
      try {
        const resp = await fetch(`/v1/memory/${encodeURIComponent(d.gaii)}/${encodeURIComponent(d.key)}`,
          s ? { headers: { Authorization: 'Bearer ' + s.jwt } } : undefined);
        const j = await resp.json().catch(() => null);
        const ok = !!(resp.ok && j && j.ok !== false);
        reply(ok, ok ? (j.data?.value ?? null) : null);
      } catch (_) {
        reply(false, null);
      }
    };

    window.addEventListener('message', onMessage);
    window.addEventListener('aimeat-auth-change', onAuthChange);
    // aimeat-auth-change fires from the login pill's onLogout BEFORE the async
    // auth.logout() has cleared the session, so getSession() still reads the old
    // state at that moment. The auth lib's own 'login'/'logout' events fire only
    // AFTER the state change — subscribe to those too so the frame flips reliably.
    const authApi = window.AIMEAT?.auth;
    if (authApi?.on) {
      authApi.on('login', onAuthChange);
      authApi.on('logout', onAuthChange);
    }
    return () => {
      window.removeEventListener('message', onMessage);
      window.removeEventListener('aimeat-auth-change', onAuthChange);
      if (authApi?.off) {
        authApi.off('login', onAuthChange);
        authApi.off('logout', onAuthChange);
      }
    };
  }, [data]);

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
          <button class="btn-ghost" style="margin-top:1rem;" onClick=${() => navigate('/v1/portal')}>
            ${t('portfolio.viewer.backToPortal')}
          </button>
        </div>
      </div>
    `;
  }

  // If portfolio HTML exists, render it full-bleed in a sandboxed iframe:
  // the frame fills the viewport below the nav + toolbar, the portfolio
  // scrolls inside it. The toolbar offers native fullscreen for a truly
  // chrome-free view (Esc exits).
  if (data.has_html && data.portfolio_html) {
    return html`
      <div class="portfolio-viewer-full">
        <div class="portfolio-viewer-bar">
          <button class="btn-ghost btn-sm" onClick=${() => navigate('/v1/portal')}>
            ← ${t('portfolio.viewer.backToPortal')}
          </button>
          <span class="portfolio-viewer-owner">${escHtml(data.display_name || username)}'s portfolio</span>
          <button class="btn-ghost btn-sm portfolio-viewer-fs"
            title=${tr('portfolio.viewer.fullscreen', 'Fullscreen')}
            onClick=${() => frameRef.current?.requestFullscreen?.()}>
            ⛶ ${tr('portfolio.viewer.fullscreen', 'Fullscreen')}
          </button>
        </div>
        <iframe ref=${frameRef} class="portfolio-viewer-frame portfolio-viewer-frame-full"
          srcdoc=${stampCspNonce(data.portfolio_html)} sandbox="allow-scripts"
          onLoad=${(e) => postAuthState(e.target.contentWindow)}></iframe>
      </div>
    `;
  }

  // No portfolio HTML — show basic profile info
  return html`
    <div class="portfolio-container">
      <div class="portfolio-not-found">
        <h2>${escHtml(data.display_name || username)}</h2>
        <p>${data.bio ? escHtml(data.bio) : t('portfolio.viewer.notFoundDesc')}</p>
        <button class="btn-ghost" style="margin-top:1rem;" onClick=${() => navigate('/v1/portal')}>
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
