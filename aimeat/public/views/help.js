/**
 * @file help.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Help page, two audiences on one page. "For me" is the page for the person who
 *   bought this AIMEAT, in their language; "For my AI" serves the node's help prompt, rendered as
 *   markdown and copyable as raw text. The page used to be the second tab alone, dumping
 *   the prompt's markdown SOURCE into a <pre> — so a person who clicked Help got
 *   "## Step 0 — Orient yourself" and code fences.
 * @structure
 *   - HelpView — tab shell, with the page's own language choice (LangChoice)
 *   - HumanHelp — the page for a person, read from public/help/help.<lang>.md (helpSections)
 *   - AgentHelp — the copyable prompt + the machine-readable entry points (AGENTS.md, llms.txt)
 * @usage import HelpView from '/views/help.js'
 * @version-history
 *   v3.0.0 -- 2026-10-31 -- "For me" is written for the person who bought this AIMEAT, in one markdown
 *       file per language (public/help/help.{fi,en,es}.md), in the sections Jouni named: getting
 *       started (the first sentence to your AI), what it costs (the AI credit in euros, more credit,
 *       the free model), who sees my things, agents and schedules, apps, signing in (the email link),
 *       if something breaks (support@aimeat.io), and the own AI key under Advanced. Morsels are not
 *       explained at the start. The store-only parts show on a node the store sold; the old question
 *       ids still open their section. A language choice sits beside the title. "For my AI" links
 *       AGENTS.md and llms.txt (Jouni v27 P4).
 *   v2.5.0 -- 2026-10-03 -- "For me" opens with what AIMEAT gives a person, then the steps: a signed-in
 *       person's own path (journey.next first, views/home/journey-steps.js), a visitor's the newcomer
 *       order as plain text. Each question has an anchor and opens from /v1/help#<id>; a "knowledge"
 *       question answers the public library's "What is a package?" link. "For my AI" serves the person's
 *       help prompt (/v1/help/prompt/person); the developer prompt stays listed (guidance A2).
 *   v2.4.1 -- 2026-09-29 -- The app catalogue link opens /v1/appcat instead of /app-catalog.html (Jouni).
 *   v2.4.0 -- 2026-09-13 -- Compose the existing ink top rule from poster.css.
 *   v2.3.1 — 2026-08-29 — "Connection instructions" leads to the connect story (/v1/connect-your-ai).
 *   v2.3.0 — 2026-08-29 — The showroom face (design canvas "AIMEAT Index Pages"): the two actions under
 *       "still stuck" are the sun slab (.hlp-btn) and a door (.hlp-door), styled in help.css.
 *   v1.0.0 — 2026-03-23 — Initial implementation
 *   v1.1.0 — 2026-06-02 — Migrate bespoke copy button to canonical CopyButton component
 *   v2.0.0 — 2026-07-28 — Split into "For me" / "For my AI". Human tab is new; the prompt is
 *     rendered through <Markdown> instead of shown as source. Learn/feedback links come from
 *     siteLinks so they only appear on nodes that have them.
 *   v2.1.0 — 2026-08-08 — The copy button is the shared .btn-primary with the shared common.copyPrompt label; the
 *       bespoke .hlp-copy-btn and the help.copyBtn/help.copied keys are gone.
 *   v2.2.0 — 2026-08-16 — Questions ordered and worded by the reader's worries (cost, privacy,
 *       what works for me, sharing, connecting, breaking) instead of by the system's vocabulary;
 *       the terms moved inside the answers. Key ids unchanged, text lives in the locales.
 */
import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
import { t, getLocale, switchLocale, onLocaleChange } from '/js/i18n.js';
import { useViewCSS } from '/components/useViewCSS.js';
import { CopyButton } from '/components/CopyButton.js';
import { Spinner } from '/components/Spinner.js';
import { Markdown } from '/components/Markdown.js';
import { customerNode } from '/js/site.js';
import { swallowed } from '/js/swallowed.js';

