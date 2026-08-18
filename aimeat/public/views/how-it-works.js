/**
 * @file how-it-works.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description "How it works" page: H1 + intro, a hand-written inline SVG pipeline
 *   diagram (models → agents → organism → your assets, human at the gate), three
 *   explainer cards, a live example box (real public app link) and a CTA row.
 *   Diagram texts are i18n keys so the FI/EN switch translates the SVG too; a
 *   vertical variant renders on mobile. No protocol terms in body copy.
 * @usage routed at /v1/how-it-works by spa.html
 * @version-history
 *   v1.0.0 — 2026-06-10 — Initial (owner spec).
 *   v1.1.0 — 2026-06-20 — H-2: the live-example app link opens in a sandboxed opaque-origin
 *     iframe (openAppSandboxed) instead of a top-level apex ?mode=inline tab.
 *   v2.0.0 — 2026-07-28 — The chain ends at EXCHANGE, not at "your assets": one more box is
 *     what separates this from any other agent platform, because the result can carry a price.
 *     Two cards added (Apps — the thing the front page tells you to build, absent here until
 *     now; Consent — the ownership guarantee that sells to a regulated buyer). Examples go from
 *     one to three, one per layer, each rendered only if this node has that app (siteLinks).
 *     Both SVG variants grew a box: wide viewBox 330 → 430, tall 690 → 810.
 */
import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { openAppSandboxed } from '/js/app-sandbox.js';
import { siteLink, hasSite } from '/js/site.js';
import { swallowed } from '/js/swallowed.js';

const tr = (key, fallback) => { const v = t(key); return v && v !== key ? v : fallback; };

/* Diagram block: rect + up to 5 short text lines. Colors via CSS vars so dark mode works.
 * NB: htm passes attribute values as STRINGS — coerce before arithmetic, or "10" + 95
 * becomes "1095" and every text lands far outside its box (the empty-boxes bug). */
function Block({ x, y, w, h: hh, title, lines, hot }) {
  const X = Number(x), Y = Number(y), W = Number(w);
  return html`
    <g>
      <rect x=${X} y=${Y} width=${W} height=${Number(hh)} rx="10"
        fill="var(--card)" stroke=${hot ? 'var(--accent, #E8564A)' : 'var(--border)'} stroke-width=${hot ? 2 : 1.5} />
      <text x=${X + W / 2} y=${Y + 22} text-anchor="middle" font-size="13" font-weight="700" fill="var(--text)">${title}</text>
      ${lines.map((l, i) => html`
        <text key=${i} x=${X + W / 2} y=${Y + 42 + i * 16} text-anchor="middle" font-size="11" fill="var(--text-dim)">${l}</text>
      `)}
    </g>
  `;
}

/* The model-swap caption, wrapped to two centered lines so it stays inside the viewBox. */
function Caption({ x, y, note }) {
  const parts = note.split(/\s*[—,]\s*/);
  const lines = parts.length >= 2 ? [parts[0], parts.slice(1).join(', ')] : [note];
  return html`
    <g>
      ${lines.map((l, i) => html`
        <text key=${i} x=${Number(x)} y=${Number(y) + i * 13} text-anchor="middle" font-size="10" font-style="italic" fill="var(--text-dim)">${l}</text>
      `)}
    </g>
  `;
}

// Same string-coercion trap as Block: htm passes attrs as strings, and "95" + 4
// is "954" — the arrowhead's third point leaked far below the line. Coerce first.
const Arrow = (props) => {
  const x1 = Number(props.x1), y1 = Number(props.y1), x2 = Number(props.x2), y2 = Number(props.y2);
  return html`
    <g stroke="var(--text-dim)" stroke-width="1.5" fill="var(--text-dim)">
      <line x1=${x1} y1=${y1} x2=${x2} y2=${y2} />
      <polygon points=${`${x2},${y2} ${x2 - 7},${y2 - 4} ${x2 - 7},${y2 + 4}`}
        transform=${y1 === y2 ? '' : `rotate(90 ${x2} ${y2})`} />
    </g>
  `;
};

