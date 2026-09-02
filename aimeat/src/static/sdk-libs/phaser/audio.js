/**
 * @file phaser/audio.js
 * @description The sound bus a game actually needs: one master level, a music channel and an
 *   effects channel a person can set apart, a mute, a crossfade between tracks, and a small
 *   synthesiser for the games that ship no audio files at all.
 *
 *   THE BROWSER'S LOCK IS HONOURED, NOT WORKED AROUND. Until someone has clicked, tapped or
 *   typed, a page may not make a sound, and a bus that queues everything up for later is worse
 *   than one that says no: the person comes back to a burst of noise they did not ask for.
 *   play() returns false while the lock is on, unlock() is what a gesture handler calls, and
 *   onUnlock() is how the interface finds out it may now offer sound.
 *
 *   NOTHING LOOPS BUT MUSIC THE APP ASKED TO LOOP. A fade is a finite ramp that ends and stops
 *   asking for frames; a synth voice schedules its own stop; destroy() takes down everything
 *   still running.
 *
 *   VOLUMES ARE NOT PERSISTED HERE. settings() hands them out and apply() takes them back, and
 *   where they are kept between visits is the app's business (saves() keeps them in the player's
 *   own record) — a library that wrote to storage on its own would be writing under someone
 *   else's name.
 * @structure audio(game, opts) → bus { master · music · sfx · mute · play · playMusic ·
 *   stopMusic · synth · unlocked · onUnlock · unlock · settings · apply · destroy }
 * @usage
 *   const bus = audio(handle.game, { music: 0.5 });
 *   scene.input.once('pointerdown', () => bus.unlock());
 *   bus.synth('coin');
 *   bus.playMusic('theme', { loop: true, fade: 800 });
 * @version-history
 *   v1.0.0 — 2026-09-02 — Initial: the two channels, the crossfade, the synth voices and the
 *     unlock handling.
 */

/**
 * @param {number} v
 * @returns {number} the same number held inside 0..1
 */
function clamp01(v) {
  const n = typeof v === 'number' && isFinite(v) ? v : 0;
  return Math.max(0, Math.min(1, n));
}

/**
 * The synth voices, as a frequency and a length per step. A voice is one or a few short steps;
 * `gain` is the voice's own weight, so a hit does not arrive twice as loud as a select.
 * Frequencies are in hertz and lengths in seconds.
 */
const VOICES = {
  beep: { type: 'square', gain: 0.18, steps: [[660, 0.09]] },
  jump: { type: 'square', gain: 0.2, steps: [[320, 0.06], [640, 0.1]] },
  coin: { type: 'square', gain: 0.16, steps: [[880, 0.05], [1320, 0.12]] },
  hit: { type: 'sawtooth', gain: 0.22, steps: [[180, 0.14]] },
  select: { type: 'triangle', gain: 0.15, steps: [[520, 0.05], [780, 0.06]] },
  win: { type: 'triangle', gain: 0.18, steps: [[523, 0.1], [659, 0.1], [784, 0.2]] },
};

/** The quietest a ramp may aim for: an exponential ramp cannot reach zero. */
const SILENCE = 0.0001;

/**
 * @typedef {object} AudioSettings
 * @property {number} master  0..1
 * @property {number} music   0..1
 * @property {number} sfx     0..1
 * @property {boolean} muted
 */

/**
 * The sound bus for one game.
 * @param {any} game  the Phaser.Game (handle.game)
 * @param {{ master?: number, music?: number, sfx?: number, muted?: boolean }} [opts]  the levels
 *   to start at. Default: master 1, music 0.6, effects 1, not muted.
 * @returns {any} the bus
 */
