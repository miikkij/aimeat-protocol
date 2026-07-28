/**
 * @file business.js
 * @description "For your business" page: night-shift hero, then cases grouped by how far
 *   up the value ladder they sit — work happens without you, the company runs here, the
 *   company earns here — a sovereignty section (the reason a regulated buyer signs), a
 *   free assessment as the entry point, and the shared ContactCard.
 *
 *   EVERY app referenced here resolves through siteLinks (window.__SITE). A node that has
 *   not configured a given app renders that case without its proof link, or drops the case
 *   entirely when the app IS the case. Another operator's business page must never point
 *   at aimeat.io's apps. No protocol terms; "organism" and "node" are product names,
 *   explained on first use.
 * @usage routed at /v1/business by spa.html
 * @version-history
 *   v1.0.0 — 2026-06-10 — Initial (owner spec).
 *   v1.1.0 — 2026-06-20 — H-2: published-app proof links open in a sandboxed opaque-origin
 *     iframe (openAppSandboxed) instead of a top-level apex ?mode=inline tab.
 *   v2.0.0 — 2026-07-28 — Six cases from June became three groups following the value ladder,
 *     with what shipped since then: a CRM, a marketplace, an API accelerator, playbooks, a
 *     public roadmap. Four of six CTAs used to be a mailto even where a working product
 *     existed; each case now opens the real thing. Adds the sovereignty section (EU AI Act,
 *     NIS2, own server, revocable grants, MIT) which is often the actual reason to buy, and
 *     a free assessment as the low-commitment entry. Every app link is operator-configurable.
 */
import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { ContactCard } from '/components/ContactCard.js';
import { openAppSandboxed, isAppHtmlUrl } from '/js/app-sandbox.js';
import { siteLink, hasSite, contactHref } from '/js/site.js';
import { swallowed } from '/js/swallowed.js';

const tr = (key, fallback) => { const v = t(key); return v && v !== key ? v : fallback; };

/* One outcome, told in the first person, with a way to check it and a way to start.
   `proofHref` empty → the case still renders, just without the proof link. */
function Case({ id, title, text, quote, quoteBy, proofHref, proofLabel, proofNote, ctaLabel, ctaHref }) {
  return html`
    <div class="ld-case" id=${id}>
      <h3 class="ld-case-title">${title}</h3>
      <p class="ld-case-text">${text}</p>
      ${quote && html`<blockquote class="ld-case-quote">“${quote}”<footer>— ${quoteBy}</footer></blockquote>`}
      ${proofHref
        // H-2: published-app proof links open in a sandboxed opaque-origin iframe, never a
        // top-level apex document. Non-app evidence (public viewers, external sites) opens normally.
        ? (isAppHtmlUrl(proofHref)
          ? html`<a class="ld-case-proof" href="#" role="button" onClick=${(e) => { e.preventDefault(); openAppSandboxed(proofHref, proofLabel); }}>${proofLabel}</a>`
          : html`<a class="ld-case-proof" href=${proofHref} target="_blank" rel="noopener">${proofLabel}</a>`)
        : proofNote && html`<div class="ld-case-proofnote">${proofNote}</div>`}
      ${ctaHref ? html`<a class="ld-path-cta" href=${ctaHref}>${ctaLabel}</a>` : ''}
    </div>
  `;
}

/* A group whose every case is gated off (this node has none of those apps) renders nothing
   at all. Checked here rather than in CSS: htm leaves whitespace text nodes between the
   conditionals, so `.ld-cases:empty` would never match and the heading would sit alone. */
function Group({ title, children }) {
  const kids = (Array.isArray(children) ? children.flat(Infinity) : [children])
    .filter(c => c !== null && c !== undefined && c !== false && c !== '');
  if (kids.length === 0) return null;
  return html`
    <section class="ld-casegroup">
      <h2 class="ld-casegroup-title">${title}</h2>
      <div class="ld-cases">${kids}</div>
    </section>
  `;
}

