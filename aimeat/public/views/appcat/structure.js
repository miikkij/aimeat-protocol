/**
 * @file public/views/appcat/structure.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The app structure page at /v1/appcat/structure?app=<owner>/<filename>: what one app
 *   consists of and where it stands, from the first moment of building, before any code or publish.
 *   Eight steps (purpose, data, layout, look, build, builders, visibility, requirements), each with
 *   its state, one line on what it means and one line on where it is now, the next step, and the
 *   layout and look pickers (?step=layout, ?step=look, views/appcat/structure-pick.js).
 *
 *   WHY (Jouni, 2026-10-29): a person who starts an app sees what they get and how the app is put
 *   together, can follow it at a glance, and picks a layout or a look by seeing them; the choice goes
 *   back to the AI that builds. It is help and never a gate: "tätä ei ole pakko käyttää".
 *
 *   THE CANVAS IS THE SPEC: the design accepted on 2026-10-29 (claude.ai artifact "Sovelluksesi
 *   rakenne", board 2). The status comes from the node (services/app-structure.ts), which the AI reads
 *   through aimeat_app_manage too, so the page and the AI see one answer. The page re-reads on the
 *   `app-plans` and `apps` live events, never on a timer.
 *
 *   Writes no class; the parts are components.
 * @structure AppStructure (default) · StepsSection · SidePanel
 * @usage routed at /v1/appcat/structure by spa.html (and portal.ts spaRoutes).
 * @version-history
 *   v1.0.0 — 2026-10-29 — Initial (wish-sovelluksen-rakenne-ja-tila-sivu-luonnoksesta-asti-josta-voi).
 */
import { h } from 'preact';
import { useCallback, useEffect, useState } from 'preact/hooks';
import htm from 'htm';
import { PageFrame } from '/components/PageFrame.js';
import { Band } from '/components/Band.js';
import { BackLink } from '/components/BackLink.js';
import { Note } from '/components/Note.js';
import { Box } from '/components/Box.js';
import { Mark } from '/components/Mark.js';
import { Section } from '/components/Section.js';
import { Meter, Figure } from '/components/Figure.js';
import { List, Row, Name, Cell, Doors } from '/components/List.js';
import { Action, Loud } from '/components/Action.js';
import { Choice } from '/components/Choice.js';
import { Row as Line, Stack, Beside } from '/components/Layout.js';
import { onAuthChange, hasSession, showLoginModal } from '/js/services/auth.js';
import { onLocaleChange } from '/js/i18n.js';
import { swallowed } from '/js/swallowed.js';
import { time } from '/js/format.js';
import { x } from '/views/appcat/i18n.js';
import { appRefFromAddress, readStructure, writePlan, stepLine, choiceName } from '/views/appcat/structure-data.js';
import { StructurePick } from '/views/appcat/structure-pick.js';

const html = htm.bind(h);

/** The status mark of a step: the poster.css status tone its state reads as. */
const STATE_TONE = { fine: 'fine', progress: 'attention', optional: 'off', not_needed: 'off', missing: 'danger', later: 'off' };

/** Said on the window when this page moves between its overview and a picker. */
const STEP_EVENT = 'aimeat-structure-step';

/** The step the address opens (?step=layout | look), or the overview. */
const readStep = () => {
  const s = new URLSearchParams(location.search).get('step');
  return s === 'layout' || s === 'look' ? s : '';
};

function go(navigate, ref, step) {
  const q = new URLSearchParams({ app: `${ref.owner}/${ref.filename}` });
  if (step) q.set('step', step);
  const to = `/v1/appcat/structure?${q.toString()}`;
  if (typeof navigate !== 'function') { location.assign(to); return; }
  navigate(to);
  // The router keeps this view mounted for the same path, so the view is told the step changed.
  window.dispatchEvent(new CustomEvent(STEP_EVENT));
}

/** The app's own page in the catalogue, once it is published. */
const detailHref = (ref) => `/v1/appcat?app=${encodeURIComponent(`${ref.owner}/${ref.filename}`)}`;


