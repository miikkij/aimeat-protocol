/**
 * @file generator-prompts-cortex-feature.js
 * @description Prompt template for generating feature cortex components.
 *   Feature cortex = one use case, data + UI combined. Self-contained module
 *   that exports render(container). Like aimeat-charts exports ChartPanel.
 * @usage
 *   import { buildFeatureCortexPrompt } from '/js/services/generator-prompts-cortex-feature.js';
 * @version-history
 *   v1.0.0 — 2026-03-26 — Initial feature cortex prompt template
 */

import { INSTRUCTION_DISCLAIMER } from './generator-prompts-base.js';

/**
 * Working code examples for platform UI cortex libraries.
 * Extracted from actual source code — these show REAL parameter patterns.
 */
const PLATFORM_UI_EXAMPLES = `
## Platform UI Cortex Libraries — Working Examples

All components take an options object. They return a DOM element you append to your container.

### Tabs (AIMEAT['aimeat-ui-nav'].Tabs)
\`\`\`javascript
var tabs = AIMEAT['aimeat-ui-nav'].Tabs({
  target: container,  // DOM element or CSS selector string
  tabs: [
    { id: 'search', label: 'Haku', icon: '🔍' },
    { id: 'watchlist', label: 'Seuranta', icon: '⭐' },
    { id: 'settings', label: 'Asetukset', icon: '⚙' }
  ],
  active: 'search',  // which tab is active initially
  onChange: function(tabId) {
    // called when user clicks a tab
    renderTabContent(tabId);
  }
});
\`\`\`

### DataTable (AIMEAT['aimeat-ui-viewers'].DataTable)
\`\`\`javascript
var table = AIMEAT['aimeat-ui-viewers'].DataTable({
  columns: [
    { key: 'name', label: 'Name', sortable: true },
    { key: 'id', label: 'ID' },
    { key: 'status', label: 'Status' }
  ],
  rows: dataRows,  // array of objects matching the column keys
  sortable: true,
  filterable: true,
  pageSize: 20
});
container.appendChild(table);
// NOTE: DataTable does NOT have onRowClick. For clickable rows, build your own
// card list with click handlers, or use the List component with onItemClick.
\`\`\`

### Timeline (AIMEAT['aimeat-ui-viewers'].Timeline)
\`\`\`javascript
var timeline = AIMEAT['aimeat-ui-viewers'].Timeline({
  events: [
    { date: '2026-03-26', title: 'Osoite muuttui', description: 'Vanha: Mannerheimintie 1 → Uusi: Pohjantie 8' },
    { date: '2026-03-20', title: 'Toimiala päivittyi', description: 'Uusi: Ohjelmistojen suunnittelu' }
  ]
});
container.appendChild(timeline);
\`\`\`

### Form components (AIMEAT['aimeat-ui-forms'])
\`\`\`javascript
// Text input — returns { el, getValue(), setValue(v), setError(msg), clearError() }
var nameInput = AIMEAT['aimeat-ui-forms'].Input({
  label: 'Hakusana',
  placeholder: 'Hae nimellä...',
  type: 'text'
});
container.appendChild(nameInput.el);
// Read value: nameInput.getValue()
// Set value: nameInput.setValue('test')
// Listen for changes: nameInput.el.querySelector('input').addEventListener('input', function(e) { doSearch(e.target.value); });

// Select dropdown — returns { el, getValue(), setValue(v) }
var langSelect = AIMEAT['aimeat-ui-forms'].Select({
  label: 'Kieli',
  options: [
    { value: 'fi', label: 'Suomi' },
    { value: 'en', label: 'English' }
  ]
});
container.appendChild(langSelect.el);
// Read value: langSelect.getValue()

// Toggle switch — returns { el, getValue(), setValue(v) }
// Toggle HAS onChange callback
var notifToggle = AIMEAT['aimeat-ui-forms'].Toggle({
  label: 'Ilmoitukset',
  checked: true,
  onChange: function(checked) { saveNotificationPref(checked); }
});
container.appendChild(notifToggle.el);
\`\`\`

### Dialogs (AIMEAT['aimeat-ui-dialogs'])
\`\`\`javascript
// Toast notification
AIMEAT['aimeat-ui-dialogs'].toast('Tallennettu!', 'success');
AIMEAT['aimeat-ui-dialogs'].toast('Virhe tapahtui', 'error');

// Confirm dialog (returns Promise)
var confirmed = await AIMEAT['aimeat-ui-dialogs'].Confirm({
  title: 'Poista kohde?',
  message: 'Haluatko varmasti poistaa tämän?',
  confirmLabel: 'Poista',
  cancelLabel: 'Peruuta'
});
if (confirmed) { deleteItem(id); }

// Modal
var modal = AIMEAT['aimeat-ui-dialogs'].Modal({
  title: 'Yrityksen tiedot',
  content: detailElement,  // DOM element
  width: 'lg'  // 'sm', 'md', 'lg'
});
\`\`\`
`;