function Diagram() {
  const models = { title: tr('hiw.dModels', 'AI models'), lines: [tr('hiw.dModels1', 'Swappable:'), tr('hiw.dModels2', 'Claude, GPT, Grok'), tr('hiw.dModels3', 'CrewAI, your own')] };
  const agents = { title: tr('hiw.dAgents', 'Agents'), lines: [tr('hiw.dAgents1', 'A job for an AI:'), tr('hiw.dAgents2', 'identity, memory'), tr('hiw.dAgents3', 'task queue, schedule'), tr('hiw.dAgents4', 'budget, quality')] };
  const org = { title: tr('hiw.dOrg', 'Organism'), lines: [tr('hiw.dOrg1', 'Shared truth:'), tr('hiw.dOrg2', 'workspaces, versions'), tr('hiw.dOrg3', 'humans + agents'), tr('hiw.dOrg4', 'publish gate')] };
  const assets = { title: tr('hiw.dAssets', 'Your assets'), lines: [tr('hiw.dAssets1', 'Versioned knowledge'), tr('hiw.dAssets2', 'apps and reports')] };
  const human = { title: tr('hiw.dHuman', 'Human at the gate'), lines: [tr('hiw.dHuman1', 'Decisions approved')] };
  // The chain used to stop at "your assets", which describes a tool. One more box is what
  // separates this from every other agent platform: the result can carry a price.
  const exch = { title: tr('hiw.dExchange', 'EXCHANGE'), lines: [tr('hiw.dExchange1', 'Priced capabilities'), tr('hiw.dExchange2', 'contracts, settlement'), tr('hiw.dExchange3', 'other companies')] };
  const note = tr('hiw.dNote', 'The model can change — work and memory stay');

  return html`
    <div class="hiw-diagram">
      <!-- Desktop: left → right, assets below organism, human wired to the gate, EXCHANGE last. -->
      <svg class="hiw-svg hiw-svg--wide" viewBox="0 0 880 430" role="img" aria-label=${tr('hiw.dAria', 'How AIMEAT works')}>
        <${Block} x="10" y="40" w="190" h="110" title=${models.title} lines=${models.lines} />
        <${Caption} x="105" y="172" note=${note} />
        <${Arrow} x1="200" y1="95" x2="240" y2="95" />
        <${Block} x="240" y="30" w="200" h="130" title=${agents.title} lines=${agents.lines} hot />
        <${Arrow} x1="440" y1="95" x2="480" y2="95" />
        <${Block} x="480" y="30" w="200" h="130" title=${org.title} lines=${org.lines} />
        <line x1="580" y1="160" x2="580" y2="200" stroke="var(--text-dim)" stroke-width="1.5" />
        <polygon points="580,205 576,198 584,198" fill="var(--text-dim)" />
        <${Block} x="480" y="205" w="200" h="85" title=${assets.title} lines=${assets.lines} hot />
        <${Block} x="710" y="50" w="160" h="70" title=${human.title} lines=${human.lines} />
        <line x1="710" y1="85" x2="680" y2="85" stroke="var(--accent, #E8564A)" stroke-width="1.5" stroke-dasharray="4 3" />
        <line x1="580" y1="290" x2="580" y2="325" stroke="var(--text-dim)" stroke-width="1.5" />
        <polygon points="580,330 576,323 584,323" fill="var(--text-dim)" />
        <${Block} x="480" y="330" w="200" h="90" title=${exch.title} lines=${exch.lines} hot />
      </svg>
      <!-- Mobile: same content stacked vertically. -->
      <svg class="hiw-svg hiw-svg--tall" viewBox="0 0 320 810" role="img" aria-label=${tr('hiw.dAria', 'How AIMEAT works')}>
        <${Block} x="40" y="10" w="240" h="105" title=${models.title} lines=${models.lines} />
        <${Caption} x="160" y="128" note=${note} />
        <line x1="160" y1="140" x2="160" y2="165" stroke="var(--text-dim)" stroke-width="1.5" />
        <polygon points="160,170 156,163 164,163" fill="var(--text-dim)" />
        <${Block} x="40" y="172" w="240" h="125" title=${agents.title} lines=${agents.lines} hot />
        <line x1="160" y1="297" x2="160" y2="322" stroke="var(--text-dim)" stroke-width="1.5" />
        <polygon points="160,327 156,320 164,320" fill="var(--text-dim)" />
        <${Block} x="40" y="330" w="240" h="125" title=${org.title} lines=${org.lines} />
        <${Block} x="40" y="470" w="240" h="70" title=${human.title} lines=${human.lines} />
        <line x1="160" y1="455" x2="160" y2="470" stroke="var(--accent, #E8564A)" stroke-width="1.5" stroke-dasharray="4 3" />
        <line x1="160" y1="540" x2="160" y2="565" stroke="var(--text-dim)" stroke-width="1.5" />
        <polygon points="160,570 156,563 164,563" fill="var(--text-dim)" />
        <${Block} x="40" y="575" w="240" h="90" title=${assets.title} lines=${assets.lines} hot />
        <line x1="160" y1="665" x2="160" y2="690" stroke="var(--text-dim)" stroke-width="1.5" />
        <polygon points="160,695 156,688 164,688" fill="var(--text-dim)" />
        <${Block} x="40" y="700" w="240" h="95" title=${exch.title} lines=${exch.lines} hot />
      </svg>
    </div>
  `;
}

