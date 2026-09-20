/**
 * @file src/services/build-atelier-book.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Part `libraries` of the Atelier specification, with the Design Book's map in it.
 *
 *   The specification told a builder to search the Book before composing, and three measured
 *   builds searched it in none. A search is a call a build can finish without. So the list of what
 *   the Book holds arrives WITH the part every builder is told to read before it writes code, and
 *   nothing has to be called to see it.
 *
 *   JOINED WHEN THE PART IS SERVED, never inside the composed specification: the spec token is a
 *   digest of that text, and a map inside it would change the token every time a part is
 *   published, refusing the publish of every build that was under way.
 * @structure atelierPieceWithBook(full, id, config, storage)
 * @usage const piece = await atelierPieceWithBook(full, id, config, storage);
 * @version-history
 *   v1.0.0 — 2026-09-19 — Initial.
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { atelierPiece, type AtelierPiece } from './build-atelier-layers.js';
import { DesignBookService } from './design-book/service.js';

export async function atelierPieceWithBook(
  full: string, id: string, config: AimeatConfig, storage: Storage,
): Promise<AtelierPiece | null> {
  const piece = atelierPiece(full, id, config.baseUrl);
  // Part `book` since 2026-09-20; it rode in `libraries` for a day, until the Book's own text
  // (the mosaic inside a genre, components, the build notes) needed a part of its own.
  if (!piece || piece.id !== 'book') return piece;
  const { map, count } = await new DesignBookService(storage, config).map();
  // An empty shelf has nothing to list, and the part still says how to propose the first one.
  return count ? { id: piece.id, text: piece.text + '\n' + map } : piece;
}