/**
 * Build prompt for generating a feature cortex component.
 * @param {string} label - Component label
 * @param {object} useCase - The use case from interview spec this feature implements
 * @param {object} view - The view from interview spec matching this use case
 * @param {object} dataCortexBundle - Context bundle from the data cortex
 * @param {object} structures - Blueprint structures relevant to this feature
 * @param {Array} translationKeys - Translation keys relevant to this feature
 * @param {Array} usesLibs - Platform cortex libraries this component uses (from blueprint)
 * @returns {string} Complete prompt
 */
export function buildFeatureCortexPrompt(label, useCase, view, dataCortexBundle, structures, translationKeys, usesLibs) {

  const structuresText = Object.entries(structures || {}).map(([name, schema]) =>
    `**${name}**: ${JSON.stringify(schema, null, 2)}`
  ).join('\n\n');

  const dataCortexAPI = dataCortexBundle ? `
## Data Cortex API (use this for all data access)

Access via: AIMEAT.${dataCortexBundle.libName}
Methods: ${(dataCortexBundle.exports || []).join(', ')}

${(dataCortexBundle.probeResults || []).map(p =>
    `${p.method || p.action}(${JSON.stringify(p.input || {})}) → ${JSON.stringify(p.response).substring(0, 400)}`
  ).join('\n')}
` : '';

  const translationSection = translationKeys && translationKeys.length > 0 ? `
## Translation Keys (use these exact keys)

${translationKeys.map(k => '- `' + k + '`').join('\n')}
` : '';

  return `${INSTRUCTION_DISCLAIMER}
Create a Feature Cortex component for: ${label}

## Use Case
${useCase ? `**${useCase.title}** [${useCase.priority}]: ${useCase.description}` : 'No specific use case provided'}

## View
${view ? `**${view.title}** (${view.type}): ${view.description}${view.interactions ? '\nInteractions: ' + view.interactions.join(', ') : ''}` : 'No specific view provided'}

## Goal

Build a self-contained feature module (data + UI) as a cortex IIFE.
It must export a \`render(container)\` function that:
1. Creates all DOM elements for this feature
2. Fetches data from the data cortex
3. Renders the data using platform UI components
4. Handles user interactions
5. Uses translation keys for all visible text

Think of it like aimeat-charts: \`ChartPanel({ target: container, ... })\` creates a complete chart.
Your \`render(container)\` creates a complete feature view.

## Data Structures
${structuresText}

${dataCortexAPI}

${PLATFORM_UI_EXAMPLES}

${translationSection}

## Loading Translations

Translations are stored in the OWNER namespace (by the translation component).
Load them with AIMEAT.data.get() — NOT from ext: namespace:
\`\`\`javascript
// CORRECT — reads from owner namespace where translation component stored them:
var translations = await AIMEAT.data.get('SERVICE_NAME.i18n.fi') || {};

// WRONG — ext: namespace does NOT contain translations:
// var translations = await AIMEAT.data.getPublic('ext:...', 'i18n.fi'); // ← NEVER do this
\`\`\`
Replace SERVICE_NAME with the actual service slug (from the CSM/extension name).

## Translation Helper
Use a t() function for all user-visible text:
\`\`\`javascript
function t(key, translations, vars) {
  if (!key || !translations) return key || '';
  var str = translations[key] != null ? translations[key] : key;
  if (vars && typeof str === 'string') {
    Object.keys(vars).forEach(function(k) {
      str = str.replace('\${' + k + '}', vars[k]);
    });
  }
  return str;
}
\`\`\`

## Nested Object Helper
API responses contain nested objects. Use this to safely render values:
\`\`\`javascript
function dv(val) {
  if (val == null) return '-';
  if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') return String(val);
  if (val.value) return val.value;
  if (val.url) return val.url;
  if (val.name) return val.name;
  if (Array.isArray(val)) return val.map(dv).join(', ');
  return JSON.stringify(val);
}
\`\`\`

## Output Format

Return TWO separate, properly tagged code blocks.
CRITICAL: Use \`\`\`yaml for the manifest and \`\`\`javascript for the library code.

First block — YAML manifest:
\`\`\`yaml
apiVersion: cortex.aimeat.org/v1
kind: Extension
metadata:
  name: kebab-case-feature-name
  namespace: community
  description: "Feature description"
  author: generator
  tags: [feature, domain-tag]
  labels:
    domain: specific-domain
spec:
  version: "1.0.0"
  license: MIT
  components:
    - type: lib
      name: kebab-case-feature-name
      filename: kebab-case-feature-name.js
      exports: [render]
      api_surface: |
        AIMEAT.featureLib.render(container) — Renders the feature UI into the given DOM element
\`\`\`

Second block — JavaScript library:
\`\`\`javascript
(function (AIMEAT) {
  'use strict';
  const LIB_NAME = 'featureLib'; // camelCase
  // ... render(container) implementation
  var exports = { render: render };
  if (AIMEAT.register) AIMEAT.register(LIB_NAME, exports);
  AIMEAT[LIB_NAME] = exports;
})(window.AIMEAT || (window.AIMEAT = {}));
\`\`\`
`;
}
