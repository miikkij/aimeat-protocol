/**
 * @file src/services/prompt-defaults/shipped-hashes.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The hash of every default text each operator-owned managed prompt has shipped with,
 *   and the test the boot seeder runs against it.
 *
 *   WHY. A managed prompt is seeded into the database once, and a node keeps what it has. When a
 *   default text changes (the Email prompt on 2026-10-16), a node whose operator never touched the
 *   prompt should get the new text, and a node whose operator changed it should keep theirs. The
 *   seeder already follows a prompt whose newest version entry is a factory write of the stored
 *   text (prompt-seeder.ts), but that reads the version history, which a restore from a backup, a
 *   pruned history or a record from before version entries can leave without an answer. A stored
 *   text that is exactly one of the texts the software shipped is positive evidence that nobody
 *   changed it, whatever the history says (Jouni, decision 2026-10-16).
 *
 *   WHAT IS KEPT. A hash per text, never the text: the texts live once, in the seed files beside
 *   this one. The hash covers the content and the language versions a seed ships (`locales`), so a
 *   language text the operator wrote is a change. 32 hex characters of SHA-256.
 *
 *   THE LIST GROWS WITH EVERY TEXT CHANGE. Each list holds every text its prompt has shipped with,
 *   the current one last. test/unit/prompt-shipped-hashes.test.ts refuses a seed whose current text
 *   is not in its list, so a change to a default text cannot land without its hash, and the hash of
 *   the text it replaces is already there from when that text was current. The failing test prints
 *   the line to add. The first lists were read from every commit of the seed files in git history.
 *
 *   ONLY THE OPERATOR'S PROMPTS. A prompt the code owns (prompt-ownership.ts, kind 'code') is
 *   written from source at every start and needs no evidence; a prompt the software no longer ships
 *   is never touched. The test refuses an entry for either.
 * @structure SHIPPED_PROMPT_HASHES · promptTextHash() · isShippedDefaultText()
 * @usage
 *   if (isShippedDefaultText(record.id, record)) { ...the stored text is a shipped default... }
 * @version-history
 *   2026-11-25 — knowledge-packager-mcp's new text (the example manifest names sharing.toll_morsels) joins its list.
 *   2026-11-23 — home-ideas' new text (apps named by kind, none ready) joins its list.
 *   2026-11-22 — sixteen default prompt texts lose their picture words (carries, hands, lives in, node in a person's text) and join their lists.
 *   2026-11-22 — operator-welcome's new text (introduction page for welcome mat) joins its list.
 *   2026-11-15 — playbook-marketplace's new text (the same handler, not the same door) joins its list.
 *   2026-10-16 — Initial: the shipped default texts of the 21 operator-owned prompts, read from git
 *     history (Jouni, decision 2026-10-16).
 */
import { createHash } from 'node:crypto';
import { stableStringify } from '../../utils/stable-json.js';

