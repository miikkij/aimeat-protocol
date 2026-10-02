/**
 * @file src/services/crew-llm-guard.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What an owner's model choice for an agent's crew may say: which environment variable
 *   the crew may send as its key, and which address it may send it to.
 *
 *   WHY. A `model` choice (`crews.llm.<agent>`, `crews.llm.default`) carries a provider block, and the
 *   crew runtime sends `os.getenv(provider.api_key_env)` as the bearer to `provider.base_url`
 *   (crewaimeat llm.py). A crew run inherits the environment of the machine it runs on. Until
 *   2026-10-02 the node checked neither field, so a saved choice could name AIMEAT_ENCRYPTION_KEY or
 *   DATABASE_URL and an address of the writer's choosing, and the next run sent that secret there.
 *   Found while designing the owner's own key for agents (Development note doc-muqrcqbt1fzx).
 *
 *   AN ALLOW-LIST, NOT A DENY-LIST (Jouni, 2026-10-02). A deny-list of the secrets we know misses the
 *   next one somebody adds to an environment; an allow-list does not. A key variable is a provider
 *   key: a name ending in _API_KEY that does not start with AIMEAT_, or one of the exact names the crew
 *   runtime's own provider map uses (EXACT_KEY_ENV_NAMES).
 *
 *   THE ADDRESS: https only, and no private, loopback or link-local address, decided by the same
 *   check every other outbound call of the node makes (utils/url-validator.ts validateOutboundUrl,
 *   which also resolves the name and refuses when any address it resolves to is private).
 *
 *   The node cannot see the crew's machine, so this decides only what the node stores. The crew
 *   runtime applies the same rules when it reads a choice, which also covers a record saved before
 *   this guard existed.
 * @structure KEY_ENV_RULE · EXACT_KEY_ENV_NAMES · keyEnvProblem() · crewAddressProblem() ·
 *   crewChoiceProblem()
 * @usage const problem = await crewChoiceProblem(choice.provider); if (problem) refuse(problem);
 * @version-history
 *   v1.0.0 — 2026-10-02 — Initial.
 */
import { validateOutboundUrl } from '../utils/url-validator.js';

/** In words, for every refusal: what a key variable may be. */
export const KEY_ENV_RULE =
  'api_key_env names a provider key variable: a name ending in _API_KEY that does not start with AIMEAT_ (for example OPENROUTER_API_KEY)';

/**
 * Key variable names the crew runtime's provider map uses that do not end in _API_KEY.
 * crewaimeat llm.py reads NVIDIA_KEY for its NVIDIA provider.
 */
export const EXACT_KEY_ENV_NAMES: readonly string[] = ['NVIDIA_KEY'];

const PROVIDER_KEY_ENV = /^[A-Z][A-Z0-9_]*_API_KEY$/;

/** Why `name` may not be sent as a crew's key, or null when it may. */
export function keyEnvProblem(name: unknown): string | null {
  if (typeof name !== 'string' || !name) return `${KEY_ENV_RULE}. Got an empty value.`;
  if (EXACT_KEY_ENV_NAMES.includes(name)) return null;
  if (PROVIDER_KEY_ENV.test(name) && !name.startsWith('AIMEAT_')) return null;
  return `${KEY_ENV_RULE}, or one of ${EXACT_KEY_ENV_NAMES.join(', ')}. "${name}" is not one.`;
}

/** Why a crew may not send its key to `url`, or null when it may. */
export async function crewAddressProblem(url: unknown): Promise<string | null> {
  if (typeof url !== 'string' || !URL.canParse(url)) return 'base_url is not an address.';
  if (new URL(url).protocol !== 'https:') return `base_url must be https: the crew sends its key there. Got ${new URL(url).protocol}`;
  const check = await validateOutboundUrl(url);
  return check.valid ? null : `base_url is refused: ${check.reason}. A crew may send its key only to a public https address.`;
}

/** The fields of a provider block that name an address the crew calls. */
const ADDRESS_FIELD = /^(base_?url|api_?base|endpoint|url)$/i;

/**
 * Why a `model` choice's provider block may not be stored, or null. Walks the whole block, the
 * entries under `models` included, so a field one level down is checked the same way.
 */
export async function crewChoiceProblem(provider: unknown, depth = 0): Promise<string | null> {
  if (depth > 4 || !provider || typeof provider !== 'object') return null;
  for (const [k, v] of Object.entries(provider as Record<string, unknown>)) {
    if (k === 'api_key_env' && v !== undefined && v !== null) {
      const problem = keyEnvProblem(v);
      if (problem) return problem;
    } else if (ADDRESS_FIELD.test(k) && typeof v === 'string' && v.trim()) {
      const problem = await crewAddressProblem(v.trim());
      if (problem) return problem;
    } else if (v && typeof v === 'object') {
      const problem = await crewChoiceProblem(v, depth + 1);
      if (problem) return problem;
    }
  }
  return null;
}
