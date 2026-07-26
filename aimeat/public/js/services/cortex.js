/**
 * @file public/js/services/cortex.js
 * @description Frontend service layer for the Cortex (extension) API — centralizes all
 *   /v1/cortex REST calls: list, detail (with prompt content + ontology), lifecycle, and installs.
 *
 * @structure
 *   - listExtensions / getExtensionDetail: read installed extensions and enrich detail with prompts/ontology
 *   - activateExtension / deactivateExtension / uninstallExtension / toggleVisibility: lifecycle + visibility
 *   - installExtension / installBundledExtension: install from a YAML manifest (+libs) or a bundled /cortex-bundled/ id
 *
 * @version-history
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import { api, apiGet, apiPost, apiDelete } from '/js/api.js';
import { getNodeUrl } from '/js/services/auth.js';
import { swallowed } from '/js/swallowed.js';

/** List installed extensions. Returns { extensions: [...], total: number }. */
export async function listExtensions() {
  const data = await apiGet('/v1/cortex');
  return data.ok !== false
    ? { extensions: data.data?.extensions || [], total: data.data?.total || 0 }
    : { extensions: [], total: 0 };
}

/** Get full extension detail, including prompt content + ontology. */
export async function getExtensionDetail(name) {
  const enc = encodeURIComponent(name);
  let data;
  try { data = await apiGet(`/v1/cortex/${enc}`); } catch (err) { swallowed('cortex', err); return null; }
  const ext = data.data?.extension || data.data;

  // Fetch prompt content for each prompt component
  const prompts = (ext.components || []).filter(c => c.type === 'prompt');
  await Promise.all(prompts.map(async (p) => {
    try {
      const pd = await apiGet(`/v1/cortex/${enc}/prompts/${encodeURIComponent(p.name)}`);
      if (pd.data?.content) p._content = pd.data.content;
    } catch (err) { swallowed('cortex: prompts', err); }
  }));

  // Fetch ontology
  try {
    const ontData = await apiGet(`/v1/cortex/${enc}/ontology`);
    ext._ontologies = ontData.data?.ontologies || [];
  } catch (err) { swallowed('cortex', err); ext._ontologies = []; }

  return ext;
}

/** Activate an extension. */
export async function activateExtension(name) {
  return apiPost(`/v1/cortex/${encodeURIComponent(name)}/activate`);
}

/** Deactivate an extension. */
export async function deactivateExtension(name) {
  return apiPost(`/v1/cortex/${encodeURIComponent(name)}/deactivate`);
}

/** Uninstall an extension. */
export async function uninstallExtension(name) {
  return apiDelete(`/v1/cortex/${encodeURIComponent(name)}`);
}

/** Toggle visibility between public and private. */
export async function toggleVisibility(name, currentVisibility) {
  const newVis = currentVisibility === 'public' ? 'private' : 'public';
  return api(`/v1/cortex/${encodeURIComponent(name)}/visibility`, {
    method: 'POST',
    body: JSON.stringify({ visibility: newVis }),
  });
}

/** Install extension from YAML manifest string + optional libs object. */
export async function installExtension(manifest, libs) {
  const body = { manifest };
  if (libs && Object.keys(libs).length > 0) body.libs = libs;
  return api('/v1/cortex', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/** Install a bundled extension by ID (fetches YAML + JS from /cortex-bundled/). */
export async function installBundledExtension(bundledId, ownerNamespace) {
  const url = getNodeUrl();

  const yamlResp = await fetch(`${url}/cortex-bundled/${bundledId}.yaml`);
  if (!yamlResp.ok) return { ok: false, error: { message: 'Could not fetch manifest' } };
  let manifest = await yamlResp.text();

  // Replace the bundled namespace with the user's namespace
  if (ownerNamespace) {
    manifest = manifest.replace(/^(\s*namespace:\s*).+$/m, `$1${ownerNamespace}`);
  }

  const libs = {};
  try {
    const jsResp = await fetch(`${url}/cortex-bundled/${bundledId}.js`);
    if (jsResp.ok) libs[`${bundledId}.js`] = await jsResp.text();
  } catch (err) { swallowed('cortex: installBundledExtension', err); }

  return installExtension(manifest, libs);
}