/** Prompt id → the hash of every default text it has shipped with, oldest first, the current one last. */
export const SHIPPED_PROMPT_HASHES: Readonly<Record<string, readonly string[]>> = {
  'anonymous-share': ['560132d021d5cdccb6e20028deb5bead', 'b86e040ee505a471bddda34b7b535adb', 'c33b89a5ab4f4bc0a0c8c23b08060460'],
  'bootstrap-auth': [
    'f753abcf7fc1522d36499cf2e247593e', '1c15475fbbb35d999b17f3d420eb3c13', 'fe517cf86e55ec49a9546284b8efa5a0',
    '05f0357872c5b676a10ee69063379186', '9aec8cd47d4636262e1242d1d2e3fcf7',
  ],
  'chat-session-human': ['d8bd52a8075e386206425fd08164172e', '62c7bbf14ec6f91cca7da3c4ff08b0b2', '7db6701543086e0bdd4b43f2176e55d2', 'fa6e10f223609e1858407fc65e0491b4'],
  'chat-session-quick': ['6fc4a98f0ded81ae040f7fb975d407ce'],
  'contacts-mcp': ['6a8750d4088b5b053777be89ad9efbd6', '4a631fa71e66c5524058d579f7e17ec0'],
  'email-mcp': ['937cb7c16e1391cb965d3e8d8b111666', '508fa60f19bf5a426fcc22ef250e60df', '9eef971834b21ac3617abb5ba4afdc3e'],
  'home-ideas': ['3aaeceff89c6882bffd2e9463d6152ff', '2ed25706f48ba35340615e427172df52', 'b400f6c25dcae2e14a37c3cd860bce2a'],
  'knowledge-packager-agent': [
    '66fcce9b0063c71d77af4d31c608154f', 'e04f196617ee32f1c4f489716e1b5167', '9b0e6bd0f09590689ee50f7e68246326',
    '4af902ad40b86a6b26482d56bd4ff615', 'b42ea1e9d5e9920d137d04105cd7e68e',
  ],
  'knowledge-packager-human': [
    'df426150f52a53552936fc1b66060368', 'a2112b03b78eb5f938d9aff92d33a82e', '00b9926e57e380829f251f60c2f5694b',
    'c3fe82e2ec7c8ad24c73a1afc8cc9514', '66924560ffc336bec8aafaf9480fccef', '9cc73c1d011c9993a784d875b431ce8b',
  ],
  'knowledge-packager-mcp': ['d5c7f756b311be33a51ff8ab28f8d7dc', '0d7e58d5b0b0255067c119f27c1f39c9', 'e5305a86a22c539c3baa14a15e4edb67'],
  'operator-welcome': ['4a5d75e974259369a49a6e53b24e9801', '6b83bb1c6a497f6ac644dd7015f0a1c2', '5d1c5b8d161386ea42484d0462ff95a6'],
  'playbook-accounts': ['1b167c42a20e484cde35c5f59197a7b1', 'a127315fe2e92a121db5ac180113a88a'],
  'playbook-brain': ['d628640324f90480ef259aebe223926f', '5612b0f509d6fb990801e5e32a237e09'],
  'playbook-businesslauncher': ['ebf24182de5b4975db24ed9a2738ac97', 'd3213e7323e89648d754d792ac1384ee', '0d80ae37f42667ffb2ef8155c1cd2ac4'],
  'playbook-instance': ['69776c4a9e7fc67e9c6a9b45013a9009', '3ba951f90cd738f42254851df59f2542'],
  'playbook-marketplace': ['fa36bdbd6faf55811148fdae8835d465', '95b9f7e8d53f80cc2d637a4d3d46e88c', 'b551d0866982a6c551b08151b6421ea1', 'aef1dc666147a51dcb34ccf468f03e59', '2b4b26d7fe2e8c75d6b31274f47dcce1'],
  'playbook-page': ['295bf8ffca739d687276b684196cccb0', 'cca8cd0beeb5eb8c29d553c9a7db4767'],
  'proactive-guidance': ['145e4bbc79c220bfcc3b938c6d97c40a', '8890de5a37aae6823c1d76324e7a09ac'],
  'workflow-create-chat': ['4df9895af83223e5cf5bb5cbbb4e499d', 'f44f6546c7b840747fb9e4be630974b3', 'f214f7be41ab6b6ad5c83cddfc8772a8'],
  'workflow-create-mcp': ['74ad90d51621e71b19165ac0ce74a563', '011718a48edd5e0ad7a182d2c8ae9ae1', 'e3462e572bbc8b969941a2442040c5aa'],
  'workflow-improve-mcp': ['9e4d3ce590a8a67604df66e4c68bd9b1', '38df427811428cb7cb9c5e421d404472', '0a33c5ce2cd38d843f01cfe774519cc5'],
};

/** The text a hash is taken of: the content, and the language versions that hold any text. */
export interface PromptText {
  content: string;
  locales?: Record<string, string> | null;
}

/** 32 hex characters of the SHA-256 of a prompt's content and its non-empty language versions. */
export function promptTextHash(text: PromptText): string {
  const locales = Object.fromEntries(
    Object.entries(text.locales ?? {}).filter(([, v]) => typeof v === 'string' && v.length > 0),
  );
  const body = Object.keys(locales).length > 0 ? `${text.content}\n\u0000${stableStringify(locales)}` : text.content;
  return createHash('sha256').update(body, 'utf8').digest('hex').slice(0, 32);
}

/** Whether `text` is exactly one of the default texts the prompt `id` has shipped with. */
export function isShippedDefaultText(
  id: string, text: PromptText, hashes: Readonly<Record<string, readonly string[]>> = SHIPPED_PROMPT_HASHES,
): boolean {
  const list = hashes[id];
  return !!list && list.includes(promptTextHash(text));
}
