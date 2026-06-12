/**
 * @file start.js
 * @description The /v1/start diagnosis page ("How dead is your JIRA?"): a
 *   story-style choice flow that builds a visible trail, reveals a shareable
 *   verdict (Level 0–3), then asks three build questions and reveals a personal
 *   playbook checklist ending in a copyable startup prompt for the visitor's
 *   own AI. Entrance copy is selected with ?from=<slug> (one per LinkedIn-post
 *   angle). No login, no email gate — an account enters only as a playbook step.
 *   Flow data and playbook assembly live in ./start-flows.js.
 * @structure default StartView; internal: Intro, Question, Trail, Verdict, Playbook
 * @usage routed at /v1/start by spa.html (also /start redirect in portal.ts)
 * @version-history
 *   v1.0.0 — 2026-06-11 — Initial: jira entrance end-to-end (diagnose → verdict
 *     → build → playbook), print/copy support, three doors at the end.
 *   v1.0.1 — 2026-06-12 — Add body.st-active marker while mounted so start.css print
 *     rules apply only on this view (they blanked printing everywhere else).
 */
import { h } from 'preact';
import { useState, useEffect, useMemo } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { CopyButton } from '/components/CopyButton.js';
import {
  entranceFor, buildQuestionsFor, scoreAnswers, tierFor,
  buildPlaybook, playbookToMarkdown,
} from './start-flows.js';

const tr = (key, fallback) => { const v = t(key); return v && v !== key ? v : fallback; };
const trr = (pair) => tr(pair.k, pair.f);

function Trail({ steps }) {
  if (!steps.length) return null;
  return html`
    <div class="st-trail" aria-label=${tr('start.trailAria', 'Your path so far')}>
      ${steps.map((s, i) => html`<span key=${i} class="st-trail-chip">✓ ${s}</span>`)}
    </div>
  `;
}

function Question({ q, onPick, onBack }) {
  return html`
    <div class="st-q">
      <h2 class="st-q-title">${trr(q.title)}</h2>
      <div class="st-opts">
        ${q.options.map((o) => html`
          <button key=${o.id} type="button" class="st-opt" onClick=${() => onPick(q.id, o.id)}>
            ${trr(o.text)}
          </button>
        `)}
      </div>
      <button type="button" class="st-back" onClick=${onBack}>${tr('start.back', '← Change previous answer')}</button>
    </div>
  `;
}

function Verdict({ tier, score, shareText, onContinue, onBack }) {
  return html`
    <div class="st-verdict">
      <div class="st-verdict-label">${tr('start.verdictLabel', 'The verdict')}</div>
      <div class="st-verdict-card">
        <div class="st-verdict-name">${trr(tier.name)}</div>
        <p class="st-verdict-desc">${trr(tier.desc)}</p>
        <div class="st-verdict-score">${tr('start.scoreLabel', 'Score')}: ${score}/9</div>
      </div>
      <div class="st-verdict-actions">
        <${CopyButton} text=${shareText} className="btn-outline"
          label=${tr('start.copyVerdict', 'Copy the verdict')} copiedLabel=${tr('start.copied', 'Copied')} />
        <button type="button" class="btn-primary" onClick=${onContinue}>${tr('start.buildCta', 'Build my playbook →')}</button>
      </div>
      <p class="st-verdict-note">${tr('start.buildIntro', 'Verdict delivered. Three more choices: they become your playbook.')}</p>
      <button type="button" class="st-back" onClick=${onBack}>${tr('start.back', '← Change previous answer')}</button>
    </div>
  `;
}

function PlaybookItem({ item }) {
  return html`
    <li class="st-pb-item ${item.quote ? 'st-pb-item--quote' : ''}">
      ${item.text && !item.quote && html`
        <label class="st-pb-check"><input type="checkbox" /> <span>${trr(item.text)}</span></label>`}
      ${item.text && item.quote && html`<blockquote class="st-pb-quote">${trr(item.text)}</blockquote>`}
      ${item.code && html`
        <div class="st-pb-code">
          <pre>${item.code}</pre>
          <${CopyButton} text=${item.code} className="btn-ghost st-pb-copy" />
        </div>`}
      ${item.prompt && html`
        <div class="st-pb-prompt">
          <blockquote>${trr(item.prompt)}</blockquote>
          <${CopyButton} text=${trr(item.prompt)} className="btn-primary"
            label=${tr('start.copyPrompt', 'Copy the prompt')} copiedLabel=${tr('start.copied', 'Copied')} />
        </div>`}
      ${item.link && html`<a class="st-pb-link" href=${item.link.href}>${trr(item.link.label)}</a>`}
    </li>
  `;
}

