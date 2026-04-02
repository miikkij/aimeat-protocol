// Compare browser prompts vs seed prompts line-by-line
const fs = require('fs');
const browser = fs.readFileSync('public/js/services/generator-prompts-build.js', 'utf8');
const seeds = fs.readFileSync('src/services/generator-prompt-seeds.ts', 'utf8');

function extractBetween(text, startMarker, endMarker) {
  const s = text.indexOf(startMarker);
  if (s === -1) return '';
  const e = text.indexOf(endMarker, s + startMarker.length);
  if (e === -1) return text.substring(s);
  return text.substring(s, e + endMarker.length);
}

// === INTERVIEW ===
console.log('════════════════════════════════════════════');
console.log('  INTERVIEW PROMPT COMPARISON');
console.log('════════════════════════════════════════════\n');

const startMark = 'You are a requirements analyst for the AIMEAT service generator.';
const endMark = 'Begin the interview now. Start by greeting the user and asking about their technical level.';

const bI = extractBetween(browser, startMark, endMark);
const sI = extractBetween(seeds, startMark, endMark);

// Normalize variable syntax differences
function norm(text) {
  return text
    .replace(/\$\{INSTRUCTION_DISCLAIMER\}/g, '{{disclaimer}}')
    .replace(/\$\{langInstruction\}/g, '{{language_instruction}}')
    .replace(/\$\{description\}/g, '{{description}}')
    .replace(/\$\{locale\}/g, '{{locale}}')
    .replace(/\\\\\`/g, 'BT')
    .replace(/\\\`/g, 'BT')
    .replace(/←/g, '--')
    .replace(/→/g, '->')
    .replace(/✓/g, 'Y')
    .replace(/✗/g, 'N');
}

const bLines = norm(bI).split('\n');
const sLines = norm(sI).split('\n');

console.log('Browser lines:', bLines.length);
console.log('Seed lines:', sLines.length);
console.log('');

let diffs = 0;
const maxLen = Math.max(bLines.length, sLines.length);
for (let i = 0; i < maxLen; i++) {
  const b = (bLines[i] || '').trimEnd();
  const s = (sLines[i] || '').trimEnd();
  if (b !== s) {
    diffs++;
    if (diffs <= 40) {
      console.log(`Line ${i+1}:`);
      console.log(`  BROWSER: ${b.substring(0, 150)}`);
      console.log(`  SEED:    ${s.substring(0, 150)}`);
      console.log('');
    }
  }
}
console.log(`INTERVIEW: ${diffs} differing lines out of ${maxLen}\n`);

// === BLUEPRINT ===
console.log('════════════════════════════════════════════');
console.log('  BLUEPRINT PROMPT COMPARISON');
console.log('════════════════════════════════════════════\n');

const bpStart = 'Analyze this request and produce a JSON blueprint listing ALL components needed.';
const bpEnd = 'Include testScenarios at the top level of the output JSON (alongside "components", "phases", "dataModel").';

const bB = extractBetween(browser, bpStart, bpEnd);
const sB = extractBetween(seeds, bpStart, bpEnd);

function normBp(text) {
  return text
    .replace(/\$\{INSTRUCTION_DISCLAIMER\}/g, '{{disclaimer}}')
    .replace(/\$\{AIMEAT_CONTEXT\}/g, '{{context}}')
    .replace(/\$\{specContext\}/g, '{{interview_spec_section}}')
    .replace(/\$\{langNote\}/g, '{{language_note}}')
    .replace(/\$\{cortexCatalog\}/g, '{{cortex_catalog}}')
    .replace(/\$\{description\}/g, '{{description}}')
    .replace(/\\\\\`/g, 'BT')
    .replace(/\\\`/g, 'BT')
    .replace(/←/g, '--')
    .replace(/→/g, '->');
}

const bbLines = normBp(bB).split('\n');
const sbLines = normBp(sB).split('\n');

console.log('Browser lines:', bbLines.length);
console.log('Seed lines:', sbLines.length);
console.log('');

let bpDiffs = 0;
const bpMax = Math.max(bbLines.length, sbLines.length);
for (let i = 0; i < bpMax; i++) {
  const b = (bbLines[i] || '').trimEnd();
  const s = (sbLines[i] || '').trimEnd();
  if (b !== s) {
    bpDiffs++;
    if (bpDiffs <= 40) {
      console.log(`Line ${i+1}:`);
      console.log(`  BROWSER: ${b.substring(0, 150)}`);
      console.log(`  SEED:    ${s.substring(0, 150)}`);
      console.log('');
    }
  }
}
console.log(`BLUEPRINT: ${bpDiffs} differing lines out of ${bpMax}\n`);
