/**
 * @file atelier/form-check.js
 * @description The form's rules as one JSON Schema. A form's fields say what they need
 *   (required, a format, a pattern, a length, a range, the same value as another field) and the
 *   host may add a schema of its own for anything else, a rule between fields included. This file
 *   folds both into one schema and hands it to the validate library's core (validate/core.js), so a
 *   form on the kit and AIMEAT.validate refuse the same values with the same words, and the schema
 *   a form checks is the schema a workspace can lock on the node.
 *
 *   A FIELD'S OWN WORDS WIN. A field's `messages` ({ <rule>: text }) become the property's
 *   x-messages, its `label` the property's title, so a message that names another field names it
 *   the way the person sees it.
 * @structure schemaFromFields(fields, schema) · FIELD_FORMAT
 * @usage import { schemaFromFields } from './form-check.js';
 *        const checker = compile(schemaFromFields(spec.fields, spec.schema));
 * @version-history
 *   v1.0.0 - 2026-10-05 - Initial (wish-sy-tteiden-validointi-sovelluksiin-yksi-json-schema-ui-lle-a).
 */

/** The input types that carry a format of their own. */
export const FIELD_FORMAT = { email: 'email', url: 'uri', tel: 'phone' };

/** The types whose value is a number rather than text. */
const NUMERIC = ['number', 'range'];

/**
 * One schema from a form's fields and the host's own schema. The host's schema is the base; a
 * field adds only what it declares and the host's property does not already say.
 * @param {Array<Record<string, any>>} fields
 * @param {Record<string, any>} [schema]
 * @returns {Record<string, any>}
 */
export function schemaFromFields(fields, schema) {
  const base = schema && typeof schema === 'object' ? schema : {};
  const props = Object.assign({}, base.properties || {});
  const required = Array.isArray(base.required) ? base.required.slice() : [];
  for (const f of fields || []) {
    if (!f || !f.name) continue;
    const type = f.type || 'text';
    const p = Object.assign({}, props[f.name] || {});
    if (p.title == null && typeof f.label === 'string') p.title = f.label;
    if (p.type == null) {
      if (NUMERIC.indexOf(type) >= 0) p.type = 'number';
      else if (type === 'checkbox' || type === 'toggle') p.type = 'boolean';
      else p.type = 'string';
    }
    const fmt = f.format || FIELD_FORMAT[/** @type {keyof typeof FIELD_FORMAT} */ (type)];
    if (fmt && p.format == null) p.format = fmt;
    if (f.pattern != null && p.pattern == null) p.pattern = String(f.pattern);
    if (f.minLength != null && p.minLength == null) p.minLength = f.minLength;
    if (f.maxLength != null && p.maxLength == null && NUMERIC.indexOf(type) < 0) p.maxLength = f.maxLength;
    if (NUMERIC.indexOf(type) >= 0) {
      if (f.min != null && p.minimum == null) p.minimum = f.min;
      if (f.max != null && p.maximum == null) p.maximum = f.max;
    }
    if (f.sameAs && p['x-same-as'] == null) p['x-same-as'] = f.sameAs;
    if (f.messages && typeof f.messages === 'object') p['x-messages'] = Object.assign({}, p['x-messages'] || {}, f.messages);
    // A required checkbox or switch asks for a yes: false is an answer, so required alone passes it.
    if (f.required && (type === 'checkbox' || type === 'toggle') && p.const == null) p.const = true;
    if (f.required && required.indexOf(f.name) < 0) required.push(f.name);
    props[f.name] = p;
  }
  const out = Object.assign({}, base, { type: base.type || 'object', properties: props });
  if (required.length) out.required = required;
  return out;
}
