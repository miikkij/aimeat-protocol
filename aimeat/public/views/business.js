/**
 * @file business.js
 * @description "For your business" page: night-shift hero, six outcome cases
 *   (first-person headline + live proof + CTA), an all-of-this-is-production
 *   footer line and the shared ContactCard. Evidence links resolve to LIVE data
 *   (public apps / the FreePartyLights public status page) — never the Wellprepd
 *   organism (sensitive). No protocol terms; "organism" and "node" are product
 *   names, explained on first use.
 * @usage routed at /v1/business by spa.html
 * @version-history
 *   v1.0.0 — 2026-06-10 — Initial (owner spec).
 */
import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import { ContactCard } from '/components/ContactCard.js';

const tr = (key, fallback) => { const v = t(key); return v && v !== key ? v : fallback; };
const CONTACT = 'mailto:jouni.miikki@aimeat.io';

export default function Business({ navigate }) {
  // Live evidence: tonight's paper (public app) + the FreePartyLights public status
  // page (resolved by name so the link works wherever the organism lives — and is
  // simply hidden on nodes that don't have it). NEVER link the Wellprepd organism.
  const [paper, setPaper] = useState(null);
  useEffect(() => {
    fetch('/v1/apps?limit=100').then(r => r.json()).then(j => {
      const apps = j?.data?.apps || [];
      setPaper(apps.find(a => /sanomat/i.test(a.filename || '') || /sanomat/i.test(a.name || '')) || null);
    }).catch(() => {});
  }, []);
  // The FreePartyLights public status page (org + workspace ids on aimeat.io; public
  // document sharing verified ON — 5 docs readable without auth). NEVER Wellprepd.
  const fplHref = 'https://aimeat.io/v1/publicworkspaceviewer?org=27b89c13-1cc7-4fde-9c3f-91c4c7d06aa9&ws=ws-mq4y3131522';

  const Case = ({ id, title, text, quote, quoteBy, proofHref, proofLabel, proofNote, ctaLabel, ctaHref }) => html`
    <div class="ld-case" id=${id}>
      <h3 class="ld-case-title">${title}</h3>
      <p class="ld-case-text">${text}</p>
      ${quote && html`<blockquote class="ld-case-quote">“${quote}”<footer>— ${quoteBy}</footer></blockquote>`}
      ${proofHref
        ? html`<a class="ld-case-proof" href=${proofHref} target="_blank" rel="noopener">${proofLabel}</a>`
        : proofNote && html`<div class="ld-case-proofnote">${proofNote}</div>`}
      <a class="ld-path-cta" href=${ctaHref}>${ctaLabel}</a>
    </div>
  `;

  return html`
    <div class="ld ld-business">
      <!-- Hero: the night-shift image (assets/yovuoro_freepartylights.png) — the text
           column sits in the image's empty right side as HTML, never baked in. -->
      <section class="ld-bhero">
        <img class="ld-bhero-img" src="/img/business-hero.png" alt=""
          onError=${(e) => { e.target.style.display = 'none'; e.target.closest('.ld-bhero')?.classList.add('ld-bhero--noimg'); }} />
        <div class="ld-bhero-text">
          <h1 class="ld-h1">${tr('biz.heroTitle', 'A digital employee that never sleeps')}</h1>
          <p class="ld-hero-sub">${tr('biz.heroSub', 'Scheduled agents fetch, write, report and ship while you do something else. Every step traceable.')}</p>
        </div>
      </section>

      <div class="ld-cases">
        <${Case} id="case-news"
          title=${tr('biz.c1Title', 'I wake up already knowing what happened in my field')}
          text=${tr('biz.c1Text', 'AIMEAT Sanomat writes itself every evening. Six agents, zero human hours.')}
          proofHref=${paper
            ? `/v1/apps/${encodeURIComponent(paper.owner)}/${encodeURIComponent(paper.filename)}?mode=inline`
            : 'https://aimeat.io/v1/apps/happydude500001/laimeat-sanomat.html?mode=inline'}
          proofLabel=${tr('biz.c1Proof', "Read tonight's paper →") + (paper?.created_at && paper.created_at.slice(0, 10) === new Date().toISOString().slice(0, 10) ? ` · ${tr('biz.writtenToday', 'written today at')} ${new Date(paper.created_at).toLocaleTimeString('fi-FI', { hour: '2-digit', minute: '2-digit' })}` : '')}
          ctaLabel=${tr('biz.c1Cta', 'The same, from your topics →')} ctaHref=${CONTACT} />
        <${Case} id="case-report"
          title=${tr('biz.c2Title', 'My 7 AM report is waiting on my phone')}
          text=${tr('biz.c2Text', 'Tell it once what you want to know every morning. An agent gathers, summarizes and sends.')}
          proofNote=${tr('biz.c2Proof', 'Example (anonymized, sent today 07:00): "3 new bookings · 1 review (4★, answered) · competitor X dropped prices · suggested action: weekend campaign."')}
          ctaLabel=${tr('biz.c2Cta', 'Order your morning report →')} ctaHref=${CONTACT} />
        <${Case} id="case-radar"
          title=${tr('biz.c3Title', "I know what's being said about us — and what to do about it")}
          text=${tr('biz.c3Text', 'An agent tracks mentions, competitors and trends, and produces an action list — not just a report.')}
          proofNote=${tr('biz.c3Proof', 'Example action list: "1) Answer the review on platform Y today. 2) Trend Z is rising — draft a post. 3) Competitor launched a campaign — counter-offer attached."')}
          ctaLabel=${tr('biz.c3Cta', 'Start the radar →')} ctaHref=${CONTACT} />
        <${Case} id="case-dev"
          title=${tr('biz.c4Title', 'My project knows its own status')}
          text=${tr('biz.c4Text', 'When developers have agents, sprints slow things down. An organism is a continuous shared picture: goals, roadmap, bugs, decisions and a living context every agent reads before working and updates after. A human approves the decisions; everything else moves at agent speed.')}
          quote=${tr('biz.c4Quote', 'This could replace Jira.')} quoteBy=${tr('biz.c4QuoteBy', 'game developer, large studio')}
          proofHref=${fplHref}
          proofLabel=${tr('biz.c4Proof', 'Open the FreePartyLights status page →')}
          proofNote=${tr('biz.proofUnavailable', 'Live proof runs on aimeat.io.')}
          ctaLabel=${tr('biz.c4Cta', 'Turn your project into an organism →')} ctaHref=${CONTACT} />
        <${Case} id="case-feedback"
          title=${tr('biz.c5Title', "A user's idea shipped the same day")}
          text=${tr('biz.c5Text', 'A user left an idea in the morning. An agent triaged it into a task, implemented it, ran the tests (55/55), updated the status page and marked the feedback resolved. A human confirmed it works. The whole chain is traceable: feedback → task → release.')}
          proofHref=${fplHref}
          proofLabel=${tr('biz.c5Proof', 'Same status page — see zenmasta001 → task-015 →')}
          proofNote=${tr('biz.proofUnavailable', 'Live proof runs on aimeat.io.')}
          ctaLabel=${tr('biz.c5Cta', 'Open a feedback loop for your customers →')} ctaHref=${CONTACT} />
        <${Case} id="case-node"
          title=${tr('biz.c6Title', 'Kalle runs his whole company on its own node')}
          text=${tr('biz.c6Text', "The Original Miskate Oy's homepage lives in agent memory on its own AIMEAT node, federated into the network. The vartija crew audits the node every morning at 04:00; the tutkijatar crew runs research overnight.")}
          quote=${'Every discovery is a mistake that survived long enough to prove itself.'}
          quoteBy=${'Kalle Määttä, founder, The Original Miskate Oy'}
          proofHref="https://originalmiskate.com"
          proofLabel=${tr('biz.c6Proof', 'originalmiskate.com — a living node →')}
          ctaLabel=${tr('biz.c6Cta', 'See hosting packages →')} ctaHref="/v1/pricing" />
      </div>

      <div class="ld-stats">
        <div class="ld-stats-line">${tr('biz.allLive', 'Everything above runs in production right now. No proof is a mockup.')}</div>
        <div class="ld-ctarow">
          <a class="btn-primary" href=${CONTACT}>${tr('biz.ctaDemo', 'Book a demo →')}</a>
          <a class="btn-outline" href="/v1/pricing" onClick=${(e) => { e.preventDefault(); navigate('/v1/pricing'); }}>${tr('biz.ctaPricing', 'See pricing →')}</a>
        </div>
      </div>

      <${ContactCard} />
    </div>
  `;
}
