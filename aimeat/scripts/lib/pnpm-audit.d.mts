export interface PnpmAuditResult {
  ok: boolean;
  status: 'clean' | 'findings' | 'error';
  error?: string;
  counts: Record<string, number> | null;
  total: number | null;
  advisories: Array<Record<string, string>>;
}
export function parsePnpmAudit(raw: string, exitCode: number | null): PnpmAuditResult;
