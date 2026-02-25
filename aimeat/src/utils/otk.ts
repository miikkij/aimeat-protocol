import { randomBytes } from 'node:crypto';

export function generateOtk(): string {
  return `otk-${randomBytes(16).toString('hex')}`;
}
