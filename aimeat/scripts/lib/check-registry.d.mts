export interface Check { script: string; label: string; slow?: boolean }
export const FAST_CHECKS: Check[];
export const AUDIT_CHECKS: Check[];
