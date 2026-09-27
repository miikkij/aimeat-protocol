/**
 * @file public/views/admin/extensions-tab.config-form.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description JSON-schema default builder and the schema-driven ConfigForm for the admin Extensions
 *   tab: one field per property of an extension's config schema. Extracted from the tab file to
 *   satisfy max-file-lines.
 * @version-history
 *   v2.0.0 — 2026-09-27 — The fields are the library's Field family (admin page group G7): an enum is a
 *     Select, a list a TextField whose label carries "comma-separated" as its note, a number a short
 *     number field, the rest a TextField, in Fields. The class and style constants the editors shared
 *     (inputStyle, labelStyle, fieldWrap) are gone: nothing draws them any more.
 *   v1.0.0 — 2026-07-13 — Extracted from the tab file (max-file-lines)
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { Field, Fields } from '/components/Field.js';
import { TextField } from '/components/TextField.js';
import { Select } from '/components/Select.js';

// ── Build default config values from JSON Schema properties ──
function buildDefaults(schema) {
  if (!schema?.properties) return {};
  const cfg = {};
  for (const [key, prop] of Object.entries(schema.properties)) {
    if (prop.default !== undefined) cfg[key] = prop.default;
  }
  return cfg;
}

// ── Schema-driven config form ──
function ConfigForm({ schema, config, onChange }) {
  if (!schema?.properties) return null;
  const props = schema.properties;
  const keys = Object.keys(props);
  if (keys.length === 0) return null;

  function set(key, value) {
    onChange({ ...config, [key]: value });
  }

  return html`
    <${Fields} cols=${3}>
      ${keys.map(key => {
        const prop = props[key];
        const val = config[key] ?? prop.default ?? '';

        // Enum → select dropdown
        if (prop.enum) {
          return html`<${Select} key=${key} label=${key} value=${val} options=${prop.enum}
            onChange=${v => set(key, v)} />`;
        }

        // Array of strings → comma-separated input
        if (prop.type === 'array') {
          const arrVal = Array.isArray(val) ? val.join(', ') : (val || '');
          return html`
            <${Field} key=${key} id=${'cfg-' + key} label=${key} labelNote=${`(${t('dashboard.servicesCommaSep')})`}>
              <${TextField} id=${'cfg-' + key} value=${arrVal}
                placeholder=${(prop.default || []).join(', ') || 'a, b, c'}
                onInput=${v => set(key, v.split(',').map(s => s.trim()).filter(Boolean))} />
            <//>`;
        }

        // Number / integer
        if (prop.type === 'number' || prop.type === 'integer') {
          return html`<${TextField} key=${key} type="number" size="short" label=${key} value=${val}
            step=${prop.type === 'integer' ? 1 : 'any'}
            onInput=${v => set(key, v === '' ? '' : Number(v))} />`;
        }

        // String (default)
        return html`<${TextField} key=${key} label=${key} value=${val} placeholder=${prop.default || ''}
          onInput=${v => set(key, v)} />`;
      })}
    <//>
  `;
}

export { buildDefaults, ConfigForm };
