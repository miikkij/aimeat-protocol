/**
 * @file landing-builder.js
 * @description The landing page's app generator, folded shut behind one line: connect your AI,
 *   describe the app, give the AI the prompt, and it builds and publishes the app on Atelier. Under
 *   the steps, folded again, the long prompt for an AI that cannot connect (Microsoft 365 Copilot,
 *   for one), with the capability packs the idea names, and the way to add the file it hands back.
 *
 *   Extracted from landing.js unchanged when that file reached 789 of its 800 allowed lines.
 *
 *   THE PROMPT TEXT IS NOT BUILT HERE. The connected prompt is the app catalogue's
 *   (views/appcat/dialogs/generate-prompt.js connectedPrompt), and it sends the AI to read the
 *   node's own Atelier spec, so the front page and the catalogue cannot say different things. The
 *   long prompt comes from GET /v1/prompts/build-app, the same canonical text the app-catalog and
 *   agentic coders read; only the idea and the packs it names are assembled on top of it. A
 *   hand-written fallback lived here until 2026-07-28 and had drifted; it was removed rather than
 *   repaired.
 *
 *   The builder is FOLDED because of measured behaviour, not taste: with the generator open on the
 *   front page two visitors produced a throwaway chat app and stopped, while the wall below is what
 *   reads as a living place. A draft left in the tab re-opens the fold onto it.
 * @structure fetchCanonicalBuildPrompt · readBuilderDraft · writeBuilderDraft · packMatchesIdea ·
 *   OtherAi · BuildAppPrompt · BuildInvite
 * @usage import { BuildInvite } from './landing-builder.js';
 * @version-history
 *   v2.0.0 — 2026-10-25 — The connected AI is the road (Jouni): connect, describe, give the short
 *     prompt, and a new app is Atelier only. The track cards, the template picker and the pack pills
 *     are gone; the long Classic prompt stays, folded, for an AI that cannot connect.
 *   (2026-09-29) Step 3's add link opens /v1/appcat?add=1 instead of /app-catalog.html (Jouni).
 *   (2026-08-28) fetchCanonicalBuildPrompt is exported for the build-story page, and BuildInvite
 *     takes openByDefault: the block declared that setting on 2026-08-26 and nothing read it.
 *   v1.1.0 — 2026-08-27 — The TRACK is the first decision (TARGET-074): Classic or Atelier as
 *     two cards, each track fetching its own guide (/v1/prompts/build-app vs
 *     /v1/prompts/build-app-atelier), never mixed — Atelier hides Classic's templates and packs
 *     because the kit is its vocabulary. Classic stays the default until measured evidence.
 *   v1.0.0 — 2026-08-26 — Pure extraction from landing.js v5.3.0. No behaviour change.
 */
import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t, getLocale } from '/js/i18n.js';
import { Collapsible } from '/components/Collapsible.js';
import { CopyButton } from '/components/CopyButton.js';
import { ManagedEnvNote } from '/components/ManagedEnvNote.js';
import { swallowed } from '/js/swallowed.js';
import { connectedPrompt } from '/views/appcat/dialogs/generate-prompt.js';

// t() echoes the key when a translation is missing — fall back to readable English.
const tr = (key, fallback) => { const v = t(key); return v && v !== key ? v : fallback; };

// Canonical build prompt from the node - the single source of truth the app-catalog + agentic
// coders use. TWO TRACKS, TWO GUIDES (TARGET-074): Classic reads /v1/prompts/build-app (the
// daisyUI vocabulary, templates and capability packs), Atelier reads /v1/prompts/build-app-atelier
// (the served kit, the looks, the mosaic). Neither prompt teaches the other's mechanics. Cached per
// locale and track.
const _canonicalPromptCache = {};
export async function fetchCanonicalBuildPrompt(locale, track) {
  const key = (locale || 'en') + '|' + (track || 'classic');
  if (_canonicalPromptCache[key]) return _canonicalPromptCache[key];
  const path = track === 'atelier' ? '/v1/prompts/build-app-atelier' : '/v1/prompts/build-app';
  const d = await (await fetch(path + '?mode=new&lang=' + encodeURIComponent(locale || 'en'))).json();
  const full = d && d.data && d.data.prompt;
  if (typeof full === 'string' && full.length > 500) { _canonicalPromptCache[key] = full; return full; }
  throw new Error('no canonical prompt');
}

// Same filter the catalog applies: engines and wrappers a person would pick on purpose.
const PACK_CATEGORIES = ['visualization', 'diagrams', 'canvas', 'game', '3d', 'realtime'];

