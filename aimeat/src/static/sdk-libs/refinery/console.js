/**
 * @file refinery/console.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description AIMEAT.refinery.console(): the workbench console of a mail refinery, built only from
 *   the atelier kit's parts (aimeat-atelier.js on the page). The batch figure with its button, the
 *   message it is on with the steps passed, the tallies per queue, and the batch's rows as they land.
 *   Before any batch runs on the page, the list shows the newest rows.
 *
 *   The words are the kit's dictionary under `refinery.*` keys, in English, Finnish and Spanish;
 *   an app overrides any of them with AIMEAT.atelier.i18n.use().
 * @structure refineryConsole(api, spec)
 * @version-history
 *   v1.0.0 - 2026-09-29 - Initial (wish aimeat-refinery).
 */

const WORDS = {
  en: {
    'refinery.run': 'Process the next batch', 'refinery.idle': 'Ready to process', 'refinery.processing': 'Processing',
    'refinery.batch': 'In this batch', 'refinery.empty': 'No messages in this batch yet.',
    'refinery.done': 'Batch done', 'refinery.processedN': '{n} messages processed', 'refinery.none': 'No new messages were found.',
    'refinery.failed': 'The batch stopped',
    'refinery.step.read': 'reading', 'refinery.step.classify': 'classifying', 'refinery.step.attach': 'reading attachments',
    'refinery.step.extract': 'extracting fields', 'refinery.step.save': 'saving',
    'refinery.q.selkea': 'Clear', 'refinery.q.epaselva': 'Unclear', 'refinery.q.kelvoton': 'Unusable', 'refinery.q.ohitettu': 'Skipped',
    'refinery.q.hyvaksytty': 'Approved', 'refinery.q.lahetetty': 'Sent', 'refinery.q.hylatty': 'Rejected',
  },
  fi: {
    'refinery.run': 'Käsittele seuraava erä', 'refinery.idle': 'Valmis käsittelemään', 'refinery.processing': 'Käsitellään',
    'refinery.batch': 'Tässä erässä', 'refinery.empty': 'Tässä erässä ei ole vielä viestejä.',
    'refinery.done': 'Erä valmis', 'refinery.processedN': '{n} viestiä käsitelty', 'refinery.none': 'Uusia viestejä ei löytynyt.',
    'refinery.failed': 'Erä pysähtyi',
    'refinery.step.read': 'luetaan', 'refinery.step.classify': 'luokitellaan', 'refinery.step.attach': 'luetaan liitteitä',
    'refinery.step.extract': 'poimitaan tietoja', 'refinery.step.save': 'tallennetaan',
    'refinery.q.selkea': 'Selkeät', 'refinery.q.epaselva': 'Epäselvät', 'refinery.q.kelvoton': 'Kelvottomat', 'refinery.q.ohitettu': 'Ohitetut',
    'refinery.q.hyvaksytty': 'Hyväksytyt', 'refinery.q.lahetetty': 'Lähetetyt', 'refinery.q.hylatty': 'Hylätyt',
  },
  es: {
    'refinery.run': 'Procesar el siguiente lote', 'refinery.idle': 'Listo para procesar', 'refinery.processing': 'Procesando',
    'refinery.batch': 'En este lote', 'refinery.empty': 'Todavía no hay mensajes en este lote.',
    'refinery.done': 'Lote terminado', 'refinery.processedN': '{n} mensajes procesados', 'refinery.none': 'No se encontraron mensajes nuevos.',
    'refinery.failed': 'El lote se detuvo',
    'refinery.step.read': 'leyendo', 'refinery.step.classify': 'clasificando', 'refinery.step.attach': 'leyendo adjuntos',
    'refinery.step.extract': 'extrayendo datos', 'refinery.step.save': 'guardando',
    'refinery.q.selkea': 'Claros', 'refinery.q.epaselva': 'Dudosos', 'refinery.q.kelvoton': 'Inservibles', 'refinery.q.ohitettu': 'Omitidos',
    'refinery.q.hyvaksytty': 'Aprobados', 'refinery.q.lahetetty': 'Enviados', 'refinery.q.hylatty': 'Rechazados',
  },
};

/**
 * Give the kit the console's words ONCE. The kit tells the page when words arrive, and a page that
 * rebuilds itself on that (Postinjalostamo does, to change language) would call console() again,
 * which added the words again: a loop that froze the tab. So the words go in when this library
 * loads, before the page listens, and at most once more if the kit arrived later.
 */
let wordsAdded = false;
export function addConsoleWords() {
  const ak = /** @type {any} */ (window).AIMEAT && /** @type {any} */ (window).AIMEAT.atelier;
  if (wordsAdded || !ak || !ak.i18n) return;
  wordsAdded = true;
  ak.i18n.use(WORDS);
}

const STEPS = ['read', 'classify', 'attach', 'extract', 'save'];
const TALLIES = [['clear', 'selkea', 'ok'], ['unclear', 'epaselva', 'warn'], ['bad', 'kelvoton', 'err'], ['skip', 'ohitettu', 'quiet']];
const BADGE_TONE = /** @type {Record<string, string>} */ ({ selkea: 'ok', epaselva: 'warn', kelvoton: 'err' });

