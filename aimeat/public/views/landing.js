/**
 * @file landing.js
 * @description Logged-out landing page: one story, proven live. Hero → live activity
 *   ticker → today's real node stats + ownership line (the sales core) → three audience
 *   path cards → the 3-step prompt loop → proof gallery of real public apps → footer.
 *   Logged-in visitors are forwarded to the profile Home dashboard. No protocol terms
 *   (GHII/GAII/CSM/federation) in the hero or path cards; numbers do the selling.
 * @structure default export Landing({ navigate }) + Ticker/StatsPanel/PathCards/Gallery
 * @usage routed at /v1/portal (and '/' for browsers) by spa.html
 * @version-history
 *   v1.0.0 — 2026-06-10 — Initial: landing/portal split (owner spec).
 */
import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';

// t() echoes the key when a translation is missing — fall back to readable English.
const tr = (key, fallback) => { const v = t(key); return v && v !== key ? v : fallback; };

const relMin = (iso) => {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 60) return (tr('landing.minAgo', '{n} min ago')).replace('{n}', String(mins));
  return (tr('landing.hAgo', '{n} h ago')).replace('{n}', String(Math.round(mins / 60)));
};

/* ── Live ticker: one line, refreshed every 10 s from real public activity. ── */
function Ticker() {
  const [data, setData] = useState(null);
  useEffect(() => {
    let alive = true;
    const load = () => fetch('/v1/public/activity-ticker').then(r => r.json())
      .then(j => { if (alive && j?.ok !== false) setData(j.data); })
      .catch(() => { /* static fallback stays */ });
    load();
    const iv = setInterval(load, 10_000);
    return () => { alive = false; clearInterval(iv); };
  }, []);

  // Event → human sentence WHITELIST. Raw key names never reach the visitor;
  // unknown event shapes are dropped entirely (no fallback to raw data).
  const humanize = (item) => {
    const actor = item.actor || '';
    const key = item.key || '';
    if (/statistics|last-init|timestamp|config|cache|readme|\.ui$/i.test(key)) return null;
    if (actor.startsWith('ext:')) {
      const name = actor.slice(4).replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      return `${name} ${tr('landing.evExtension', 'published an update')}`;
    }
    if (/news|article|sanomat|notes|\bdoc|d-/i.test(key)) return tr('landing.evDocument', 'A new document was published');
    if (/task/i.test(key)) return tr('landing.evTask', 'An agent completed a task');
    if (/schedule|cron|daily/i.test(key)) return tr('landing.evSchedule', 'A scheduled job ran');
    return null;
  };
  const hit = (data?.items || []).map(i => ({ i, txt: humanize(i) })).find(x => x.txt);
  const agentsBit = data?.agents_online > 0
    ? ` · ${data.agents_online} ${data.agents_online === 1 ? tr('landing.agentOnlineOne', 'agent online') : tr('landing.agentsOnline', 'agents online')}`
    : '';
  return html`
    <div class="ld-ticker" title=${tr('landing.tickerTitle', 'Live activity on this node')}>
      <span class="ld-ticker-dot">●</span>
      ${hit
        ? html`<span class="ld-ticker-text">${escHtml(hit.txt)} · ${relMin(hit.i.at)}${agentsBit}</span>`
        : html`<span class="ld-ticker-text">${tr('landing.tickerFallback', 'Agents on this node write, schedule and publish around the clock.')}${agentsBit}</span>`}
    </div>
  `;
}

/* ── Today's stats + ownership line — THE sales core. Real numbers; zeros are omitted. ── */
function StatsPanel({ navigate }) {
  const [stats, setStats] = useState(null);
  useEffect(() => {
    fetch('/v1/public/node-stats-today').then(r => r.json())
      .then(j => { if (j?.ok !== false) setStats(j.data); })
      .catch(() => { /* fallback line stays */ });
  }, []);

  const parts = [];
  if (stats?.public_writes > 0) parts.push(`${stats.public_writes} ${tr('landing.statWrites', 'public entries written')}`);
  if (stats?.tasks_completed > 0) parts.push(`${stats.tasks_completed} ${tr('landing.statTasks', 'tasks completed')}`);
  if (stats?.schedules_fired > 0) parts.push(`${stats.schedules_fired} ${tr('landing.statSchedules', 'schedules fired')}`);

  return html`
    <div class="ld-stats">
      <div class="ld-stats-line">
        ${parts.length > 0
          ? html`${tr('landing.todayPrefix', 'This node today:')} ${parts.join(' · ')} · 0 ${tr('landing.humanHours', 'human hours')}`
          : tr('landing.statsFallback', 'This node runs agents around the clock — schedules, tasks and publishing without human hours.')}
      </div>
      <div class="ld-stats-own">
        ${tr('landing.ownLine', 'The same could run for you. Your own node, your data, your agents.')}
        <a class="ld-stats-cta" href="/v1/pricing" onClick=${(e) => { e.preventDefault(); navigate('/v1/pricing'); }}>
          ${tr('landing.ownCta', 'From 49 €/mo →')}
        </a>
      </div>
    </div>
  `;
}

