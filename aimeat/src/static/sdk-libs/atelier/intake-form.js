/**
 * @file atelier/intake-form.js
 * @description The public form, as kit components (iam-members-and-library-blocks plan, Phase D
 *   block 4). feedbackForm (commercial.js) draws one fixed three-field form; these draw ANY form
 *   from its stored definition, and give the owner the list of their forms.
 *
 *   Two members:
 *     intakeForm   a visitor fills in a public form, signed in or not: the fields come from the
 *                  stored definition (AIMEAT.intake.getForm, then fields()), a hidden honeypot
 *                  input catches a bot, a refusal lands on the field the node names or at the top,
 *                  and a sent form says thank you and empties itself
 *     intakeAdmin  the owner's forms in one workspace: each with Copy link and Delete (asked
 *                  first), and a small Create form that calls defineForm
 *
 *   WHY intakeForm DRAWS ITS OWN FIELDS. The kit's form() has no radio group, and it puts a refusal
 *   that names no field on the first field. A public form needs both: a radio is one of the ten
 *   types fields() answers, and a rate limit or a closed form is not about any one field. So this
 *   draws with form()'s classes and the same wiring (a real label for every control, the error
 *   bound with aria-describedby and announced, required both stated and marked, the send button
 *   held busy until the answer comes), and it puts a field-less refusal above the form.
 *
 *   WHAT FETCHES AND WHY. Nothing here fetches. Every read and write goes through AIMEAT.intake,
 *   which the page loads (aimeat-intake.js, plus aimeat-auth.js for the owner's side). Without it
 *   the component says what is missing.
 *
 *   THE LINK. The node answers a form's API address (submit_url), not a page a person opens. Copy
 *   link therefore copies the app's own page with `?form=<form id>`, and intakeForm without a
 *   `formId` reads the same parameter, so one page with both components works end to end. An app
 *   that draws its forms somewhere else passes `link(form)`.
 *
 *   THE SAMPLE STATE. `sample: true`, or an org, ws or form id that is missing or still a fill's
 *   <placeholder>, draws built-in sample content marked as such, and sends and changes nothing.
 * @parts intakeForm root · title · hint · failure · form · field · label · req · input · choice · error · honeypot · bar · send · sent
 * @tokens intakeForm --ak-intake-width
 * @fork intakeForm Copying it out means calling AIMEAT.intake.getForm(), fields() and submit() yourself, drawing a hidden input named form.honeypot_field and sending its value, and putting err.field on its field.
 * @parts intakeAdmin root · title · intro · failure · notice · forms · row · meta · acts · copy · delete · create · fieldRows · addField · removeField · save
 * @slots intakeAdmin link(form)
 * @tokens intakeAdmin --ak-intake-width
 * @fork intakeAdmin Copying it out means calling AIMEAT.intake.listForms(), deleteForm() and defineForm() yourself, and building each form's link, its allowed and required fields and its honeypot.
 * @structure intakeForm(spec) · intakeAdmin(spec) (helpers: intakeOf · signedOut · linkedFormId · sampleForm · slug)
 * @usage
 *   AIMEAT.atelier.intakeForm({ target: '#contact', org, ws, formId: 'contact-us' });
 *   AIMEAT.atelier.intakeAdmin({ target: '#forms', org, ws, namespace: 'leads' });
 * @version-history
 *   v0.61.0 — 2026-10-01 — Initial (iam-members-and-library-blocks plan, Phase D block 4).
 */
import { el, clear, resolve, uid, enter, whileBusy, attention } from './dom.js';
import { t } from './i18n.js';
import { ti } from './intake-connect-i18n.js';
import { isPlaceholder, sampleBadge, watch, ask, refusal } from './members-shared.js';

/** The ten types fields() answers, in the order the Create form offers them. */
const TYPES = ['text', 'textarea', 'email', 'tel', 'url', 'number', 'date', 'select', 'radio', 'checkbox'];

/** The honeypot every form made here carries: a name a crawler fills and a person never sees. */
const HONEYPOT = 'company_url';