function Playbook({ answers, tier, slug, onBack, onRestart }) {
  const mcpUrl = `${location.origin}/v1/mcp`;
  const sections = useMemo(() => buildPlaybook(answers, mcpUrl), [answers, mcpUrl]);
  const md = useMemo(
    () => playbookToMarkdown(sections, trr, tr('start.pb.title', 'Your playbook')),
    [sections],
  );
  const estimate = answers.path === 'hosted' ? tr('start.pb.estHosted', 'Estimated time: 10–15 minutes')
    : answers.path === 'self' ? tr('start.pb.estSelf', 'Estimated time: from zero to a running node, proven in 21 minutes')
    : null;

  return html`
    <div class="st-pb st-print-area">
      <div class="st-pb-head">
        <h2 class="st-pb-title">${tr('start.pb.title', 'Your playbook')}</h2>
        <p class="st-pb-sub">${tr('start.pb.sub', 'Built from your answers. Save it: it doubles as the first document of your first organism.')}</p>
        <p class="st-pb-tier">${trr(tier.name)}${estimate ? ` · ${estimate}` : ''}</p>
      </div>
      ${sections.map((s, i) => html`
        <section key=${i} class="st-pb-section">
          <h3>${trr(s.title)}</h3>
          <ul class="st-pb-items">
            ${s.items.map((it, j) => html`<${PlaybookItem} key=${j} item=${it} />`)}
          </ul>
        </section>
      `)}
      <div class="st-pb-actions st-no-print">
        <${CopyButton} text=${md} className="btn-outline"
          label=${tr('start.pb.copyAll', 'Copy playbook')} copiedLabel=${tr('start.copied', 'Copied')} />
        <button type="button" class="btn-outline" onClick=${() => window.print()}>${tr('start.pb.print', 'Print / save as PDF')}</button>
        <button type="button" class="st-back" onClick=${onBack}>${tr('start.back', '← Change previous answer')}</button>
        <button type="button" class="st-back" onClick=${onRestart}>${tr('start.restart', 'Start over')}</button>
      </div>
      <div class="st-doors st-no-print">
        <h3 class="st-doors-title">${tr('start.doors.title', 'Three doors')}</h3>
        <p class="st-doors-sub">${tr('start.doors.sub', 'Same house, three ways in. Your playbook covers the one you picked, the others wait here.')}</p>
        <div class="st-doors-grid">
          <a class="st-door" href="/v1/portal">
            <span class="st-door-name">${tr('start.doors.hosted', 'Try it hosted')}</span>
            <span class="st-door-desc">${tr('start.doors.hostedDesc', 'Free account, nothing to install.')}</span>
          </a>
          <a class="st-door" href="https://github.com/miikkij/aimeat-protocol" target="_blank" rel="noopener">
            <span class="st-door-name">${tr('start.doors.self', 'Build it yourself')}</span>
            <span class="st-door-desc">${tr('start.doors.selfDesc', 'MIT-licensed, your hardware, your keys.')}</span>
          </a>
          <a class="st-door" href="/v1/business">
            <span class="st-door-name">${tr('start.doors.help', 'Ask for help')}</span>
            <span class="st-door-desc">${tr('start.doors.helpDesc', 'Done-for-you and managed hosting.')}</span>
          </a>
        </div>
      </div>
    </div>
  `;
}

