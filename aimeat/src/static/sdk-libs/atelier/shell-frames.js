/**
 * @file atelier/shell-frames.js
 * @description THE TWO FRAMES `app({ frame })` NAMES beyond the page it always had and the
 *   side-navigation frame (`nav: 'side'`). A frame decides once how the page behaves at every
 *   width, so an app writes no media query for it.
 *
 *     stage     ONE WORKING SURFACE IS THE PAGE: a map, a drawing, an editor, a simulation, a 3D
 *               view. The surface fills everything under the bar and never scrolls; the app's
 *               controls stand in one panel that floats at the top right of a wide window and is
 *               a sheet at the bottom edge of a phone, above the platform's own strip. One press
 *               on the panel's head folds it away and brings it back. The Design Book's record of
 *               parts made by hand shows this frame built again in app after app, because the
 *               default frame is a bar over a scrolling column.
 *     reading   A COLUMN KEPT TO A READING MEASURE. The default frame lets its main column take
 *               the window, which is right for cards and tables and wrong for running text: on a
 *               wide screen a line ran to several hundred characters. This frame is the
 *               stylesheet alone (frames.css): every direct child of the main region is held to
 *               the measure and centred.
 *
 *   Nothing changes for an app that names no frame, and the side-navigation frame keeps its own
 *   capped column: with `nav: 'side'` the frame option is not read.
 * @parts stage surface · panel · handle · title · body
 * @tokens stage --ak-stage-panel-width · --ak-stage-sheet-height
 * @fork stage Copy .ak-stage* out of frames.css and build the surface and the panel yourself; you give up the one panel that is a float on a wide window and a sheet on a phone.
 * @use stage layout
 * @structure FRAMES · frameOf(name) · stageFrame(main, controls)
 * @usage
 *   const a = AIMEAT.atelier.app({ title: 'Terrain', frame: 'stage', controls: { title: 'Layers' } });
 *   a.main.appendChild(mapCanvas);        // the surface
 *   a.controls.appendChild(layerList);    // the panel: a float when wide, a sheet on a phone
 * @version-history
 *   v0.73.0 — 2026-11-27 — Initial (wish-atelier-contextual-templates-pyynt-lohko-ask).
 */
import { el, uid } from './dom.js';
import { t, i18n } from './i18n.js';

/** The frames this module adds. */
export const FRAMES = ['stage', 'reading'];

/**
 * The frame an app named, when it is one of these; null for none, for the default ('pages') and,
 * with a word in the console, for a name this kit does not have.
 * @param {unknown} name @returns {'stage'|'reading'|null}
 */
export function frameOf(name) {
  if (name == null || name === '' || name === 'pages') return null;
  if (name === 'stage' || name === 'reading') return name;
  console.warn('aimeat-atelier: unknown frame "' + name + '" — app() has: ' + FRAMES.join(', '));
  return null;
}

/**
 * Build the stage inside the app's main region: the surface, and the controls panel when the app
 * asks for one.
 * @param {HTMLElement} main
 * @param {boolean|{ title?: string, open?: boolean }|null|undefined} controls
 * @returns {{ surface: HTMLElement, body: HTMLElement|null, setOpen: (on: boolean) => void,
 *   setTitle: (text: string) => void, destroy: () => void }}
 */
export function stageFrame(main, controls) {
  const surface = el('div', { class: 'ak-stage__surface', 'data-ak-part': 'surface' });
  main.appendChild(surface);
  if (!controls) {
    return { surface: surface, body: null, setOpen: function () {}, setTitle: function () {}, destroy: function () {} };
  }
  const wish = typeof controls === 'object' ? controls : {};
  let given = wish.title || '';
  const bodyId = uid('ak-stage');
  const title = el('span', { class: 'ak-stage__title', 'data-ak-part': 'title' }, given || t('menu'));
  const handle = el('button', {
    type: 'button', class: 'ak-stage__handle', 'data-ak-part': 'handle', 'data-ak-noguard': true,
    'aria-expanded': 'true', 'aria-controls': bodyId,
  }, [el('span', { class: 'ak-stage__grip', 'aria-hidden': 'true' }), title]);
  const body = el('div', { class: 'ak-stage__body', id: bodyId, 'data-ak-part': 'body' });
  const panel = el('aside', { class: 'ak-stage__panel', 'data-ak-part': 'panel', 'data-ak-open': 'true' }, [handle, body]);
  main.appendChild(panel);

  /** @param {boolean} on */
  function setOpen(on) {
    panel.setAttribute('data-ak-open', on ? 'true' : 'false');
    handle.setAttribute('aria-expanded', on ? 'true' : 'false');
  }
  handle.addEventListener('click', function () { setOpen(panel.getAttribute('data-ak-open') !== 'true'); });
  if (wish.open === false) setOpen(false);
  const stopLang = i18n.onChange(function () { if (!given) title.textContent = t('menu'); });

  return {
    surface: surface,
    body: body,
    setOpen: setOpen,
    setTitle: function (text) { given = String(text || ''); title.textContent = given || t('menu'); },
    destroy: function () { if (typeof stopLang === 'function') stopLang(); },
  };
}