/** The node's form id rule (routes/organisms/intake.ts FORM_ID_RE). */
const FORM_ID_RE = /^[a-z0-9][a-z0-9-]{1,63}$/;

/** The page's AIMEAT.intake, or null. */
function intakeOf() {
  const ns = /** @type {any} */ (window).AIMEAT;
  return ns && ns.intake ? ns.intake : null;
}

/** True when the page knows for certain that nobody is signed in. */
function signedOut() {
  const ns = /** @type {any} */ (window).AIMEAT;
  const auth = ns && ns.auth;
  return !!(auth && typeof auth.getSession === 'function' && !auth.getSession());
}

/** The form id a copied link carries (`?form=`), or ''. */
function linkedFormId() {
  try {
    return new URLSearchParams(window.location.search || '').get('form') || '';
  } catch {
    return '';
  }
}

/** Whether a prop is missing or still a fill's placeholder. */
function unset(v) {
  return !v || isPlaceholder(v);
}

/**
 * The sample form: every type once, in the shape fields() answers. Built at draw time so the
 * labels follow the language.
 * @returns {{ title: string, honeypot_field: string, fields: any[] }}
 */
function sampleForm() {
  const opt = function (keys) { return keys.map(function (k) { return { value: k, label: ti('intake.sample.' + k) }; }); };
  return {
    title: '',
    honeypot_field: HONEYPOT,
    fields: [
      { name: 'name', label: ti('intake.sample.name'), type: 'text', required: true, maxLength: 200 },
      { name: 'email', label: ti('intake.sample.email'), type: 'email', required: true, maxLength: 320 },
      { name: 'phone', label: ti('intake.sample.phone'), type: 'tel', required: false, maxLength: 40 },
      { name: 'site', label: ti('intake.sample.site'), type: 'url', required: false, maxLength: 400 },
      { name: 'people', label: ti('intake.sample.people'), type: 'number', required: false },
      { name: 'day', label: ti('intake.sample.day'), type: 'date', required: false },
      { name: 'topic', label: ti('intake.sample.topic'), type: 'select', required: true, options: opt(['order', 'question', 'other']) },
      { name: 'found', label: ti('intake.sample.found'), type: 'radio', required: false, options: opt(['friend', 'search', 'social']) },
      { name: 'message', label: ti('intake.sample.message'), type: 'textarea', required: true, maxLength: 4000 },
      { name: 'consent', label: ti('intake.sample.consent'), type: 'checkbox', required: false },
    ],
  };
}

// ── intakeForm: the visitor's side ────────────────────────────────────────────────────────────

/**
 * One public form, drawn from its stored definition.
 * @param {{ target?: string|Element, org: string, ws: string, formId?: string, title?: string,
 *   hint?: string, sample?: boolean,
 *   onSent?: (values: Record<string, any>, answer: any) => void }} spec
 * @returns {{ el: HTMLElement, refresh: () => Promise<void>, destroy: () => void }}
 */
