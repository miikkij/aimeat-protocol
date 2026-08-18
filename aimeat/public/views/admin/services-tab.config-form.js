/**
 * @file public/views/admin/services-tab.config-form.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Shared input-style constants, JSON-schema default builder, and schema-driven ConfigForm for the admin Services tab. Extracted from services-tab.js to satisfy max-file-lines.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from services-tab.js (max-file-lines)
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';

const inputStyle = 'adm-input';
const labelStyle = 'adm-text-sm adm-text-dim';
const fieldWrap = 'display:flex;flex-direction:column;gap:2px';

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
    <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-start">
      ${keys.map(key => {
        const prop = props[key];
        const val = config[key] ?? prop.default ?? '';

        // Enum → select dropdown
        if (prop.enum) {
          return html`
            <div style=${fieldWrap}>
              <label class="${labelStyle}">${key}</label>
              <select class="${inputStyle}" value=${val}
                onChange=${e => set(key, e.target.value)}>
                ${prop.enum.map(opt => html`<option value=${opt}>${opt}</option>`)}
              </select>
            </div>
          `;
        }

        // Array of strings → comma-separated input
        if (prop.type === 'array') {
          const arrVal = Array.isArray(val) ? val.join(', ') : (val || '');
          return html`
            <div style=${fieldWrap + ';flex:1;min-width:160px'}>
              <label class="${labelStyle}">${key} <span style="opacity:.6">(${t('dashboard.servicesCommaSep')})</span></label>
              <input type="text" class="${inputStyle}" value=${arrVal}
                placeholder=${(prop.default || []).join(', ') || 'a, b, c'}
                onInput=${e => {
                  const items = e.target.value.split(',').map(s => s.trim()).filter(Boolean);
                  set(key, items);
                }} />
            </div>
          `;
        }

        // Number / integer
        if (prop.type === 'number' || prop.type === 'integer') {
          return html`
            <div style=${fieldWrap}>
              <label class="${labelStyle}">${key}</label>
              <input type="number" class="${inputStyle}" style="width:100px" value=${val}
                step=${prop.type === 'integer' ? 1 : 'any'}
                onInput=${e => set(key, e.target.value === '' ? '' : Number(e.target.value))} />
            </div>
          `;
        }

        // String (default)
        return html`
          <div style=${fieldWrap + ';min-width:140px'}>
            <label class="${labelStyle}">${key}</label>
            <input type="text" class="${inputStyle}" value=${val}
              placeholder=${prop.default || ''}
              onInput=${e => set(key, e.target.value)} />
          </div>
        `;
      })}
    </div>
  `;
}

export { inputStyle, labelStyle, fieldWrap, buildDefaults, ConfigForm };