/** What each step's door does: open a picker, the app's page, or nothing yet. */
function doorOf(step, s, ref, navigate) {
  switch (step.id) {
    case 'layout': return { label: x('structure.door.layout'), onClick: () => go(navigate, ref, 'layout') };
    case 'look': return { label: x('structure.door.look'), onClick: () => go(navigate, ref, 'look') };
    case 'build': return s.published ? { label: x('structure.door.open'), href: detailHref(ref) } : null;
    case 'purpose': case 'data': case 'builders': case 'requirements':
      return s.published ? { label: x('structure.door.detail'), href: detailHref(ref) } : null;
    case 'visibility': return s.published ? { label: x('structure.door.detail'), href: detailHref(ref) } : null;
    default: return null;
  }
}

/** The person says who may see the app before it is published: one of the three listings. */
function VisibilityPick({ s, appRef: ref, onSaved }) {
  const [busy, setBusy] = useState(false);
  const current = s.plan?.choices?.visibility?.value || '';
  const pick = async (v) => {
    setBusy(true);
    try { onSaved(await writePlan(ref.owner, ref.filename, { choices: { visibility: v ? { value: v } : null } })); } catch (err) { swallowed('structure: visibility', err); }
    setBusy(false);
  };
  return html`<${Choice} tone="tile" clearable value=${current} disabled=${busy} ariaLabel=${x('structure.step.visibility.name')} onChange=${pick}
    options=${['listed', 'community', 'unlisted'].map((v) => ({ value: v, label: choiceName('visibility', v), title: x(`structure.visibility.${v}.line`) }))} />`;
}

function StepsSection({ s, appRef: ref, navigate, onSaved }) {
  const pct = s.total ? Math.round((s.fine / s.total) * 100) : 0;
  return html`<${Section} id="structure-steps" title=${x('structure.steps')} first
    doors=${html`<${Mark} kind="word" tone="ink">${x('structure.stepsCount', { fine: s.fine, total: s.total })}<//>`}>
    <${Meter} pct=${pct} thin />
    <${List} cols="n-name-doors" keepCols>
      ${s.steps.map((step, i) => {
        const door = doorOf(step, s, ref, navigate);
        const pick = step.id === 'visibility' && !s.published ? html`<${VisibilityPick} s=${s} appRef=${ref} onSaved=${onSaved} />` : null;
        return html`<${Row} key=${step.id} id=${`structure-${step.id}`} below=${pick}>
          <${Cell}><${Figure} n=${String(i + 1)} step /><//>
          <${Name} tag=${html`<${Mark} kind="status" tone=${STATE_TONE[step.state] || 'off'}>${x(`structure.state.${step.state}`)}<//>`}
            desc=${[x(`structure.step.${step.id}.what`), stepLine(step)]}>${x(`structure.step.${step.id}.name`)}<//>
          <${Doors}>${door ? (door.href
            ? html`<${Action} small href=${door.href}>${door.label}<//>`
            : html`<${Action} small onClick=${door.onClick}>${door.label}<//>`) : null}<//>
        <//>`;
      })}
    <//>
  <//>`;
}

/** The side column: the next step, the reminder that the page is optional, the parts, where it is. */
function SidePanel({ s, appRef: ref, navigate }) {
  const next = s.next;
  const nextDoor = next === 'layout' || next === 'look' ? () => go(navigate, ref, next) : null;
  return html`<${Stack} gap="section">
    ${next ? html`<${Box} tone="raised" name=${x('structure.next')}>
      <${Note} kind="lead">${x(`structure.next.${next}`)}<//>
      ${nextDoor ? html`<${Loud} onClick=${nextDoor}>${x(`structure.door.${next}`)}<//>` : null}
    <//>` : html`<${Box} tone="raised" name=${x('structure.next')}><${Note} kind="lead">${x('structure.next.none')}<//><//>`}
    <${Note} kind="aside">${x('structure.optional')}<//>
    <${Box} name=${x('structure.parts')}>
      <${Stack} gap="medium">
        ${['view', 'datamap', 'spec', 'settings'].map((k) => html`<${Line} key=${k} align="baseline">
          <${Mark}>${x(`structure.part.${k}`)}<//><${Note} inline>${x(`structure.part.${k}.line`)}<//>
        <//>`)}
      <//>
    <//>
    <${Box} name=${x('structure.where')}>
      <${Note} inline>${s.published ? x('structure.where.live') : x('structure.where.draft')}<//>
    <//>
  <//>`;
}