// The canonical prompt carries a placeholder for the idea. Replacing it beats appending, so the
// AI reads the idea where it expects to and the interview step adapts itself.
const IDEA_PLACEHOLDER = 'My initial idea: (not given yet — ask me what to build)';

/* The half-finished thought, kept for the length of the browser tab.
   sessionStorage rather than localStorage on purpose: this is an unfinished draft, not a
   setting, and a stranger who looks once should not find their idea waiting weeks later on a
   shared machine. Closing the tab is the intent to drop it. It also carries the idea through the
   connect page and registration, which leave this page. */
const BUILDER_DRAFT_KEY = 'aimeat.landing.builder';

function readBuilderDraft() {
  try {
    const raw = sessionStorage.getItem(BUILDER_DRAFT_KEY);
    const d = raw ? JSON.parse(raw) : null;
    if (!d || typeof d !== 'object') return {};
    return { idea: typeof d.idea === 'string' ? d.idea : '' };
  } catch (err) { swallowed('landing: read builder draft', err); return {}; }
}

function writeBuilderDraft(draft) {
  try {
    // Nothing typed is nothing to keep: a kept-but-empty record would re-open the fold onto a
    // blank form.
    if (!draft.idea) sessionStorage.removeItem(BUILDER_DRAFT_KEY);
    else sessionStorage.setItem(BUILDER_DRAFT_KEY, JSON.stringify(draft));
  } catch (err) { swallowed('landing: write builder draft', err); }
}

function packMatchesIdea(pack, ideaText) {
  const text = (ideaText || '').toLowerCase();
  if (!text) return false;
  return (pack.interviewTriggers || []).some((trigger) => {
    const esc = String(trigger).toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp('(^|[^a-zà-öø-ÿ])' + esc).test(text);
  });
}

/* The road for an AI that cannot connect. Mounted only while its fold is open, so the front page
   reads the long prompt and the packs only for the visitor who needs them. */
function OtherAi({ idea }) {
  const [canonical, setCanonical] = useState('');
  const [packs, setPacks] = useState([]);
  const [packDocs, setPackDocs] = useState({});

  useEffect(() => {
    fetchCanonicalBuildPrompt(getLocale(), 'classic').then(setCanonical).catch(err => { swallowed('landing: prompt', err); });
    fetch('/v1/library-packs?lang=' + encodeURIComponent(getLocale())).then(r => r.json()).then(d => {
      const all = (d.data && d.data.packs) || [];
      setPacks(all.filter(pk => {
        if (pk.status === 'deprecated') return false;
        if (pk.kind === 'vendored' || pk.kind === 'bundle') return PACK_CATEGORIES.includes(pk.category);
        if (pk.kind === 'cortex') return PACK_CATEGORIES.includes(pk.category) && pk.id !== 'aimeat-charts';
        return false;
      }));
    }).catch(err => { swallowed('landing: packs', err); });
  }, []);

  // The packs the idea names. Their usage docs travel inside the prompt, because a chat AI cannot
  // fetch the pack endpoint itself.
  const selected = packs.filter(pk => packMatchesIdea(pk, idea));
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
    let out = idea.trim() ? canonical.replace(IDEA_PLACEHOLDER, 'My initial idea: ' + idea.trim()) : canonical;
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

  return html`
    <div class="ld-gen-other">
      <p class="ld-gen-hint">${tr('landing.genOtherHint', 'Microsoft 365 Copilot, for one, cannot connect. Then copy this longer prompt: it carries the build instructions with it, the AI hands you one HTML file, and you add that file here yourself. This road builds on the Classic track, not on Atelier.')}</p>
      ${selected.length ? html`<p class="ld-gen-contains">${tr('landing.genOtherPacks', 'Included for your idea')}: ${selected.map(pk => pk.title || pk.id).join(' · ')}.</p>` : ''}
      <div class="ld-gen-preview-label">${tr('landing.genPreview', 'Prompt preview')}</div>
      <div class="ld-gen-preview">${prompt || tr('landing.buildLoading', 'Loading the build prompt from this node…')}</div>
      <${CopyButton} text=${prompt} className="btn-outline ld-gen-action" disabled=${!prompt}
        label=${tr('landing.genOtherCopy', 'Copy the long prompt')} copiedLabel=${tr('common.copied', '✓ Copied')} />
      <p class="ld-gen-hint">${tr('landing.genStep3Hint', 'Got the code or HTML file back from the AI? Create an account, it takes a minute, then paste the code or upload the file. The app goes live at its own address and you get a link to share.')}</p>
      <a class="btn-outline ld-gen-action ld-gen-add" href="/v1/appcat?add=1">
        ${tr('landing.genStep3Btn', 'Register and add your app')}
      </a>
    </div>`;
}

