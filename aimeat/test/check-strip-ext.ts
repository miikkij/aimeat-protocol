import { readFileSync } from 'node:fs';
import { stripCodeblock } from '../src/services/generator-prompts/strip.js';
import { validateComponent } from '../src/services/generator-prompts/validate.js';

const raw = readFileSync('data/debug/generator/prj-mnghbw4x-2anlt/components/ext-1/ai-raw-response.txt', 'utf8');
const stripped = stripCodeblock(raw);
console.log('Has fences:', stripped.includes('```'));
console.log('Starts with metadata:', stripped.startsWith('metadata:'));
console.log('Has action markers:', /^\/\/ actions\//m.test(stripped));

// Validate
const vr = validateComponent('extension', stripped, null as any);
console.log('Valid:', vr.valid);
if (!vr.valid) {
  console.log('Errors:');
  for (const e of vr.errors) console.log('  -', e);
}

// Check action extraction (registration path)
const actionMarkerRegex = /^\/\/\s*actions\/([\w-]+\.js)\s*$/gm;
const markers: Array<{ name: string }> = [];
let um: RegExpExecArray | null;
while ((um = actionMarkerRegex.exec(stripped)) !== null) {
  markers.push({ name: um[1]! });
}
console.log('Action scripts found:', markers.length, markers.map(m => m.name).join(', '));

// Check YAML parsing (registration uses this)
const jsStart = stripped.search(/^\/\/\s*actions\//m);
const manifestYaml = jsStart > 0 ? stripped.slice(0, jsStart).trim() : stripped.trim();
try {
  const { parseDocument } = await import('yaml');
  const doc = parseDocument(manifestYaml);
  if (doc.errors.length > 0) {
    console.log('YAML errors:', doc.errors.map(e => e.message).join('; '));
  } else {
    const parsed = doc.toJSON() as Record<string, unknown>;
    console.log('YAML parsed OK, name:', (parsed.metadata as any)?.name);
    console.log('Actions count:', ((parsed.actions as any[]) || []).length);
  }
} catch (e) {
  console.log('YAML parse FAILED:', (e as Error).message);
}
