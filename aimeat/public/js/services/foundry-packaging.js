/**
 * @file foundry-packaging.js
 * @description Bridge between the Foundry and Package/Template systems.
 *   Enables packaging foundry projects into versioned bundles, importing packages
 *   back into the foundry for editing, updating existing packages, forking, and
 *   publishing to the template gallery.
 * @structure
 *   - Content normalization: normalizeContent, denormalizeContent, computeContentHash
 *   - Packaging: packageProject, updatePackageVersion, buildPackageComponents
 *   - Import: importPackageToFoundry, parseFoundryMetadata
 *   - Change detection: detectChanges, buildChangelog
 *   - Gallery: publishToGallery
 *   - Helpers: inferDependencies, buildManifestYaml, reconstructBlueprint, slugify
 * @usage
 *   import { packageProject, importPackageToFoundry } from '/js/services/foundry-packaging.js';
 * @version-history
 *   v1.0.0 — 2026-03-17 — initial implementation (Foundry ↔ Package bridge)
 */

import {
  getProject, updateProject, loadAllComponents,
  getInterviewSpec, saveInterviewSpec, saveComponent,
} from '/js/services/foundry.js';
import {
  createPackage, getPackage, getPackageVersions, createVersion,
  listTemplates, createTemplate, updateTemplate,
} from '/js/services/packages.js';
import { validateComponent } from '/js/services/foundry-validate.js';
import { parse as parseYaml, stringify as stringifyYaml } from '/lib/yaml.mjs';

/* ── Helpers ─────────────────────────────────────────── */

function genId() {
  return 'prj-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
}

/** Slugify a project name for use as package name. */
export function slugify(name) {
  return name
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // strip diacritics
    .replace(/[äå]/g, 'a').replace(/ö/g, 'o')         // Finnish chars
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64) || 'unnamed';
}

/* ── Content Normalization ───────────────────────────── */

/**
 * Normalize a foundry component result into a package content string.
 * Uses validator extraction for structured types, then serializes to a
 * deterministic string format suitable for hashing and storage.
 *
 * @param {string} type - Component type (csm, msm, extension, cortex, app, memory, translation)
 * @param {*} result - Foundry component result (raw AI output or extracted)
 * @returns {string} - Package-compatible content string
 */
export function normalizeContent(type, result) {
  if (result == null) return '';
  const text = typeof result === 'string' ? result : JSON.stringify(result);

  switch (type) {
    case 'csm':
    case 'msm': {
      // Validate to extract clean YAML
      const v = validateComponent(type, text);
      return v.extracted || text;
    }

    case 'extension': {
      // Extension result is mixed YAML + JS — parse into { manifest, scripts }
      const parsed = parseExtensionResult(text);
      return JSON.stringify(parsed, Object.keys(parsed).sort(), 2);
    }

    case 'cortex': {
      // Cortex validator extracts { manifest, libs } — if already extracted, use it
      if (typeof result === 'object' && result.manifest) {
        const obj = { manifest: result.manifest };
        if (result.libs && result.libs.length > 0) {
          obj.libs = {};
          for (const lib of result.libs) {
            if (lib.filename && lib.code) obj.libs[lib.filename] = lib.code;
          }
        }
        return JSON.stringify(obj, null, 2);
      }
      // Otherwise validate to extract
      const v = validateComponent('cortex', text);
      if (v.extracted && v.extracted.manifest) {
        const obj = { manifest: v.extracted.manifest };
        if (v.extracted.libs && v.extracted.libs.length > 0) {
          obj.libs = {};
          for (const lib of v.extracted.libs) {
            if (lib.filename && lib.code) obj.libs[lib.filename] = lib.code;
          }
        }
        return JSON.stringify(obj, null, 2);
      }
      return text;
    }

    case 'app': {
      // Extract HTML from markdown fences if present
      const v = validateComponent('app', text);
      return v.extracted || text;
    }

    case 'memory': {
      // Memory result is { key: value } object — wrap in entries format
      let obj;
      try { obj = typeof result === 'string' ? JSON.parse(result) : result; }
      catch { return text; }
      if (typeof obj !== 'object' || obj === null) return text;
      const entries = Object.entries(obj).map(([key, value]) => ({ key, value }));
      return JSON.stringify({ entries }, null, 2);
    }

    case 'translation': {
      // Translation result is { locale: { strings } } — pass through as JSON
      const v = validateComponent('translation', text);
      if (v.extracted) {
        // Re-serialize for deterministic output
        try { return JSON.stringify(JSON.parse(v.extracted), null, 2); }
        catch { return v.extracted; }
      }
      return text;
    }

    default:
      return text;
  }
}

