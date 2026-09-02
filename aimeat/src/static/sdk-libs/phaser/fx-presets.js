/**
 * @file phaser/fx-presets.js
 * @description The particle presets fx.js draws, as data. Seventeen named effects, each one a
 *   shape, a list of theme colour words and up to three FAMILIES: at (a one-shot burst that ends
 *   on its own), weather (a full-camera layer that runs until stopped) and follow (a standing
 *   emitter attached to a game object). A preset that lacks a family cannot be asked for it, and
 *   fx.js answers null rather than guessing.
 *
 *   NO COLOUR IS WRITTEN HERE. colours holds token WORDS (accent, ink, inkDim, ok, warn, err,
 *   ch1 to ch4 and the rest boot.js exposes), and fx.js turns each word into the theme's number
 *   when the texture is drawn, so the whole set re-tones with the page's palette and mode. Snow,
 *   fog, smoke and dust are drawn in inkDim, the one grey that reads on a light ground and on a
 *   dark one; a game with a night sky passes colour: 'surface' and gets white.
 *
 *   EVERY NUMBER HERE IS PHASER'S OWN. config is handed to the emitter as it is, after fx.js has
 *   added the texture, the frames, the zones and the flow. angle is in degrees with 0 pointing
 *   right and negative values pointing up; speed is radial (with angle) and speedX/speedY are
 *   directional; lifespan is milliseconds; rotate is degrees.
 *
 *   life is the longest a particle of that family can live, and it is what decides when a stopped
 *   emitter is taken down. Keep it equal to the largest lifespan in the config, plus nothing.
 * @structure PRESETS (rain, snow, fog, smoke, fire, embers, sparks, dust, bubbles, stars, leaves,
 *   confetti, explosion, portal, trail, splash, footsteps) · ALIASES (mist, magic)
 * @usage  import { PRESETS, ALIASES } from './fx-presets.js';   // read by fx.js only
 * @version-history
 *   v1.2.0 — 2026-09-02 — Initial: the seventeen presets and the two aliases.
 */

/**
 * @typedef {object} FxBurst
 * @property {number} count   particles per burst, before the caller's own count
 * @property {number} life    the longest lifespan in config, in ms
 * @property {number} [ring]  emit on a ring of this radius around the point instead of at it
 * @property {any} config     the emitter config, minus texture, frame and emitting
 */

/**
 * @typedef {object} FxWeather
 * @property {'top'|'bottom'|'all'} zone  where particles are born: a band above the view, a band
 *   below it, or anywhere inside it
 * @property {number} rate    particles per second across a 960 px wide view at density 1
 * @property {number} life    the longest lifespan in config, in ms
 * @property {number} [wind]  the default sideways drift in px/s; the caller's wind replaces it
 * @property {number} [sway]  the random spread around the wind, in px/s. Its presence marks the
 *   preset as directional: speedX is rebuilt from wind and sway, and speedY is left alone
 * @property {boolean} [align]  turn each particle to face its own direction of travel (rain)
 * @property {any} config
 */

/**
 * @typedef {object} FxFollow
 * @property {number} life    the longest lifespan in config, in ms
 * @property {boolean} [behind]  draw one depth step under the followed object (a trail) rather
 *   than one step over it (a flame)
 * @property {number} [ring]  emit on a ring of this radius around the object
 * @property {any} config     includes frequency (ms between emissions) and quantity
 */

/**
 * @typedef {object} FxPreset
 * @property {'dot'|'chip'|'spark'|'drop'|'flake'|'puff'|'ring'|'star'|'leaf'|'bubble'|'print'} [shape]
 *   the generated texture. Absent when texture names the app's own.
 * @property {string[]} [colours]  theme colour words, one frame each; a particle picks one at random
 * @property {string} [texture]    an app's own texture key, used instead of a generated shape
 * @property {string|string[]|number|number[]} [frame]  frames of that texture, when it has several
 * @property {FxBurst} [at]
 * @property {FxWeather} [weather]
 * @property {FxFollow} [follow]
 */

