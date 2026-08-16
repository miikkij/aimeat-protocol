/**
 * @file landing.js
 * @description Logged-out landing page, in the order a visitor needs it (TARGET-056):
 *   the three-step loop → the generator itself → live counters as its evidence → the
 *   ownership question (owner or tenant) → the wall of published apps → agent prompt →
 *   ask-your-own-AI → today's stats → footer. Logged-in visitors are forwarded to the
 *   profile Home dashboard. No protocol terms (GHII/GAII/CSM/federation) above the fold;
 *   a working result does the selling.
 * @structure default export Landing({ navigate }) + BuildHero/Gallery(live wall)/StatsPanel/BuildAppPrompt/BuildAgentPrompt/AskYourAI
 * @usage routed at /v1/portal (and '/' for browsers) by spa.html
 * @version-history
 *   v5.2.0 — 2026-08-16 — The arrival redirect asks the node where this account lands instead of
 *     sending everyone to /v1/profile. The server has decided that since the remake, and this page
 *     ignored it, so an account created on the new path still arrived at the old one.
 *   v5.1.0 — 2026-08-01 — One line above the footer about how this node marks AI-generated
 *     content, linking /v1/transparency (TARGET-058 Phase 10). One line and no more: the page
 *     that states the limits properly is the one it links to.
 *   v5.0.0 — 2026-07-30 — TARGET-056: order reversed. The generator led the page's value and
 *     sat below a wall of other people's work; it is first now, with the three steps above it
 *     and the live counters directly under it as its evidence. The ownership question moved
 *     below them, because it answers a question a visitor only has after seeing the thing work.
 *     Hero keeps ONE primary button (four of equal weight asked for a choice before there was
 *     enough to choose from); the rest are one quiet line. Its old copy button was dropped as a
 *     duplicate of the generator's, now directly above it.
 *   v4.0.0 — 2026-07-28 — Hero states the fork (owner or tenant) with three entrances: build,
 *     business, own node. The Experience Center line and every other app reference now come
 *     from siteLinks, so a node that is not aimeat.io renders without them. The build button
 *     waits for the node's canonical prompt instead of copying the in-file fallback, which
 *     predates research-first and the T1/T2/T3 tiers. ASK_AI_PROMPT facts corrected: the old
 *     block claimed "hosting is the only subscription" (untrue against the price list and the
 *     EXCHANGE fee) and framed federation as cross-company work sharing.
 *   v2.2.0 — 2026-07-16 — Build-app prompt fetched from the canonical GET /v1/prompts/build-app
 *     (registry-generated libraries + capability packs; kills the landing's 5th drifting copy);
 *     the hand-built text remains only as the offline fallback. Template block via shared helper.
 *   v1.0.0 — 2026-06-10 — Initial: landing/portal split (owner spec).
 *   v1.1.0 — 2026-06-16 — Add BuildAppPrompt section: copyable Generate App Prompt from app-catalog.
 *   v1.2.0 — 2026-06-16 — Embed PublicActivityFeed (3 real-time tabs) after the proof gallery.
 *   v1.3.0 — 2026-06-16 — Move PublicActivityFeed directly under the hero; remove the now-redundant
 *     one-line Ticker (the full feed supersedes it).
 *   v2.0.0 — 2026-06-16 — Reward-first restructure (owner spec): new Hero (newspaper-framed
 *     Sanomat teaser — designed masthead card now, real screenshot when one exists — + two CTAs)
 *     replaces the text hero; gallery moved up; 3 audience path cards dropped (the two hero CTAs
 *     are the fork); AskYourAI + StatsPanel moved below the build loop.
 *   v2.1.0 — 2026-06-17 — Add BuildAgentPrompt: a copy-paste "build an agent in 10 minutes" prompt
 *     for the local crewaimeat fleet (Ollama/Gemma, no keys); Hero "Get your own →" now points to
 *     the desktop installer GitHub Release (was /v1/pricing).
 *   v3.0.0 — 2026-06-20 — Value-first hero: replace the Sanomat newspaper Hero with BuildHero
 *     (copy the build prompt → your AI builds you an app you own + publish); the gallery becomes a
 *     LIVE wall of the real apps people published here (manifest-driven from /v1/apps).
 *   v3.1.0 — 2026-06-20 — Wall: fixed 3-up grid + filter search; cards show author + publish
 *     date/time. Hero subline adds "let your agents keep it running" (Sanomat as the example).
 *   v3.2.0 — 2026-06-20 — H-2: wall cards open published apps in a sandboxed opaque-origin
 *     iframe (openAppSandboxed) instead of a top-level apex ?mode=inline link.
 *   v3.3.0 — 2026-06-20 — Replace PublicActivityFeed (read as broken when empty) with NodeTotals:
 *     cumulative "this node has X" counters (apps/organisms/agents+online/knowledge/downloads).
 *   v3.4.0 — 2026-07-14 — Footer GitHub link: fix href to the real repo
 *     (github.com/miikkij/aimeat-protocol) + add the GitHub Octocat mark.
 *   v3.5.0 — 2026-07-17 — Hero gains an Experience Center line (the hands-on academy at
 *     experience-center.apps.aimeat.io) under the two CTAs.
 *   v3.6.0 — 2026-07-31 — ManagedEnvNote above each of the three copy buttons (build-app full,
 *     build-agent and ask-your-AI compact): what a company-managed AI tool's untrusted-source
 *     notice means and the three routes round it. A security team met that notice cold and did
 *     not continue. No prompt text changed anywhere.
 *   v3.7.0 — 2026-08-08 — BuildAppPrompt's copy button is the shared <CopyButton> (with the new
 *     `disabled` prop, which the async-loaded prompt needs) instead of a hand-rolled
 *     navigator.clipboard handler; labels come from common.copyPrompt / common.copied. The
 *     misnamed .ld-gen-copy — which also dressed step 3's "Register and add your app" anchor,
 *     not a copy control at all — is now .ld-gen-action. No prompt text changed.
 */
