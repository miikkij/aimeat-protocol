/**
 * @file landing-v2-cards.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Two proof sections of the front page (TARGET-075). The prompt cards: four prompts,
 *   four very different things (a game, a tool for a business, a room for a team, a committee of
 *   agents), each the whole product experience in one frame: you get a place, you plug in your AI,
 *   you paste the prompt, the thing exists. And the wall: the same list of published apps the
 *   showroom shows, split in two, the community's apps first because "built by people and their
 *   AI" is a claim and they are its proof, then the house's own.
 *
 *   THE PROMPTS ARE THE PRODUCT, AND THEY ARE ENGLISH. A prompt is what a person pastes into their
 *   AI, so it stays in the language the models work best in; the card's title and sentence are in
 *   the visitor's language. The time and the model are filled in once each prompt has been run
 *   (CARDS[].took / model), and until an app exists the card says so instead of linking nowhere.
 *
 *   WHO IS "THE HOUSE" is not in the public app list. The wall reads window.__SITE.operatorOwner
 *   when the server provides it and otherwise treats the owner with the most apps as the house,
 *   which is true on aimeat.io (131 of 156) and is the open question TARGET-075 carries.
 * @structure PROMPTS · CARDS · PromptCards · AppCard · Wall2
 * @usage import { PromptCards, Wall2 } from './landing-v2-cards.js';
 * @version-history
 *   v0.2.0 — 2026-09-14 — Four new prompts, written to be run: a co-op lighthouse game, receipts
 *     into the ledger, a live decision room, a committee of agents. The apps they make come after.
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

/** What every prompt opens with: read first, then build, then finish properly. */
const PREAMBLE = `You are connected to aimeat.io over MCP as my AI. Build and publish the app below on my account.

Before writing a line: call aimeat_appdev_overview, read the Atelier build spec (GET /v1/prompts/build-app-atelier) and the skill node:aimeat-app-builder-atelier with aimeat_skill_get, read aimeat_appdev_pitfall_list, and search the Design Book with aimeat_designbook_search for the parts you will use. Reuse what exists: the served libraries under /v1/libs and the library packs, never a CDN. Pick one look for the whole app in light and dark. The app must work on a phone first.

When it is built: publish it with aimeat_app_publish, run aimeat_app_audit and fix everything it names, take the screenshot, set the legal pages with aimeat_app_legal_set, switch search on with aimeat_app_seo_set, and hand me the address. Then tell me, in two lines, how long the whole thing took from this message to the address, and which model you are.`;

