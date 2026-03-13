import { URL } from 'node:url';
import { lookup } from 'node:dns/promises';

const BLOCKED_RANGES = [
  /^127\./,           // Loopback
  /^10\./,            // Private class A
  /^172\.(1[6-9]|2\d|3[01])\./,  // Private class B
  /^192\.168\./,      // Private class C
  /^169\.254\./,      // Link-local / cloud metadata
  /^0\./,             // Current network
  /^::1$/,            // IPv6 loopback
  /^fc00:/i,          // IPv6 unique local
  /^fe80:/i,          // IPv6 link-local
];

export async function validateOutboundUrl(urlStr: string): Promise<{ valid: boolean; reason?: string }> {
  let parsed: URL;
  try {
    parsed = new URL(urlStr);
  } catch {
    return { valid: false, reason: 'Invalid URL format' };
  }

  // Only allow http/https
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { valid: false, reason: `Protocol ${parsed.protocol} not allowed` };
  }

  // In dev mode, allow loopback for local webhook/hook testing
  const devMode = process.env.AIMEAT_DEV_MODE === 'true';
  const hostname = parsed.hostname.toLowerCase();

  if (devMode && (hostname === 'localhost' || hostname === '::1' || /^127\./.test(hostname))) {
    return { valid: true };
  }

  // Block localhost hostnames
  if (hostname === 'localhost' || hostname === '::1') {
    return { valid: false, reason: 'Localhost not allowed' };
  }

  // Check IP against blocked ranges
  for (const range of BLOCKED_RANGES) {
    if (range.test(hostname)) {
      return { valid: false, reason: 'Private/reserved IP not allowed' };
    }
  }

  // DNS resolution check (prevent DNS rebinding)
  try {
    const { address } = await lookup(hostname);
    for (const range of BLOCKED_RANGES) {
      if (range.test(address)) {
        return { valid: false, reason: 'Resolved IP is private/reserved' };
      }
    }
  } catch {
    return { valid: false, reason: 'DNS resolution failed' };
  }

  return { valid: true };
}
