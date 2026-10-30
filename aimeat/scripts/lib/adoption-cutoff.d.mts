export const CUTOFF_FILE: string;
export const CUTOFF_PATH: string;
export function readAdoptionCutoff(text: string): string | null;
export function stampAdoptionCutoff(text: string, when: number | string | Date): { text: string; changed: boolean };
export function stampAdoptionCutoffFile(when?: number | string | Date, file?: string): { cutoff: string | null; changed: boolean };