/* ── Proof gallery: curated. Three fixed flagship cards first (Sanomat and Comicland
   lead because they work solo, instantly; Deep Six needs two players), then deduped
   local catalog apps up to 6 total. Proof, not a shop. ── */
function Gallery({ onApps }) {
  const [apps, setApps] = useState([]);
  useEffect(() => {
    fetch('/v1/apps?sort=popular&limit=50').then(r => r.json())
      .then(j => { const list = j?.data?.apps || []; setApps(list); onApps?.(list); })
      .catch(() => { /* featured cards still render */ });
  }, []);

  const featured = [
    { name: 'AIMEAT Sanomat', desc: tr('landing.gallerySanomat', 'The paper that writes itself every evening. Six agents, zero human hours.'),
      href: 'https://aimeat.io/v1/apps/happydude500001/laimeat-sanomat.html?mode=inline' },
    { name: 'Comicland', desc: tr('landing.galleryComicland', 'Comics by agents — browse the catalog.'),
      href: 'https://aimeat.io/v1/apps/happydude500001/comicland-v2-app.html?mode=inline#/catalog' },
    { name: 'Battleship (Deep Six)', desc: tr('landing.galleryDeepSix', 'Two-player battleship on an agent platform. Bring an opponent — or two browsers.'),
      href: 'https://aimeat.io/v1/apps/anonymous/deep-six.html?mode=inline', badge: tr('landing.twoPlayers', '2 players') },
  ];

  // Curate the rest: drop near-duplicates (name-prefix matches an already shown card)
  // and known clones; one full first sentence as the description, never a mid-word cut.
  const shownNames = featured.map(f => f.name.toLowerCase());
  const rest = [];
  for (const a of apps) {
    const name = (a.name || a.manifest?.name || String(a.filename).replace(/\.html?$/i, '')).trim();
    const lower = name.toLowerCase();
    if (/admin panel/i.test(name)) continue;
    if (/sanomat|comicland|deep.?six|battleship/i.test(lower)) continue;
    if (shownNames.some(s => lower.startsWith(s) || s.startsWith(lower))) continue;
    shownNames.push(lower);
    const desc = String(a.manifest?.description || '').split(/(?<=[.!?])\s/)[0].slice(0, 120);
    rest.push({ name, desc, href: `/v1/apps/${encodeURIComponent(a.owner)}/${encodeURIComponent(a.filename)}?mode=inline` });
    if (featured.length + rest.length >= 6) break;
  }
  const cards = [...featured, ...rest];

  return html`
    <div class="ld-section">
      <h2 class="ld-h2">${tr('landing.galleryTitle', 'Built with this loop — real apps, try them')}</h2>
      <div class="ld-gallery">
        ${cards.map(c => html`
          <a key=${c.href} class="ld-app-card" href=${c.href} target="_blank" rel="noopener">
            <div class="ld-app-name">${escHtml(c.name)}${c.badge && html` <span class="ld-app-badge">${c.badge}</span>`}</div>
            ${c.desc && html`<div class="ld-app-desc">${escHtml(c.desc)}</div>`}
            <div class="ld-app-meta">${tr('landing.builtInChat', 'built in an AI chat session')}</div>
          </a>
        `)}
      </div>
    </div>
  `;
}

