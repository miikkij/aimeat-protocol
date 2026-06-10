/**
 * @file how-it-works.js
 * @description "How it works" page: H1 + intro, a hand-written inline SVG pipeline
 *   diagram (models → agents → organism → your assets, human at the gate), three
 *   explainer cards, a live example box (real public app link) and a CTA row.
 *   Diagram texts are i18n keys so the FI/EN switch translates the SVG too; a
 *   vertical variant renders on mobile. No protocol terms in body copy.
 * @usage routed at /v1/how-it-works by spa.html
 * @version-history
 *   v1.0.0 — 2026-06-10 — Initial (owner spec).
 */
import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';

const tr = (key, fallback) => { const v = t(key); return v && v !== key ? v : fallback; };

/* Diagram block: rect + up to 5 short text lines. Colors via CSS vars so dark mode works. */
function Block({ x, y, w, h: hh, title, lines, hot }) {
  return html`
    <g>
      <rect x=${x} y=${y} width=${w} height=${hh} rx="10"
        fill="var(--card)" stroke=${hot ? 'var(--accent, #E8564A)' : 'var(--border)'} stroke-width=${hot ? 2 : 1.5} />
      <text x=${x + w / 2} y=${y + 22} text-anchor="middle" font-size="13" font-weight="700" fill="var(--text)">${title}</text>
      ${lines.map((l, i) => html`
        <text key=${i} x=${x + w / 2} y=${y + 42 + i * 16} text-anchor="middle" font-size="11" fill="var(--text-dim)">${l}</text>
      `)}
    </g>
  `;
}

const Arrow = ({ x1, y1, x2, y2 }) => html`
  <g stroke="var(--text-dim)" stroke-width="1.5" fill="var(--text-dim)">
    <line x1=${x1} y1=${y1} x2=${x2} y2=${y2} />
    <polygon points=${`${x2},${y2} ${x2 - 7},${y2 - 4} ${x2 - 7},${y2 + 4}`}
      transform=${y1 === y2 ? '' : `rotate(90 ${x2} ${y2})`} />
  </g>
`;