export function intakeForm(spec) {
  const formId = spec.formId || linkedFormId();
  const sample = spec.sample === true || unset(spec.org) || unset(spec.ws) || unset(formId);
  const root = el('section', { class: 'ak-root ak-intake', 'data-ak-part': 'root' });
  if (spec.target) resolve(spec.target).appendChild(root);
  let gen = 0;
  /**
   * What the person had typed when the form was last drawn, so a redraw keeps it.
   * @type {() => Record<string, any>}
   */
  let snapshot = function () { return {}; };

  function heading(def) {
    root.appendChild(el('h3', { class: 'ak-intake__title', 'data-ak-part': 'title' },
      [spec.title || (def && def.title) || ti('intake.title'), sample ? sampleBadge() : null].filter(Boolean)));
    if (spec.hint) root.appendChild(el('p', { class: 'ak-intake__intro', 'data-ak-part': 'hint' }, spec.hint));
    if (sample) root.appendChild(el('p', { class: 'ak-intake__intro' }, ti('intake.sampleNote')));
  }

  function stop(text) {
    root.appendChild(el('p', { class: 'ak-intake__failure', role: 'alert', 'data-ak-part': 'failure' }, text));
  }

  async function render() {
    const mine = ++gen;
    const kept = snapshot();
    let def;
    let list;
    if (sample) {
      def = sampleForm();
      list = def.fields;
    } else {
      const lib = intakeOf();
      if (!lib) { clear(root); heading(null); stop(ti('intake.noLib')); return; }
      try {
        def = await lib.getForm(spec.org, spec.ws, formId);
      } catch (e) {
        if (mine !== gen) return;
        clear(root);
        heading(null);
        stop(e && e.code === 'NOT_FOUND' ? ti('intake.notFound') : ti('intake.failed', { why: refusal(e) || String(e) }));
        return;
      }
      if (mine !== gen) return;
      list = typeof lib.fields === 'function' ? lib.fields(def) : [];
    }
    clear(root);
    heading(def);
    draw(def, list, kept);
  }

  /**
   * @param {any} def   the descriptor (or the sample)
   * @param {any[]} list fields() of it
   * @param {Record<string, any>} kept values to put back after a redraw
   */
  function draw(def, list, kept) {
    /** @type {Map<string, { field: any, wrap: HTMLElement, error: HTMLElement, inputs: HTMLInputElement[] }>} */
    const controls = new Map();
    const failure = el('p', { class: 'ak-intake__failure', role: 'alert', 'data-ak-part': 'failure', hidden: true });
    const sent = el('p', { class: 'ak-intake__sent', role: 'status', 'data-ak-part': 'sent', hidden: true });
    const form = el('form', { class: 'ak-form ak-intake__form', 'data-ak-part': 'form', novalidate: true });
    root.appendChild(failure);
    if (!list.length) root.appendChild(el('p', { class: 'ak-intake__intro' }, ti('intake.noFields')));
    for (const f of list) form.appendChild(fieldNode(f, controls));

    // The honeypot: an input a person never sees or reaches; a crawler that fills every input does.
    // The node answers a filled one with a success and writes nothing.
    const hpName = (def && def.honeypot_field) || HONEYPOT;
    const hp = /** @type {HTMLInputElement} */ (el('input', {
      type: 'text', name: hpName, tabindex: '-1', autocomplete: 'off', 'aria-label': ti('intake.honeypot'),
    }));
    form.appendChild(el('div', { class: 'ak-intake__hp', 'aria-hidden': 'true', 'data-ak-part': 'honeypot' }, [hp]));

    const send = el('button', { type: 'submit', class: 'ak-btn ak-btn--primary', 'data-ak-part': 'send', 'data-ak-noguard': true }, ti('intake.send'));
    form.appendChild(el('div', { class: 'ak-form__bar', 'data-ak-part': 'bar' }, [send]));
    root.appendChild(form);
    root.appendChild(sent);

    function valueOf(c) {
      const type = c.field.type;
      if (type === 'checkbox') return !!c.inputs[0].checked;
      if (type === 'radio') {
        const on = c.inputs.filter(function (i) { return i.checked; })[0];
        return on ? on.value : '';
      }
      const v = c.inputs[0].value;
      if (type === 'number') return v === '' || v == null ? null : Number(v);
      return v == null ? '' : String(v);
    }

    function setValue(c, v) {
      const type = c.field.type;
      if (type === 'checkbox') c.inputs[0].checked = !!v;
      else if (type === 'radio') c.inputs.forEach(function (i) { i.checked = v != null && i.value === String(v); });
      else c.inputs[0].value = v == null ? '' : String(v);
    }

    function setError(name, message) {
      const c = controls.get(name);
      if (!c) return;
      c.error.textContent = message;
      c.error.hidden = false;
      c.wrap.classList.add('ak-form__field--invalid');
      c.inputs.forEach(function (i) { i.setAttribute('aria-invalid', 'true'); });
      attention(c.wrap, 'shake');
    }

    function clearErrors() {
      failure.hidden = true;
      failure.textContent = '';
      for (const [, c] of controls) {
        c.error.hidden = true;
        c.error.textContent = '';
        c.wrap.classList.remove('ak-form__field--invalid');
        c.inputs.forEach(function (i) { i.removeAttribute('aria-invalid'); });
      }
    }

    /** Required and number, in words next to the field. @returns {string|null} the first bad field */
    function validate() {
      let first = null;
      for (const [name, c] of controls) {
        const v = valueOf(c);
        let problem = '';
        const empty = v === '' || v == null || v === false || (typeof v === 'string' && !v.trim());
        if (c.field.required && empty) problem = ti('intake.required', { label: c.field.label });
        else if (c.field.type === 'number' && typeof v === 'number' && Number.isNaN(v)) problem = ti('intake.notNumber', { label: c.field.label });
        if (problem) { setError(name, problem); if (!first) first = name; }
      }
      return first;
    }

    function values() {
      /** @type {Record<string, any>} */
      const out = {};
      for (const [name, c] of controls) {
        const v = valueOf(c);
        // An empty optional answer is left out, so a locked schema that types the field is not
        // handed an empty string; a checkbox always answers.
        if (v === '' || v == null || (typeof v === 'string' && !v.trim())) continue;
        out[name] = v;
      }
      return out;
    }

    function reset() {
      for (const [, c] of controls) setValue(c, c.field.type === 'checkbox' ? false : '');
      hp.value = '';
    }

    for (const name in kept) { const c = controls.get(name); if (c) setValue(c, kept[name]); }
    snapshot = function () {
      /** @type {Record<string, any>} */
      const out = {};
      for (const [name, c] of controls) out[name] = valueOf(c);
      return out;
    };

    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      clearErrors();
      sent.hidden = true;
      const bad = validate();
      if (bad) { const c = controls.get(bad); if (c) c.inputs[0].focus(); return; }
      if (sample) { sent.textContent = ti('intake.sampleSent'); sent.hidden = false; return; }
      const lib = intakeOf();
      if (!lib) { failure.textContent = ti('intake.noLib'); failure.hidden = false; return; }
      const payload = values();
      // The honeypot goes out only under the name the form watches; a form without one ignores it.
      if (def && def.honeypot_field) payload[def.honeypot_field] = hp.value;
      whileBusy(send, lib.submit(spec.org, spec.ws, formId, payload)).then(function (answer) {
        reset();
        sent.textContent = (def && def.success_message) || ti('intake.sent');
        sent.hidden = false;
        if (typeof spec.onSent === 'function') spec.onSent(payload, answer);
      }, function (e) {
        const why = refusal(e) || String(e);
        const named = e && e.field && controls.has(e.field);
        if (named) {
          setError(e.field, why);
          const c = controls.get(e.field);
          if (c) c.inputs[0].focus();
        } else {
          failure.textContent = ti('intake.failed', { why: why });
          failure.hidden = false;
          attention(failure, 'shake');
        }
      });
    });
  }

  /**
   * One field: its label, its control (or a group of radios), the required mark and its error line.
   * @param {any} f  one entry of fields()
   * @param {Map<string, any>} controls
   */
  function fieldNode(f, controls) {
    const id = uid('ak-intake');
    const errId = id + '-err';
    const error = el('p', { class: 'ak-form__error', 'data-ak-part': 'error', id: errId, role: 'alert', hidden: true });
    const marks = f.required ? [
      el('span', { class: 'ak-form__req', 'data-ak-part': 'req', 'aria-hidden': 'true' }, '*'),
      el('span', { class: 'ak-sr-only' }, ' (' + t('required') + ')'),
    ] : [];
    const req = f.required ? 'true' : null;
    /** @type {HTMLInputElement[]} */
    let inputs;
    let wrap;
    if (f.type === 'radio') {
      const group = id + '-r';
      const labels = (f.options || []).map(function (o, i) {
        const oid = id + '-' + i;
        const input = /** @type {HTMLInputElement} */ (el('input', {
          type: 'radio', id: oid, name: group, value: o.value, class: 'ak-intake__radio', 'data-ak-part': 'input', 'aria-describedby': errId,
        }));
        return { input: input, node: el('label', { class: 'ak-intake__choice', 'data-ak-part': 'choice', for: oid }, [input, el('span', {}, o.label)]) };
      });
      inputs = labels.map(function (x) { return x.input; });
      wrap = el('fieldset', { class: 'ak-form__field ak-intake__group', 'data-ak-part': 'field', 'data-ak-field': f.name, 'aria-required': req }, [
        el('legend', { class: 'ak-form__label', 'data-ak-part': 'label' }, [f.label].concat(marks)),
        el('div', { class: 'ak-intake__choices' }, labels.map(function (x) { return x.node; })),
        error,
      ]);
    } else if (f.type === 'checkbox') {
      const input = /** @type {HTMLInputElement} */ (el('input', {
        type: 'checkbox', id: id, class: 'ak-check', 'data-ak-part': 'input', 'aria-describedby': errId, 'aria-required': req,
      }));
      inputs = [input];
      wrap = el('div', { class: 'ak-form__field', 'data-ak-part': 'field', 'data-ak-field': f.name }, [
        el('div', { class: 'ak-intake__check' }, [
          input, el('label', { class: 'ak-form__label', 'data-ak-part': 'label', for: id }, [f.label].concat(marks)),
        ]),
        error,
      ]);
    } else {
      let input;
      if (f.type === 'textarea') {
        input = el('textarea', { id: id, class: 'ak-input ak-input--area', 'data-ak-part': 'input', rows: 4, maxlength: f.maxLength || null, 'aria-describedby': errId, 'aria-required': req });
      } else if (f.type === 'select') {
        input = el('select', { id: id, class: 'ak-input', 'data-ak-part': 'input', 'aria-describedby': errId, 'aria-required': req },
          [el('option', { value: '' }, ti('intake.choose'))].concat((f.options || []).map(function (o) {
            return el('option', { value: o.value }, o.label);
          })));
      } else {
        const type = TYPES.indexOf(f.type) === -1 ? 'text' : f.type;
        input = el('input', {
          id: id, type: type, class: 'ak-input', 'data-ak-part': 'input', maxlength: f.maxLength || null,
          autocomplete: type === 'email' ? 'email' : (type === 'tel' ? 'tel' : (type === 'url' ? 'url' : null)),
          inputmode: type === 'number' ? 'decimal' : null,
          'aria-describedby': errId, 'aria-required': req,
        });
      }
      inputs = [/** @type {HTMLInputElement} */ (input)];
      wrap = el('div', { class: 'ak-form__field', 'data-ak-part': 'field', 'data-ak-field': f.name }, [
        el('label', { class: 'ak-form__label', 'data-ak-part': 'label', for: id }, [f.label].concat(marks)),
        input,
        error,
      ]);
    }
    controls.set(f.name, { field: f, wrap: wrap, error: error, inputs: inputs });
    return wrap;
  }

  const ready = render().then(function () { enter(root); });
  const stopWatch = watch(function () { render(); }, root);
  return {
    el: root,
    refresh: function () { return ready.then(render); },
    destroy: function () { stopWatch(); gen += 1; if (root.parentNode) root.parentNode.removeChild(root); },
  };
}