/** The four prompts. English on purpose: this is what gets pasted into an AI. */
const PROMPTS = {
  lighthouse: `${PREAMBLE}

THE APP: "NIGHT WATCH", a two-player co-op game about keeping one lighthouse lit through one night.

The lighthouse is the same for everyone, and it persists: every night anyone plays is one entry in the keeper's log, kept server-side in a cortex extension, so the log grows for as long as the app exists. One night is four minutes of real time.

Two keepers in two browsers share a room through AIMEAT's own realtime engine (the served realtime library and its rooms under /v1/realtime/rooms; nothing else for sync). The keeper on the stairs carries oil up a spiral of eleven floors while the storm knocks out lamps floor by floor; the keeper in the lamp room turns the lens by hand to track ships that only she can see on her radar, and calls out bearings that appear as text on the stairs keeper's screen. A ship that passes an unlit sector is lost, and the night's score is ships saved minus ships lost. Solo play is allowed and the second role is then an AI keeper who calls bearings through the owner's model, slightly late, as a real colleague would.

Build it on Phaser 4 through the aimeat-phaser base: keyboard, gamepad and touch as one control, the levels as text maps with the level editor open to players, generated music that rises with the storm, a trophy for the first night with zero ships lost. A guest's progress follows them into an account when they sign in. The crew leaderboard is per night and all time.

At dawn the app writes the keeper's log entry with the owner's model from what actually happened (bearings called, lamps lost, ships saved), stores it with an AI provenance record, and posts it to the Showcase board. Pick a look that reads as a lighthouse at night: one dark ground, one warm light, no other colours, every text in the game bilingual EN/FI.`,

  tosite: `${PREAMBLE}

THE APP: "TOSITE", receipts into the accounting ledger with no typing.

Installable on a phone. One button: photograph a receipt. The owner's model reads the photo (POST /v1/ai/complete with the image, under the app's quota) and answers with a voucher proposal: date, counterparty, total, VAT rate and amount, the VAT code from the Finnish set, an account suggestion, and its confidence. I see the photo and the proposal side by side, correct a field if I must, and press "book it". That press writes an append-only voucher through /v1/finance/vouchers, files the photo in storage as its evidence, and shows the voucher number. A photo that is not a receipt is refused with the reason, and a duplicate (same counterparty, total and date within three days) is caught before it is booked.

The second screen is the month: every voucher, the VAT report the ledger already computes, and two exports, CSV and Finvoice, made for the accountant. The third screen is a share: one press opens the month's evidence to a sharing group named "accountant", and revokes it when the month closes.

Companies: the app reads my companies from /v1/companies and books under the one I pick, with separate books per company. Every receipt the model read carries an AI provenance record that says the model proposed and a person confirmed. Look: an official document, black on white, one accent, monospace numbers, nothing decorative. EN/FI, Finnish first.`,

  signalroom: `${PREAMBLE}

THE APP: "SIGNAL ROOM", a live decision room for five people who have to decide something in ten minutes.

One person opens a room inside an organism and types the question. The others join from the link and see each other live through AIMEAT's own realtime engine (the served realtime library and its rooms under /v1/realtime/rooms; no other sync layer), with presence and names from their accounts. Round one is silent: each person turns a dial from "no" to "yes" and writes one sentence; nobody sees the others' dials until the ninety-second clock runs out, and then all five appear at once. Round two: the owner's model reads the five sentences and names the dissent in two lines, without taking a side. Round three is the same dial again, and the room shows how far each person moved.

The ruling is written by the person who opened the room, in one sentence, and then the app writes a decision record into the organism's workspace (a records space named decisions, schema-locked) with the question, both rounds' dials, the five sentences, the model's two lines with their provenance record, and the ruling. Every participant signs the record with an identity attestation, and the record shows who has signed. Anyone who refuses to sign is recorded as refusing, which is a valid outcome.

A room that reaches no ruling in twenty minutes closes and writes that too. Look: a control room at night, one dial per person drawn in SVG, large type, nothing that needs a mouse. EN/FI/ES.`,

  committee: `${PREAMBLE}

THE APP: "THE COMMITTEE", where my own agents deliberate a question and I get the minutes.

I type a question and pick up to four of my agents from /v1/agents (the app names which are reachable right now). It composes a workflow with aimeat_workflow_save: one step per agent, each told to take a position in under 200 words and to name the strongest argument against itself; then a step where every agent reads the others and may change its position once; then a pause that waits for my answer; then a closing step in which one agent, chosen by lot, writes the minutes. Every message an agent writes is a direct message in one thread that carries the agent's name and the model it used, so the deliberation is readable as it happens on the Messages page and in the app.

When the pause comes, the app shows me the four positions side by side with what each one changed, and I answer with a ruling or a further question; a further question starts another round. The minutes go into a living document in my organism's workspace, the thread stays as the record, and the app sends me a direct message with the ruling and a link. If I have fewer than four agents, it runs with the ones I have and says so; with none, it tells me how to connect one and stops.

A schedule can reconvene the committee weekly on the same question, and the app shows how the positions drifted over the weeks. Look: a chamber, four seats drawn as four columns, minutes typeset like a public record, the EU AI label on everything a model wrote. EN/FI.`,
};

/**
 * The four cards. `app` is owner/filename once the prompt has been run and the thing exists;
 * `took` and `model` are filled in from that run. Until then the card says "not built yet".
 */
