/**
 * @file landing-builder.js
 * @description The landing page's app generator, folded shut behind one line: the three numbered
 *   steps, the idea box, the template picker, the capability packs, and the prompt they assemble.
 *
 *   Extracted from landing.js unchanged when that file reached 789 of its 800 allowed lines.
 *
 *   THE PROMPT TEXT IS NOT BUILT HERE. It comes from GET /v1/prompts/build-app, the same canonical
 *   text the app-catalog and agentic coders read, so this page cannot drift from the node. Only
 *   what a person chooses — idea, template, packs — is assembled on top of it. A hand-written
 *   fallback lived here until 2026-07-28 and had drifted (no research-first step, no T1/T2/T3
 *   tiers, no capability packs); it was removed rather than repaired.
 *
 *   The builder is FOLDED because of measured behaviour, not taste: with the generator open on the
 *   front page two visitors produced a throwaway chat app and stopped, while the wall below is what
 *   reads as a living place. A draft left in the tab re-opens the fold onto it.
 * @structure fetchCanonicalBuildPrompt · appendTemplateBlock · readBuilderDraft · writeBuilderDraft ·
 *   tierTitle · packMatchesIdea · BuildAppPrompt · BuildInvite
 * @usage import { BuildInvite } from './landing-builder.js';
 * @version-history
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

// t() echoes the key when a translation is missing — fall back to readable English.
const tr = (key, fallback) => { const v = t(key); return v && v !== key ? v : fallback; };

// Canonical build prompt from the node - the single source of truth the app-catalog + agentic
// coders use. TWO TRACKS, TWO GUIDES (TARGET-074): Classic reads /v1/prompts/build-app (the
// daisyUI vocabulary, templates and capability packs), Atelier reads /v1/prompts/build-app-atelier
// (the served kit, the looks, the mosaic). Neither prompt teaches the other's mechanics, so the
// choice is made HERE and nothing is mixed after it. Cached per locale and track.
const _canonicalPromptCache = {};
async function fetchCanonicalBuildPrompt(locale, track) {
  const key = (locale || 'en') + '|' + (track || 'classic');
  if (_canonicalPromptCache[key]) return _canonicalPromptCache[key];
  const path = track === 'atelier' ? '/v1/prompts/build-app-atelier' : '/v1/prompts/build-app';
  const d = await (await fetch(path + '?mode=new&lang=' + encodeURIComponent(locale || 'en'))).json();
  const full = d && d.data && d.data.prompt;
  if (typeof full === 'string' && full.length > 500) { _canonicalPromptCache[key] = full; return full; }
  throw new Error('no canonical prompt');
}

// Appended to whichever prompt body is in use.
function appendTemplateBlock(p, templateContent) {
  if (!templateContent) return p;
  return p + '\n## Starting template (copy from this)\nUse this skeleton as your base — keep its boot, login pill, and self-hosted theme wiring; fill the {{...}} slots; build your views inside <main>. Return the COMPLETE single HTML file based on it.\n```html\n' + templateContent + '\n```\n';
}

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
      track: d.track === 'atelier' ? 'atelier' : 'classic',
    };
  } catch (err) { swallowed('landing: read builder draft', err); return {}; }
}

function writeBuilderDraft(draft) {
  try {
    // Nothing decided is nothing to keep, and a kept-but-empty record would re-open the fold onto
    // a blank form. Emptiness counts only packs that are ON: unticking leaves an explicit `false`,
    // which is a decision about idea-matching and is meaningless once the idea box is empty too.
    const anyPackOn = Object.values(draft.chosen || {}).some(Boolean);
    if (!draft.idea && !draft.tplId && !anyPackOn && draft.track !== 'atelier') sessionStorage.removeItem(BUILDER_DRAFT_KEY);
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
  // The TRACK is the first decision and the guides never mix. Classic stays the default until
  // the measured evidence says otherwise (TARGET-074 phase 3).
  const [track, setTrack] = useState(saved.track || 'classic');

  useEffect(() => { writeBuilderDraft({ idea, tplId, chosen, track }); }, [idea, tplId, chosen, track]);

  // The canonical prompt follows the chosen track.
  useEffect(() => {
    setCanonical('');
    fetchCanonicalBuildPrompt(getLocale(), track).then(setCanonical).catch(err => { swallowed('landing: prompt', err); });
  }, [track]);

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

    // (The canonical prompt is fetched by the track effect above, per chosen track.)

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
    // Atelier: the kit is the vocabulary — no Classic templates, no capability packs, and the
    // idea rides as its own opening line (the Atelier guide has no placeholder to replace).
    if (track === 'atelier') {
      return idea.trim()
        ? "The app idea, in the owner's words: " + idea.trim() + '\n\n' + canonical
        : canonical;
    }
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
  if (track === 'atelier') {
    contains.push(tr('landing.promptHasAtelier', 'the Atelier kit: living looks, layouts and motion the AI composes from'));
  } else {
    if (tplId) contains.push(tr('landing.promptHasTemplate', 'your starting template'));
    if (selected.length) {
      contains.push(selected.length === 1
        ? tr('landing.promptHasPack', 'one capability pack with its usage doc')
        : `${selected.length} ${tr('landing.promptHasPacks', 'capability packs with their usage docs')}`);
    }
    contains.push(tr('landing.promptHasPitfalls', 'this node’s libraries and the pitfalls already written down'));
  }

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

        <div class="ld-gen-track" role="radiogroup" aria-label=${tr('landing.trackTitle', 'How should it be built?')}>
          <label class=${`ld-gen-trackcard ${track === 'classic' ? 'is-on' : ''}`}>
            <input type="radio" name="ld-gen-track" checked=${track === 'classic'} onChange=${() => setTrack('classic')} />
            <span class="ld-gen-trackname">${tr('landing.trackClassic', 'Classic')}</span>
            <span class="ld-gen-trackdesc">${tr('landing.trackClassicDesc', 'The proven way: templates, capability packs, the familiar clean style.')}</span>
          </label>
          <label class=${`ld-gen-trackcard ${track === 'atelier' ? 'is-on' : ''}`}>
            <input type="radio" name="ld-gen-track" checked=${track === 'atelier'} onChange=${() => setTrack('atelier')} />
            <span class="ld-gen-trackname">${tr('landing.trackAtelier', 'Atelier')}</span>
            <span class="ld-gen-tracknew">${tr('landing.trackNew', 'new')}</span>
            <span class="ld-gen-trackdesc">${tr('landing.trackAtelierDesc', 'The new track: living looks (newspaper, gallery, neon console…), layouts your AI can rearrange later without republishing, motion built in.')}</span>
          </label>
        </div>

        <textarea class="ld-gen-idea" rows="3" value=${idea} onInput=${(e) => setIdea(e.target.value)}
          placeholder=${tr('landing.genIdeaPh', 'Describe what the app should do…')}></textarea>

        ${track === 'classic' && templates.length ? html`
          <label class="ld-gen-label" for="ld-gen-tpl">${tr('landing.startTemplate', 'Start from a template')} <span class="ld-gen-opt">${tr('landing.genOptional', '(optional)')}</span></label>
          <select id="ld-gen-tpl" class="input-field ld-gen-select" onChange=${onPickTemplate} value=${tplId}>
            <option value="">${tr('landing.fromScratch', '(none, build from scratch)')}</option>
            ${templates.map(t => html`<option value=${t.id} key=${t.id}>${t.kind === 'use-case' ? '★ ' : ''}${t.title}</option>`)}
          </select>` : ''}

        ${track === 'classic' && packs.length ? html`
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

/* The build invitation, folded shut.
   Evidence over theory: an open generator on the front page produced two throwaway chat apps
   and nothing else, while the wall underneath is what actually reads as a living place. So the
   whole builder — the three steps and the prompt with its templates — sits behind one line, and
   the page leads with what people made.

   The line invites the click and stops short of the old "no account needed to start", which was
   false: anonymous access is off, so an app only reaches the server behind a login. Designing is
   still free — /v1/prompts/build-app, /v1/app-templates and /v1/library-packs all answer
   anonymously — and that is the distinction the subline has to carry. */
export function BuildInvite() {
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