export default function StartView() {
  const slug = new URLSearchParams(location.search).get('from') || '';
  const entrance = entranceFor(slug);

  const [phase, setPhase] = useState('intro'); // intro | diag | verdict | build | playbook
  const [idx, setIdx] = useState(0);
  const [answers, setAnswers] = useState({});

  useEffect(() => { window.scrollTo(0, 0); }, [phase, idx]);

  // Mark the body while this view is mounted so start.css's print rules (which blank everything
  // except .st-print-area) apply only on this page — view CSS is preloaded globally in spa.html,
  // so unscoped print rules would blank printing on every other view.
  useEffect(() => {
    document.body.classList.add('st-active');
    return () => document.body.classList.remove('st-active');
  }, []);

  const diagQs = entrance.questions;
  const buildQs = useMemo(() => buildQuestionsFor(answers), [answers]);
  const score = scoreAnswers(diagQs, answers);
  const tier = tierFor(score);

  const shareUrl = `${location.origin}/v1/start${slug ? `?from=${encodeURIComponent(slug)}` : ''}`;
  const shareText = tr('start.share', 'I took the AIMEAT agent diagnosis. Result: {tier}. See what shape your agents are in: {url}')
    .replace('{tier}', trr(tier.name)).replace('{url}', shareUrl);

  const pick = (qid, optId) => {
    const next = { ...answers, [qid]: optId };
    setAnswers(next);
    if (phase === 'diag') {
      if (idx < diagQs.length - 1) setIdx(idx + 1);
      else setPhase('verdict');
    } else if (phase === 'build') {
      const qs = buildQuestionsFor(next);
      if (idx < qs.length - 1) setIdx(idx + 1);
      else setPhase('playbook');
    }
  };

  const dropAnswer = (qid) => setAnswers((prev) => {
    const rest = { ...prev };
    delete rest[qid];
    return rest;
  });

  const back = () => {
    if (phase === 'diag') {
      if (idx > 0) { dropAnswer(diagQs[idx - 1].id); setIdx(idx - 1); }
      else setPhase('intro');
    } else if (phase === 'verdict') {
      dropAnswer(diagQs[diagQs.length - 1].id);
      setPhase('diag'); setIdx(diagQs.length - 1);
    } else if (phase === 'build') {
      if (idx > 0) { dropAnswer(buildQs[idx - 1].id); setIdx(idx - 1); }
      else setPhase('verdict');
    } else if (phase === 'playbook') {
      dropAnswer(buildQs[buildQs.length - 1].id);
      setPhase('build'); setIdx(buildQs.length - 1);
    }
  };

  const restart = () => { setAnswers({}); setIdx(0); setPhase('intro'); };

  // Trail: answered questions in asked order, as the chosen option's text.
  const trail = [];
  const answered = phase === 'diag' ? diagQs.slice(0, idx)
    : phase === 'verdict' ? diagQs
    : phase === 'build' ? [...diagQs, ...buildQs.slice(0, idx)]
    : phase === 'playbook' ? [...diagQs, ...buildQs] : [];
  for (const q of answered) {
    const o = q.options.find((x) => x.id === answers[q.id]);
    if (o) trail.push(trr(o.text));
  }

  return html`
    <div class="st">
      ${phase === 'intro' ? html`
        <div class="st-hero">
          <h1 class="st-h1">${trr(entrance.title)}</h1>
          <p class="st-hero-sub">${trr(entrance.sub)}</p>
          <button type="button" class="btn-primary st-start-btn" onClick=${() => { setPhase('diag'); setIdx(0); }}>
            ${tr('start.startCta', 'Start the diagnosis')}
          </button>
          <p class="st-hero-meta">${tr('start.meta', '3 questions · a verdict · a playbook')}</p>
        </div>
      ` : html`
        <div class="st-header">
          <div class="st-header-title">${trr(entrance.title)}</div>
          <${Trail} steps=${trail} />
        </div>
        ${phase === 'diag' && html`<${Question} q=${diagQs[idx]} onPick=${pick} onBack=${back} />`}
        ${phase === 'verdict' && html`<${Verdict} tier=${tier} score=${score} shareText=${shareText}
          onContinue=${() => { setPhase('build'); setIdx(0); }} onBack=${back} />`}
        ${phase === 'build' && html`<${Question} q=${buildQs[idx]} onPick=${pick} onBack=${back} />`}
        ${phase === 'playbook' && html`<${Playbook} answers=${answers} tier=${tier} slug=${slug}
          onBack=${back} onRestart=${restart} />`}
      `}
      <div class="st-footer st-no-print">
        ${tr('start.footer', 'AIMEAT is open source (MIT).')}${' '}
        <a href="https://github.com/miikkij/aimeat-protocol" target="_blank" rel="noopener">github.com/miikkij/aimeat-protocol</a>
      </div>
    </div>
  `;
}