/**
 * @param {any} api  AIMEAT.refinery
 * @param {{ target: string|Element, listTarget?: string|Element, prefix: string, total?: number, classLabel?: (klass: string) => string,
 *   onRow?: (row: any) => void, onDone?: (run: any) => void, onError?: (err: Error) => void }} spec
 * @returns {{ el: Element, run: () => Promise<any>, refresh: () => Promise<void>, busy: () => boolean, destroy: () => void }}
 */
export function refineryConsole(api, spec) {
  const ak = /** @type {any} */ (window).AIMEAT && /** @type {any} */ (window).AIMEAT.atelier;
  if (!ak || !ak.progressFigure) throw new Error('AIMEAT.refinery.console() draws with the atelier kit: load /v1/libs/aimeat-atelier.js before aimeat-refinery.js.');
  addConsoleWords();
  /** @param {string} k @param {Record<string, any>} [v] */
  const t = function (k, v) { return ak.i18n.t(k, v); };
  const classLabel = spec.classLabel || function (/** @type {string} */ k) { return k; };
  /** @param {string|Element|undefined} x @returns {Element|null} */
  const place = function (x) { return !x ? null : typeof x === 'string' ? document.querySelector(x) : x; };
  const root = place(spec.target);
  if (!root) throw new Error('AIMEAT.refinery.console(): target names no element on the page.');
  const listHost = place(spec.listTarget) || root;

  let busy = false;
  let total = spec.total || 10;
  /** @type {Record<string, number>} */
  let tally = { clear: 0, unclear: 0, bad: 0, skip: 0 };
  const counts = function () {
    return TALLIES.map(function (x) { return { id: x[0], label: t('refinery.q.' + x[1]), value: tally[x[0]] || 0, tone: x[2] }; });
  };
  const figure = ak.progressFigure({ target: root, label: t('refinery.idle'), value: 0, total: total, counts: counts(),
    action: { label: t('refinery.run'), onClick: function () { return run(); } } });
  const section = ak.section({ target: listHost, title: t('refinery.batch') });
  // One list divided by hairlines, as the approved batch list is drawn: the kit's `plain` variant.
  const list = ak.list({ target: section.body, variant: 'plain', items: [], empty: { title: t('refinery.empty') } });

  /** @param {Array<{ rowId: string, subject: string, klass: string, queue: string }>} rows */
  function paintRows(rows) {
    list.set({ items: rows.map(function (r) {
      return { id: r.rowId, title: r.subject || '—', sub: r.klass && r.klass !== 'NONE' && r.klass !== 'ERROR' ? classLabel(r.klass) : '',
        badge: t('refinery.q.' + r.queue), badgeTone: BADGE_TONE[r.queue] || 'quiet' };
    }) });
  }

  /** @param {any} r */
  function paint(r) {
    const at = STEPS.indexOf(r.step);
    const working = r.status === 'running' && r.n > 0;
    tally = r.counts || tally;
    figure.set({
      label: r.status === 'running' ? t('refinery.processing') : t('refinery.idle'),
      value: working ? Math.max(0, r.i - (r.step === 'save' ? 0 : 1)) : (r.n || 0),
      total: r.n || total,
      now: working && r.subject ? r.subject : '',
      steps: working ? STEPS.map(function (s, i) { return { label: t('refinery.step.' + s), state: i < at ? 'done' : i === at ? 'now' : 'todo' }; }) : [],
      counts: counts(),
    });
    paintRows(r.rows || []);
  }

  async function refresh() {
    if (busy) return;
    const def = await api.definition(spec.prefix);
    if (!def || !def.organismId) return;
    total = spec.total || def.batchSize || total;
    const got = await api.rows(def, { limit: total });
    paintRows(got.rows.map(function (/** @type {any} */ b) { return { rowId: api.rowIdOf(def, b.messageId), subject: b.subject, klass: b.klass, queue: b.queue }; }));
    figure.set({ total: total });
  }

  async function run() {
    if (busy) return null;
    busy = true;
    let lastLen = 0;
    try {
      const done = await api.run(spec.prefix, { onProgress: function (/** @type {any} */ r) {
        paint(r);
        if (spec.onRow && r.rows && r.rows.length > lastLen) { for (let k = r.rows.length - lastLen - 1; k >= 0; k--) spec.onRow(r.rows[k]); lastLen = r.rows.length; }
      } });
      busy = false;
      paint(done);
      if (done.status === 'failed') {
        const err = new Error(done.error || t('refinery.failed'));
        if (spec.onError) spec.onError(err); else ak.toast({ title: t('refinery.failed'), sub: err.message, tone: 'err' });
      } else {
        const n = (done.counts && done.counts.seen) || 0;
        ak.toast({ title: t('refinery.done'), sub: n ? t('refinery.processedN', { n: n }) : t('refinery.none'), tone: 'ok' });
      }
      if (spec.onDone) spec.onDone(done);
      return done;
    } catch (e) {
      busy = false;
      const err = /** @type {Error} */ (e);
      if (spec.onError) spec.onError(err); else ak.toast({ title: t('refinery.failed'), sub: err.message, tone: 'err' });
      return null;
    }
  }

  refresh().catch(function (e) { console.warn('[aimeat-refinery] the console could not read the newest rows:', e); });
  return {
    el: root,
    run: run,
    refresh: refresh,
    busy: function () { return busy; },
    destroy: function () { figure.destroy(); section.el.remove(); },
  };
}
