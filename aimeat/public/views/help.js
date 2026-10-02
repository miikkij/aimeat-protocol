/**
 * @file help.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
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
import { useState, useEffect, useRef } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { hasSession } from '/js/services/auth.js';
import { openSteps, stepTitle, stepLine, stepHref, useJourney, VISITOR_STEPS } from './home/journey-steps.js';
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
const QUESTIONS = ['cost', 'privacy', 'agent', 'organism', 'knowledge', 'connect', 'broken'];

/** The question an address names (/v1/help#knowledge), so a link from another page opens its answer. */
const askedQuestion = () => {
  const id = (typeof window !== 'undefined' ? window.location.hash : '').replace(/^#/, '');
  return QUESTIONS.includes(id) ? id : null;
};

/* Canonical Collapsible is controlled; each question owns its own open state. The wrapper carries
 * the question's id, so /v1/help#<id> lands on it and opens it. */
function Question({ id }) {
  const [open, setOpen] = useState(() => askedQuestion() === id);
  const ref = useRef(null);
  useEffect(() => {
    if (askedQuestion() === id) ref.current?.scrollIntoView({ block: 'start' });
  }, [id]);
  return html`
    <div id=${id} ref=${ref}>
      <${Collapsible} title=${tr(`help.q.${id}.q`, id)} open=${open} onToggle=${() => setOpen(o => !o)}>
        <p class="hlp-answer">${tr(`help.q.${id}.a`, '')}</p>
      <//>
    </div>
  `;
}

/**
 * The steps. A signed-in person reads their own path (journey.next first, then the open stages
 * after it), each a link to where it is done; a visitor reads the order a newcomer meets, as plain
 * text. Nothing renders while a signed-in person's path is still being read.
 */
function Steps() {
  const { journey, ready } = useJourney();
  const signedIn = hasSession();
  if (signedIn && !ready) return null;
  const mine = signedIn ? openSteps(journey) : null;
  if (mine) {
    return html`
      <h2 class="section-title">${t('help.nextTitle')}</h2>
      ${mine.length === 0 ? html`<p>${t('help.pathWalked')}</p>` : html`
        <ol class="hlp-steps">
          ${mine.map((id) => html`<li key=${id}><a href=${stepHref(id)}>${stepTitle(id)}</a>. ${stepLine(id)}</li>`)}
        </ol>`}
    `;
  }
  return html`
    <h2 class="section-title">${tr('help.startTitle', 'Getting started')}</h2>
    <ol class="hlp-steps">
      ${VISITOR_STEPS.map((id) => html`<li key=${id}><strong>${stepTitle(id)}</strong>. ${stepLine(id)}</li>`)}
    </ol>
    ${!signedIn && html`<p>${t('help.visitorNote')}</p>`}
    ${hasSite('learn') ? html`
      <p>${tr('help.start4', 'Learn the whole platform hands-on, free, without an account.')} <a href=${siteLink('learn')} target="_blank" rel="noopener">${tr('help.start4Link', 'Open the Experience Center')}</a></p>` : ''}
  `;
}

function HumanHelp({ onAskAi }) {
  const contact = contactHref(tr('help.contactSubject', 'A question about AIMEAT'));
  return html`
    <div class="hlp-human">
      <h2 class="section-title">${t('help.whatTitle')}</h2>
      <p>${t('help.whatLead')}</p>

      <${Steps} />

      <h2 class="section-title">${tr('help.qTitle', 'Common questions')}</h2>
      <div class="hlp-questions">
        ${QUESTIONS.map(k => html`<${Question} key=${k} id=${k} />`)}
      </div>

      <h2 class="section-title">${tr('help.stuckTitle', 'Still stuck')}</h2>
      <div class="hlp-stuck">
        <button class="hlp-btn" type="button" onClick=${onAskAi}>${tr('help.stuckAi', 'Ask your own AI: get the help prompt →')}</button>
        ${contact ? html`<a class="hlp-door" href=${contact}>${tr('help.stuckHuman', 'Ask a human →')}</a>` : ''}
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
        <h1 class="hlp-title">${tr('help.pageTitle', 'Help')}</h1>

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
