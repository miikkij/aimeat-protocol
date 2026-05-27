/**
 * @file status.ts
 * @description CLI subcommand: show agent status
 */
import { AimeatClient } from '../lib/api-client.js';
import { loadConfig } from '../lib/config.js';

export async function runStatus(): Promise<void> {
  const config = loadConfig();
  if (!config) { console.log('Not configured. Run: npx @aimeat/connect'); return; }
  console.log(`Agent: ${config.agent}`);
  console.log(`Owner: ${config.owner}`);
  console.log(`Node:  ${config.node_url}`);

  try {
    const client = await AimeatClient.fromConfig();
    const resp = await client.get('/v1/wallet');
    if (resp.ok) {
      const wallet = resp.data as { balance?: number };
      console.log(`Balance: ${wallet.balance ?? 'unknown'} morsels`);
    }
    const me = await client.get('/v1/agents/me/inbox');
    console.log(`Status: ${me.ok ? 'Connected' : 'Token invalid'}`);
  } catch { console.log('Status: Not connected'); }
}
