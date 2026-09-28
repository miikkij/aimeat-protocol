/**
 * @file src/data/atelier-motions.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The motion recipes the Design Book seeds: three spring hands an app can take in
 *   one adopt, so a builder picks how the controls feel (snappy, soft, heavy) instead of tuning
 *   three numbers. Each is a `motion` part body, benched like any proposal at boot
 *   (design-book/lifecycle.ts), and the numbers sit inside SPRING_BOUNDS.
 *
 *   The damping ratio is what a person feels as overshoot: snappy and heavy stay under one
 *   percent past the target, soft passes it by about five and comes back. None of them bounces.
 * @structure MOTION_RECIPES
 * @usage
 *   import { MOTION_RECIPES } from '../../data/atelier-motions.js';
 * @version-history
 *   v1.0.0 — 2026-09-28 — Initial (the ten motion parts).
 */

export interface AtelierMotionRecipe {
  id: string;
  title: string;
  summary: string;
  tokens: Record<string, string>;
}

export const MOTION_RECIPES: readonly AtelierMotionRecipe[] = [
  {
    id: 'motion-spring-snappy',
    title: 'Snappy spring',
    summary: 'Controls answer at once and land without a swing: the tab ink, the switch and the menus arrive quickly and stop dead. For tools used all day.',
    tokens: { '--ak-spring-stiffness': '320', '--ak-spring-damping': '30', '--ak-spring-mass': '1', '--ak-motion': '140ms' },
  },
  {
    id: 'motion-spring-soft',
    title: 'Soft spring',
    summary: 'Controls travel a little further than they need and settle back, a small overshoot the eye reads as friendly. For consumer apps and anything playful.',
    tokens: { '--ak-spring-stiffness': '170', '--ak-spring-damping': '18', '--ak-spring-mass': '1', '--ak-motion': '220ms' },
  },
  {
    id: 'motion-spring-heavy',
    title: 'Heavy spring',
    summary: 'Controls move with weight: slower to start and slower to stop, with no swing. For calm, editorial and premium registers.',
    tokens: { '--ak-spring-stiffness': '140', '--ak-spring-damping': '26', '--ak-spring-mass': '1.6', '--ak-motion': '280ms' },
  },
];
