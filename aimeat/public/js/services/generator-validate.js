/**
 * Generator Validation — per-type validators for component results
 */

/* ── Helpers ─────────────────────────────────────────── */

function extractCodeBlock(text, lang) {
  const regex = new RegExp('```' + (lang || '') + '\\s*\\n([\\s\\S]*?)```', 'i');
  const match = text.match(regex);
  return match ? match[1].trim() : text.trim();
}

/* ── YAML Parse (lightweight) ────────────────────────── */

function basicYamlCheck(text) {
  const errors = [];
  if (!text || typeof text !== 'string') {
    errors.push('Result is empty');
    return { errors, parsed: null };
  }
  // Check for common YAML issues
  const lines = text.split('\n');
  if (lines.length < 3) errors.push('YAML seems too short (fewer than 3 lines)');
  if (!lines.some(l => l.includes(':'))) errors.push('No key-value pairs found — not valid YAML');
  return { errors, raw: text };
}

/* ── Validators ──────────────────────────────────────── */

const validators = {
  csm(result) {
    const errors = [];
    const yaml = extractCodeBlock(result, 'yaml');
    const check = basicYamlCheck(yaml);
    errors.push(...check.errors);

    if (!yaml.match(/^name:\s*.+/m)) errors.push('Missing required field: name');
    if (!yaml.match(/^version:\s*.+/m)) errors.push('Missing required field: version');
    if (!yaml.match(/^fields:/m)) errors.push('Missing required field: fields');
    if (!yaml.match(/consent:/m)) errors.push('Missing required section: consent');

    return { valid: errors.length === 0, errors, extracted: yaml };
  },

  msm(result) {
    const errors = [];
    const yaml = extractCodeBlock(result, 'yaml');
    const check = basicYamlCheck(yaml);
    errors.push(...check.errors);

    if (!yaml.match(/^name:\s*.+/m)) errors.push('Missing required field: name');
    if (!yaml.match(/^version:\s*.+/m)) errors.push('Missing required field: version');
    if (!yaml.match(/auth:/m)) errors.push('Missing required section: auth');
    if (!yaml.match(/endpoints:/m)) errors.push('Missing required section: endpoints');

    return { valid: errors.length === 0, errors, extracted: yaml };
  },

  extension(result) {
    const errors = [];
    const yaml = extractCodeBlock(result, 'yaml');
    const check = basicYamlCheck(yaml);
    errors.push(...check.errors);

    if (!yaml.match(/^extension:\s*.+/m)) errors.push('Missing required field: extension (version)');
    if (!yaml.match(/metadata:/m)) errors.push('Missing required section: metadata');
    if (!yaml.match(/actions:/m)) errors.push('Missing required section: actions');

    // Check for action scripts
    const jsBlocks = result.match(/```javascript[\s\S]*?```/gi) || [];
    const actionIds = [...yaml.matchAll(/- id:\s*(.+)/g)].map(m => m[1].trim());
    if (actionIds.length > 0 && jsBlocks.length === 0) {
      errors.push(`Extension defines ${actionIds.length} action(s) but no JavaScript code blocks found`);
    }

    return { valid: errors.length === 0, errors, extracted: result };
  },

  app(result) {
    const errors = [];
    const html = extractCodeBlock(result, 'html') || result;

    if (!html.includes('<!DOCTYPE html') && !html.includes('<html')) {
      errors.push('Not a valid HTML document — missing <!DOCTYPE html> or <html> tag');
    }
    if (!html.includes('<head')) errors.push('Missing <head> section');
    if (!html.includes('<body')) errors.push('Missing <body> section');
    if (!html.includes('AIMEAT App Manifest') && !html.match(/name:\s*.+/)) {
      errors.push('Missing AIMEAT App Manifest comment');
    }

    return { valid: errors.length === 0, errors, extracted: html };
  },

  memory(result) {
    const errors = [];
    const json = extractCodeBlock(result, 'json');
    try {
      const parsed = JSON.parse(json);
      if (typeof parsed !== 'object' || Array.isArray(parsed)) {
        errors.push('Memory structure must be a JSON object with key-value pairs');
      } else if (Object.keys(parsed).length === 0) {
        errors.push('Memory structure is empty');
      }
      return { valid: errors.length === 0, errors, extracted: json };
    } catch (e) {
      errors.push(`Invalid JSON: ${e.message}`);
      return { valid: false, errors, extracted: json };
    }
  },

  translation(result) {
    const errors = [];
    const json = extractCodeBlock(result, 'json');
    try {
      const parsed = JSON.parse(json);
      if (!parsed.en) errors.push('Missing "en" (English) locale');
      if (!parsed.fi) errors.push('Missing "fi" (Finnish) locale');
      if (parsed.en && parsed.fi) {
        const enKeys = Object.keys(parsed.en);
        const fiKeys = Object.keys(parsed.fi);
        const missing = enKeys.filter(k => !fiKeys.includes(k));
        if (missing.length > 0) errors.push(`Finnish translations missing for: ${missing.join(', ')}`);
      }
      return { valid: errors.length === 0, errors, extracted: json };
    } catch (e) {
      errors.push(`Invalid JSON: ${e.message}`);
      return { valid: false, errors, extracted: json };
    }
  },
};

/* ── Blueprint Validator ─────────────────────────────── */

export function validateBlueprint(result) {
  const errors = [];
  const json = extractCodeBlock(result, 'json') || result;
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed.components)) errors.push('Missing "components" array');
    else {
      for (const c of parsed.components) {
        if (!c.id) errors.push(`Component missing "id" field`);
        if (!c.type) errors.push(`Component "${c.id || '?'}" missing "type" field`);
        if (!c.label) errors.push(`Component "${c.id || '?'}" missing "label" field`);
        if (c.type && !['csm', 'msm', 'extension', 'app', 'memory', 'translation'].includes(c.type)) {
          errors.push(`Component "${c.id}" has unknown type "${c.type}"`);
        }
      }
    }
    if (!Array.isArray(parsed.phases)) errors.push('Missing "phases" array');
    else {
      for (const p of parsed.phases) {
        if (!p.id) errors.push(`Phase missing "id"`);
        if (!Array.isArray(p.componentIds)) errors.push(`Phase "${p.id || '?'}" missing "componentIds" array`);
      }
    }
    return { valid: errors.length === 0, errors, parsed, extracted: json };
  } catch (e) {
    errors.push(`Invalid JSON: ${e.message}`);
    return { valid: false, errors, parsed: null, extracted: json };
  }
}

/* ── Main Validate Function ──────────────────────────── */

export function validateComponent(type, result) {
  const validator = validators[type];
  if (!validator) return { valid: false, errors: [`No validator for type: ${type}`], extracted: result };
  return validator(result);
}
