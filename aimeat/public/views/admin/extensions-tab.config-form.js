/**
 * @file public/views/admin/extensions-tab.config-form.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description JSON-schema default builder and the schema-driven ConfigForm for the admin Extensions
 *   tab: one shared field per property of the instance's config schema.
 * @version-history
 *   v2.0.0 -- 2026-09-22 -- Each property is a shared Field (select, number or text) in a wrapping
 *     stack; the input-style constants other files borrowed are gone with the classes they named.
 *   v1.0.0 — 2026-07-13 — Extracted from the tab file (max-file-lines)
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { Stack, Field } from '/components/poster-parts.js';

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

  return html`<${Stack} direction="wrap" align="start">
    ${keys.map(key => {
      const prop = props[key];
      const val = config[key] ?? prop.default ?? '';

      // Enum → select dropdown
      if (prop.enum) {
        return html`<${Field} key=${key} type="select" label=${key} value=${val}
          options=${prop.enum.map(opt => ({ value: opt, label: opt }))}
          onChange=${e => set(key, e.target.value)} />`;
      }

      // Array of strings → comma-separated input
      if (prop.type === 'array') {
        const arrVal = Array.isArray(val) ? val.join(', ') : (val || '');
        return html`<${Field} key=${key} label=${`${key} (${t('dashboard.servicesCommaSep')})`} value=${arrVal}
          placeholder=${(prop.default || []).join(', ') || 'a, b, c'}
          onInput=${e => {
            const items = e.target.value.split(',').map(s => s.trim()).filter(Boolean);
            set(key, items);
          }} />`;
      }

      // Number / integer
      if (prop.type === 'number' || prop.type === 'integer') {
        return html`<${Field} key=${key} type="number" width="narrow" label=${key} value=${val}
          step=${prop.type === 'integer' ? 1 : 'any'}
          onInput=${e => set(key, e.target.value === '' ? '' : Number(e.target.value))} />`;
      }

      // String (default)
      return html`<${Field} key=${key} label=${key} value=${val}
        placeholder=${prop.default || ''}
        onInput=${e => set(key, e.target.value)} />`;
    })}
  <//>`;
}

export { buildDefaults, ConfigForm };