/** What the AI is doing now, said live, or that the page keeps itself up to date. */
function LiveLine({ s }) {
  const now = s.plan?.now;
  const who = now?.by && now.by.includes('#') ? now.by.slice(0, now.by.indexOf('#')) : x('structure.ai');
  return html`<${Box}>
    <${Line} wrap align="center">
      ${now ? html`<${Mark} live>${x('structure.live.working', { who })}<//>
        <${Note} inline>${now.text}<//><${Mark} kind="time">${time(now.at, { hour: '2-digit', minute: '2-digit' })}<//>`
        : html`<${Note} inline>${x('structure.live.idle')}<//>`}
    <//>
  <//>`;
}

export default function AppStructure({ navigate }) {
  const ref = appRefFromAddress();
  const [state, setState] = useState({ loading: true, s: null, error: null });
  const [step, setStep] = useState(readStep());
  const [, setTick] = useState(0);

  // The app is read from the address each time, so a step change in place reads the right one.
  const load = useCallback(async () => {
    const at = appRefFromAddress();
    if (!at) { setState({ loading: false, s: null, error: 'noApp' }); return; }
    if (!hasSession()) { setState({ loading: false, s: null, error: 'signIn' }); return; }
    try {
      setState({ loading: false, s: await readStructure(at.owner, at.filename), error: null });
    } catch (err) {
      swallowed('structure: read', err);
      setState({ loading: false, s: null, error: err?.status === 404 ? 'notFound' : 'failed' });
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  // The node says when the plan or the app changed; the page reads again then, and never on a timer.
  useEffect(() => {
    const onLive = (e) => { const d = e.detail?.domains; if (d && !d.has('app-plans') && !d.has('apps')) return; load(); };
    window.addEventListener('aimeat-live-update', onLive);
    const offAuth = onAuthChange(() => load());
    const offLocale = onLocaleChange(() => setTick((n) => n + 1));
    const onPop = () => setStep(readStep());
    window.addEventListener('popstate', onPop);
    window.addEventListener(STEP_EVENT, onPop);
    return () => {
      window.removeEventListener('aimeat-live-update', onLive);
      if (typeof offAuth === 'function') offAuth();
      if (typeof offLocale === 'function') offLocale();
      window.removeEventListener('popstate', onPop);
      window.removeEventListener(STEP_EVENT, onPop);
    };
  }, [load]);

  const toCatalogue = (e) => {
    e.preventDefault();
    if (typeof navigate === 'function') navigate('/v1/appcat'); else location.assign('/v1/appcat');
  };
  const back = html`<${BackLink} href="/v1/appcat" onClick=${toCatalogue}>↩ ${x('structure.backToCatalogue')}<//>`;

  if (state.loading) return html`<${PageFrame} loading />`;
  if (state.error) {
    return html`<${PageFrame}>${back}<${Band} title=${x('structure.title')}>
      <${Note} kind="lead">${x(`structure.error.${state.error}`)}<//>
      ${state.error === 'signIn' ? html`<${Loud} onClick=${() => showLoginModal()}>${x('structure.signIn')}<//>` : null}
    <//><//>`;
  }
  const s = state.s;
  const saved = (next) => { if (next) setState({ loading: false, s: next, error: null }); };

  if (step) {
    return html`<${PageFrame}>
      <${StructurePick} kind=${step} s=${s} appRef=${ref} onSaved=${saved} onBack=${() => go(navigate, ref, '')} />
    <//>`;
  }
  return html`<${PageFrame}>
    ${back}
    <${Band} title=${x('structure.title')}>
      <${Note} kind="lead">${s.plan?.purpose ? x('structure.leadWithPurpose', { name: s.name, purpose: s.plan.purpose }) : x('structure.lead', { name: s.name })}<//>
      <${Line} wrap><${Mark} tone=${s.published ? 'fine' : 'sun'}>${s.published ? x('structure.published') : x('structure.draft')}<//><//>
      <${LiveLine} s=${s} />
      <${Beside} narrow side=${html`<${SidePanel} s=${s} appRef=${ref} navigate=${navigate} />`} above="section">
        <${StepsSection} s=${s} appRef=${ref} navigate=${navigate} onSaved=${saved} />
      <//>
    <//>
  <//>`;
}