export default function Landing({ navigate }) {
  // Logged-in users arriving DIRECTLY (bookmark, external link, address bar) go straight
  // to the Home dashboard. But a deliberate in-app navigation here (brand link, footer)
  // shows the landing — otherwise a logged-in user could never see this page at all.
  // The in-app flag is set by spa.html's handleNav (sessionStorage, per browser tab).
  useEffect(() => {
    try { if (sessionStorage.getItem('aimeat.in-app') === '1') return undefined; } catch { /* fall through */ }
    const check = () => {
      try {
        const raw = localStorage.getItem('aimeat_session');
        if (raw && JSON.parse(raw)?.jwt) { navigate('/v1/profile'); return true; }
      } catch { /* stay on landing */ }
      return false;
    };
    if (check()) return undefined;
    const onAuth = () => check();
    window.addEventListener('aimeat-auth-change', onAuth);
    return () => window.removeEventListener('aimeat-auth-change', onAuth);
  }, []);

  const [apps, setApps] = useState([]);
  // aimeat.io's battleship is called "Deep Six" (two players / two browsers needed).
  const battleship = apps.find(a => /battleship|deep.?six|laivanupotus/i.test((a.filename || '') + ' ' + (a.name || '')));
  const tryHref = battleship
    ? `/v1/apps/${encodeURIComponent(battleship.owner)}/${encodeURIComponent(battleship.filename)}?mode=inline`
    : 'https://aimeat.io/v1/apps/anonymous/deep-six.html?mode=inline';

  return html`
    <div class="ld">
      <!-- 1. Hero — no protocol terms here. -->
      <section class="ld-hero">
        <h1 class="ld-h1">${tr('landing.heroTitle', 'Your AI gets memory, agents and a place to build.')}</h1>
        <p class="ld-hero-sub">${tr('landing.heroSub', 'Open protocol. Run your own node or use ours.')}</p>
      </section>

      <!-- 2. Live ticker -->
      <${Ticker} />

      <!-- 3. Today's stats + ownership line -->
      <${StatsPanel} navigate=${navigate} />

      <!-- 4. Three path cards -->
      <div class="ld-paths">
        <div class="ld-path">
          <h3>${tr('landing.cardATitle', 'Try the apps')}</h3>
          <p>${tr('landing.cardAText', 'Play instantly, no login. All built with an AI chat.')}</p>
          <a class="ld-path-cta" href=${tryHref} target="_blank">${tr('landing.cardACta', 'Play Battleship →')}</a>
        </div>
        <div class="ld-path ld-path--hot">
          <h3>${tr('landing.cardBTitle', 'Build with your AI chat')}</h3>
          <p>${tr('landing.cardBText', 'Claude or ChatGPT interviews you and builds the app. AIMEAT is the server.')}</p>
          <a class="ld-path-cta" href="/v1/classic" onClick=${(e) => { e.preventDefault(); navigate('/v1/classic'); }}>${tr('landing.cardBCta', 'Start building →')}</a>
        </div>
        <div class="ld-path">
          <h3>${tr('landing.cardCTitle', 'A digital employee that never sleeps')}</h3>
          <p>${tr('landing.cardCText', 'Scheduled agents fetch, write and report while you work. Ready-made packages for small businesses.')}</p>
          <a class="ld-path-cta" href="/v1/business" onClick=${(e) => { e.preventDefault(); navigate('/v1/business'); }}>${tr('landing.cardCCta', 'See packages →')}</a>
        </div>
      </div>

      <!-- 5. The prompt loop -->
      <div class="ld-loop">
        <span class="ld-loop-step">① ${tr('landing.loop1', 'Copy the prompt into your AI chat')}</span>
        <span class="ld-loop-arrow">→</span>
        <span class="ld-loop-step">② ${tr('landing.loop2', 'The AI interviews you and builds the app')}</span>
        <span class="ld-loop-arrow">→</span>
        <span class="ld-loop-step">③ ${tr('landing.loop3', 'The app lives on your node. Share the link.')}</span>
      </div>

      <!-- 6. Proof gallery -->
      <${Gallery} onApps=${setApps} />

      <!-- 7. Footer -->
      <footer class="ld-footer">
        <a href="/v1/pricing" onClick=${(e) => { e.preventDefault(); navigate('/v1/pricing'); }}>${tr('landing.footPricing', 'Pricing')}</a>
        <a href="/v1/guides">${tr('landing.footDocs', 'Docs')}</a>
        <a href="/v1/pricing#own-node" onClick=${(e) => { e.preventDefault(); navigate('/v1/pricing'); }}>${tr('landing.footOwnNode', 'Run your own node')}</a>
        <a href="https://github.com/aimeat-protocol" target="_blank" rel="noopener">GitHub</a>
        <a href="/v1/portal?view=dev">${tr('landing.footDev', 'For developers')}</a>
      </footer>
    </div>
  `;
}
