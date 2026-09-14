/**
 * @file landing-v2-cards.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Two proof sections of the front page's design round (TARGET-075). The prompt
 *   cards: one card per prompt, the prompt to copy, what it produced, how long it took and with
 *   which model, for four apps that really run on this server. And the wall: the same list of
 *   published apps the showroom shows, split in two, the community's apps first because "built by
 *   people and their AI" is a claim and they are its proof, then the house's own.
 *
 *   THE PROMPT TEXTS, TIMES AND MODELS ARE PLACEHOLDERS the developer fills in; the cards say so
 *   on their face. The apps, their names and what they do are real.
 *
 *   WHO IS "THE HOUSE" is not in the public app list. The wall reads window.__SITE.operatorOwner
 *   when the server provides it and otherwise treats the owner with the most apps as the house,
 *   which is true on aimeat.io (131 of 156) and is the open question TARGET-075 carries.
 * @structure CARDS · PromptCards · AppCard · Wall2
 * @usage import { PromptCards, Wall2 } from './landing-v2-cards.js';
 * @version-history
 *   v0.1.0 — 2026-09-14 — Design round, TARGET-075.
 */
import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { openAppSandboxed } from '/js/app-sandbox.js';
import { CopyButton } from '/components/CopyButton.js';
import { swallowed } from '/js/swallowed.js';
import { date as fmtDate } from '/js/format.js';

// t() echoes the key when a translation is missing — fall back to readable English.
const tr = (key, fallback) => { const v = t(key); return v && v !== key ? v : fallback; };

/** The four apps, as they are on aimeat.io on 2026-09-14. Names are product names and stay. */
const CARDS = [
  { owner: 'happydude500001', file: 'tinki.html', name: 'TINKI', key: 'landing2.cardTinki',
    en: 'An auction house where agents bid for you, sealed, every bid covered by a payment hold.' },
  { owner: 'happydude500001', file: 'parvi.html', name: 'PARVI', key: 'landing2.cardParvi',
    en: 'An agent that reads the emissions off Porkkala and disagrees with three ships about where they are.' },
  { owner: 'happydude500001', file: 'palkkalaskuri-2026.html', name: 'Suomen palkkalaskuri 2026', key: 'landing2.cardPalkka',
    en: 'A Finnish salary calculator for 2026 with the tax rules built in, and your history kept when you sign in.' },
  { owner: 'happydude500001', file: 'ai-music-charts.html', name: 'AI Music Charts', key: 'landing2.cardMusic',
    en: 'The weekly chart of AI-made music, and every entry says who, which model and how much human work.' },
];

const EyeMark = html`<svg class="ld-eye" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>`;

/**
 * Prompts and what they produced. The card is the whole product experience in one frame: you
 * get a place, you plug in your AI, you paste the prompt, the thing exists.
 */
export function PromptCards() {
  const [missing, setMissing] = useState({});
  const promptPh = tr('landing2.cardPromptPh', '[PROMPT: the exact words this was asked with. Jouni fills this in.]');
  return html`
    <section class="ld-v2-cards">
      <h2 class="ld-sh-h2 ld-v2-h2-row">
        <span>${tr('landing2.cardsTitle1', 'What to do on day one:')}</span>
        <span class="ld-sh-accent">${tr('landing2.cardsTitle2', 'a prompt, and what it made')}</span>
      </h2>
      <p class="ld-sh-text ld-v2-cards-sub">${tr('landing2.cardsSub', 'Four things that exist because somebody pasted a prompt here. Copy one, paste it into your own AI, and yours exists too. The time and the model are on each card so you know what to expect.')}</p>
      <div class="ld-v2-cardgrid">
        ${CARDS.map((c) => {
          const href = `/v1/apps/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.file)}?mode=inline`;
          const shot = `/v1/apps/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.file)}/screenshot`;
          const open = (e) => { e.preventDefault(); openAppSandboxed(href, c.name); };
          return html`
            <article class="ld-v2-card poster-frame" key=${c.file}>
              <div class="ld-v2-card-shot" role="button" tabindex="0" onClick=${open}
                onKeyDown=${(e) => { if (e.key === 'Enter' || e.key === ' ') open(e); }}>
                ${missing[shot]
                  ? html`<span class="ld-v2-card-shot-ph">${c.name}</span>`
                  : html`<img src=${shot} alt=${c.name} onError=${() => setMissing((m) => ({ ...m, [shot]: true }))} />`}
              </div>
              <div class="ld-v2-card-body">
                <h3 class="ld-sh-h3">${c.name}</h3>
                <p class="ld-v2-card-result">${tr(c.key, c.en)}</p>
                <pre class="ld-v2-card-prompt">${promptPh}</pre>
                <dl class="ld-v2-card-facts">
                  <div><dt>${tr('landing2.cardTook', 'Took')}</dt><dd>${tr('landing2.cardTookPh', '[time]')}</dd></div>
                  <div><dt>${tr('landing2.cardModel', 'Model')}</dt><dd>${tr('landing2.cardModelPh', '[model]')}</dd></div>
                </dl>
                <div class="ld-v2-card-actions">
                  <${CopyButton} text=${promptPh} className="btn-primary ld-v2-card-copy"
                    label=${tr('landing2.cardCopy', 'Copy the prompt')}
                    copiedLabel=${tr('landing2.cardCopied', 'Copied. Paste it into your AI')} />
                  <a class="ld-sh-door showroom-door" href=${href} onClick=${open}>${tr('landing2.cardOpen', 'Open what it made →')}</a>
                </div>
              </div>
            </article>`;
        })}
      </div>
    </section>`;
}

