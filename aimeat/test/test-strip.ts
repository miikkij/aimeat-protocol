import { readFileSync } from 'node:fs';
import { stripCodeblock } from '../src/services/llm-strip.js';

const raw = readFileSync('data/debug/generator/prj-mnhzlw4a-2k21l/components/cortex-data/test-raw-response.txt', 'utf8');
const stripped = stripCodeblock(raw);

console.log('Raw lines:', raw.split('\n').length);
console.log('Stripped lines:', stripped.split('\n').length);
console.log('First 5 lines:');
for (let i = 0; i < 5; i++) console.log(`  ${i}: "${stripped.split('\n')[i]}"`);
