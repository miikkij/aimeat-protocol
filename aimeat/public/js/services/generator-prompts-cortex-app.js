/**
 * @file generator-prompts-cortex-app.js
 * @deprecated DEPRECATED — kept as backup/reference. Prompts now served from database seeds.
 * @description Prompt template for generating app-domain cortex components.
 *   App-domain cortex = composition layer. Combines all feature cortex components
 *   + auth + translations + settings into a single entry point for the app.
 * @usage
 *   import { buildAppDomainCortexPrompt } from '/js/services/generator-prompts-cortex-app.js';
 * @version-history
 *   v1.0.0 — 2026-03-26 — Initial app-domain cortex prompt template
 */

import { INSTRUCTION_DISCLAIMER } from './generator-prompts-base.js';

/**
 * Build prompt for generating an app-domain cortex component.
 * @param {string} label - Component label
 * @param {string} projectDescription - Project description
 * @param {Array} featureBundles - Context bundles from all feature cortex components
 * @param {object} dataCortexBundle - Context bundle from the data cortex
 * @param {object} translationBundle - Context bundle from translation component (keys)
 * @returns {string} Complete prompt
 */
export function buildAppDomainCortexPrompt(label, projectDescription, featureBundles, dataCortexBundle, translationBundle) {

  const featureAPIs = (featureBundles || []).map(b => `
### ${b.name}
Registered as: ${b.registeredAs}
Access via: AIMEAT.${b.libName || b.registeredAs}
Exports: ${(b.exports || []).join(', ')}
`).join('\n');

  const translationKeys = translationBundle?.keys?.slice(0, 30).join(', ') || 'none available';

  return `${INSTRUCTION_DISCLAIMER}
Create an App-Domain Cortex for: ${label}

Project: ${projectDescription}

## Goal

Build the top-level cortex library that the APP will use. It composes:
1. All feature cortex components (renders them into containers)
2. Auth initialization (AIMEAT.auth)
3. Translation loading and management
4. Settings management
5. Navigation support

The app loads ONLY this cortex. This cortex provides everything the app needs.

## Feature Cortex Components (compose these)
${featureAPIs}

## Data Cortex
${dataCortexBundle ? `
Access via: AIMEAT.${dataCortexBundle.libName}
Methods: ${(dataCortexBundle.exports || []).join(', ')}
` : 'No data cortex available'}

## Translation Keys Available
${translationKeys}

## Methods to Export

- **init()** — Initialize auth, load translations, check data readiness. Returns { ready: boolean, authenticated: boolean }.
- **render(container)** — Render the full application UI into the container. Sets up navigation, renders feature views.
- **getTranslations(locale)** — Load translation strings for a locale. Returns the translation object.
- **t(key, vars)** — Translate a key with optional variable interpolation. Uses loaded translations.
- **switchLocale(locale)** — Change language, reload translations, re-render.

## Auth Pattern
\`\`\`javascript
// Restore session from storage (MUST call login() first — getSession() alone returns null)
var session = await AIMEAT.auth.login();
if (!session) {
  // No stored session — show login button
  // mountLoginButton takes a CSS SELECTOR string, not a DOM element
  // Give the container an ID first, then pass the selector
  container.id = container.id || 'app-auth';
  AIMEAT.auth.mountLoginButton('#' + container.id);
  return { ready: false, authenticated: false };
}
\`\`\`

## Translation Pattern
\`\`\`javascript
// Load translations — try service-prefixed key first, then plain key
async function loadTranslations(locale) {
  try {
    // Translations are stored in the OWNER namespace by the translation component
    // Key format: SERVICE_PREFIX.i18n.LOCALE (dots throughout)
    return await AIMEAT.data.get('SERVICE_PREFIX.i18n.' + locale)
        || await AIMEAT.data.get('i18n.' + locale)
        || {};
  } catch (e) { return {}; }
}

// Translate with interpolation
function t(key, vars) {
  var str = translations[key] || key;
  if (vars) {
    Object.keys(vars).forEach(function(k) {
      str = str.replace('\${' + k + '}', vars[k]);
    });
  }
  return str;
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
  name: kebab-case-app-name
  namespace: community
  description: "App-domain cortex description"
  author: generator
  tags: [app, domain-tag]
  labels:
    domain: specific-domain
spec:
  version: "1.0.0"
  license: MIT
  components:
    - type: lib
      name: kebab-case-app-name
      filename: kebab-case-app-name.js
      exports: [init, render, t, switchLocale, getTranslations]
      api_surface: |
        AIMEAT.appLib.init() — Initialize auth, load translations. Returns { ready, authenticated }
        AIMEAT.appLib.render(container) — Render the full application into DOM container
        AIMEAT.appLib.t(key, vars) — Translate with interpolation
        AIMEAT.appLib.switchLocale(locale) — Change language and re-render
        AIMEAT.appLib.getTranslations(locale) — Load translations for locale
\`\`\`

Second block — JavaScript library:
\`\`\`javascript
(function (AIMEAT) {
  'use strict';
  const LIB_NAME = 'appLib'; // camelCase
  // ... init/render implementation
  var exports = { init, render, t, switchLocale, getTranslations };
  if (AIMEAT.register) AIMEAT.register(LIB_NAME, exports);
  AIMEAT[LIB_NAME] = exports;
})(window.AIMEAT || (window.AIMEAT = {}));
\`\`\`
`;
}