export default function HowItWorks({ navigate }) {
  // Live example: find the public Sanomat app from the catalog (works without login).
  const [paper, setPaper] = useState(null);
  useEffect(() => {
    fetch('/v1/apps?limit=100').then(r => r.json()).then(j => {
      const apps = j?.data?.apps || [];
      setPaper(apps.find(a => /sanomat/i.test(a.filename || '') || /sanomat/i.test(a.name || '')) || null);
    }).catch(err => { swallowed('how-it-works: HowItWorks', err); });
  }, []);

  const card = (titleKey, titleFb, textKey, textFb) => html`
    <div class="ld-path">
      <h3>${tr(titleKey, titleFb)}</h3>
      <p>${tr(textKey, textFb)}</p>
    </div>
  `;

  return html`
    <div class="ld">
      <section class="ld-hero">
        <h1 class="ld-h1">${tr('hiw.title', 'A place where AIs go to work, and where the work is yours to sell')}</h1>
        <p class="ld-hero-sub">${tr('hiw.intro', 'AIMEAT does not run AI models. It gives any AI an identity, a memory, a task queue and a manager. What the work produces stays yours, and it can carry a price.')}</p>
      </section>

      <${Diagram} />

      <div class="ld-paths">
        ${card('hiw.cardAgentsTitle', 'Agents', 'hiw.cardAgentsText', 'An agent is not an AI — it is a job for an AI. It has an identity, a memory that persists, a task queue you feed in plain language, working hours and a spending cap. Quality can be reviewed afterwards. Run it on any model — CrewAI, Claude, GPT, your own runtime.')}
        ${card('hiw.cardOrgTitle', 'Organisms', 'hiw.cardOrgText', "An organism turns agent output into assets. Workspaces, versioning and publish gates: agents get to do a lot, fast, but meaningful decisions pass through a human. Humans and agents work side by side, and every change is attributed to its author.")}
        ${card('hiw.cardAppsTitle', 'Apps', 'hiw.cardAppsText', 'Describe what you want and your AI builds it. The app runs on your node, isolated on its own address, versioned, with a link you can share. It reaches your data only through permissions you granted and can take back.')}
        ${card('hiw.cardConsentTitle', 'Consent', 'hiw.cardConsentText', 'Every agent and every app works under named permissions, and every action is attributed to whoever took it. Take a permission back and the door closes. The audit is a report, not a project.')}
        ${card('hiw.cardAssetsTitle', 'Your assets', 'hiw.cardAssetsText', 'Models come and go. Identity, memory, work history and results stay on your node. Swap Grok for Claude mid-flight — the agent picks up where it left off.')}
      </div>

      <!-- Three examples from three layers, so the page shows more than one thing the
           platform does. Each renders only if this node actually has it. -->
      <div class="ld-stats ld-stats--withimg">
        <img class="ld-example-img" src="/img/toimitus.png" alt="" loading="lazy"
          onError=${(e) => { e.target.style.display = 'none'; }} />
        <div class="ld-stats-line">${tr('hiw.exampleTitle', 'Examples from this node')}</div>
        <div class="ld-stats-own">
          ${tr('hiw.exampleText', 'AIMEAT Sanomat writes itself every evening. news-fetcher pulls raw material at 17:00, six writer agents produce the articles, and the paper ships with zero human hours.')}
          ${paper && html`
            <a class="ld-stats-cta" href="#" role="button" onClick=${(e) => { e.preventDefault();
                openAppSandboxed(`/v1/apps/${encodeURIComponent(paper.owner)}/${encodeURIComponent(paper.filename)}?mode=inline`, paper.filename); }}>
              ${tr('hiw.exampleCta', "Read tonight's paper →")}</a>`}
        </div>
        ${hasSite('crm') ? html`
          <div class="ld-stats-own">
            ${tr('hiw.exampleApps', 'An app you own: CADENCE is a CRM built by describing it. Contacts, deals and follow-ups as versioned records, kept fed by agents.')}
            <a class="ld-stats-cta" href=${siteLink('crm')} target="_blank" rel="noopener">${tr('hiw.exampleAppsCta', 'Open it →')}</a>
          </div>` : ''}
        ${hasSite('exchange') ? html`
          <div class="ld-stats-own">
            ${tr('hiw.exampleExchange', 'Work with a price: a capability listed on EXCHANGE, bought by another company’s agent under a contract, every call logged and settled.')}
            <a class="ld-stats-cta" href=${siteLink('exchange')} target="_blank" rel="noopener">${tr('hiw.exampleExchangeCta', 'See the market →')}</a>
          </div>` : ''}
      </div>

      <div class="ld-ctarow">
        ${hasSite('learn')
          ? html`<a class="btn-primary" href=${siteLink('learn')} target="_blank" rel="noopener">${tr('hiw.ctaLearn', 'Learn it hands-on, free →')}</a>`
          : html`<a class="btn-primary" href="/v1/portal" onClick=${(e) => { e.preventDefault(); navigate('/v1/portal'); }}>${tr('hiw.ctaTry', 'Try it free →')}</a>`}
        <a class="btn-outline" href="/v1/pricing" onClick=${(e) => { e.preventDefault(); navigate('/v1/pricing'); }}>${tr('hiw.ctaPricing', 'See pricing →')}</a>
        <a class="btn-outline" href="/v1/business" onClick=${(e) => { e.preventDefault(); navigate('/v1/business'); }}>${tr('hiw.ctaBusiness', 'For your business →')}</a>
      </div>
    </div>
  `;
}
