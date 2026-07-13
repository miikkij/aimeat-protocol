/**
 * @file public/js/services/generator.registration.js
 * @description Generator component registration — turns a validated component result (CSM/MSM YAML,
 *   extension bundle, app HTML, memory/translation JSON, cortex) into a live node install, plus the
 *   YAML/manifest/extension parsers it needs. Extracted from generator.js to satisfy max-file-lines.
 * @usage import { registerComponent } from './generator.registration.js';
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from generator.js (max-file-lines)
 */
import { apiPost, apiDelete } from '/js/api.js';
import { parse as parseYaml, stringify as stringifyYaml } from '/lib/yaml.mjs';

/* ── App Manifest Parser ─────────────────────────────── */

/**
 * Extract name, description, version from an AIMEAT App Manifest HTML comment.
 * Expected format: <!-- AIMEAT App Manifest\nname: ...\nversion: ...\n-->
 */
function parseAppManifest(html) {
  const meta = { name: '', description: '', version: '1.0.0' };
  const match = html.match(/<!--\s*AIMEAT App Manifest\s*\n([\s\S]*?)-->/i);
  if (!match) return meta;
  for (const line of match[1].split('\n')) {
    const m = line.match(/^\s*(name|description|version|entry)\s*:\s*(.+)/i);
    if (m) {
      const key = m[1].toLowerCase();
      if (key in meta) meta[key] = m[2].trim();
    }
  }
  return meta;
}

/* ── Registration ────────────────────────────────────── */

/**
 * Clean YAML through the real yaml parser: parse → re-serialize.
 * No regex hacks. If the YAML is valid, the parser handles block scalars,
 * multiline strings, quoting, etc. correctly. Returns clean YAML string.
 * Falls back to minimal text cleanup if parse fails entirely.
 */
function cleanYaml(text) {
  if (typeof text !== 'string') return text;
  // Minimal pre-clean: only fix chars that prevent parsing at all
  let s = text;
  s = s.replace(/\\_/g, '_');
  s = s.replace(/\\\[/g, '[').replace(/\\\]/g, ']');
  s = s.replace(/\\\{/g, '{').replace(/\\\}/g, '}');
  s = s.replace(/\u200B|\u200C|\u200D|\uFEFF/g, '');
  try {
    const parsed = parseYaml(s);
    return stringifyYaml(parsed, { lineWidth: 0 });
  } catch {
    // Try fixing markdown bullets and retry
    s = s.replace(/^(\s*)\*\s{2,}/gm, '$1- ');
    s = s.replace(/^(\s*)\*\s+(?=\S)/gm, '$1- ');
    try {
      const parsed = parseYaml(s);
      return stringifyYaml(parsed, { lineWidth: 0 });
    } catch {
      return s; // give up, return pre-cleaned text
    }
  }
}

/**
 * Prefix service.name in YAML with owner namespace (owner/name) to avoid collisions.
 * If already namespaced with this owner, leaves it unchanged.
 */
function namespacedYaml(result, owner) {
  const raw = typeof result === 'string' ? cleanYaml(result) : result;
  if (!owner || typeof raw !== 'string') return typeof result === 'string' ? { yaml: raw } : result;
  try {
    const parsed = parseYaml(raw);
    const name = parsed?.service?.name;
    if (name && !name.startsWith(owner + '/')) {
      parsed.service.name = owner + '/' + name;
    }
    return { yaml: stringifyYaml(parsed, { lineWidth: 0 }) };
  } catch {
    return { yaml: raw };
  }
}

/**
 * POST a CSM/MSM manifest. On 409 NAME_TAKEN, delete the old one (if owned) and retry.
 */
async function upsertManifest(endpoint, body, _owner) {
  try {
    return await apiPost(endpoint, body);
  } catch (err) {
    const code = err?.code || '';
    if (err?.status === 409 || code.includes('NAME_TAKEN')) {
      // Extract name from the YAML we just tried to post
      try {
        const parsed = parseYaml(body.yaml);
        const name = parsed?.service?.name;
        if (name) {
          await apiDelete(`${endpoint}/${encodeURIComponent(name)}`);
          return await apiPost(endpoint, body);
        }
      } catch { /* delete failed — not our manifest, surface original error */ }
    }
    throw err;
  }
}