export default function Business({ navigate }) {
  const CONTACT = contactHref();

  // Live proof: the paper this node's agents write. Resolved from the apps API when the
  // operator has not pinned a URL, so the link survives a rename.
  const [paper, setPaper] = useState(null);
  useEffect(() => {
    if (hasSite('paper')) return undefined;
    fetch('/v1/apps?limit=100').then(r => r.json()).then(j => {
      const apps = j?.data?.apps || [];
      setPaper(apps.find(a => /sanomat/i.test(a.filename || '') || /sanomat/i.test(a.name || '')) || null);
    }).catch(err => { swallowed('business: paper lookup', err); });
    return undefined;
  }, []);
  const paperHref = hasSite('paper')
    ? siteLink('paper')
    : (paper ? `/v1/apps/${encodeURIComponent(paper.owner)}/${encodeURIComponent(paper.filename)}?mode=inline` : '');

  return html`
    <div class="ld ld-business">
      <!-- Hero: the night-shift image (assets/yovuoro_freepartylights.png) — the text
           column sits in the image's empty right side as HTML, never baked in. -->
      <section class="ld-bhero">
        <img class="ld-bhero-img" src="/img/business-hero.png" alt=""
          onError=${(e) => { e.target.style.display = 'none'; e.target.closest('.ld-bhero')?.classList.add('ld-bhero--noimg'); }} />
        <div class="ld-bhero-text">
          <h1 class="ld-h1">${tr('biz.heroTitle', 'A digital employee that never sleeps')}</h1>
          <p class="ld-hero-sub">${tr('biz.heroSub', 'Scheduled agents fetch, write, report and ship while you do something else. Every step traceable, and what they produce is yours.')}</p>
        </div>
      </section>

      <${Group} title=${tr('biz.g1Title', 'The work happens without you')}>
        <${Case} id="case-news"
          title=${tr('biz.c1Title', 'I wake up already knowing what happened in my field')}
          text=${tr('biz.c1Text', 'A publication that writes itself every evening. Agents pull the raw material, write the pieces and ship the edition. Zero human hours.')}
          proofHref=${paperHref}
          proofLabel=${tr('biz.c1Proof', "Read tonight's edition →")}
          ctaLabel=${tr('biz.c1Cta', 'The same, from your topics →')} ctaHref=${CONTACT} />
        <${Case} id="case-report"
          title=${tr('biz.c2Title', 'My morning briefing is waiting, and it knows what is stale')}
          text=${tr('biz.c2Text', 'Say once what you want to know every morning. An agent gathers, summarises and sends, and the board shows how old each answer is with a button that puts the agent back to work.')}
          proofHref=${siteLink('briefing')}
          proofLabel=${tr('biz.c2Proof', 'Open the briefing board →')}
          proofNote=${tr('biz.c2ProofNote', 'Example, sent today at 07:00: "3 new bookings · 1 review (4★, answered) · a competitor dropped prices · suggested action: weekend campaign."')}
          ctaLabel=${tr('biz.c2Cta', 'Order your morning briefing →')} ctaHref=${CONTACT} />
        <${Case} id="case-radar"
          title=${tr('biz.c3Title', 'I know what is being said about us, and what to do about it')}
          text=${tr('biz.c3Text', 'An agent tracks mentions, competitors and registry changes, and produces an action list. Company cards fill themselves from open data.')}
          proofHref=${siteLink('radar')}
          proofLabel=${tr('biz.c3Proof', 'Open the company radar →')}
          proofNote=${tr('biz.c3ProofNote', 'Example action list: "1) Answer the review on platform Y today. 2) Trend Z is rising, draft a post. 3) A competitor launched a campaign, counter-offer attached."')}
          ctaLabel=${tr('biz.c3Cta', 'Start the radar →')} ctaHref=${CONTACT} />
      <//>

      <${Group} title=${tr('biz.g2Title', 'The company runs on it')}>
        ${hasSite('crm') ? html`
          <${Case} id="case-crm"
            title=${tr('biz.c7Title', 'My CRM costs less than lunch, and my agents keep it fed')}
            text=${tr('biz.c7Text', 'Contacts, companies, deals and follow-ups as versioned records you own. Tap to dial, dictate the note by voice, set the next follow-up. Company cards enrich themselves from the trade register.')}
            proofHref=${siteLink('crm')}
            proofLabel=${tr('biz.c7Proof', 'Open the CRM →')}
            ctaLabel=${tr('biz.c7Cta', 'Move your CRM here →')} ctaHref=${CONTACT} />` : ''}
        <${Case} id="case-dev"
          title=${tr('biz.c4Title', 'My project knows its own status')}
          text=${tr('biz.c4Text', 'When developers have agents, sprints slow things down. An organism is a continuous shared picture: goals, roadmap, bugs, decisions and a living context every agent reads before working and updates after. A human approves the decisions; everything else moves at agent speed.')}
          quote=${tr('biz.c4Quote', 'This could replace Jira.')} quoteBy=${tr('biz.c4QuoteBy', 'game developer, large studio')}
          proofHref=${siteLink('roadmap')}
          proofLabel=${tr('biz.c4Proof', 'Open our own roadmap, live →')}
          proofNote=${tr('biz.proofUnavailable', 'Live proof runs on the operator’s node.')}
          ctaLabel=${tr('biz.c4Cta', 'Turn your project into an organism →')} ctaHref=${CONTACT} />
        <${Case} id="case-feedback"
          title=${tr('biz.c5Title', "A user's idea shipped the same day")}
          text=${tr('biz.c5Text', 'A user left an idea in the morning. An agent triaged it into a task, implemented it, ran the tests, updated the status page and marked the feedback resolved. A human confirmed it works. The whole chain is traceable: feedback → task → release.')}
          proofHref=${siteLink('roadmap')}
          proofLabel=${tr('biz.c5Proof', 'Follow one from idea to release →')}
          proofNote=${tr('biz.proofUnavailable', 'Live proof runs on the operator’s node.')}
          ctaLabel=${tr('biz.c5Cta', 'Open a feedback loop for your customers →')} ctaHref=${CONTACT} />
      <//>

      <${Group} title=${tr('biz.g3Title', 'The company earns on it')}>
        ${hasSite('apiAccelerator') ? html`
          <${Case} id="case-api"
            title=${tr('biz.c8Title', 'My API is something agents can find, use and pay for')}
            text=${tr('biz.c8Text', 'You already have an API. Agents cannot find it, cannot read it and cannot pay for it. That is a day of work, not a project.')}
            proofHref=${siteLink('apiAccelerator')}
            proofLabel=${tr('biz.c8Proof', 'See what agent-native looks like →')}
            ctaLabel=${tr('biz.c8Cta', 'Make your API agent-native →')} ctaHref=${CONTACT} />` : ''}
        ${hasSite('exchange') ? html`
          <${Case} id="case-exchange"
            title=${tr('biz.c9Title', 'My data sells itself while I sleep')}
            text=${tr('biz.c9Text', 'Publish a capability once and it carries a price. Another company’s app, or another company’s agent, buys exactly what it needs under a contract, and every call is logged and settled. You see what it earned; the buyer saw the price before the first call.')}
            proofHref=${siteLink('exchange')}
            proofLabel=${tr('biz.c9Proof', 'Open the marketplace →')}
            ctaLabel=${tr('biz.c9Cta', 'List your first capability →')} ctaHref=${CONTACT} />` : ''}
        ${hasSite('playbooks') ? html`
          <${Case} id="case-playbooks"
            title=${tr('biz.c10Title', 'What we know how to do is now a product')}
            text=${tr('biz.c10Text', 'A way of working, packaged: the steps, the prompts, the checks. Run it for one team, then for the next customer without rebuilding it.')}
            proofHref=${siteLink('playbooks')}
            proofLabel=${tr('biz.c10Proof', 'Open a playbook →')}
            ctaLabel=${tr('biz.c10Cta', 'Package what you know →')} ctaHref=${CONTACT} />` : ''}
        ${hasSite('showcase') ? html`
          <${Case} id="case-node"
            title=${tr('biz.c6Title', 'A whole company running on its own node')}
            text=${tr('biz.c6Text', "The homepage lives in agent memory on its own AIMEAT node, federated into the network. One crew audits the node every morning at 04:00; another runs research overnight.")}
            quote=${'Every discovery is a mistake that survived long enough to prove itself.'}
            quoteBy=${'Kalle Määttä, founder, The Original Miskate Oy'}
            proofHref=${siteLink('showcase')}
            proofLabel=${tr('biz.c6Proof', 'Open a living node →')}
            ctaLabel=${tr('biz.c6Cta', 'See hosting packages →')} ctaHref="/v1/pricing" />` : ''}
      <//>

      <!-- The reason a regulated buyer signs. Often decisive before any of the cases above. -->
      <section class="ld-sovereignty">
        <h2 class="ld-casegroup-title">${tr('biz.sovTitle', 'Why owning it is the reason to buy')}</h2>
        <ul class="ld-sov-list">
          <li>${tr('biz.sov0', 'A company here is a node, not an account type. You take your own AIMEAT node, put your business identity and your own payment keys on it, invite your people and build the apps your work needs. Nothing about it is a separate product tier.')}</li>
          <li>${tr('biz.sov1', 'Your data stays on a server you control. We do not see it and do not keep it, so your own certification is the one that counts.')}</li>
          <li>${tr('biz.sov2', 'Every action is logged: who read what, who authorised it, what it cost. The audit is a report, not a project.')}</li>
          <li>${tr('biz.sov3', 'Agents and apps work under named permissions you can take back with one click, and every action is attributed to whoever took it.')}</li>
          <li>${tr('biz.sov4', 'The code is MIT licensed and readable. A closed competitor can only promise the same thing.')}</li>
        </ul>
      </section>

      <div class="ld-stats">
        <div class="ld-stats-line">${tr('biz.allLive', 'Everything above runs in production right now. No proof is a mockup.')}</div>
        <div class="ld-ctarow">
          ${hasSite('assessment') ? html`
            <a class="btn-primary" href=${siteLink('assessment')} target="_blank" rel="noopener">${tr('biz.ctaAssessment', 'Free: where is your AI right now? →')}</a>` : ''}
          ${CONTACT ? html`<a class=${hasSite('assessment') ? 'btn-outline' : 'btn-primary'} href=${CONTACT}>${tr('biz.ctaDemo', 'Book a demo →')}</a>` : ''}
          <a class="btn-outline" href="/v1/pricing" onClick=${(e) => { e.preventDefault(); navigate('/v1/pricing'); }}>${tr('biz.ctaPricing', 'See pricing →')}</a>
        </div>
      </div>

      <${ContactCard} />
    </div>
  `;
}
