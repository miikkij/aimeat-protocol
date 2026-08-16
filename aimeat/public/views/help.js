/**
 * @file help.js
 * @description Help page, two audiences on one page. "For me" answers the questions a
 *   human actually arrives with; "For my AI" serves the node's help prompt, rendered as
 *   markdown and copyable as raw text. The page used to be the second tab alone, dumping
 *   the prompt's markdown SOURCE into a <pre> — so a person who clicked Help got
 *   "## Step 0 — Orient yourself" and code fences.
 * @structure
 *   - HelpView — tab shell
 *   - HumanHelp — start here, common questions, who to ask
 *   - AgentHelp — the copyable prompt + the machine-readable entry points
 * @usage import HelpView from '/views/help.js'
 * @version-history
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
import { t } from '/js/i18n.js';
import { useViewCSS } from '/components/useViewCSS.js';
import { CopyButton } from '/components/CopyButton.js';
import { Spinner } from '/components/Spinner.js';
import { Markdown } from '/components/Markdown.js';
import { Collapsible } from '/components/Collapsible.js';
import { siteLink, hasSite, contactHref } from '/js/site.js';

const html = htm.bind(h);
const tr = (key, fallback) => { const v = t(key); return v && v !== key ? v : fallback; };

// The questions people actually arrive with, in the order of their worries: money, privacy,
// what works for me, sharing, connecting, breaking. The system's own words (agent, organism,
// morsel) live inside the answers, never in the question. Each answer is a few sentences, not
// a link list — a link list is what sends someone back to the search box.
const QUESTIONS = ['cost', 'privacy', 'agent', 'organism', 'connect', 'broken'];

/* Canonical Collapsible is controlled; each question owns its own open state. */
function Question({ id }) {
  const [open, setOpen] = useState(false);
  return html`
    <${Collapsible} title=${tr(`help.q.${id}.q`, id)} open=${open} onToggle=${() => setOpen(o => !o)}>
      <p class="hlp-answer">${tr(`help.q.${id}.a`, '')}</p>
    <//>
  `;
}

function HumanHelp({ onAskAi }) {
  const contact = contactHref(tr('help.contactSubject', 'A question about AIMEAT'));
  return html`
    <div class="hlp-human">
      <h2 class="section-title">${tr('help.startTitle', 'Getting started')}</h2>
      <ol class="hlp-steps">
        <li>${tr('help.start1', 'Sign in or create an account. One click with Google, or email and password.')}</li>
        <li>${tr('help.start2', 'Connect your AI assistant so it can work here.')} <a href="/v1/portal?view=dev">${tr('help.start2Link', 'Connection instructions')}</a></li>
        <li>${tr('help.start3', 'Build your first app by describing it to your AI.')} <a href="/app-catalog.html">${tr('help.start3Link', 'Open the app catalog')}</a></li>
        ${hasSite('learn') ? html`
          <li>${tr('help.start4', 'Learn the whole platform hands-on, free, without an account.')} <a href=${siteLink('learn')} target="_blank" rel="noopener">${tr('help.start4Link', 'Open the Experience Center')}</a></li>` : ''}
      </ol>

      <h2 class="section-title">${tr('help.qTitle', 'Common questions')}</h2>
      <div class="hlp-questions">
        ${QUESTIONS.map(k => html`<${Question} key=${k} id=${k} />`)}
      </div>

      <h2 class="section-title">${tr('help.stuckTitle', 'Still stuck')}</h2>
      <div class="hlp-stuck">
        <button class="btn-outline" type="button" onClick=${onAskAi}>${tr('help.stuckAi', 'Ask your own AI: get the help prompt →')}</button>
        ${contact ? html`<a class="btn-ghost" href=${contact}>${tr('help.stuckHuman', 'Ask a human →')}</a>` : ''}
      </div>
    </div>
  `;
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
        <li><code>GET /?format=json</code> — ${tr('help.epRoot', 'machine-readable getting started')}</li>
        <li><code>GET /llms.txt</code> — ${tr('help.epLlms', 'the full agent manual')}</li>
        <li><code>GET /v1/spec</code> — ${tr('help.epSpec', 'the OpenAPI contract')}</li>
        <li><code>POST /v1/mcp</code> — ${tr('help.epMcp', 'the MCP endpoint')}</li>
        <li><code>GET /v1/help/prompt</code> — ${tr('help.epPrompt', 'this prompt as plain markdown')}</li>
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
    fetch('/v1/help/prompt')
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
        <h1 class="hlp-title">${tr('help.pageTitle', 'Help')}</h1>

        <div class="hlp-tabs" role="tablist">
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