const CARDS = [
  { id: 'lighthouse', name: 'NIGHT WATCH', key: 'landing2.cardLighthouse', en: 'Two keepers in two browsers keep one lighthouse lit through a four-minute night, and the keeper\'s log grows for as long as the app exists.', prompt: PROMPTS.lighthouse, app: null, took: '', model: '' },
  { id: 'tosite', name: 'TOSITE', key: 'landing2.cardTosite', en: 'Photograph a receipt and it is a voucher in the ledger with its VAT code, the photo filed as evidence, and the month ready for the accountant.', prompt: PROMPTS.tosite, app: null, took: '', model: '' },
  { id: 'signalroom', name: 'SIGNAL ROOM', key: 'landing2.cardSignalRoom', en: 'Five people, one question, two silent rounds of dials, and a ruling every one of them signed.', prompt: PROMPTS.signalroom, app: null, took: '', model: '' },
  { id: 'committee', name: 'THE COMMITTEE', key: 'landing2.cardCommittee', en: 'Your own agents deliberate a question, change their minds once, wait for your ruling, and hand you the minutes.', prompt: PROMPTS.committee, app: null, took: '', model: '' },
];

const EyeMark = html`<svg class="ld-eye" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>`;

/**
 * Prompts and what they made. The card is the whole product experience in one frame: you get a
 * place, you plug in your AI, you paste the prompt, the thing exists.
 */
export function PromptCards() {
  const [missing, setMissing] = useState({});
  return html`
    <section class="ld-v2-cards">
      <h2 class="ld-sh-h2 ld-v2-h2-row">
        <span>${tr('landing2.cardsTitle1', 'What to do on day one:')}</span>
        <span class="ld-sh-accent">${tr('landing2.cardsTitle2', 'a prompt, and what it made')}</span>
      </h2>
      <p class="ld-sh-text ld-v2-cards-sub">${tr('landing2.cardsSub', 'Four prompts, four very different things. Copy one, paste it into your own AI, and see what comes back. The time it took and the model go on the card once each one has been run.')}</p>
      <div class="ld-v2-cardgrid">
        ${CARDS.map((c) => {
          const built = !!c.app;
          const href = built ? `/v1/apps/${c.app.split('/').map(encodeURIComponent).join('/')}?mode=inline` : '';
          const shot = built ? `/v1/apps/${c.app.split('/').map(encodeURIComponent).join('/')}/screenshot` : '';
          const open = (e) => { e.preventDefault(); if (built) openAppSandboxed(href, c.name); };
          return html`
            <article class="ld-v2-card poster-frame" key=${c.id}>
              <div class="ld-v2-card-shot" role=${built ? 'button' : undefined} tabindex=${built ? 0 : undefined} onClick=${open}
                onKeyDown=${(e) => { if (built && (e.key === 'Enter' || e.key === ' ')) open(e); }}>
                ${!built || missing[shot]
                  ? html`<span class="ld-v2-card-shot-ph">${c.name}</span>`
                  : html`<img src=${shot} alt=${c.name} onError=${() => setMissing((m) => ({ ...m, [shot]: true }))} />`}
              </div>
              <div class="ld-v2-card-body">
                <h3 class="ld-sh-h3">${c.name}</h3>
                <p class="ld-v2-card-result">${tr(c.key, c.en)}</p>
                <pre class="ld-v2-card-prompt" tabindex="0">${c.prompt}</pre>
                <dl class="ld-v2-card-facts">
                  <div><dt>${tr('landing2.cardTook', 'Took')}</dt><dd>${c.took || tr('landing2.cardTookPh', '[time]')}</dd></div>
                  <div><dt>${tr('landing2.cardModel', 'Model')}</dt><dd>${c.model || tr('landing2.cardModelPh', '[model]')}</dd></div>
                </dl>
                <div class="ld-v2-card-actions">
                  <${CopyButton} text=${c.prompt} className="btn-primary ld-v2-card-copy"
                    label=${tr('landing2.cardCopy', 'Copy the prompt')}
                    copiedLabel=${tr('landing2.cardCopied', 'Copied. Paste it into your AI')} />
                  ${built
                    ? html`<a class="ld-sh-door showroom-door" href=${href} onClick=${open}>${tr('landing2.cardOpen', 'Open what it made →')}</a>`
                    : html`<span class="ld-v2-card-notyet">${tr('landing2.cardNotYet', 'Not built yet. Be the first: run it.')}</span>`}
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
        <p class="ld-sh-text ld-v2-wall-lead">${tr('landing2.wallCommunity', 'These were built by people who came here with their own AI. Every one of them is proof from somebody we have never met.').replace('{n}', String(community.length))}</p>
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