const html = htm.bind(h);
const tr = (key, fallback) => { const v = t(key); return v && v !== key ? v : fallback; };

const LANGS = ['fi', 'en', 'es'];

/**
 * Addresses other pages link to (/v1/help#knowledge, and the question ids of the page before
 * 2026-10-31) mapped to the section that answers them now.
 */
const ANCHOR_ALIASES = { agent: 'agents', organism: 'privacy', connect: 'start' };

/**
 * The page's text for one language: public/help/help.<lang>.md, one source per language (Jouni v27
 * P4). Parts written for a node the store sold sit between <!--store--> and <!--/store-->, and the
 * text for any other node between <!--nostore--> and <!--/nostore-->; only the one that applies is
 * kept. Each "## Title {#id}" starts a section, and the id is its address on the page.
 * @returns {Array<{ id: string, title: string, body: string }>}
 */
export function helpSections(markdown, store) {
  const kept = String(markdown)
    .replace(/<!--store-->([\s\S]*?)<!--\/store-->/g, (_m, inner) => (store ? inner : ''))
    .replace(/<!--nostore-->([\s\S]*?)<!--\/nostore-->/g, (_m, inner) => (store ? '' : inner));
  const out = [];
  for (const part of kept.split(/^## /m).slice(1)) {
    const nl = part.indexOf('\n');
    const head = (nl < 0 ? part : part.slice(0, nl)).trim();
    const m = head.match(/^(.*?)\s*\{#([a-z0-9-]+)\}$/);
    out.push({ id: m ? m[2] : '', title: m ? m[1] : head, body: nl < 0 ? '' : part.slice(nl + 1).trim() });
  }
  return out;
}

/** The section an address names, once the sections are on the page. */
function scrollToAsked(sections) {
  const raw = (window.location.hash || '').replace(/^#/, '');
  const id = ANCHOR_ALIASES[raw] || raw;
  if (id && sections.some(s => s.id === id)) document.getElementById(`help-${id}`)?.scrollIntoView({ block: 'start' });
}

function HumanHelp({ onAskAi }) {
  const [lang, setLang] = useState(() => (LANGS.includes(getLocale()) ? getLocale() : 'en'));
  const [sections, setSections] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => onLocaleChange((loc) => setLang(LANGS.includes(loc) ? loc : 'en')), []);

  useEffect(() => {
    let live = true;
    setFailed(false);
    fetch(`/help/help.${lang}.md`)
      .then((r) => { if (!r.ok) throw new Error(`${r.status}`); return r.text(); })
      .then((text) => { if (live) setSections(helpSections(text, customerNode())); })
      .catch((err) => { swallowed('help: page text', err); if (live) setFailed(true); });
    return () => { live = false; };
  }, [lang]);

  useEffect(() => { if (sections) scrollToAsked(sections); }, [sections]);

  if (failed) return html`<p class="hlp-error">${t('help.loadError')}</p>`;
  if (!sections) return html`<div class="hlp-loading"><${Spinner} /></div>`;
  return html`
    <div class="hlp-human">
      <nav class="hlp-toc" aria-label=${tr('help.tocLabel', 'On this page')}>
        ${sections.filter(s => s.id).map(s => html`<a key=${s.id} href=${`#${s.id}`}
          onClick=${(e) => { e.preventDefault(); history.replaceState(null, '', `#${s.id}`); scrollToAsked(sections); }}>${s.title}</a>`)}
      </nav>
      ${sections.map(s => html`
        <section key=${s.id || s.title} id=${s.id ? `help-${s.id}` : undefined} class="hlp-section">
          <h2 class="section-title">${s.title}</h2>
          <${Markdown} text=${s.body} />
        </section>`)}
      <div class="hlp-stuck">
        <button class="hlp-btn" type="button" onClick=${onAskAi}>${tr('help.stuckAi', 'Ask your own AI: get the help prompt →')}</button>
      </div>
    </div>
  `;
}

/** The page's own language choice: the same switch the header has, where a reader of this page looks. */
function LangChoice() {
  const [lang, setLang] = useState(getLocale());
  useEffect(() => onLocaleChange(setLang), []);
  return html`
    <div class="hlp-langs" role="group" aria-label=${tr('help.langLabel', 'Language')}>
      ${LANGS.map(l => html`<button key=${l} type="button" class=${`lang-btn ${lang === l ? 'active' : ''}`}
        aria-pressed=${lang === l} onClick=${() => switchLocale(l)}>${l.toUpperCase()}</button>`)}
    </div>`;
}

function AgentHelp({ prompt, loading, error }) {
  return html`
    <div class="hlp-agent">
      <p class="hlp-desc">${tr('help.description', 'If your AI assistant is having trouble connecting to or using this node, copy the prompt below and paste it into your AI chat. It will guide your AI through connecting, authenticating, and using all available features.')}</p>

      ${loading && html`<div class="hlp-loading"><${Spinner} /></div>`}
      ${error && html`<p class="hlp-error">${t('help.loadError')}</p>`}
      ${!loading && !error && html`
        <${CopyButton} text=${prompt} label=${t('common.copyPrompt')} className="btn-primary" />
        <div class="hlp-prompt-rendered"><${Markdown} text=${prompt} /></div>
      `}

      <h2 class="section-title">${tr('help.agentEntryTitle', 'For an agent reading this page directly')}</h2>
      <ul class="hlp-endpoints">
        <li><a href="/AGENTS.md"><code>GET /AGENTS.md</code></a> — ${tr('help.epAgents', 'orientation for an agent: what this node is and where to start')}</li>
        <li><a href="/llms.txt"><code>GET /llms.txt</code></a> — ${tr('help.epLlms', 'the full agent manual')}</li>
        <li><code>GET /?format=json</code> — ${tr('help.epRoot', 'machine-readable getting started')}</li>
        <li><code>GET /v1/spec</code> — ${tr('help.epSpec', 'the OpenAPI contract')}</li>
        <li><code>POST /v1/mcp</code> — ${tr('help.epMcp', 'the MCP endpoint')}</li>
        <li><code>GET /v1/help/prompt/person</code> — ${tr('help.epPrompt', 'this prompt as plain markdown')}</li>
        <li><code>GET /v1/help/prompt</code> — ${t('help.epPromptDev')}</li>
      </ul>
    </div>
  `;
}

export default function HelpView() {
  useViewCSS('/css/views/help.css');

  const [tab, setTab] = useState('human');
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    // The person's help prompt: what they can do here and their next step. The developer one
    // (/v1/help/prompt: discovery, device flow, tokens) stays listed below for builders.
    fetch('/v1/help/prompt/person')
      .then(r => {
        if (!r.ok) throw new Error(r.statusText);
        return r.text();
      })
      .then(text => { setPrompt(text); setLoading(false); })
      .catch(() => { setError(true); setLoading(false); });
  }, []);

  return html`
    <div class="hlp-container">
      <div class="hlp-card">
        <div class="hlp-head">
          <h1 class="hlp-title">${tr('help.pageTitle', 'Help')}</h1>
          <${LangChoice} />
        </div>

        <div class="hlp-tabs poster-row--thing" role="tablist">
          <button type="button" role="tab" aria-selected=${tab === 'human'}
            class=${`hlp-tab ${tab === 'human' ? 'active' : ''}`} onClick=${() => setTab('human')}>
            ${tr('help.tabHuman', 'For me')}
          </button>
          <button type="button" role="tab" aria-selected=${tab === 'agent'}
            class=${`hlp-tab ${tab === 'agent' ? 'active' : ''}`} onClick=${() => setTab('agent')}>
            ${tr('help.tabAgent', 'For my AI')}
          </button>
        </div>

        ${tab === 'human'
          ? html`<${HumanHelp} onAskAi=${() => setTab('agent')} />`
          : html`<${AgentHelp} prompt=${prompt} loading=${loading} error=${error} />`}
      </div>
    </div>
  `;
}
