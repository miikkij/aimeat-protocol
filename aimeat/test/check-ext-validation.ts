import { readFileSync } from 'node:fs';
import { validateComponent } from '../src/services/generator-prompts/validate.js';

const content = readFileSync('data/debug/generator/prj-mngacwdf-bn406/components/ext-1/generated.txt', 'utf8');
process.stdout.write('File length: ' + content.length + '\n');

const result = validateComponent('extension', content, null as any);
process.stdout.write('Valid: ' + result.valid + '\n');
process.stdout.write('Error count: ' + result.errors.length + '\n');
for (const e of result.errors) {
  process.stdout.write('ERR: ' + e + '\n');
}