import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t, getLocale } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import { apiGet } from '/js/api.js';
import { openAppSandboxed } from '/js/app-sandbox.js';
import { siteLink, hasSite } from '/js/site.js';
import { Collapsible } from '/components/Collapsible.js';
import { CopyButton } from '/components/CopyButton.js';
import { ManagedEnvNote } from '/components/ManagedEnvNote.js';
import NodeTotals from './landing-node-totals.js';
import NodeChangeLog from './landing-changelog.js';
import { BuildAgentPrompt, AskYourAI } from './landing-prompts.js';
import { swallowed } from '/js/swallowed.js';
import { WelcomeDoor } from '/views/home/welcome-door.js';

// t() echoes the key when a translation is missing — fall back to readable English.
const tr = (key, fallback) => { const v = t(key); return v && v !== key ? v : fallback; };

// The GitHub mark left with this page's footer (the shell's SiteFooter carries that link now).
// portal-dev.js and the profile's agents tab keep their own copies of the same drawing.

// An eye, drawn rather than typed: an emoji would render as a different picture on every
// platform and the house rule keeps emoji out of the UI. currentColor so the accent is set in CSS.
const EyeMark = html`<svg class="ld-eye" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>`;

/* ── Today's stats + ownership line — THE sales core. Real numbers; zeros are omitted. ── */
function StatsPanel({ navigate }) {
  const [stats, setStats] = useState(null);
  useEffect(() => {
    fetch('/v1/public/node-stats-today').then(r => r.json())
      .then(j => { if (j?.ok !== false) setStats(j.data); })
      .catch(err => { swallowed('landing: StatsPanel', err); });
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
          : tr('landing.statsFallback', 'This node runs agents around the clock: schedules, tasks and publishing without human hours.')}
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

/* ── Live wall — the REAL apps people built with their AI and published to this node (from the
   apps API, manifest-driven). Three per row + a filter. Each card: name · description · who made
   it · when. The proof the loop works: your creation lands on this same wall. ── */
// Date only. The clock time of a publish tells a visitor nothing, and it was the part that
// pushed the card's footer onto a second line, so half the grid wrapped and half did not.
function fmtPublished(iso) {
  try {
    return new Date(iso).toLocaleDateString();
  } catch (err) { swallowed('landing: fmtPublished', err); return ''; }
}

/** How many cards the wall shows before "show the rest". On a phone every extra card is a full
 *  screen of scrolling: 60 cards measured 37.9 screens of landing page, and the visitor's own
 *  next step (the two doors above) is what that length buries (UX-remake v3, P11). */
const WALL_FIRST_PAGE = 12;

function Gallery() {
  const [apps, setApps] = useState([]);
  const [q, setQ] = useState('');
  const [showAll, setShowAll] = useState(false);
  // Newest first by default: the wall's job is to show the place is alive, and the freshest
  // publish says that better than a leaderboard whose top has not moved in weeks.
  const [sort, setSort] = useState('newest');
  useEffect(() => {
    // Public proof wall: the default listing already excludes parked + operator-hidden
    // apps (no manage flag), so the wall never surfaces moderated/hidden apps.
    fetch(`/v1/apps?sort=${encodeURIComponent(sort)}&limit=60`).then(r => r.json())
      .then(j => setApps(j?.data?.apps || []))
      .catch(err => { swallowed('landing: Gallery', err); });
  }, [sort]);

  const ql = q.trim().toLowerCase();
  const matched = !ql ? apps : apps.filter((a) => {
    const m = a.manifest || {};
    return [m.name, m.description, m.authorDisplay, a.owner].some(v => (v || '').toLowerCase().includes(ql));
  });
  // A search shows everything it matched (the visitor asked for it); the default wall shows the
  // first page with the rest one click away, never behind a link to another page.
  const shown = (ql || showAll) ? matched : matched.slice(0, WALL_FIRST_PAGE);
  const hiddenCount = matched.length - shown.length;

  return html`
    <div class="ld-section">
      <h2 class="ld-h2">${tr('landing.wallTitle', 'Built by people with their AI. Yours goes here too.')}</h2>
      <div class="ld-wall-bar">
        <input class="ld-wall-search" type="search" value=${q}
          onInput=${(e) => setQ(e.target.value)}
          placeholder=${tr('landing.wallSearch', 'Search apps…')}
          aria-label=${tr('landing.wallSearch', 'Search apps')} />
        <div class="ld-wall-sort" role="group" aria-label=${tr('landing.wallSortLabel', 'Order the apps')}>
          <button type="button" class=${`ld-wall-sort-btn ${sort === 'newest' ? 'is-on' : ''}`}
            aria-pressed=${sort === 'newest'} onClick=${() => setSort('newest')}>
            ${tr('landing.wallSortNewest', 'Recently updated')}
          </button>
          <button type="button" class=${`ld-wall-sort-btn ${sort === 'popular' ? 'is-on' : ''}`}
            aria-pressed=${sort === 'popular'} onClick=${() => setSort('popular')}>
            ${tr('landing.wallSortPopular', 'Most opened')}
          </button>
        </div>
      </div>
      ${shown.length === 0
        ? html`<p class="ld-app-desc">${apps.length === 0
            ? tr('landing.wallEmpty', 'Be the first. Copy the prompt above, build something, and it lands here.')
            : tr('landing.wallNoMatch', 'No apps match your search.')}</p>`
        : html`<div class="ld-gallery">
            ${shown.map((a) => {
              const m = a.manifest || {};
              // H-2: open published apps in a sandboxed (opaque-origin) iframe, never as a
              // top-level apex document. Click-to-open instead of an apex href, so middle-/
              // ctrl-click can't bypass it either.
              const href = `/v1/apps/${encodeURIComponent(a.owner)}/${encodeURIComponent(a.filename)}?mode=inline`;
              const desc = (m.description || '').length > 140 ? m.description.slice(0, 140) + '…' : (m.description || '');
              const author = m.authorDisplay || a.owner || tr('landing.wallAnon', 'someone');
              const when = a.created_at ? fmtPublished(a.created_at) : '';
              const open = () => openAppSandboxed(href, m.name || a.filename);
              // Version first, then the two numbers, and a zero is left out rather than printed:
              // "0 opens" on a freshly published app reads as a verdict on it.
              // The node's own version is the incrementing publish number, the same v30 the
              // catalogue shows. The manifest's semver is whatever the author typed and does not
              // move when they republish, so it says nothing about how alive the app is.
              const opensLabel = `${a.downloads} ${a.downloads === 1 ? tr('landing.wallOpen1', 'open') : tr('landing.wallOpens', 'opens')}`;
              const facts = [];
              if (a.version_number) facts.push(html`<span>v${a.version_number}</span>`);
              // The count carries the mark; the word it replaces stays as the accessible name, so
              // a screen reader still says "41 opens" and a hover still spells it out.
              if (a.downloads > 0) facts.push(html`<span class="ld-app-opens" title=${opensLabel} aria-label=${opensLabel}>${EyeMark}${a.downloads}</span>`);
              if (a.forks > 0) facts.push(html`<span>${a.forks} ${a.forks === 1 ? tr('landing.wallFork1', 'fork') : tr('landing.wallForks', 'forks')}</span>`);
              return html`
                <div key=${a.owner + '/' + a.filename} class="ld-app-card" role="button" tabindex="0"
                  onClick=${open} onKeyDown=${(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } }}>
                  ${a.screenshot_url ? html`<img class="ld-app-shot" src=${a.screenshot_url} loading="lazy" alt="" />` : ''}
                  <div class="ld-app-name">${m.icon ? escHtml(m.icon) + ' ' : ''}${escHtml(m.name || a.filename)}</div>
                  ${desc && html`<div class="ld-app-desc">${escHtml(desc)}</div>`}
                  <div class="ld-app-foot">
                    <span class="ld-app-facts">${facts.map((f, i) => html`${i ? html`<span class="ld-app-sep">·</span>` : ''}${f}`)}</span>
                    <span class="ld-app-by">${escHtml(author)}${when ? ' · ' + when : ''}</span>
                  </div>
                </div>`;
            })}
          </div>`}
      ${hiddenCount > 0 ? html`
        <div class="ld-wall-more">
          <button type="button" class="btn-outline" onClick=${() => setShowAll(true)}>
            ${tr('landing.wallShowAll', 'Show the other {n} apps').replace('{n}', String(hiddenCount))}
          </button>
        </div>` : ''}
    </div>
  `;
}

// Mirrors buildPromptFromBuilder() in app-catalog.html for the "new app / no description" case,
// with the current node URL injected. If no idea is given the prompt explicitly tells the AI to ask.
// Canonical build prompt from the node (GET /v1/prompts/build-app - the single source of
// truth the app-catalog + agentic coders use; includes the registry-generated library
// sections and capability packs). Cached per locale. The hand-built text below is ONLY the
// offline / older-node fallback and may lag behind the node's.
const _canonicalPromptCache = {};
async function fetchCanonicalBuildPrompt(locale) {
  const key = locale || 'en';
  if (_canonicalPromptCache[key]) return _canonicalPromptCache[key];
  const d = await (await fetch('/v1/prompts/build-app?mode=new&lang=' + encodeURIComponent(key))).json();
  const full = d && d.data && d.data.prompt;
  if (typeof full === 'string' && full.length > 500) { _canonicalPromptCache[key] = full; return full; }
  throw new Error('no canonical prompt');
}

// Appended to whichever prompt body is in use (canonical or fallback).
function appendTemplateBlock(p, templateContent) {
  if (!templateContent) return p;
  return p + '\n## Starting template (copy from this)\nUse this skeleton as your base — keep its boot, login pill, and self-hosted theme wiring; fill the {{...}} slots; build your views inside <main>. Return the COMPLETE single HTML file based on it.\n```html\n' + templateContent + '\n```\n';
}

// The hand-written fallback build prompt lived here until 2026-07-28. It was the fifth copy of
// a spec the node already serves at GET /v1/prompts/build-app, and it had drifted: no Step 0
// research-first, no T1/T2/T3 tier choice, no capability packs. Both call sites now wait for
// the canonical text rather than offering a stale one. Git history has it if ever needed.

/* The generator, in the app-catalog's shape: numbered steps, an idea box, a template picker,
   the capability packs, then the prompt. Deliberately the same STRUCTURE and look as the
   catalog's "Generate App with AI" so the two do not feel like two different products, but its
   own implementation — the catalog is a vanilla-JS esbuild bundle and this page is Preact, and
   welding them together for a page that is still changing weekly would cost more than it saves.

   The prompt text itself is NOT rebuilt here: it comes from GET /v1/prompts/build-app, so the
   node stays the single source of truth and this page cannot drift from it. Only the parts a
   person chooses (idea, template, packs) are assembled on top. */

// Same filter the catalog applies: engines and wrappers a person would pick on purpose.
const PACK_CATEGORIES = ['visualization', 'diagrams', 'canvas', 'game', '3d', 'realtime'];

// The canonical prompt carries a placeholder for the idea. Replacing it beats appending, so the
// AI reads the idea where it expects to and the interview step adapts itself.
const IDEA_PLACEHOLDER = 'My initial idea: (not given yet — ask me what to build)';

/* The half-finished thought, kept for the length of the browser tab.
   sessionStorage rather than localStorage on purpose: this is an unfinished draft, not a
   setting, and a stranger who looks once should not find their idea waiting weeks later on a
   shared machine. Closing the tab is the intent to drop it. */
const BUILDER_DRAFT_KEY = 'aimeat.landing.builder';

function readBuilderDraft() {
  try {
    const raw = sessionStorage.getItem(BUILDER_DRAFT_KEY);
    const d = raw ? JSON.parse(raw) : null;
    if (!d || typeof d !== 'object') return {};
    return {
      idea: typeof d.idea === 'string' ? d.idea : '',
      tplId: typeof d.tplId === 'string' ? d.tplId : '',
      chosen: d.chosen && typeof d.chosen === 'object' ? d.chosen : {},
    };
  } catch (err) { swallowed('landing: read builder draft', err); return {}; }
}

function writeBuilderDraft(draft) {
  try {
    // Nothing decided is nothing to keep, and a kept-but-empty record would re-open the fold onto
    // a blank form. Emptiness counts only packs that are ON: unticking leaves an explicit `false`,
    // which is a decision about idea-matching and is meaningless once the idea box is empty too.
    const anyPackOn = Object.values(draft.chosen || {}).some(Boolean);
    if (!draft.idea && !draft.tplId && !anyPackOn) sessionStorage.removeItem(BUILDER_DRAFT_KEY);
    else sessionStorage.setItem(BUILDER_DRAFT_KEY, JSON.stringify(draft));
  } catch (err) { swallowed('landing: write builder draft', err); }
}

/* AEB reliability tier, shown exactly as the catalogue shows it. The label is the INSTRUCTION,
   not the raw key: `needs-doc` reads as "documentation missing" when it means "no priors — the
   AI must read the doc first". */
const TIER_FALLBACK = { any: 'ANY MODEL', frontier: 'VERSION TRAP', 'needs-doc': 'READ THE DOC' };

function tierTitle(pack) {
  const proven = (pack.proofs || []).map(pr => pr.model + '→' + pr.verdict).join(', ');
  return 'AEB reliability tier: ' + pack.modelTier
    + (proven ? ' · proven on ' + proven : ' · not yet AEB-run')
    + (pack.apiCaveat ? ' · ' + pack.apiCaveat : '');
}

function packMatchesIdea(pack, ideaText) {
  const text = (ideaText || '').toLowerCase();
  if (!text) return false;
  return (pack.interviewTriggers || []).some((trigger) => {
    const esc = String(trigger).toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp('(^|[^a-zà-öø-ÿ])' + esc).test(text);
  });
}

function BuildAppPrompt() {
  const [templates, setTemplates] = useState([]);
  const [tplContent, setTplContent] = useState('');
  const [canonical, setCanonical] = useState('');
  const [packs, setPacks] = useState([]);
  const [packDocs, setPackDocs] = useState({});
  const [hovered, setHovered] = useState(null);   // pack the pointer or keyboard focus is on
  // Restored from the tab, so the three things a person actually decides survive the round trip
  // through registration. Step 3 sends them to the catalogue and signing in reloads the page;
  // without this they come back to an empty box and have to describe their app a second time.
  const saved = readBuilderDraft();
  const [tplId, setTplId] = useState(saved.tplId || '');
  const [idea, setIdea] = useState(saved.idea || '');
  const [chosen, setChosen] = useState(saved.chosen || {});   // id → true/false, set only by a real click

  useEffect(() => { writeBuilderDraft({ idea, tplId, chosen }); }, [idea, tplId, chosen]);

  useEffect(() => {
    // Starting points only: full use-case scaffolds first, then blank app-shells (not components).
    fetch('/v1/app-templates?lang=' + encodeURIComponent(getLocale())).then(r => r.json()).then(d => {
      const list = ((d.data && d.data.templates) || []).filter(t => t.kind !== 'component');
      list.sort((a, b) => (a.kind === 'use-case' ? 0 : 1) - (b.kind === 'use-case' ? 0 : 1));
      setTemplates(list);
    }).catch(err => { swallowed('landing: templates', err); });

    fetch('/v1/library-packs?lang=' + encodeURIComponent(getLocale())).then(r => r.json()).then(d => {
      const all = (d.data && d.data.packs) || [];
      setPacks(all.filter(pk => {
        if (pk.status === 'deprecated') return false;
        if (pk.kind === 'vendored' || pk.kind === 'bundle') return PACK_CATEGORIES.includes(pk.category);
        if (pk.kind === 'cortex') return PACK_CATEGORIES.includes(pk.category) && pk.id !== 'aimeat-charts';
        return false;
      }));
    }).catch(err => { swallowed('landing: packs', err); });

    fetchCanonicalBuildPrompt(getLocale()).then(setCanonical).catch(err => { swallowed('landing: prompt', err); });

    // A restored template id names the template but carries none of its content, and the content
    // is what the prompt appends.
    if (saved.tplId) loadTemplate(saved.tplId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadTemplate = async (id) => {
    if (!id) { setTplContent(''); return; }
    try { const d = await (await fetch('/v1/app-templates/' + encodeURIComponent(id))).json(); setTplContent((d.data && d.data.template && d.data.template.content) || ''); }
    catch (err) { swallowed('landing: template', err); setTplContent(''); }
  };
  const onPickTemplate = (e) => { const id = e.target.value; setTplId(id); loadTemplate(id); };

  // A pack is on when the person ticked it, and otherwise when their idea text names it. A manual
  // choice always wins: typing more words must never silently untick something they chose.
  const isOn = (pack) => (pack.id in chosen ? chosen[pack.id] : packMatchesIdea(pack, idea));
  const selected = packs.filter(isOn);

  // Fetch the usage doc for whatever is on — a chat AI cannot fetch the pack endpoint itself, so
  // the doc has to travel inside the prompt.
  useEffect(() => {
    selected.forEach((pack) => {
      if (packDocs[pack.id]) return;
      fetch('/v1/library-packs/' + encodeURIComponent(pack.id))
        .then(r => r.json())
        .then(d => { const doc = d?.data?.pack; if (doc) setPackDocs(prev => ({ ...prev, [pack.id]: doc })); })
        .catch(err => { swallowed('landing: pack doc', err); });
    });
    // selected is derived; the ids are what actually matter for re-running this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected.map(pk => pk.id).join(','), packDocs]);

  const prompt = (() => {
    if (!canonical) return '';
    let out = idea.trim()
      ? canonical.replace(IDEA_PLACEHOLDER, 'My initial idea: ' + idea.trim())
      : canonical;
    out = appendTemplateBlock(out, tplContent);
    const docs = selected.map(pk => packDocs[pk.id]).filter(Boolean);
    if (docs.length) {
      out += '\n## Selected capability packs (self-hosted on my node — use these, never a CDN)\n';
      for (const doc of docs) {
        out += '\n### Pack: ' + doc.id + ' — ' + (doc.title || '') + '\n';
        out += 'Include (in order):\n' + (doc.include || []).join('\n') + '\n';
        if (doc.ai_doc) out += 'Usage:\n' + doc.ai_doc + '\n';
      }
    }
    return out;
  })();

  // What the prompt CONTAINS, rather than how many characters it is. A character count reads as
  // complexity; the contents read as value, and they are the reason the prompt is long.
  const contains = [];
  if (tplId) contains.push(tr('landing.promptHasTemplate', 'your starting template'));
  if (selected.length) {
    contains.push(selected.length === 1
      ? tr('landing.promptHasPack', 'one capability pack with its usage doc')
      : `${selected.length} ${tr('landing.promptHasPacks', 'capability packs with their usage docs')}`);
  }
  contains.push(tr('landing.promptHasPitfalls', 'this node’s libraries and the pitfalls already written down'));

  // Which pack's description to spell out. Pointing at one wins, because that is a question being
  // asked right now; otherwise the ones that are ON, which is what the prompt will actually carry.
  // A description in a title attribute is invisible on touch and to anyone not hunting for it.
  const hoveredPack = packs.find(pk => pk.id === hovered);
  const described = hoveredPack ? [hoveredPack] : selected;

  return html`
    <div class="ld-gen">
      <p class="ld-gen-intro">${tr('landing.genIntro', 'No coding. Describe your idea, copy the prompt, and paste it into any AI chat (Claude, ChatGPT…). The AI asks a few questions, builds a ready-to-use app, and gives you one HTML file.')}</p>

      <div class="ld-gen-step">
        <div class="ld-gen-head"><span class="ld-gen-num">1</span><span>${tr('landing.genStep1', 'Describe your app')}</span></div>
        <textarea class="ld-gen-idea" rows="3" value=${idea} onInput=${(e) => setIdea(e.target.value)}
          placeholder=${tr('landing.genIdeaPh', 'Describe what the app should do…')}></textarea>

        ${templates.length ? html`
          <label class="ld-gen-label" for="ld-gen-tpl">${tr('landing.startTemplate', 'Start from a template')} <span class="ld-gen-opt">${tr('landing.genOptional', '(optional)')}</span></label>
          <select id="ld-gen-tpl" class="input-field ld-gen-select" onChange=${onPickTemplate} value=${tplId}>
            <option value="">${tr('landing.fromScratch', '(none, build from scratch)')}</option>
            ${templates.map(t => html`<option value=${t.id} key=${t.id}>${t.kind === 'use-case' ? '★ ' : ''}${t.title}</option>`)}
          </select>` : ''}

        ${packs.length ? html`
          <div class="ld-gen-label">${tr('landing.genPacks', 'Capability packs')} <span class="ld-gen-opt">${tr('landing.genOptional', '(optional)')}</span></div>
          <p class="ld-gen-hint">${tr('landing.genPacksHint', 'Charts, editable flow diagrams, games, 3D. Self-hosted libraries with AI instructions baked into the prompt. Your idea text pre-selects matching packs.')}</p>
          <div class="ld-gen-packs">
            ${packs.map(pk => html`
              <label class="ld-gen-pack" key=${pk.id}
                onMouseEnter=${() => setHovered(pk.id)} onMouseLeave=${() => setHovered(null)}>
                <input type="checkbox" checked=${isOn(pk)}
                  onFocus=${() => setHovered(pk.id)} onBlur=${() => setHovered(null)}
                  onChange=${(e) => setChosen(prev => ({ ...prev, [pk.id]: e.target.checked }))} />
                <span>${pk.title || pk.id}</span>
                ${pk.modelTier ? html`<span class=${`ld-gen-tier ${pk.modelTier === 'frontier' ? 'is-frontier' : ''}`} title=${tierTitle(pk)}>${tr('landing.tier.' + pk.modelTier, TIER_FALLBACK[pk.modelTier] || pk.modelTier)}</span>` : ''}
              </label>`)}
          </div>
          ${described.length ? html`
            <div class="ld-gen-packinfo">
              ${described.map(pk => html`<p class="ld-gen-packinfo-line" key=${pk.id}>
                <span class="ld-gen-packinfo-name">${pk.title || pk.id}:</span> ${pk.description || ''}
              </p>`)}
            </div>` : ''}
          <p class="ld-gen-legend">${tr('landing.tierLegend', 'ANY MODEL = any model can build with it · READ THE DOC = the model has no priors for it, so the usage doc travels in the prompt · VERSION TRAP = the model remembers an older version, so follow the version in the doc')}</p>` : ''}
      </div>

      <div class="ld-gen-step">
        <div class="ld-gen-head"><span class="ld-gen-num">2</span><span>${tr('landing.genStep2', 'Copy the prompt and paste it into your AI')}</span></div>
        <p class="ld-gen-hint">${tr('landing.genStep2Hint', 'Open Claude, ChatGPT or any AI chat, paste this in and answer its questions. It builds your app and hands you a single HTML file.')}</p>
        <div class="ld-gen-preview-label">${tr('landing.genPreview', 'Prompt preview')}</div>
        <div class="ld-gen-preview">${prompt || tr('landing.buildLoading', 'Loading the build prompt from this node…')}</div>
        ${prompt ? html`<p class="ld-gen-contains">${tr('landing.promptContains', 'Includes')}: ${contains.join(' · ')}.</p>` : ''}
        <${ManagedEnvNote} />
        <${CopyButton} text=${prompt} className="btn-primary ld-gen-action" disabled=${!prompt}
          label=${tr('common.copyPrompt', 'Copy prompt')} copiedLabel=${tr('common.copied', '✓ Copied')} />
      </div>

      <div class="ld-gen-step">
        <div class="ld-gen-head"><span class="ld-gen-num">3</span><span>${tr('landing.genStep3', 'Add & publish your app')}</span></div>
        <p class="ld-gen-hint">${tr('landing.genStep3Hint', 'Got the code or HTML file back from the AI? Create an account, it takes a minute, then paste the code or upload the file. The app goes live at its own address and you get a link to share.')}</p>
        <a class="btn-outline ld-gen-action ld-gen-add" href="/app-catalog.html?add=1">
          ${tr('landing.genStep3Btn', 'Register and add your app')}
        </a>
        <p class="ld-gen-hint ld-gen-mcp">${tr('landing.genStep3Mcp', 'If the AI you pasted the prompt into is connected to this node over MCP, it can publish the app for you, with no file to move by hand.')}</p>
      </div>
    </div>`;
}

/* ── Hero — value first: AIMEAT is a safe place to build real apps with your AI in minutes, and
   you own + publish them. One copyable prompt is the whole on-ramp; the live wall below is the
   proof that your creation lands on the same shelf as everyone else's. ── */
/* The build invitation, folded shut.
   Evidence over theory: an open generator on the front page produced two throwaway chat apps
   and nothing else, while the wall underneath is what actually reads as a living place. So the
   whole builder — the three steps and the prompt with its templates — sits behind one line, and
   the page leads with what people made.

   The line invites the click and stops short of the old "no account needed to start", which was
   false: anonymous access is off, so an app only reaches the server behind a login. Designing is
   still free — /v1/prompts/build-app, /v1/app-templates and /v1/library-packs all answer
   anonymously — and that is the distinction the subline has to carry. */
function BuildInvite() {
  // Shut by default, but a draft left in this tab means the visitor was mid-thought: open onto it.
  const [open, setOpen] = useState(() => {
    const d = readBuilderDraft();
    return !!(d.idea || d.tplId || Object.values(d.chosen || {}).some(Boolean));
  });
  return html`
    <section class="ld-invite">
      <${Collapsible}
        title=${html`
          <span class="ld-invite-title">${tr('landing.inviteTitle', 'Build your app in 10 minutes')}</span>
          <span class="ld-invite-sub">${tr('landing.inviteSub', 'Click here and start designing. Your AI builds it; publishing it here takes an account.')}</span>
        `}
        open=${open} onToggle=${() => setOpen(o => !o)}>
        <div class="ld-loop">
          <span class="ld-loop-step">① ${tr('landing.loop1', 'Copy the prompt into your AI chat')}</span>
          <span class="ld-loop-arrow">→</span>
          <span class="ld-loop-step">② ${tr('landing.loop2', 'The AI interviews you and builds the app')}</span>
          <span class="ld-loop-arrow">→</span>
          <span class="ld-loop-step">③ ${tr('landing.loop3', 'The app goes live at its own address. Share the link.')}</span>
        </div>
        <${BuildAppPrompt} />
      <//>
    </section>
  `;
}

/**
 * The SECOND door, and in the chat-first model the bigger one: connect the AI you already use to
 * this node, and the whole system runs from that chat. It was invisible on this page — "MCP"
 * appeared three times, never in a heading or a button, and the guided path lived behind the
 * profile menu (UX-remake v3, P1, measured). Named in plain language on purpose: "Hello MCP" is
 * jargon to the person this door is for.
 */
function ConnectInvite({ onNavigate }) {
  const [open, setOpen] = useState(false);
  return html`
    <section class="ld-invite">
      <${Collapsible}
        title=${html`
          <span class="ld-invite-title">${tr('landing.connectTitle', 'Connect the AI you already use')}</span>
          <span class="ld-invite-sub">${tr('landing.connectSub', 'Five minutes. After it, you run all of this from your own chat: notes, documents, team knowledge, agents.')}</span>
        `}
        open=${open} onToggle=${() => setOpen(o => !o)}>
        <div class="ld-loop">
          <span class="ld-loop-step">① ${tr('landing.connectLoop1', 'Add this node as a connector in your AI tool')}</span>
          <span class="ld-loop-arrow">→</span>
          <span class="ld-loop-step">② ${tr('landing.connectLoop2', 'Run one prompt that proves the connection works')}</span>
          <span class="ld-loop-arrow">→</span>
          <span class="ld-loop-step">③ ${tr('landing.connectLoop3', 'Your chat can now read and write your own space here')}</span>
        </div>
        <p class="ld-connect-note">${tr('landing.connectWorks', 'Works with Claude (a free account is enough to start), ChatGPT on a paid plan, Claude Code, Cursor, VS Code, Codex CLI and Grok. The guided path checks your setup at every step.')}</p>
        <div class="ld-connect-cta">
          <a class="btn-primary" href="/v1/profile?tab=mcp"
            onClick=${(e) => { e.preventDefault(); onNavigate('/v1/profile?tab=mcp'); }}>
            ${tr('landing.connectCta', 'Open the guided path →')}
          </a>
          <span class="ld-connect-hint">${tr('landing.connectAccount', 'Takes an account: the connection is to YOUR space, so there has to be one.')}</span>
        </div>
      <//>
    </section>
  `;
}

function BuildHero({ onNavigate }) {
  // ONE primary action. This section used to carry four buttons of equal weight, which asks the
  // visitor to choose before they know enough to choose. It also sits BELOW the generator now, so
  // its old "Build something, free" button duplicated the copy button directly above it — the
  // remaining paths are the ones a person reaches for AFTER the ownership question lands.
  return html`
    <section class="ld-hero2">
      <p class="ld-hero2-kicker">${tr('landing.heroKicker', 'Two roles in the agent economy.')}</p>
      <h1 class="ld-hero2-title">${tr('landing.heroTitle', 'Owner, or tenant. Which one do you want to be?')}</h1>
      <p class="ld-hero2-sub">${tr('landing.heroSub', 'Your memory, your agents, your balance sheet. On a rented platform you build a tool and pay for it. Here the tool can bill someone else, and it is yours.')}</p>
      <div class="ld-hero2-cta">
        <a class="btn-primary" href="/v1/business" onClick=${(e) => { e.preventDefault(); onNavigate('/v1/business'); }}>${tr('landing.heroCtaBusiness', 'See what it does for a business →')}</a>
      </div>
      <div class="ld-hero2-more">
        <a href="https://github.com/miikkij/aimeat-protocol/releases/latest" target="_blank" rel="noopener">${tr('landing.heroGetOwn', 'Run it on your own server →')}</a>
        ${hasSite('learn') ? html`<a href=${siteLink('learn')} target="_blank" rel="noopener">${tr('landing.ecLinkShort', 'Learn it hands-on, free →')}</a>` : ''}
        <a href="/v1/pricing" onClick=${(e) => { e.preventDefault(); onNavigate('/v1/pricing'); }}>${tr('landing.heroPricing', 'Pricing →')}</a>
      </div>
    </section>
  `;
}

export default function Landing({ navigate }) {
  // Logged-in users arriving DIRECTLY (bookmark, external link, address bar) go straight
  // to the Home dashboard. But a deliberate in-app navigation here (brand link, footer)
  // shows the landing — otherwise a logged-in user could never see this page at all.
  // The in-app flag is set by spa.html's handleNav (sessionStorage, per browser tab).
  //
  // The flag suppresses ONLY the arrival redirect. Signing in while standing on this page
  // always moves on to Home: without that, the sign-in modal closed and the visitor was left
  // looking at the same marketing page with no sign that anything had happened.
  //
  // WHERE it forwards to is the node's answer, not this file's. The server has decided since the
  // remake which side an account lands on, and this page sent everyone to /v1/profile regardless —
  // so a new account created on the new path still arrived at the old one. It asks now, and falls
  // back to the profile only when the answer does not arrive.
  useEffect(() => {
    const landingFor = async () => {
      try {
        const res = await apiGet('/v1/home/ui-track');
        return res?.data?.landing || '/v1/profile';
      } catch (err) {
        // Not knowing where to send someone is not a reason to leave them on the marketing page.
        // The old landing is where everyone went until now, so it is the safe answer.
        console.warn('[landing] could not read where this account lands:', err.message);
        return '/v1/profile';
      }
    };
    const check = () => {
      try {
        const raw = localStorage.getItem('aimeat_session');
        if (raw && JSON.parse(raw)?.jwt) {
          landingFor().then((path) => navigate(path));
          return true;
        }
      // eslint-disable-next-line aimeat/no-silent-catch -- stay on landing
      } catch { /* stay on landing */ }
      return false;
    };
    let arrivedInApp = false;
    try { arrivedInApp = sessionStorage.getItem('aimeat.in-app') === '1'; } catch { /* treat as direct arrival */ }   // eslint-disable-line aimeat/no-silent-catch -- treat as direct arrival
    if (!arrivedInApp && check()) return undefined;
    const onAuth = () => check();
    window.addEventListener('aimeat-auth-change', onAuth);
    return () => window.removeEventListener('aimeat-auth-change', onAuth);
    // navigate is a router prop; this is a deliberate mount-only "redirect on arrival"
    // check that must not re-run (and re-redirect) if navigate's identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return html`
    <div class="ld">
      <!-- 0. The front door (remake phase 8). What this place is, in one sentence, and the three
              ways in — the agent door first, because "your AI can do the whole thing" is the
              product's strongest claim and this demonstrates it instead of describing it.
              The landing page belongs to both the old path and the new one, which makes this the
              one deliberate, bounded exception to the new path keeping to its own files. -->
      <${WelcomeDoor} onNavigate=${navigate} />

      <!-- Order reversed 2026-07-30 (TARGET-056). The strongest thing on this page is that a
           sentence becomes a published app, and it used to sit below the fold under a wall of
           other people's work. It leads now; the reason it matters (owner or tenant) comes
           after, because it answers a question the visitor only has once they have seen the
           thing work. -->

      <!-- 0. What this place IS, in one sentence, before anything asks the visitor to do
              something. The fold below opens onto a tool for building an app, and a tool
              answers "what can I make" while leaving "what is this" unanswered. The lead-in
              line frames the fold as one example rather than the whole product. -->
      <section class="ld-pitch">
        <p class="ld-pitch-line">${tr('landing.pitch', 'AIMEAT is a digital agency where people, AI, agents and apps work under one roof and everyone owns their own data.')}</p>
        <p class="ld-pitch-lead">${tr('landing.pitchLead', 'This is one of the things you can do with AIMEAT.')}</p>
      </section>

      <!-- 1. The invitation, folded. Measured behaviour beat the theory here: with the generator
              open on the page, two visitors produced a throwaway chat app and stopped. What holds
              attention is the wall directly below: it shows the place is alive, which is what
              makes someone want to add to it. So the builder is one line until it is wanted.
              It leads the page: the visitor's own first move outranks our release notes. -->
      <${BuildInvite} />

      <!-- 1a. The second door, equal weight: connect the chat you already use. The two doors are
               the two real ways in, and until 2026-08-07 only one of them was on this page. -->
      <${ConnectInvite} onNavigate=${navigate} />

      <!-- 1b. What we shipped, folded to one line, directly under the invitation — near enough
               to say the place is worked on, below the thing the visitor came to do. -->
      <${NodeChangeLog} />

      <!-- 2. The wall, immediately visible. The best thing on this page for showing activity. -->
      <${Gallery} />

      <!-- 3. Live counters close the activity block. "N agents, M online now" is the strongest
              single number here. -->
      <${NodeTotals} />

      <!-- 4. Why it matters: owner or tenant. After the proof, not before it. -->
      <${BuildHero} onNavigate=${navigate} />

      <!-- 6. Build an AGENT (local crewaimeat fleet on Ollama/Gemma) — the coder/tinkerer on-ramp. -->
      <${BuildAgentPrompt} />

      <!-- 7. Ask your own AI what AIMEAT is — for you (a homework path, for the already-curious). -->
      <${AskYourAI} />

      <!-- 8. Today's stats + ownership line — the sales close. -->
      <${StatsPanel} navigate=${navigate} />

      <!-- 8b. One line about AI transparency, and one link. It is deliberately one line: the
               landing page is not a compliance brochure, and the page it links to is where the
               limits are stated properly. -->
      <p class="ld-transline">
        ${tr('landing.transLine', 'Content a model wrote here carries a record of how it was made, and a label where a person reads it.')}
        ${' '}
        <a href="/v1/transparency" onClick=${(e) => { e.preventDefault(); navigate('/v1/transparency'); }}>
          ${tr('landing.transCta', 'How this node marks AI content →')}
        </a>
      </p>

      ${/* The footer this page used to carry (Pricing, Docs, Run your own node, GitHub, For
            developers, AI transparency) is the shell's SiteFooter now — spa.html renders it
            under every public view, so those links are on the pricing page and the help page
            too instead of only here, and there is one footer to edit rather than three. */''}
    </div>
  `;
}