// ── intakeAdmin: the owner's forms ────────────────────────────────────────────────────────────

/** The owner's list in the sample, shaped like listForms() answers. */
const SAMPLE_FORMS = [
  { form_id: 'contact-us', title: 'Contact us', enabled: true, discoverable: true, mode: 'publish', allowed_fields: ['name', 'email', 'message'], submissions: 12 },
  { form_id: 'frm_q7k2m9x4w1p8z3n6', title: 'Autumn party RSVP', enabled: true, discoverable: false, mode: 'draft', allowed_fields: ['name', 'people'], submissions: 1 },
];

/**
 * A field key from what the owner typed as its label: small letters, numbers and underscores.
 * @param {string} label
 */
function slug(label) {
  const s = String(label || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
  return s || 'field';
}

/**
 * The owner's public forms in one workspace: the list, Copy link, Delete, and Create.
 * @param {{ target?: string|Element, org: string, ws: string, namespace?: string, title?: string,
 *   sample?: boolean, link?: (form: any) => string }} spec
 * @returns {{ el: HTMLElement, refresh: () => Promise<void>, destroy: () => void }}
 */
export function intakeAdmin(spec) {
  const sample = spec.sample === true || unset(spec.org) || unset(spec.ws);
  const root = el('section', { class: 'ak-root ak-intake ak-intake-admin', 'data-ak-part': 'root' });
  if (spec.target) resolve(spec.target).appendChild(root);
  let gen = 0;
  let failure = '';
  let notice = '';
  /** @type {HTMLElement|null} */
  let failureEl = null;
  /** @type {HTMLElement|null} */
  let createHost = null;
  /** What the owner is typing into Create; kept across a redraw so a refusal loses nothing. */
  const draft = { formId: '', title: '', namespace: spec.namespace || '', rows: [{ label: '', type: 'text', required: false, options: '' }] };

  async function act(work, done) {
    failure = ''; notice = '';
    try {
      const r = await work();
      failure = refusal(r);
      if (!failure && done) notice = done(r) || '';
    } catch (e) {
      failure = refusal(e) || String(e);
    }
    await render();
  }

  function button(label, tone, part, run) {
    const noop = function () { /* the sample changes nothing */ };
    return el('button', { type: 'button', class: 'ak-btn ak-btn--' + tone, 'data-ak-part': part, disabled: sample ? true : null, on: { click: sample ? noop : run } }, label);
  }

  function linkOf(f) {
    if (typeof spec.link === 'function') return spec.link(f);
    const here = String(window.location.href || '').split(/[?#]/)[0];
    return here + '?form=' + encodeURIComponent(f.form_id);
  }

  function countOf(f) {
    const n = [f.submissions, f.submission_count, f.count].filter(function (v) { return typeof v === 'number'; })[0];
    if (typeof n !== 'number') return '';
    return n === 1 ? ti('intake.answers1') : ti('intake.answers', { n: n });
  }

  async function render() {
    const mine = ++gen;
    /** @type {any[]} */
    let forms = [];
    let stopText = '';
    const lib = intakeOf();
    if (sample) forms = SAMPLE_FORMS;
    else if (!lib) stopText = ti('intake.noLib');
    else if (signedOut()) stopText = ti('intake.signIn');
    else {
      try {
        forms = await lib.listForms(spec.org, spec.ws);
      } catch (e) {
        if (!failure) failure = refusal(e) || String(e);
      }
    }
    if (mine !== gen) return;
    clear(root);
    failureEl = null;
    createHost = null;
    root.appendChild(el('h3', { class: 'ak-intake__title', 'data-ak-part': 'title' },
      [spec.title || ti('intake.adminTitle'), sample ? sampleBadge() : null].filter(Boolean)));
    root.appendChild(el('p', { class: 'ak-intake__intro', 'data-ak-part': 'intro' }, sample ? ti('intake.sampleNote') : ti('intake.adminIntro')));
    if (stopText) { root.appendChild(el('p', { class: 'ak-intake__none' }, stopText)); return; }
    failureEl = el('p', { class: 'ak-intake__failure', role: 'alert', 'data-ak-part': 'failure', hidden: failure ? null : true },
      failure ? ti('intake.failed', { why: failure }) : '');
    root.appendChild(failureEl);
    const noticeEl = el('p', { class: 'ak-intake__notice', role: 'status', 'data-ak-part': 'notice', hidden: notice ? null : true }, notice);
    root.appendChild(noticeEl);

    function tell(text) { noticeEl.textContent = text; noticeEl.hidden = false; }

    const rows = (Array.isArray(forms) ? forms : []).map(function (f) {
      const name = f.title || f.form_id;
      const meta = [
        f.form_id !== name ? f.form_id : '',
        countOf(f),
        f.enabled === false ? ti('intake.closed') : '',
        f.discoverable === false ? ti('intake.private') : '',
        f.mode === 'draft' ? ti('intake.draft') : '',
      ].filter(Boolean).join(' · ');
      return el('li', { class: 'ak-intake__row', 'data-ak-part': 'row', 'data-ak-form': f.form_id }, [
        el('span', { class: 'ak-intake__name' }, name),
        el('span', { class: 'ak-intake__meta', 'data-ak-part': 'meta' }, meta),
        el('span', { class: 'ak-intake__acts', 'data-ak-part': 'acts' }, [
          button(ti('intake.copy'), 'ghost', 'copy', function () {
            const url = linkOf(f);
            const clip = navigator.clipboard;
            if (!clip || typeof clip.writeText !== 'function') { tell(ti('intake.copyByHand', { url: url })); return; }
            clip.writeText(url).then(function () { tell(ti('intake.copied', { url: url })); },
              function () { tell(ti('intake.copyByHand', { url: url })); });
          }),
          button(ti('intake.delete'), 'ghost', 'delete', function () {
            ask({
              title: ti('intake.confirmDelete', { name: name }), text: ti('intake.confirmDeleteText'),
              confirmLabel: ti('intake.delete'), tone: 'danger',
            }).then(function (yes) {
              if (yes) act(function () { return lib.deleteForm(spec.org, spec.ws, f.form_id); }, function () { return ti('intake.deleted'); });
            });
          }),
        ]),
      ]);
    });
    root.appendChild(el('div', { class: 'ak-intake__group', 'data-ak-part': 'forms' }, [
      rows.length ? el('ul', { class: 'ak-intake__rows' }, rows) : el('p', { class: 'ak-intake__none' }, ti('intake.none')),
    ]));
    createHost = el('div', { class: 'ak-intake__group ak-intake__create', 'data-ak-part': 'create' });
    root.appendChild(createHost);
    drawCreate(lib);
  }

  /** A check the page can make before asking the node, said where the node's refusal goes. */
  function local(text) {
    if (!failureEl) return;
    failureEl.textContent = text;
    failureEl.hidden = false;
    attention(failureEl, 'shake');
  }

  /** A labelled input bound to one key of the draft. */
  function text(label, key, hint) {
    const id = uid('ak-intake-new');
    const input = /** @type {HTMLInputElement} */ (el('input', { type: 'text', id: id, class: 'ak-input', value: draft[key], disabled: sample ? true : null, autocomplete: 'off' }));
    input.addEventListener('input', function () { draft[key] = input.value; });
    return el('div', { class: 'ak-form__field' }, [
      el('label', { class: 'ak-form__label', for: id }, label),
      input,
      hint ? el('p', { class: 'ak-form__hint' }, hint) : null,
    ].filter(Boolean));
  }

  function fieldRow(r, i, lib) {
    const label = /** @type {HTMLInputElement} */ (el('input', { type: 'text', class: 'ak-input ak-intake__flabel', value: r.label, 'aria-label': ti('intake.fieldLabel'), placeholder: ti('intake.fieldLabel'), disabled: sample ? true : null }));
    const type = /** @type {HTMLSelectElement} */ (el('select', { class: 'ak-input ak-intake__ftype', 'aria-label': ti('intake.fieldType'), disabled: sample ? true : null },
      TYPES.map(function (k) { return el('option', { value: k, selected: k === r.type ? true : null }, ti('intake.type.' + k)); })));
    type.value = r.type;
    const reqId = uid('ak-intake-req');
    const required = /** @type {HTMLInputElement} */ (el('input', { type: 'checkbox', id: reqId, class: 'ak-check', checked: r.required ? true : null, disabled: sample ? true : null }));
    const options = /** @type {HTMLInputElement} */ (el('input', { type: 'text', class: 'ak-input ak-intake__fopts', value: r.options, 'aria-label': ti('intake.fieldOptions'), placeholder: ti('intake.fieldOptions'), disabled: sample ? true : null }));
    const choice = function () { return r.type === 'select' || r.type === 'radio'; };
    options.hidden = !choice();
    label.addEventListener('input', function () { r.label = label.value; });
    type.addEventListener('change', function () { r.type = type.value; options.hidden = !choice(); });
    required.addEventListener('change', function () { r.required = !!required.checked; });
    options.addEventListener('input', function () { r.options = options.value; });
    return el('li', { class: 'ak-intake__frow' }, [
      label, type,
      el('span', { class: 'ak-intake__check' }, [required, el('label', { for: reqId }, ti('intake.fieldRequired'))]),
      options,
      draft.rows.length > 1 ? button(ti('intake.removeField'), 'ghost', 'removeField', function () { draft.rows.splice(i, 1); drawCreate(lib); }) : null,
    ].filter(Boolean));
  }

  /** The Create panel, drawn into its own host so adding a field reads nothing from the node. */
  function drawCreate(lib) {
    if (!createHost) return;
    clear(createHost);
    const save = button(ti('intake.save'), 'primary', 'save', function () {
      const id = draft.formId.trim().toLowerCase();
      const namespace = draft.namespace.trim();
      const rows = draft.rows.filter(function (r) { return r.label.trim(); });
      if (!rows.length) { local(ti('intake.needField')); return; }
      if (!namespace) { local(ti('intake.needNamespace')); return; }
      if (id && !FORM_ID_RE.test(id)) { local(ti('intake.badId')); return; }
      const taken = {};
      taken[HONEYPOT] = true;
      const fields = rows.map(function (r) {
        let key = slug(r.label);
        for (let n = 2; taken[key]; n++) key = slug(r.label) + '_' + n;
        taken[key] = true;
        /** @type {Record<string, any>} */
        const out = { key: key, label: r.label.trim(), type: r.type, required: !!r.required };
        const opts = String(r.options || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
        if ((r.type === 'select' || r.type === 'radio') && opts.length) out.options = opts;
        return out;
      });
      /** @type {Record<string, any>} */
      const cfg = {
        organism_id: spec.org, ws: spec.ws, namespace: namespace, title: draft.title.trim(),
        allowed_fields: fields.map(function (f) { return f.key; }),
        required_fields: fields.filter(function (f) { return f.required; }).map(function (f) { return f.key; }),
        fields: fields,
        honeypot_field: HONEYPOT,
      };
      if (id) cfg.form_id = id;
      act(function () { return lib.defineForm(cfg); }, function (r) {
        draft.formId = ''; draft.title = '';
        draft.rows = [{ label: '', type: 'text', required: false, options: '' }];
        return ti('intake.created', { name: (r && r.form_id) || id });
      });
    });
    const rowOf = function (r, i) { return fieldRow(r, i, lib); };
    [
      el('h4', { class: 'ak-intake__group-title' }, ti('intake.create')),
      text(ti('intake.formTitle'), 'title'),
      text(ti('intake.formId'), 'formId', ti('intake.formIdHint')),
      spec.namespace ? null : text(ti('intake.namespace'), 'namespace'),
      el('p', { class: 'ak-form__label' }, ti('intake.fields')),
      el('ul', { class: 'ak-intake__frows', 'data-ak-part': 'fieldRows' }, draft.rows.map(rowOf)),
      el('div', { class: 'ak-intake__bar' }, [
        button(ti('intake.addField'), 'ghost', 'addField', function () {
          draft.rows.push({ label: '', type: 'text', required: false, options: '' });
          drawCreate(lib);
        }),
        save,
      ]),
    ].filter(Boolean).forEach(function (n) { createHost.appendChild(n); });
  }

  const ready = render().then(function () { enter(root); });
  const stopWatch = watch(function () { failure = ''; notice = ''; render(); }, root);
  return {
    el: root,
    refresh: function () { return ready.then(render); },
    destroy: function () { stopWatch(); gen += 1; if (root.parentNode) root.parentNode.removeChild(root); },
  };
}
