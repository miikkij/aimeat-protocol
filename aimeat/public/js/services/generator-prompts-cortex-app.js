/**
 * @file generator-prompts-cortex-app.js
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
// Check if user is authenticated
var session = AIMEAT.auth.getSession();
if (!session) {
  // Show login prompt or mount auth UI
  AIMEAT.auth.mountLogin(container);
  return { ready: false, authenticated: false };
}
\`\`\`

## Translation Pattern
\`\`\`javascript
// Load translations from extension namespace
async function loadTranslations(locale) {
  try {
    return await AIMEAT.data.getPublic('ext:EXTENSION_NAME', 'i18n.' + locale) || {};
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

Return TWO code blocks: \`\`\`yaml for the cortex manifest and \`\`\`javascript for the library.
The library is a single IIFE. It loads and composes the feature cortex components.
`;
}