/**
 * Reverse normalization: convert package content string back to foundry result format.
 * This is what gets stored in the foundry component's `result` field.
 *
 * @param {string} type - Component type
 * @param {string} content - Package content string
 * @returns {*} - Foundry-compatible result
 */
export function denormalizeContent(type, content) {
  if (!content) return content;

  switch (type) {
    case 'csm':
    case 'msm':
      // YAML string passes through directly
      return content;

    case 'extension': {
      // JSON { manifest, scripts } → reconstruct mixed text format
      try {
        const parsed = JSON.parse(content);
        if (!parsed.manifest) return content;
        let text = '```yaml\n' + parsed.manifest + '\n```\n';
        if (parsed.scripts && typeof parsed.scripts === 'object') {
          for (const [filename, code] of Object.entries(parsed.scripts)) {
            text += '\n```javascript\n// actions/' + filename + '\n' + code + '\n```\n';
          }
        }
        return text;
      } catch {
        return content;
      }
    }

    case 'cortex': {
      // JSON { manifest, libs } → return as object (cortex validator expects this)
      try {
        const parsed = JSON.parse(content);
        if (!parsed.manifest) return content;
        const result = { manifest: parsed.manifest };
        if (parsed.libs && typeof parsed.libs === 'object') {
          result.libs = Object.entries(parsed.libs).map(([filename, code]) => ({ filename, code }));
        } else {
          result.libs = [];
        }
        return result;
      } catch {
        return content;
      }
    }

    case 'app':
      // HTML string passes through directly
      return content;

    case 'memory': {
      // JSON { entries: [...] } → convert to { key: value } object
      try {
        const parsed = JSON.parse(content);
        if (parsed.entries && Array.isArray(parsed.entries)) {
          const obj = {};
          for (const entry of parsed.entries) {
            obj[entry.key] = entry.value;
          }
          return obj;
        }
        return parsed;
      } catch {
        return content;
      }
    }

    case 'translation': {
      // JSON string → parse to object
      try { return JSON.parse(content); }
      catch { return content; }
    }

    default:
      return content;
  }
}

/**
 * Compute SHA-256 hash of content string using Web Crypto API.
 * @param {string} content
 * @returns {Promise<string>} hex hash
 */