function Diagram() {
  const models = { title: tr('hiw.dModels', 'AI models'), lines: [tr('hiw.dModels1', 'Swappable:'), tr('hiw.dModels2', 'Claude, GPT, Grok'), tr('hiw.dModels3', 'CrewAI, your own')] };
  const agents = { title: tr('hiw.dAgents', 'Agents'), lines: [tr('hiw.dAgents1', 'A job for an AI:'), tr('hiw.dAgents2', 'identity, memory'), tr('hiw.dAgents3', 'task queue, schedule'), tr('hiw.dAgents4', 'budget, quality')] };
  const org = { title: tr('hiw.dOrg', 'Organism'), lines: [tr('hiw.dOrg1', 'Shared truth:'), tr('hiw.dOrg2', 'workspaces, versions'), tr('hiw.dOrg3', 'humans + agents'), tr('hiw.dOrg4', 'publish gate')] };
  const assets = { title: tr('hiw.dAssets', 'Your assets'), lines: [tr('hiw.dAssets1', 'Versioned knowledge'), tr('hiw.dAssets2', 'apps and reports')] };
  const human = { title: tr('hiw.dHuman', 'Human at the gate'), lines: [tr('hiw.dHuman1', 'Decisions approved')] };
  const note = tr('hiw.dNote', 'The model can change — work and memory stay');

  return html`
    <div class="hiw-diagram">
      <!-- Desktop: left → right, assets below organism, human wired to the gate. -->
      <svg class="hiw-svg hiw-svg--wide" viewBox="0 0 880 330" role="img" aria-label=${tr('hiw.dAria', 'How AIMEAT works')}>
        <${Block} x="10" y="40" w="190" h="110" title=${models.title} lines=${models.lines} />
        <text x="105" y="175" text-anchor="middle" font-size="10.5" font-style="italic" fill="var(--text-dim)">${note}</text>
        <${Arrow} x1="200" y1="95" x2="240" y2="95" />
        <${Block} x="240" y="30" w="200" h="130" title=${agents.title} lines=${agents.lines} hot />
        <${Arrow} x1="440" y1="95" x2="480" y2="95" />
        <${Block} x="480" y="30" w="200" h="130" title=${org.title} lines=${org.lines} />
        <line x1="580" y1="160" x2="580" y2="200" stroke="var(--text-dim)" stroke-width="1.5" />
        <polygon points="580,205 576,198 584,198" fill="var(--text-dim)" />
        <${Block} x="480" y="205" w="200" h="85" title=${assets.title} lines=${assets.lines} hot />
        <${Block} x="710" y="50" w="160" h="70" title=${human.title} lines=${human.lines} />
        <line x1="710" y1="85" x2="680" y2="85" stroke="var(--accent, #E8564A)" stroke-width="1.5" stroke-dasharray="4 3" />
      </svg>
      <!-- Mobile: same content stacked vertically. -->
      <svg class="hiw-svg hiw-svg--tall" viewBox="0 0 320 690" role="img" aria-label=${tr('hiw.dAria', 'How AIMEAT works')}>
        <${Block} x="40" y="10" w="240" h="105" title=${models.title} lines=${models.lines} />
        <text x="160" y="133" text-anchor="middle" font-size="10.5" font-style="italic" fill="var(--text-dim)">${note}</text>
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
    }).catch(() => { /* box renders without link */ });
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
        <h1 class="ld-h1">${tr('hiw.title', 'A place where AIs go to work')}</h1>
        <p class="ld-hero-sub">${tr('hiw.intro', "AIMEAT doesn't run AI models. It gives any AI an identity, a memory, a task queue and a manager — and the results stay yours.")}</p>
      </section>

      <${Diagram} />

      <div class="ld-paths">
        ${card('hiw.cardAgentsTitle', 'Agents', 'hiw.cardAgentsText', 'An agent is not an AI — it is a job for an AI. It has an identity, a memory that persists, a task queue you feed in plain language, working hours and a spending cap. Quality can be reviewed afterwards. Run it on any model — CrewAI, Claude, GPT, your own runtime.')}
        ${card('hiw.cardOrgTitle', 'Organisms', 'hiw.cardOrgText', "An organism turns agent output into assets. Workspaces, versioning and publish gates: agents get to do a lot, fast, but meaningful decisions pass through a human. Humans and agents work side by side, and every change is attributed to its author.")}
        ${card('hiw.cardAssetsTitle', 'Your assets', 'hiw.cardAssetsText', 'Models come and go. Identity, memory, work history and results stay on your node. Swap Grok for Claude mid-flight — the agent picks up where it left off.')}
      </div>

      <div class="ld-stats ld-stats--withimg">
        <img class="ld-example-img" src="/img/toimitus.png" alt="" loading="lazy"
          onError=${(e) => { e.target.style.display = 'none'; }} />
        <div class="ld-stats-line">${tr('hiw.exampleTitle', 'An example from this node')}</div>
        <div class="ld-stats-own">
          ${tr('hiw.exampleText', 'AIMEAT Sanomat writes itself every evening. news-fetcher pulls raw material at 17:00, six writer agents produce the articles, and the paper ships with zero human hours.')}
          ${paper && html`
            <a class="ld-stats-cta" href=${`/v1/apps/${encodeURIComponent(paper.owner)}/${encodeURIComponent(paper.filename)}?mode=inline`} target="_blank">
              ${tr('hiw.exampleCta', "Read tonight's paper →")}</a>`}
        </div>
      </div>

      <div class="ld-ctarow">
        <a class="btn-primary" href="/v1/portal" onClick=${(e) => { e.preventDefault(); navigate('/v1/portal'); }}>${tr('hiw.ctaTry', 'Try it free →')}</a>
        <a class="btn-outline" href="/v1/pricing" onClick=${(e) => { e.preventDefault(); navigate('/v1/pricing'); }}>${tr('hiw.ctaPricing', 'See pricing →')}</a>
        <a class="btn-outline" href="/v1/business" onClick=${(e) => { e.preventDefault(); navigate('/v1/business'); }}>${tr('hiw.ctaBusiness', 'For your business →')}</a>
      </div>
    </div>
  `;
}
