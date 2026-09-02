/**
 * @file phaser/designer.js
 * @description The two designer panels of aimeat-phaser, as one door: fxDesigner tunes a particle
 *   preset beside the canvas and parallaxDesigner composes a backdrop stack, each through the same
 *   fx() and parallax() handles a game uses, and each writes the code a person pastes. The panels
 *   live in designer-fx.js and designer-parallax.js, on the controls in designer-parts.js, so no
 *   file here crosses the line cap; this module only re-exports them for index.js.
 * @structure re-exports: fxDesigner (designer-fx.js) · parallaxDesigner (designer-parallax.js)
 * @usage  import { fxDesigner, parallaxDesigner } from './designer.js';   // index.js
 *         const tools = AIMEAT.phaser.fxDesigner({ target: '#tools', fx: fx, scene: this });
 *         const stack = AIMEAT.phaser.parallaxDesigner({ target: '#tools', parallax: bg });
 * @version-history
 *   v1.2.0 — 2026-09-02 — Initial: fxDesigner and parallaxDesigner.
 */
export { fxDesigner } from './designer-fx.js';
export { parallaxDesigner } from './designer-parallax.js';