/** @type {Record<string, FxPreset>} */
export const PRESETS = {
  rain: {
    shape: 'drop', colours: ['ch1'],
    weather: {
      zone: 'top', rate: 140, life: 2400, wind: 0, sway: 20, align: true,
      config: {
        speedY: { min: 640, max: 880 }, lifespan: { min: 1600, max: 2400 },
        alpha: { min: 0.35, max: 0.8 }, scale: { min: 0.8, max: 1.2 },
      },
    },
    at: {
      count: 14, life: 700,
      config: {
        speedX: { min: -60, max: 60 }, speedY: { min: 300, max: 520 }, gravityY: 500,
        lifespan: { min: 400, max: 700 }, alpha: { start: 0.8, end: 0 }, scale: { min: 0.7, max: 1 },
      },
    },
  },

  snow: {
    shape: 'flake', colours: ['inkDim'],
    weather: {
      zone: 'top', rate: 36, life: 9000, wind: 0, sway: 18,
      config: {
        speedY: { min: 40, max: 90 }, lifespan: { min: 6000, max: 9000 },
        alpha: { min: 0.5, max: 0.95 }, scale: { min: 0.6, max: 1.4 },
      },
    },
    at: {
      count: 10, life: 1400,
      config: {
        speed: { min: 20, max: 70 }, angle: { min: 0, max: 360 }, gravityY: 30,
        lifespan: { min: 800, max: 1400 }, alpha: { start: 0.9, end: 0 }, scale: { min: 0.6, max: 1.2 },
      },
    },
  },

  fog: {
    shape: 'puff', colours: ['inkDim'],
    weather: {
      zone: 'all', rate: 5, life: 9000, wind: 12, sway: 6,
      config: {
        speedY: { min: -4, max: 4 }, lifespan: { min: 6000, max: 9000 },
        alpha: { values: [0, 0.5, 0.5, 0], interpolation: 'linear' }, scale: { min: 1.6, max: 3.2 },
      },
    },
    at: {
      count: 6, life: 1800,
      config: {
        speed: { min: 6, max: 24 }, angle: { min: 0, max: 360 },
        lifespan: { min: 1200, max: 1800 }, alpha: { start: 0.5, end: 0 }, scale: { start: 1, end: 2.4 },
      },
    },
  },

  smoke: {
    shape: 'puff', colours: ['inkDim'],
    follow: {
      life: 1800,
      config: {
        frequency: 90, quantity: 1, speedX: { min: -14, max: 14 }, speedY: { min: -70, max: -30 },
        lifespan: { min: 1200, max: 1800 }, alpha: { start: 0.55, end: 0 }, scale: { start: 0.5, end: 1.6 },
      },
    },
    at: {
      count: 8, life: 1400,
      config: {
        speed: { min: 10, max: 50 }, angle: { min: -120, max: -60 }, gravityY: -30,
        lifespan: { min: 900, max: 1400 }, alpha: { start: 0.6, end: 0 }, scale: { start: 0.6, end: 1.8 },
      },
    },
  },

  fire: {
    shape: 'dot', colours: ['warn', 'err', 'ch3'],
    follow: {
      life: 700,
      config: {
        frequency: 28, quantity: 2, speedX: { min: -18, max: 18 }, speedY: { min: -120, max: -60 },
        gravityY: -60, lifespan: { min: 400, max: 700 },
        scale: { start: 1.4, end: 0 }, alpha: { start: 0.95, end: 0 },
      },
    },
    at: {
      count: 18, life: 700,
      config: {
        speed: { min: 40, max: 160 }, angle: { min: -130, max: -50 }, gravityY: -80,
        lifespan: { min: 400, max: 700 }, scale: { start: 1.4, end: 0 }, alpha: { start: 1, end: 0 },
      },
    },
  },

  embers: {
    shape: 'flake', colours: ['warn', 'ch3'],
    weather: {
      zone: 'bottom', rate: 10, life: 7000, wind: 8, sway: 14,
      config: {
        speedY: { min: -70, max: -25 }, accelerationY: -6, lifespan: { min: 4000, max: 7000 },
        alpha: { start: 0.9, end: 0, ease: 'Sine.easeIn' }, scale: { min: 0.6, max: 1.2 },
      },
    },
    follow: {
      life: 1600,
      config: {
        frequency: 120, quantity: 1, speedX: { min: -30, max: 30 }, speedY: { min: -80, max: -30 },
        lifespan: { min: 900, max: 1600 }, alpha: { start: 1, end: 0 }, scale: { start: 1, end: 0.3 },
      },
    },
    at: {
      count: 12, life: 1400,
      config: {
        speed: { min: 30, max: 120 }, angle: { min: -150, max: -30 }, gravityY: -40,
        lifespan: { min: 800, max: 1400 }, alpha: { start: 1, end: 0 }, scale: { start: 1, end: 0.2 },
      },
    },
  },

  sparks: {
    shape: 'spark', colours: ['accent', 'ch3'],
    at: {
      count: 16, life: 420,
      config: {
        speed: { min: 120, max: 360 }, angle: { min: 0, max: 360 }, gravityY: 300,
        lifespan: { min: 220, max: 420 }, rotate: { min: -180, max: 180 }, scale: { start: 1, end: 0 },
      },
    },
    follow: {
      life: 500,
      config: {
        frequency: 40, quantity: 2, speed: { min: 80, max: 240 }, angle: { min: -170, max: -10 },
        gravityY: 400, lifespan: { min: 250, max: 500 }, rotate: { min: -180, max: 180 },
        scale: { start: 1, end: 0 },
      },
    },
  },

  dust: {
    shape: 'dot', colours: ['inkDim'],
    weather: {
      zone: 'all', rate: 6, life: 8000, wind: 4, sway: 8,
      config: {
        speedY: { min: -6, max: 6 }, lifespan: { min: 5000, max: 8000 },
        alpha: { values: [0, 0.6, 0], interpolation: 'linear' }, scale: { min: 0.25, max: 0.6 },
      },
    },
    at: {
      count: 8, life: 460,
      config: {
        speed: { min: 20, max: 80 }, angle: { min: 190, max: 350 }, gravityY: 40,
        lifespan: { min: 300, max: 460 }, scale: { start: 0.9, end: 0.1 }, alpha: { start: 0.55, end: 0 },
      },
    },
    follow: {
      life: 500, behind: true,
      config: {
        frequency: 70, quantity: 1, speed: { min: 10, max: 40 }, angle: { min: -160, max: -20 },
        lifespan: { min: 300, max: 500 }, scale: { start: 0.8, end: 0.1 }, alpha: { start: 0.5, end: 0 },
      },
    },
  },

  bubbles: {
    shape: 'bubble', colours: ['ch1'],
    follow: {
      life: 2200,
      config: {
        frequency: 160, quantity: 1, speedX: { min: -12, max: 12 }, speedY: { min: -70, max: -35 },
        lifespan: { min: 1400, max: 2200 }, scale: { start: 0.5, end: 1.1 }, alpha: { start: 0.9, end: 0 },
      },
    },
    weather: {
      zone: 'bottom', rate: 8, life: 9000, wind: 0, sway: 10,
      config: {
        speedY: { min: -60, max: -25 }, lifespan: { min: 6000, max: 9000 },
        scale: { min: 0.5, max: 1.3 }, alpha: { min: 0.4, max: 0.9 },
      },
    },
    at: {
      count: 10, life: 1200,
      config: {
        speed: { min: 20, max: 70 }, angle: { min: -140, max: -40 }, gravityY: -50,
        lifespan: { min: 700, max: 1200 }, scale: { start: 0.6, end: 1.1 }, alpha: { start: 0.9, end: 0 },
      },
    },
  },

  stars: {
    shape: 'star', colours: ['ch3', 'ink'],
    weather: {
      zone: 'all', rate: 7, life: 2600,
      config: {
        speedX: 0, speedY: 0, lifespan: { min: 1200, max: 2600 },
        alpha: { values: [0, 1, 0], interpolation: 'linear' }, scale: { min: 0.5, max: 1.2 },
        rotate: { min: 0, max: 90 },
      },
    },
    at: {
      count: 12, life: 900,
      config: {
        speed: { min: 10, max: 60 }, angle: { min: 0, max: 360 }, lifespan: { min: 500, max: 900 },
        alpha: { start: 1, end: 0 }, scale: { start: 1.2, end: 0.2 }, rotate: { min: -90, max: 90 },
      },
    },
  },

  leaves: {
    shape: 'leaf', colours: ['ok', 'warn'],
    weather: {
      zone: 'top', rate: 8, life: 9000, wind: 25, sway: 30,
      config: {
        speedY: { min: 45, max: 110 }, lifespan: { min: 5000, max: 9000 },
        rotate: { min: -180, max: 180 }, scale: { min: 0.7, max: 1.3 }, alpha: { min: 0.7, max: 1 },
      },
    },
    at: {
      count: 10, life: 1600,
      config: {
        speed: { min: 40, max: 140 }, angle: { min: -170, max: -10 }, gravityY: 90,
        lifespan: { min: 1000, max: 1600 }, rotate: { min: -180, max: 180 },
        alpha: { start: 1, end: 0.3 }, scale: { min: 0.7, max: 1.2 },
      },
    },
  },

  confetti: {
    shape: 'chip', colours: ['ch1', 'ch2', 'ch3', 'ch4'],
    at: {
      count: 22, life: 1000,
      config: {
        speed: { min: 140, max: 320 }, angle: { min: -160, max: -20 }, gravityY: 430,
        lifespan: { min: 640, max: 1000 }, rotate: { min: -180, max: 180 },
        scale: { start: 1, end: 0.7 }, alpha: { start: 1, end: 0.2 },
      },
    },
    weather: {
      zone: 'top', rate: 20, life: 6000, wind: 0, sway: 40,
      config: {
        speedY: { min: 80, max: 200 }, lifespan: { min: 4000, max: 6000 },
        rotate: { min: -180, max: 180 }, scale: { min: 0.7, max: 1.2 },
      },
    },
  },

  explosion: {
    shape: 'dot', colours: ['err', 'warn', 'ch3'],
    at: {
      count: 32, life: 800,
      config: {
        speed: { min: 80, max: 420 }, angle: { min: 0, max: 360 }, gravityY: 120,
        lifespan: { min: 300, max: 800 }, scale: { start: 1.8, end: 0 }, alpha: { start: 1, end: 0 },
      },
    },
  },

  portal: {
    shape: 'flake', colours: ['accent', 'ch2'],
    at: {
      count: 26, life: 1000, ring: 28,
      config: {
        speed: { min: 20, max: 60 }, angle: { min: 0, max: 360 }, gravityY: -80,
        lifespan: { min: 600, max: 1000 }, alpha: { start: 1, end: 0 }, scale: { start: 1, end: 0.2 },
      },
    },
    follow: {
      life: 900, ring: 22,
      config: {
        frequency: 50, quantity: 1, speed: { min: 5, max: 20 }, angle: { min: 0, max: 360 },
        gravityY: -40, lifespan: { min: 500, max: 900 }, alpha: { start: 1, end: 0 },
        scale: { start: 1, end: 0.2 },
      },
    },
  },

  trail: {
    shape: 'dot', colours: ['accent'],
    follow: {
      life: 420, behind: true,
      config: {
        frequency: 24, quantity: 1, speed: 0, lifespan: { min: 260, max: 420 },
        alpha: { start: 0.6, end: 0 }, scale: { start: 1, end: 0.2 },
      },
    },
  },

  splash: {
    shape: 'flake', colours: ['ch1'],
    at: {
      count: 16, life: 700,
      config: {
        speed: { min: 90, max: 260 }, angle: { min: -150, max: -30 }, gravityY: 600,
        lifespan: { min: 400, max: 700 }, scale: { start: 1, end: 0.4 }, alpha: { start: 0.95, end: 0.2 },
      },
    },
  },

  footsteps: {
    shape: 'print', colours: ['inkDim'],
    at: {
      count: 1, life: 900,
      config: { speed: 0, lifespan: 900, alpha: { start: 0.45, end: 0 } },
    },
    follow: {
      life: 1200, behind: true,
      config: { frequency: 260, quantity: 1, speed: 0, lifespan: 1200, alpha: { start: 0.45, end: 0 } },
    },
  },
};

/** A second name for a preset, so both words a builder might reach for land on the same effect. */
export const ALIASES = { mist: 'fog', magic: 'portal' };