export function audio(game, opts) {
  const o = opts || {};
  const state = {
    master: o.master != null ? clamp01(o.master) : 1,
    music: o.music != null ? clamp01(o.music) : 0.6,
    sfx: o.sfx != null ? clamp01(o.sfx) : 1,
    muted: !!o.muted,
  };

  /** Every ramp still running, so destroy() can end all of them. */
  const ramps = new Set();
  /** The track playing now, if any. */
  let current = null;
  /** Every music sound this bus made, including one fading out. */
  const tracks = new Set();
  let gone = false;

  game.sound.volume = state.master;
  game.sound.mute = state.muted;

  /**
   * Move a sound's volume from where it is to where it should be, over a finite number of
   * frames, and then stop asking for frames.
   * @param {any} sound
   * @param {number} to
   * @param {number} ms
   * @param {() => void} [done]
   * @returns {void}
   */
  function ramp(sound, to, ms, done) {
    const from = typeof sound.volume === 'number' ? sound.volume : 0;
    if (!ms || ms <= 0 || typeof requestAnimationFrame !== 'function') {
      sound.setVolume(to);
      if (done) done();
      return;
    }
    const started = performance.now();
    const stop = { cancelled: false };
    ramps.add(stop);
    const tick = function (now) {
      if (stop.cancelled || gone) { ramps.delete(stop); return; }
      const p = Math.min(1, (now - started) / ms);
      sound.setVolume(from + (to - from) * p);
      if (p < 1) { requestAnimationFrame(tick); return; }
      ramps.delete(stop);
      if (done) done();
    };
    requestAnimationFrame(tick);
  }

  /**
   * @param {any} sound
   * @param {number} fade
   */
  function retire(sound, fade) {
    ramp(sound, 0, fade, function () {
      sound.stop();
      sound.destroy();
      tracks.delete(sound);
    });
  }

  /**
   * @param {string} key
   * @returns {boolean} is this key in the audio cache?
   */
  function known(key) {
    return !!(game.cache && game.cache.audio && game.cache.audio.exists(key));
  }

  const bus = {
    /**
     * The master level, which is Phaser's own game volume. Called with no argument it reports.
     * @param {number} [v] 0..1
     * @returns {number}
     */
    master(v) {
      if (v != null) {
        state.master = clamp01(v);
        game.sound.volume = state.master;
      }
      return state.master;
    },

    /**
     * The music channel. Setting it moves the track that is playing; a track fading out is left
     * to finish its fade, because catching it mid-fade would make the change audible as a jump.
     * @param {number} [v] 0..1
     * @returns {number}
     */
    music(v) {
      if (v != null) {
        state.music = clamp01(v);
        if (current && current.isPlaying) current.setVolume(state.music);
      }
      return state.music;
    },

    /**
     * The effects channel. It applies to every play() from here on; a sound already ringing keeps
     * the level it started at.
     * @param {number} [v] 0..1
     * @returns {number}
     */
    sfx(v) {
      if (v != null) state.sfx = clamp01(v);
      return state.sfx;
    },

    /**
     * @param {boolean} [on]
     * @returns {boolean} whether the game is muted now
     */
    mute(on) {
      if (on != null) {
        state.muted = !!on;
        game.sound.mute = state.muted;
      }
      return state.muted;
    },

    /**
     * Play one effect, on the effects channel. Returns false rather than queueing when the
     * browser has not been unlocked yet, or when nothing loaded under that key.
     * @param {string} key
     * @param {any} [options]  a Phaser sound config; `volume` here is a multiplier on the channel
     * @returns {boolean}
     */
    play(key, options) {
      if (gone || game.sound.locked) return false;
      if (!known(key)) {
        console.warn('[aimeat-phaser] no sound is loaded under "' + key + '", so nothing played.');
        return false;
      }
      const p = options || {};
      /** @type {any} */
      const config = {};
      for (const name in p) config[name] = p[name];
      config.volume = clamp01(state.sfx * (p.volume != null ? p.volume : 1));
      return game.sound.play(key, config) !== false;
    },

    /**
     * Play a music track, crossfading out of whatever was playing. The new track comes up from
     * silence and the old one goes down to it over the same span, so the two never add up to a
     * moment twice as loud.
     * @param {string} key
     * @param {{ loop?: boolean, fade?: number, volume?: number }} [options]
     * @returns {any|null} the Phaser sound, or null when it could not start
     */
    playMusic(key, options) {
      if (gone) return null;
      const p = options || {};
      const fade = p.fade != null ? p.fade : 400;
      if (game.sound.locked) {
        console.warn('[aimeat-phaser] music waits for a gesture: call unlock() from a click, a '
          + 'tap or a key press, then start the track.');
        return null;
      }
      if (!known(key)) {
        console.warn('[aimeat-phaser] no music is loaded under "' + key + '", so nothing played.');
        return null;
      }
      const target = clamp01(state.music * (p.volume != null ? p.volume : 1));
      const next = game.sound.add(key, { loop: p.loop !== false, volume: 0 });
      tracks.add(next);
      next.play();
      ramp(next, target, fade);
      const previous = current;
      current = next;
      if (previous) retire(previous, fade);
      return next;
    },

    /**
     * Fade the music out and let it go.
     * @param {number} [fade]  milliseconds, default 300
     * @returns {void}
     */
    stopMusic(fade) {
      const previous = current;
      current = null;
      if (previous) retire(previous, fade != null ? fade : 300);
    },

    /**
     * A sound with no file behind it: one short oscillator envelope per step, scheduled and
     * stopped by the clock, on the effects channel and through the game's own master and mute.
     * Silent, and false, where Web Audio is not what the game is running on.
     * @param {'beep'|'jump'|'coin'|'hit'|'select'|'win'|string} name
     * @param {{ volume?: number, type?: string, rate?: number }} [options]
     * @returns {boolean} whether a voice was scheduled
     */
    synth(name, options) {
      if (gone || state.muted || game.sound.locked) return false;
      const ctx = game.sound.context;
      if (!ctx || typeof ctx.createOscillator !== 'function') return false;
      const p = options || {};
      const voice = VOICES[name] || VOICES.beep;
      const level = clamp01(state.sfx * (p.volume != null ? p.volume : 1)) * voice.gain;
      if (level <= 0) return false;
      const rate = p.rate && p.rate > 0 ? p.rate : 1;
      // The master mute node is the bus's own output where there is one, so the game's master
      // level and its mute reach a generated voice exactly as they reach a loaded one.
      const out = game.sound.destination || ctx.destination;
      let at = ctx.currentTime;
      for (const step of voice.steps) {
        const span = step[1];
        const osc = ctx.createOscillator();
        const shape = ctx.createGain();
        osc.type = p.type || voice.type;
        osc.frequency.setValueAtTime(step[0] * rate, at);
        shape.gain.setValueAtTime(SILENCE, at);
        shape.gain.linearRampToValueAtTime(level, at + Math.min(0.012, span / 3));
        shape.gain.exponentialRampToValueAtTime(SILENCE, at + span);
        osc.connect(shape);
        shape.connect(out);
        osc.onended = function () {
          osc.disconnect();
          shape.disconnect();
        };
        osc.start(at);
        osc.stop(at + span);
        at += span;
      }
      return true;
    },

    /** @returns {boolean} may this page make a sound yet? */
    get unlocked() {
      return !game.sound.locked;
    },

    /**
     * Hear about the unlock. Called straight away when sound is already allowed.
     * @param {() => void} fn
     * @returns {() => void} stop listening
     */
    onUnlock(fn) {
      if (typeof fn !== 'function') return function () { /* nothing to stop */ };
      if (!game.sound.locked) {
        fn();
        return function () { /* nothing to stop */ };
      }
      game.sound.once('unlocked', fn);
      return function () { game.sound.off('unlocked', fn); };
    },

    /**
     * Ask the browser for sound. Call it from a real gesture: a click, a tap, a key. Phaser is
     * listening for the same gesture and will clear its own lock once the audio clock is running.
     * @returns {Promise<boolean>} whether sound is allowed now
     */
    unlock() {
      if (!game.sound.locked) return Promise.resolve(true);
      const ctx = game.sound.context;
      if (!ctx || typeof ctx.resume !== 'function') return Promise.resolve(false);
      return ctx.resume().then(
        function () { return !game.sound.locked; },
        function () { return false; },
      );
    },

    /**
     * The four numbers worth keeping for a player.
     * @returns {AudioSettings}
     */
    settings() {
      return { master: state.master, music: state.music, sfx: state.sfx, muted: state.muted };
    },

    /**
     * Put a remembered set of levels back in force.
     * @param {Partial<AudioSettings>} settings
     * @returns {AudioSettings}
     */
    apply(settings) {
      const s = settings || {};
      if (s.master != null) bus.master(s.master);
      if (s.music != null) bus.music(s.music);
      if (s.sfx != null) bus.sfx(s.sfx);
      if (s.muted != null) bus.mute(s.muted);
      return bus.settings();
    },

    /** Stop every ramp, drop every track, and leave nothing running. */
    destroy() {
      if (gone) return;
      gone = true;
      for (const stop of ramps) stop.cancelled = true;
      ramps.clear();
      for (const track of tracks) {
        track.stop();
        track.destroy();
      }
      tracks.clear();
      current = null;
    },
  };

  return bus;
}