function BuildAppPrompt() {
  // Restored from the tab, so the idea survives the round trip through the connect page and
  // registration; without this they come back to an empty box and describe their app again.
  const saved = readBuilderDraft();
  const [idea, setIdea] = useState(saved.idea || '');
  const [other, setOther] = useState(false);

  useEffect(() => { writeBuilderDraft({ idea }); }, [idea]);

  const prompt = connectedPrompt({ description: idea, lang: getLocale() });

  return html`
    <div class="ld-gen">
      <p class="ld-gen-intro">${tr('landing.genIntroConnected', 'Your own AI builds the app and publishes it here. It reads this service\'s build instructions first, asks you a few questions and waits for your yes before it builds.')}</p>

      <div class="ld-gen-step">
        <div class="ld-gen-head"><span class="ld-gen-num">1</span><span>${tr('landing.genConnectStep', 'Connect your AI')}</span></div>
        <p class="ld-gen-hint">${tr('landing.genConnectHint', 'Claude, ChatGPT and many other AIs connect to this service. You do it once, and after that your AI builds, publishes and fixes your apps.')}</p>
        <a class="btn-outline ld-gen-action" href="/v1/connect-your-ai">${tr('landing.genConnectBtn', 'Connect your AI')}</a>
      </div>

      <div class="ld-gen-step">
        <div class="ld-gen-head"><span class="ld-gen-num">2</span><span>${tr('landing.genStep1', 'Describe your app')}</span></div>
        <textarea class="ld-gen-idea" rows="3" value=${idea} onInput=${(e) => setIdea(e.target.value)}
          aria-label=${tr('landing.genStep1', 'Describe your app')}
          placeholder=${tr('landing.genIdeaPh', 'Describe what the app should do…')}></textarea>
      </div>

      <div class="ld-gen-step">
        <div class="ld-gen-head"><span class="ld-gen-num">3</span><span>${tr('landing.genGiveStep', 'Give the prompt to your AI')}</span></div>
        <p class="ld-gen-hint">${tr('landing.genGiveHint', 'Copy the prompt and paste it into your connected AI. It asks what it needs to know, shows you what it will build and waits for your yes. It publishes the finished app itself and gives you its address.')}</p>
        <div class="ld-gen-preview-label">${tr('landing.genPreview', 'Prompt preview')}</div>
        <div class="ld-gen-preview">${prompt}</div>
        <${ManagedEnvNote} />
        <${CopyButton} text=${prompt} className="btn-primary ld-gen-action"
          label=${tr('common.copyPrompt', 'Copy prompt')} copiedLabel=${tr('common.copied', '✓ Copied')} />
      </div>

      <${Collapsible} title=${tr('landing.genOtherTitle', 'Your AI cannot connect?')} open=${other} onToggle=${() => setOther(o => !o)}>
        <${OtherAi} idea=${idea} />
      <//>
    </div>`;
}

/* The build invitation, folded shut.
   Evidence over theory: an open generator on the front page produced two throwaway chat apps
   and nothing else, while the wall underneath is what actually reads as a living place. So the
   whole builder sits behind one line, and the page leads with what people made.

   The line invites the click and stops short of the old "no account needed to start", which was
   false: anonymous access is off, so an app only reaches the server behind a login. */
export function BuildInvite({ openByDefault = false } = {}) {
  // Shut by default, but a draft left in this tab means the visitor was mid-thought: open onto it.
  // openByDefault is the block's own setting (portal.build-invite) and the build-story page's
  // choice: there the generator IS the page's last word, so it starts open.
  const [open, setOpen] = useState(() => openByDefault || !!readBuilderDraft().idea);
  return html`
    <section class="ld-invite">
      <${Collapsible}
        title=${html`
          <span class="ld-invite-title">${tr('landing.inviteTitle', 'Build your app in 10 minutes')}</span>
          <span class="ld-invite-sub">${tr('landing.inviteSubConnected', 'Click here and start. Your own AI builds the app and publishes it here.')}</span>
        `}
        open=${open} onToggle=${() => setOpen(o => !o)}>
        <div class="ld-loop">
          <span class="ld-loop-step">① ${tr('landing.loopConnect1', 'Connect your AI')}</span>
          <span class="ld-loop-arrow">→</span>
          <span class="ld-loop-step">② ${tr('landing.loopConnect2', 'Describe your app and give your AI the prompt')}</span>
          <span class="ld-loop-arrow">→</span>
          <span class="ld-loop-step">③ ${tr('landing.loopConnect3', 'Your AI builds and publishes the app. Share the link.')}</span>
        </div>
        <${BuildAppPrompt} />
      <//>
    </section>
  `;
}
