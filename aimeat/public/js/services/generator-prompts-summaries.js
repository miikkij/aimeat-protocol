/**
 * @file public/js/services/generator-prompts-summaries.js
 * @description Code-block extraction and compact API-summary helpers for generator prompts. Extracted from generator-prompts-base.js to satisfy max-file-lines.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from generator-prompts-base.js (max-file-lines)
 */

/**
 * Summarize extension code into a compact API reference (actions, memory keys, data shapes).
 * Avoids injecting thousands of lines of full extension code into prompts.
 */
/**
 * Extract only code blocks (```yaml ... ``` and ```javascript ... ```) from AI response.
 * Strips explanatory text that AI adds during fix rounds.
 */
export function extractCodeBlocks(text) {
  if (!text) return '';
  const blocks = [];
  const re = /```(\w*)\n([\s\S]*?)```/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    blocks.push('```' + m[1] + '\n' + m[2] + '```');
  }
  return blocks.length > 0 ? blocks.join('\n\n') : text;
}

/** @deprecated Use component.spec (formal JSON contract) instead of regex-extracted summaries. */
export function summarizeExtensionApi(result) {
  console.warn('[DEPRECATED] summarizeExtensionApi — use component.spec instead. See generator-specs.js.');
  if (!result) return '  (no code available)\n';
  const summary = [];

  // Extract metadata.name
  const nameMatch = result.match(/name:\s*"?([^\s"]+)"?/);
  if (nameMatch) summary.push(`  Extension name: ${nameMatch[1]}`);

  // Parse YAML actions section
  const actionsStart = result.indexOf('actions:');
  const schedulesStart = result.indexOf('schedules:');
  const actionsSection = actionsStart >= 0
    ? result.substring(actionsStart, schedulesStart >= 0 ? schedulesStart : undefined)
    : '';

  if (actionsSection) {
    const actionBlocks = actionsSection.split(/\n {2}- id:/);
    for (const block of actionBlocks.slice(1)) {
      const id = block.split('\n')[0].trim();
      const desc = block.match(/description:\s*"([^"]+)"/)?.[1] || '';
      const method = block.match(/method:\s*(\S+)/)?.[1] || 'POST';
      const path = block.match(/path:\s*(\S+)/)?.[1] || '';
      summary.push(`  Action: ${method} ${path} (${id}) — ${desc}`);
      // Extract input properties
      const inputProps = block.match(/properties:\n((?:\s+\w+:\n(?:\s+\w+:.*\n)*)*)/);
      if (inputProps) {
        const propNames = [...inputProps[1].matchAll(/^\s{8}(\w+):/gm)].map(m => m[1]);
        if (propNames.length) summary.push(`    Input: { ${propNames.join(', ')} }`);
      }
    }
  }

  // Extract memory keys from ctx.memory.set() and ctx.memory.get() calls
  const memSetKeys = new Set();
  const memGetKeys = new Set();
  for (const match of result.matchAll(/ctx\.memory\.set\(['"]([^'"]+)['"]/g)) {
    memSetKeys.add(match[1]);
  }
  for (const match of result.matchAll(/ctx\.memory\.get\(['"]([^'"]+)['"]/g)) {
    memGetKeys.add(match[1]);
  }
  if (memSetKeys.size > 0) summary.push(`  Memory writes: ${[...memSetKeys].join(', ')}`);
  if (memGetKeys.size > 0) summary.push(`  Memory reads: ${[...memGetKeys].join(', ')}`);

  // Extract data shapes from ctx.memory.set() values (first occurrence)
  for (const key of memSetKeys) {
    const setPattern = new RegExp(`ctx\\.memory\\.set\\(['"]${key.replace(/\./g, '\\.')}['"],\\s*\\{([^}]{1,200})`);
    const shapeMatch = result.match(setPattern);
    if (shapeMatch) {
      summary.push(`  Data shape for "${key}": { ${shapeMatch[1].trim()} ... }`);
    }
  }

  return summary.join('\n') + '\n';
}

/**
 * Summarize cortex code into a compact API reference (public methods).
 */
/** @deprecated Use component.spec (formal JSON contract) instead of regex-extracted summaries. */
export function summarizeCortexApi(result) {
  if (!result) return '  (no code available)\n';
  const summary = [];

  // Extract metadata.name
  const nameMatch = result.match(/name:\s*"?([^\s"]+)"?/);
  if (nameMatch) summary.push(`  Cortex name: ${nameMatch[1]}`);

  // Extract LIB_NAME
  const libMatch = result.match(/const\s+LIB_NAME\s*=\s*['"]([^'"]+)['"]/);
  if (libMatch) summary.push(`  JS access: AIMEAT.${libMatch[1]}`);

  // Extract public methods (async function declarations that are exported)
  const methodRegex = /async\s+function\s+(\w+)\s*\(/g;
  const methods = [];
  let match;
  while ((match = methodRegex.exec(result)) !== null) {
    methods.push(match[1]);
  }
  if (methods.length > 0) summary.push(`  Public methods: ${methods.join(', ')}`);

  // Extract EXT object (extension names this cortex wraps)
  const extMatch = result.match(/const\s+EXT\s*=\s*\{([^}]+)\}/);
  if (extMatch) summary.push(`  Wraps extensions: ${extMatch[1].trim()}`);

  // Extract readExtMemory calls (memory keys this cortex reads)
  const readKeys = new Set();
  for (const m of result.matchAll(/readExtMemory\([^,]+,\s*['"]([^'"]+)['"]/g)) {
    readKeys.add(m[1]);
  }
  if (readKeys.size > 0) summary.push(`  Reads memory keys: ${[...readKeys].join(', ')}`);

  return summary.join('\n') + '\n';
}

/**
 * Summarize cortex API for the app prompt — shows ONLY public methods and return shapes.
 * Never shows internal functions (callExt, readExtMemory, etc.) to prevent apps from
 * bypassing the cortex and calling extensions directly.
 */
/**
 * Generate a JSDoc-style API reference from cortex source code for the app prompt.
 * Shows ONLY public methods with parameters and return types.
 * Never exposes internal functions (callExt, readExtMemory, etc.).
 */
/** @deprecated Use component.spec (formal JSON contract) instead of regex-extracted summaries. */
export function summarizeCortexApiForApp(result, probeResults) {
  if (!result) return '  (no API info available)';

  // Extract LIB_NAME
  const libMatch = result.match(/const\s+LIB_NAME\s*=\s*['"]([^'"]+)['"]/);
  const libName = libMatch ? libMatch[1] : 'unknownLib';

  // Extract exported method names from the exports object
  const exportsMatch = result.match(/(?:const|var)\s+exports\s*=\s*\{([\s\S]*?)\}/);
  const exportedNames = new Set();
  if (exportsMatch) {
    for (const m of exportsMatch[1].split(',')) {
      const name = m.trim().split(':')[0].trim();
      if (name && !name.startsWith('//')) exportedNames.add(name);
    }
  }

  // Extract function signatures + JSDoc comments for exported methods only
  const jsdocEntries = [];
  // Match JSDoc + function pairs: /** ... */ followed by async function name(...)
  const funcRegex = /(\/\*\*[\s\S]*?\*\/)\s*(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)/g;
  let match;
  while ((match = funcRegex.exec(result)) !== null) {
    const [, docComment, funcName, params] = match;
    if (!exportedNames.has(funcName)) continue; // skip internal functions
    jsdocEntries.push({ name: funcName, params, doc: docComment });
  }

  // Also catch functions without JSDoc (fallback)
  const bareFuncRegex = /(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)\s*\{/g;
  while ((match = bareFuncRegex.exec(result)) !== null) {
    const [, funcName, params] = match;
    if (!exportedNames.has(funcName)) continue;
    if (jsdocEntries.some(e => e.name === funcName)) continue; // already captured
    jsdocEntries.push({ name: funcName, params, doc: null });
  }

  // Build JSDoc-style output
  const lines = [];
  lines.push(`/**`);
  lines.push(` * Cortex library: AIMEAT.${libName}`);
  lines.push(` * Load: <script src="/v1/cortex/.../${libName.replace(/([A-Z])/g, '-$1').toLowerCase()}.js"></script>`);
  lines.push(` *`);
  lines.push(` * Call these methods from your app. They handle all backend communication internally.`);
  lines.push(` * Do NOT call callExt(), readExtMemory(), writeOwnerMemory() or /v1/ext/ directly.`);
  lines.push(` */`);
  lines.push('');

  for (const entry of jsdocEntries) {
    if (entry.doc) {
      // Include the original JSDoc comment
      lines.push(entry.doc.trim());
    }
    lines.push(`async AIMEAT.${libName}.${entry.name}(${entry.params})`);

    // Extract @returns shape from JSDoc for prominent display
    if (entry.doc) {
      const returnsMatch = entry.doc.match(/@returns\s+\{([^}]+)\}/);
      if (returnsMatch) {
        lines.push(`  ⚠️ RETURNS: ${returnsMatch[1].trim()}`);
        lines.push(`  Use EXACTLY these field names when accessing the result.`);
      }
    }

    // Attach real response example from probe if available
    if (probeResults && probeResults.length > 0) {
      const probe = probeResults.find(p => p.action === entry.name);
      if (probe && probe.response) {
        const example = JSON.stringify(probe.response, null, 2);
        const truncated = example.length > 600 ? example.substring(0, 600) + '...' : example;
        lines.push(`  ACTUAL RESPONSE (from live probe — use these EXACT field names):`);
        lines.push(`  ${truncated.split('\n').join('\n  ')}`);
      }
    }
    lines.push('');
  }

  // If no JSDoc entries found, fall back to api_surface from YAML
  if (jsdocEntries.length === 0) {
    const apiSurfaceMatch = result.match(/api_surface:\s*\|\n([\s\S]*?)(?=\n\s{4}\w|\n\s{2}-|\n[^\s])/);
    if (apiSurfaceMatch) {
      lines.push('Public API:');
      for (const sl of apiSurfaceMatch[1].split('\n').map(l => l.trim()).filter(Boolean)) {
        lines.push('  ' + sl);
      }
    } else {
      // Last resort: just list method names
      for (const name of exportedNames) {
        lines.push(`async AIMEAT.${libName}.${name}()`);
      }
    }
  }

  lines.push('');
  lines.push('╔══════════════════════════════════════════════════════════════════════════╗');
  lines.push('║  Use EXACTLY the field names shown in @returns and ACTUAL RESPONSE      ║');
  lines.push('║  above. If @returns says { companies: Array }, use .companies            ║');
  lines.push('║  NOT .results, .data, .items, or any other guessed name.                ║');
  lines.push('║  These are the ONLY methods available. NEVER call callExt(),            ║');
  lines.push('║  readExtMemory(), or /v1/ext/ directly.                                  ║');
  lines.push('╚══════════════════════════════════════════════════════════════════════════╝');

  return lines.join('\n');
}