const WALL_FIRST_PAGE = 12;

const fmtPublished = (iso) => {
  try { return fmtDate(iso); } catch (err) { swallowed('landing-v2: date', err); return ''; }
};

/** One app on the wall, the showroom's card: name, a line, the facts, who and when. */
function AppCard({ a }) {
  const m = a.manifest || {};
  const href = `/v1/apps/${encodeURIComponent(a.owner)}/${encodeURIComponent(a.filename)}?mode=inline`;
  const desc = (m.description || '').length > 140 ? m.description.slice(0, 140) + '…' : (m.description || '');
  const author = m.authorDisplay || a.owner || tr('landing.wallAnon', 'someone');
  const when = a.created_at ? fmtPublished(a.created_at) : '';
  const open = () => openAppSandboxed(href, m.name || a.filename);
  const opensLabel = `${a.downloads} ${a.downloads === 1 ? tr('landing.wallOpen1', 'open') : tr('landing.wallOpens', 'opens')}`;
  const facts = [];
  if (a.version_number) facts.push(html`<span>v${a.version_number}</span>`);
  if (a.downloads > 0) facts.push(html`<span class="ld-app-opens" title=${opensLabel} aria-label=${opensLabel}>${EyeMark}${a.downloads}</span>`);
  if (a.forks > 0) facts.push(html`<span>${a.forks} ${a.forks === 1 ? tr('landing.wallFork1', 'fork') : tr('landing.wallForks', 'forks')}</span>`);
  return html`
    <div class="ld-app-card" role="button" tabindex="0"
      onClick=${open} onKeyDown=${(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } }}>
      ${a.screenshot_url ? html`<img class="ld-app-shot" src=${a.screenshot_url} loading="lazy" alt="" />` : ''}
      <div class="ld-app-name">${m.icon ? m.icon + ' ' : ''}${m.name || a.filename}</div>
      ${desc && html`<div class="ld-app-desc">${desc}</div>`}
      <div class="ld-app-foot">
        <span class="ld-app-facts">${facts.map((f, i) => html`${i ? html`<span class="ld-app-sep">·</span>` : ''}${f}`)}</span>
        <span class="ld-app-by">${author}${when ? ' · ' + when : ''}</span>
      </div>
    </div>`;
}

/** The house's owner name: what the server says, else whoever published the most. */
function houseOwner(apps) {
  try {
    const s = /** @type {any} */ (window).__SITE;
    if (s && typeof s.operatorOwner === 'string' && s.operatorOwner) return s.operatorOwner;
  } catch (err) { swallowed('landing-v2: site', err); }
  const counts = new Map();
  for (const a of apps) counts.set(a.owner, (counts.get(a.owner) || 0) + 1);
  let best = ''; let n = 0;
  for (const [owner, c] of counts) if (c > n) { best = owner; n = c; }
  return best;
}

/**
 * Built by people and their AI: the community's apps first, all of them, then the house's own
 * with the rest one click away. Same listing, same card, same sandboxed opening as the showroom.
 */
export function Wall2() {
  const [apps, setApps] = useState([]);
  const [showAll, setShowAll] = useState(false);
  useEffect(() => {
    fetch('/v1/apps?sort=newest&limit=200').then(r => r.json())
      .then(j => setApps(j?.data?.apps || []))
      .catch(err => { swallowed('landing-v2: wall', err); });
  }, []);
  const house = houseOwner(apps);
  const community = apps.filter((a) => a.owner !== house);
  const own = apps.filter((a) => a.owner === house);
  const ownShown = showAll ? own : own.slice(0, WALL_FIRST_PAGE);
  const hidden = own.length - ownShown.length;

  return html`
    <section class="ld-v2-wall">
      <h2 class="ld-h2">${tr('landing2.wallTitle', 'Built by people and their AI.')}</h2>
      ${community.length > 0 ? html`
        <p class="ld-sh-text ld-v2-wall-lead">${tr('landing2.wallCommunity', 'These were built by people who came here with their own AI. Every one of them is a stranger\'s proof.').replace('{n}', String(community.length))}</p>
        <div class="ld-gallery">${community.map((a) => html`<${AppCard} a=${a} key=${a.owner + '/' + a.filename} />`)}</div>` : ''}
      ${own.length > 0 ? html`
        <h3 class="ld-sh-h3 ld-v2-wall-own">${tr('landing2.wallOwn', 'And by us, here, every day.')}</h3>
        <div class="ld-gallery">${ownShown.map((a) => html`<${AppCard} a=${a} key=${a.owner + '/' + a.filename} />`)}</div>
        ${hidden > 0 ? html`
          <div class="ld-wall-more">
            <button type="button" class="btn-outline" onClick=${() => setShowAll(true)}>
              ${tr('landing.wallShowAll', 'Show the other {n} apps').replace('{n}', String(hidden))}
            </button>
          </div>` : ''}` : ''}
      ${apps.length === 0 ? html`<p class="ld-app-desc">${tr('landing.wallEmpty', 'Be the first. Say what you want at the top, and it lands here.')}</p>` : ''}
    </section>`;
}