export async function computeContentHash(content) {
  const data = new TextEncoder().encode(content);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/* ── Extension result parser (copied from foundry.js for independence) ── */

function parseExtensionResult(result) {
  const text = typeof result === 'string' ? result : JSON.stringify(result);

  // Strategy 1: markdown fences
  const yamlMatch = text.match(/```yaml\s*\n([\s\S]*?)```/i);
  const fencedJs = [...text.matchAll(/```javascript\s*\n\/\/\s*(actions\/[\w-]+\.js)\s*\n([\s\S]*?)```/gi)];

  if (yamlMatch && fencedJs.length > 0) {
    const scripts = {};
    for (const m of fencedJs) {
      scripts[m[1].replace('actions/', '')] = m[2].trim();
    }
    return { manifest: yamlMatch[1].trim(), scripts };
  }

  // Strategy 2: split on `// actions/filename.js` boundaries
  const actionCommentRegex = /^\/\/\s*actions\/([\w-]+\.js)\s*$/gm;
  const boundaries = [];
  let m;
  while ((m = actionCommentRegex.exec(text)) !== null) {
    boundaries.push({ filename: m[1], index: m.index, afterComment: m.index + m[0].length });
  }

  if (boundaries.length === 0) {
    const manifest = yamlMatch ? yamlMatch[1].trim() : text.trim();
    return { manifest, scripts: {} };
  }

  let manifest = text.slice(0, boundaries[0].index).trim();
  manifest = manifest.replace(/^```\w*\s*\n?/gm, '').replace(/```\s*$/gm, '').trim();

  const scripts = {};
  for (let i = 0; i < boundaries.length; i++) {
    const start = boundaries[i].afterComment;
    const end = i + 1 < boundaries.length ? boundaries[i + 1].index : text.length;
    let code = text.slice(start, end).trim();
    code = code.replace(/^```\w*\s*\n?/gm, '').replace(/```\s*$/gm, '').trim();
    scripts[boundaries[i].filename] = code;
  }

  return { manifest, scripts };
}

/* ── Dependency Inference ────────────────────────────── */

/**
 * Infer dependencies between components based on type relationships and
 * blueprint produces/consumes graph.
 *
 * @param {object} component - The component to infer deps for
 * @param {object[]} allComponents - All components in the project
 * @param {object} [blueprint] - Blueprint with produces/consumes data
 * @returns {string[]} - Array of component IDs this depends on
 */
export function inferDependencies(component, allComponents, blueprint) {
  const deps = new Set();
  const type = component.type;

  // If blueprint has produces/consumes, use those
  if (blueprint?.components) {
    const bpComp = blueprint.components.find(c => c.id === component.id);
    if (bpComp?.consumes) {
      for (const consumed of bpComp.consumes) {
        // Find which component produces this
        for (const other of blueprint.components) {
          if (other.id === component.id) continue;
          if (other.produces?.includes(consumed)) {
            deps.add(other.id);
          }
        }
      }
    }
    if (deps.size > 0) return [...deps];
  }

  // Fallback: infer from type relationships
  if (type === 'app') {
    const cortex = allComponents.find(c => c.type === 'cortex');
    if (cortex) deps.add(cortex.id);
  }
  if (type === 'extension') {
    const csm = allComponents.find(c => c.type === 'csm');
    if (csm) deps.add(csm.id);
  }
  if (type === 'cortex') {
    const ext = allComponents.find(c => c.type === 'extension');
    if (ext) deps.add(ext.id);
  }
  if (type === 'msm') {
    const csm = allComponents.find(c => c.type === 'csm');
    if (csm) deps.add(csm.id);
  }

  return [...deps];
}

/* ── Manifest Builder ────────────────────────────────── */

/**
 * Build a YAML manifest string from project metadata, components, and foundry context.
 *
 * @param {object} project - Foundry project
 * @param {object[]} pkgComponents - Normalized package components
 * @param {object} [foundryMeta] - Foundry metadata to embed for round-trip fidelity
 * @returns {string} - YAML manifest string
 */
export function buildManifestYaml(project, pkgComponents, foundryMeta) {
  const manifest = {
    name: slugify(project.name),
    description: project.description,
    category: project.category || 'utility',
    tags: project.tags || [],
    components: pkgComponents.map(c => ({
      id: c.id,
      type: c.type,
      label: c.label,
      dependencies: c.dependencies || [],
    })),
  };

  // Embed foundry metadata for fork/edit round-trip
  if (foundryMeta) {
    manifest.foundry = foundryMeta;
  }

  return stringifyYaml(manifest, { lineWidth: 0 });
}

/**
 * Reconstruct a blueprint from package components (when no foundry metadata is available).
 */
export function reconstructBlueprint(components) {
  const phaseMap = {
    csm: 'define',
    msm: 'registration',
    extension: 'logic',
    cortex: 'connect',
    app: 'ui',
    memory: 'seed',
    translation: 'seed',
  };

  const phaseOrder = ['define', 'seed', 'logic', 'connect', 'ui', 'registration'];

  const bpComponents = components.map(c => ({
    id: c.id,
    type: c.type,
    label: c.label,
    produces: [],
    consumes: [],
  }));

  const phaseGroups = {};
  for (const c of components) {
    const phase = phaseMap[c.type] || 'logic';
    if (!phaseGroups[phase]) phaseGroups[phase] = [];
    phaseGroups[phase].push(c.id);
  }

  const phases = phaseOrder
    .filter(p => phaseGroups[p])
    .map(p => ({
      id: p,
      label: p.charAt(0).toUpperCase() + p.slice(1),
      componentIds: phaseGroups[p],
    }));

  return {
    components: bpComponents,
    phases,
    dataModel: {},
  };
}

/* ── Foundry Metadata Extraction ───────────────────── */

/**
 * Parse foundry metadata from a package manifest YAML string.
 * @param {string} manifestYaml
 * @returns {{ description: string|null, blueprint: object|null, interviewSpec: object|null, forkedFrom: object|null } | null}
 */
export function parseFoundryMetadata(manifestYaml) {
  if (!manifestYaml) return null;
  try {
    const manifest = parseYaml(manifestYaml);
    if (!manifest?.foundry) return null;
    return {
      description: manifest.foundry.description || null,
      blueprint: manifest.foundry.blueprint || null,
      interviewSpec: manifest.foundry.interviewSpec || null,
      forkedFrom: manifest.foundry.forkedFrom || null,
    };
  } catch {
    return null;
  }
}

/* ── Build Package Components ────────────────────────── */

/**
 * Build normalized package components array from foundry components.
 * @param {object[]} components - Foundry components with status 'done' and result
 * @param {object} [blueprint] - Blueprint for dependency inference
 * @returns {Promise<object[]>} - Package-compatible components
 */
export async function buildPackageComponents(components, blueprint) {
  return Promise.all(components.map(async comp => {
    const content = normalizeContent(comp.type, comp.result);
    return {
      id: comp.id,
      type: comp.type,
      label: comp.label,
      content,
      contentHash: await computeContentHash(content),
      dependencies: inferDependencies(comp, components, blueprint),
    };
  }));
}

/* ── Package Creation ────────────────────────────────── */

/**
 * Package a foundry project into a bundle (first version).
 *
 * @param {string} projectId
 * @param {object} [options] - { visibility, category, tags, includeInterviewSpec }
 * @returns {Promise<object>} - API response from POST /v1/packages
 */
export async function packageProject(projectId, options = {}) {
  const project = await getProject(projectId);
  if (!project) throw new Error('Project not found');

  const components = await loadAllComponents(projectId);
  const packageable = components.filter(c => c.status === 'done' && c.result);

  if (packageable.length === 0) throw new Error('No completed components to package');

  const pkgComponents = await buildPackageComponents(packageable, project.blueprint);

  // Collect full foundry context for prompt fidelity in forks
  const interviewSpec = options.includeInterviewSpec !== false
    ? await getInterviewSpec(projectId)
    : null;

  const foundryMeta = {
    projectId,
    generatedAt: new Date().toISOString(),
    description: project.description,
    blueprint: project.blueprint || null,
    interviewSpec,
    forkedFrom: project.forkedFrom || null,
  };

  const manifest = buildManifestYaml(project, pkgComponents, foundryMeta);

  const result = await createPackage({
    name: slugify(project.name),
    description: project.description,
    category: options.category || 'utility',
    tags: options.tags || [],
    visibility: options.visibility || 'private',
    components: pkgComponents,
    manifest,
  });

  // Link package to foundry project
  const pkgData = result?.data;
  await updateProject(projectId, {
    packageGroupId: pkgData?.packageGroupId,
    lastPackagedVersion: pkgData?.version,
    lastPackagedAt: new Date().toISOString(),
  });

  return result;
}

/* ── Change Detection ────────────────────────────────── */

/**
 * Compare foundry components against the currently packaged version.
 * Returns a list of changes: added, modified, removed, unchanged.
 *
 * @param {object[]} foundryComponents - Current foundry components (done + result)
 * @param {object[]} packageComponents - Components from the latest package version
 * @returns {Promise<object[]>} - Array of { id, label, type, action }
 */
export async function detectChanges(foundryComponents, packageComponents) {
  const changes = [];
  const pkgMap = new Map((packageComponents || []).map(c => [c.id, c]));

  for (const comp of foundryComponents) {
    const content = normalizeContent(comp.type, comp.result);
    const hash = await computeContentHash(content);
    const pkgComp = pkgMap.get(comp.id);

    if (!pkgComp) {
      changes.push({ id: comp.id, label: comp.label, type: comp.type, action: 'added' });
    } else if (pkgComp.contentHash !== hash) {
      changes.push({ id: comp.id, label: comp.label, type: comp.type, action: 'modified' });
    } else {
      changes.push({ id: comp.id, label: comp.label, type: comp.type, action: 'unchanged' });
    }
    pkgMap.delete(comp.id);
  }

  // Remaining in pkgMap are removed components
  for (const [id, comp] of pkgMap) {
    changes.push({ id, label: comp.label, type: comp.type, action: 'removed' });
  }

  return changes;
}

/**
 * Build a human-readable changelog from detected changes.
 * @param {object[]} changes - From detectChanges()
 * @param {string} [note] - Optional user-provided changelog note
 * @returns {string} - Markdown changelog
 */
export function buildChangelog(changes, note) {
  const lines = [];
  const added = changes.filter(c => c.action === 'added');
  const modified = changes.filter(c => c.action === 'modified');
  const removed = changes.filter(c => c.action === 'removed');

  if (added.length > 0) {
    for (const c of added) lines.push(`- **Added:** ${c.label} (${c.type})`);
  }
  if (modified.length > 0) {
    for (const c of modified) lines.push(`- **Modified:** ${c.label} (${c.type})`);
  }
  if (removed.length > 0) {
    for (const c of removed) lines.push(`- **Removed:** ${c.label} (${c.type})`);
  }

  if (lines.length === 0) lines.push('- No changes detected');

  let changelog = lines.join('\n');
  if (note) changelog += '\n\n' + note;
  return changelog;
}

/* ── Package Update ──────────────────────────────────── */

/**
 * Create a new version of an existing package from foundry project.
 *
 * @param {string} projectId
 * @param {object} [options] - { category, tags, changelogNote, includeInterviewSpec }
 * @returns {Promise<{ result: object, changes: object[] }>}
 */
export async function updatePackageVersion(projectId, options = {}) {
  const project = await getProject(projectId);
  if (!project?.packageGroupId) throw new Error('Project not linked to a package');

  // Get current package to compare against
  const currentPkgResp = await getPackage(project.packageGroupId);
  const currentPkg = currentPkgResp?.data || currentPkgResp;

  const components = await loadAllComponents(projectId);
  const packageable = components.filter(c => c.status === 'done' && c.result);

  // Detect what changed
  const changes = await detectChanges(packageable, currentPkg?.components);

  // Build new components
  const pkgComponents = await buildPackageComponents(packageable, project.blueprint);

  // Rebuild foundry metadata
  const interviewSpec = options.includeInterviewSpec !== false
    ? await getInterviewSpec(projectId)
    : null;

  const foundryMeta = {
    projectId,
    generatedAt: new Date().toISOString(),
    description: project.description,
    blueprint: project.blueprint || null,
    interviewSpec,
    forkedFrom: project.forkedFrom || null,
  };

  const manifest = buildManifestYaml(project, pkgComponents, foundryMeta);
  const changelog = buildChangelog(changes, options.changelogNote);

  const result = await createVersion(project.packageGroupId, {
    description: project.description,
    category: options.category || currentPkg?.category || 'utility',
    tags: options.tags || currentPkg?.tags || [],
    components: pkgComponents,
    manifest,
    changelog,
  });

  await updateProject(projectId, {
    lastPackagedVersion: result?.data?.version,
    lastPackagedAt: new Date().toISOString(),
  });

  return { result, changes };
}

/* ── Import Package into Foundry ───────────────────── */

/**
 * Import a package into a new foundry project.
 * If the package belongs to currentUser, it's an "edit" (linked to package).
 * If it belongs to someone else, it's a "fork" (new independent project).
 *
 * @param {string} groupId - Package group ID
 * @param {string|null} version - Specific version (null = latest published)
 * @param {string} currentUser - Current user's owner name (for fork detection)
 * @returns {Promise<string>} - New foundry project ID
 */
export async function importPackageToFoundry(groupId, version, currentUser) {
  // Fetch package data
  let pkg;
  if (version) {
    const versionsResp = await getPackageVersions(groupId);
    const versions = versionsResp?.data?.versions || versionsResp?.data || [];
    pkg = versions.find(v => v.version === version);
    if (!pkg) throw new Error(`Version ${version} not found for ${groupId}`);
  } else {
    const resp = await getPackage(groupId);
    pkg = resp?.data || resp;
  }

  if (!pkg) throw new Error('Package not found');

  const isOwnPackage = pkg.author === currentUser;

  // Extract foundry metadata from manifest
  const genMeta = parseFoundryMetadata(pkg.manifest);

  // Create foundry project
  const projectId = genId();
  const now = new Date().toISOString();

  const project = {
    projectId,
    name: pkg.name,
    description: genMeta?.description || pkg.description,
    status: 'components',
    blueprint: genMeta?.blueprint || reconstructBlueprint(pkg.components || []),
    // Link to package only if editing own package
    packageGroupId: isOwnPackage ? pkg.packageGroupId : undefined,
    lastPackagedVersion: isOwnPackage ? pkg.version : undefined,
    sourceVersion: pkg.version,
    sourcePackageGroupId: pkg.packageGroupId,
    forkedFrom: isOwnPackage ? undefined : {
      packageGroupId: pkg.packageGroupId,
      version: pkg.version,
      author: pkg.author,
    },
    createdAt: now,
    updatedAt: now,
  };

  // Save project to memory
  const { apiPost } = await import('/js/api.js');
  await apiPost('/v1/memory', {
    key: `foundry.${projectId}.project`,
    value: project,
    visibility: 'owner',
  });

  // Restore interview spec if present in manifest
  if (genMeta?.interviewSpec) {
    await saveInterviewSpec(projectId, genMeta.interviewSpec);
  }

  // Create foundry components from package components
  const pkgComponents = pkg.components || [];
  for (const comp of pkgComponents) {
    const result = denormalizeContent(comp.type, comp.content);
    await saveComponent(projectId, {
      id: comp.id,
      type: comp.type,
      label: comp.label,
      status: 'done',
      result,
      validationErrors: [],
      validationWarnings: [],
      registeredAs: null,
      history: [{
        action: 'imported_from_package',
        at: now,
        by: 'system',
        meta: { packageGroupId: pkg.packageGroupId, version: pkg.version },
      }],
      _version: 0,
    });
  }

  return projectId;
}

/* ── Publish to Template Gallery ─────────────────────── */

/**
 * Create or update a template listing for a packaged project.
 *
 * @param {string} projectId
 * @param {object} [options] - { title, description, category, tags }
 * @returns {Promise<object>} - API response
 */
export async function publishToGallery(projectId, options = {}) {
  const project = await getProject(projectId);
  if (!project?.packageGroupId) throw new Error('Package project first');

  // Check if listing already exists for this package
  const existingResp = await listTemplates({ search: project.packageGroupId, limit: 50 });
  const listings = existingResp?.data?.listings || existingResp?.data || [];
  const existing = listings.find(l => l.packageGroupId === project.packageGroupId);

  if (existing) {
    return updateTemplate(existing.id, {
      description: options.description || project.description,
      tags: options.tags,
    });
  }

  return createTemplate({
    packageGroupId: project.packageGroupId,
    title: options.title || project.name,
    description: options.description || project.description,
    category: options.category || 'utility',
    tags: options.tags || [],
  });
}