export async function registerComponent(type, result, session, serviceSlug = '') {
  const owner = session?.owner;
  switch (type) {
    case 'csm': {
      // CSM results are YAML — namespace the service name with owner to avoid collisions
      const yaml = namespacedYaml(result, owner);
      return upsertManifest('/v1/csm', yaml, owner);
    }
    case 'msm': {
      // MSM results are YAML — namespace the service name with owner to avoid collisions
      const yaml = namespacedYaml(result, owner);
      return upsertManifest('/v1/msm', yaml, owner);
    }
    case 'extension': {
      // POST /v1/extensions expects { manifest: yamlString, scripts: { key: code } }
      const parts = parseExtensionResult(result);
      return apiPost('/v1/extensions', { manifest: cleanYaml(parts.manifest), scripts: parts.scripts });
    }
    case 'app': {
      // App result is HTML. POST /v1/apps expects { filename, content (base64), name, description, ... }
      const html = typeof result === 'string' ? result : String(result);
      const appMeta = parseAppManifest(html);
      const content = btoa(unescape(encodeURIComponent(html))); // UTF-8 safe base64
      return apiPost('/v1/apps', {
        filename: (appMeta.name || 'app') + '.html',
        content,
        mime_type: 'text/html',
        name: appMeta.name || 'Generated App',
        description: appMeta.description || '',
        version: appMeta.version || '1.0.0',
      });
    }
    case 'memory': {
      const entries = typeof result === 'string' ? JSON.parse(result) : result;
      const results = [];
      for (const [rawKey, value] of Object.entries(entries)) {
        // Service-prefix memory keys to avoid collisions across services
        // Skip __meta and __index keys (they already contain the namespace)
        const key = (serviceSlug && !rawKey.startsWith(serviceSlug + '.'))
          ? `${serviceSlug}.${rawKey}`
          : rawKey;
        results.push(await apiPost('/v1/memory', { key, value, visibility: 'public' }));
      }
      return { data: { registered: results.length, keys: results.map((_, i) => {
        const rawKey = Object.keys(entries)[i];
        return (serviceSlug && !rawKey.startsWith(serviceSlug + '.'))
          ? `${serviceSlug}.${rawKey}`
          : rawKey;
      }) } };
    }
    case 'translation': {
      const translations = typeof result === 'string' ? JSON.parse(result) : result;
      // Store each locale's translations with service-prefix to avoid collisions
      const locales = [];
      for (const [locale, strings] of Object.entries(translations)) {
        if (locale && typeof strings === 'object') {
          const key = serviceSlug ? `${serviceSlug}.i18n.${locale}` : `i18n.${locale}`;
          await apiPost('/v1/memory', {
            key,
            value: strings,
            visibility: 'public',
          });
          locales.push(locale);
        }
      }
      const prefix = serviceSlug ? `${serviceSlug}.` : '';
      return { ok: true, data: { locales, name: `${prefix}i18n.${locales.join('.')}` } };
    }
    case 'cortex': {
      // Cortex result contains YAML manifest + optional JS lib code (pre-extracted by validator)
      const extracted = typeof result === 'string' ? null : result;
      if (!extracted || !extracted.manifest) {
        throw new Error('Cortex result must be pre-extracted by validator (manifest + libs)');
      }
      const body = { manifest: extracted.manifest };
      if (extracted.libs && extracted.libs.length > 0) {
        const libs = {};
        for (const lib of extracted.libs) {
          if (lib.filename && lib.code) libs[lib.filename] = lib.code;
        }
        if (Object.keys(libs).length > 0) body.libs = libs;
      }
      let installResp;
      try {
        installResp = await apiPost('/v1/cortex', body);
      } catch (e) {
        // If cortex already exists (409 CONFLICT), deactivate + delete + retry install
        if (e.message?.includes('already installed') || e.message?.includes('409') || e.message?.includes('CONFLICT')) {
          const existingName = extracted.manifest.match?.(/name:\s*"?([^\s"]+)"?/)?.[1];
          if (existingName) {
            try { await apiPost(`/v1/cortex/${encodeURIComponent(existingName)}/deactivate`); } catch { /* ok */ }
            await apiDelete(`/v1/cortex/${encodeURIComponent(existingName)}`);
            installResp = await apiPost('/v1/cortex', body);
          } else {
            throw e;
          }
        } else {
          throw e;
        }
      }
      // Auto-activate after install — deactivate first to ensure new code takes effect
      const name = installResp?.data?.name || installResp?.data?.extension?.name;
      if (name) {
        try { await apiPost(`/v1/cortex/${encodeURIComponent(name)}/deactivate`); } catch { /* ok if not yet active */ }
        await apiPost(`/v1/cortex/${encodeURIComponent(name)}/activate`);
      }
      return installResp;
    }
    default:
      throw new Error(`Unknown component type: ${type}`);
  }
}

/* ── Extension Result Parser ─────────────────────────── */

function parseExtensionResult(result) {
  const text = typeof result === 'string' ? result : JSON.stringify(result);

  // Strategy 1: markdown fences present — use them
  const yamlMatch = text.match(/```yaml\s*\n([\s\S]*?)```/i);
  const fencedJs = [...text.matchAll(/```javascript\s*\n\/\/\s*(actions\/[\w-]+\.js)\s*\n([\s\S]*?)```/gi)];

  if (yamlMatch && fencedJs.length > 0) {
    const scripts = {};
    for (const m of fencedJs) {
      scripts[m[1].replace('actions/', '')] = m[2].trim();
    }
    return { manifest: yamlMatch[1].trim(), scripts };
  }

  // Strategy 2: no fences — split on `// actions/filename.js` comment boundaries
  // The YAML manifest is everything before the first `// actions/` line.
  // Each JS file starts at `// actions/filename.js` and ends before the next one.
  const actionCommentRegex = /^\/\/\s*actions\/([\w-]+\.js)\s*$/gm;
  const boundaries = [];
  let m;
  while ((m = actionCommentRegex.exec(text)) !== null) {
    boundaries.push({ filename: m[1], index: m.index, afterComment: m.index + m[0].length });
  }

  if (boundaries.length === 0) {
    // No JS blocks found at all — return whatever we have as manifest
    const manifest = yamlMatch ? yamlMatch[1].trim() : text.trim();
    return { manifest, scripts: {} };
  }

  // Everything before first // actions/ comment is the YAML manifest
  let manifest = text.slice(0, boundaries[0].index).trim();
  // Strip any markdown fences or stray ``` from the manifest
  manifest = manifest.replace(/^```\w*\s*\n?/gm, '').replace(/```\s*$/gm, '').trim();

  const scripts = {};
  for (let i = 0; i < boundaries.length; i++) {
    const start = boundaries[i].afterComment;
    const end = i + 1 < boundaries.length ? boundaries[i + 1].index : text.length;
    let code = text.slice(start, end).trim();
    // Strip any trailing/leading markdown fences
    code = code.replace(/^```\w*\s*\n?/gm, '').replace(/```\s*$/gm, '').trim();
    scripts[boundaries[i].filename] = code;
  }

  return { manifest, scripts };
}
