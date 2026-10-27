/**
 * @file public/js/field-errors.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The per-field errors of a refused write, for a form to show beside each field. Every
 *   route that checks its body with a schema answers 400 VALIDATION_ERROR with `error.details`, one
 *   `{ path, code, message }` per field (src/models/validation-issues.ts); `message` is already in
 *   the person's language. A form keeps what fieldErrorsOf gives in its state and passes it to
 *   Fields as `errors`; each field whose `name` is a path in it shows its message under itself
 *   (components/Field.js).
 * @structure fieldErrorsOf(err) · otherErrors(errors, names) · refusalLine(errors, names, t)
 * @usage
 *   const [errors, setErrors] = useState({});
 *   try { setErrors({}); await apiPost('/v1/x', body); } catch (err) { setErrors(fieldErrorsOf(err)); }
 *   html`<${Fields} errors=${errors}><${TextField} name="title" … /><//>`
 * @version-history
 *   v1.0.0 — 2026-10-27 — Initial (wish wish-sy-tteiden-validointi-pituusrajat-ja-roskan-torjunta-palveli).
 */

/**
 * `{ path: message }` from an error api() threw, or from the `ok: false` envelope a session's own
 * fetch returns without throwing; `{}` when it was not a field refusal. A field with two problems
 * keeps the first; the body itself ("" path) is under ''.
 * @param {any} err
 * @returns {Record<string, string>}
 */
export function fieldErrorsOf(err) {
  const error = err?.response?.error ?? (err?.ok === false ? err.error : undefined);
  if (!error || error.code !== 'VALIDATION_ERROR' || !Array.isArray(error.details)) return {};
  /** @type {Record<string, string>} */
  const out = {};
  for (const d of error.details) {
    if (!d || typeof d.message !== 'string') continue;
    const path = typeof d.path === 'string' ? d.path : '';
    if (!(path in out)) out[path] = d.message;
  }
  return out;
}

/**
 * The messages of `errors` that no field of the form is named for, as one line, so a form can say
 * them in its general message instead of losing them.
 * @param {Record<string, string>} errors
 * @param {readonly string[]} names the `name` of every field the form draws
 */
export function otherErrors(errors, names) {
  const drawn = (path) => names.some((n) => path === n || path.startsWith(`${n}.`));
  return Object.entries(errors).filter(([path]) => !drawn(path)).map(([path, m]) => (path ? `${path}: ${m}` : m)).join(' ');
}

/**
 * The line a form says after a refused write: the messages no field shows, or "check the marked
 * fields" when every message stands under its field; null when the refusal named no field.
 * @param {Record<string, string>} errors
 * @param {readonly string[]} names
 * @param {(key: string) => string} t
 */
export function refusalLine(errors, names, t) {
  if (!Object.keys(errors).length) return null;
  return otherErrors(errors, names) || t('form.checkFields');
}
