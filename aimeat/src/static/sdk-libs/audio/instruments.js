/**
 * @file audio/instruments.js
 * @description The 6 built-in synthesized instruments for aimeat-audio (SDK-libs migration Phase 2):
 *   piano (2-op FM), guitar (Karplus-Strong), bass (saw + sub + lowpass), drums (per-hit noise/sine
 *   bursts: kick/snare/hihat/…/cowbell), flute (sine + breath noise + vibrato LFO), and synth
 *   (configurable oscillator). Importing this module populates the shared `instruments` registry from
 *   core.js (side-effect only — no exports). Split out of the merged audio module to keep every file
 *   under the 800-line cap.
 * @structure side-effect: instruments.piano/guitar/bass/drums/flute/synth = { play(note, opts) }.
 * @usage import './instruments.js';  // registers the built-ins onto the shared registry
 * @version-history
 *   v1.0.0 — 2026-07-19 — Extracted from lib-audio.ts + audio-lib-part2.ts (SDK-libs migration Phase 2).
 */
import { ctx, noteToFreq, masterNode, registerActive, instruments } from './core.js';

// ── Piano: 2-operator FM synthesis ──
instruments.piano = {
  play: function (note, opts) {
    var freq = noteToFreq(note);
    if (!freq) return;
    var t = ctx().currentTime;
    var vel = (opts && opts.velocity !== undefined) ? opts.velocity : 0.7;
    var dur = (opts && opts.duration) || 2.0;

    var mod = ctx().createOscillator(); mod.type = 'sine';
    mod.frequency.value = freq * 2;
    var modGain = ctx().createGain();
    modGain.gain.setValueAtTime(freq * 1.5 * vel, t);
    modGain.gain.exponentialRampToValueAtTime(freq * 0.01, t + dur * 0.8);
    mod.connect(modGain);

    var car = ctx().createOscillator(); car.type = 'sine';
    car.frequency.value = freq;
    modGain.connect(car.frequency);

    var env = ctx().createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(vel * 0.4, t + 0.005);
    env.gain.exponentialRampToValueAtTime(vel * 0.15, t + 0.1);
    env.gain.exponentialRampToValueAtTime(0.001, t + dur);

    car.connect(env); env.connect(masterNode());
    mod.start(t); car.start(t);
    mod.stop(t + dur + 0.1); car.stop(t + dur + 0.1);

    registerActive('piano', note, [mod, car], function () {
      try { env.gain.cancelScheduledValues(ctx().currentTime);
        env.gain.setValueAtTime(env.gain.value, ctx().currentTime);
        env.gain.linearRampToValueAtTime(0, ctx().currentTime + 0.05);
        mod.stop(ctx().currentTime + 0.1); car.stop(ctx().currentTime + 0.1); } catch { /* already stopped */ }
    });
  },
};

// ── Guitar: Karplus-Strong plucked string ──
instruments.guitar = {
  play: function (note, opts) {
    var freq = noteToFreq(note);
    if (!freq) return;
    var t = ctx().currentTime;
    var vel = (opts && opts.velocity !== undefined) ? opts.velocity : 0.7;
    var dur = (opts && opts.duration) || 1.5;

    var bufSize = Math.round(ctx().sampleRate / freq);
    var noiseBuffer = ctx().createBuffer(1, bufSize, ctx().sampleRate);
    var data = noiseBuffer.getChannelData(0);
    for (var i = 0; i < bufSize; i++) data[i] = (Math.random() * 2 - 1) * vel;

    var noise = ctx().createBufferSource();
    noise.buffer = noiseBuffer;
    noise.loop = true;

    var filter = ctx().createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = freq * 4;
    filter.Q.value = 0.5;

    var env = ctx().createGain();
    env.gain.setValueAtTime(vel * 0.5, t);
    env.gain.exponentialRampToValueAtTime(0.001, t + dur);

    noise.connect(filter); filter.connect(env); env.connect(masterNode());
    noise.start(t); noise.stop(t + dur + 0.05);

    registerActive('guitar', note, [noise], function () {
      try { env.gain.cancelScheduledValues(ctx().currentTime);
        env.gain.linearRampToValueAtTime(0, ctx().currentTime + 0.05);
        noise.stop(ctx().currentTime + 0.1); } catch { /* already stopped */ }
    });
  },
};

// ── Bass: sawtooth + lowpass + sub-oscillator ──
instruments.bass = {
  play: function (note, opts) {
    var freq = noteToFreq(note);
    if (!freq) return;
    var t = ctx().currentTime;
    var vel = (opts && opts.velocity !== undefined) ? opts.velocity : 0.7;
    var dur = (opts && opts.duration) || 0.8;

    var osc = ctx().createOscillator(); osc.type = 'sawtooth'; osc.frequency.value = freq;
    var sub = ctx().createOscillator(); sub.type = 'sine'; sub.frequency.value = freq / 2;
    var subGain = ctx().createGain(); subGain.gain.value = 0.5;
    sub.connect(subGain);

    var mix = ctx().createGain();
    osc.connect(mix); subGain.connect(mix);

    var filter = ctx().createBiquadFilter(); filter.type = 'lowpass';
    filter.frequency.setValueAtTime(freq * 3, t);
    filter.frequency.exponentialRampToValueAtTime(freq * 1.2, t + 0.15);
    filter.Q.value = 2;

    var env = ctx().createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(vel * 0.5, t + 0.01);
    env.gain.setValueAtTime(vel * 0.5, t + dur * 0.7);
    env.gain.exponentialRampToValueAtTime(0.001, t + dur);

    mix.connect(filter); filter.connect(env); env.connect(masterNode());
    osc.start(t); sub.start(t);
    osc.stop(t + dur + 0.05); sub.stop(t + dur + 0.05);

    registerActive('bass', note, [osc, sub], function () {
      try { env.gain.cancelScheduledValues(ctx().currentTime);
        env.gain.linearRampToValueAtTime(0, ctx().currentTime + 0.05);
        osc.stop(ctx().currentTime + 0.1); sub.stop(ctx().currentTime + 0.1); } catch { /* already stopped */ }
    });
  },
};

// ── Drums: noise + sine bursts (per-hit) ──
instruments.drums = {
  play: function (hit, opts) {
    var t = ctx().currentTime;
    var vel = (opts && opts.velocity !== undefined) ? opts.velocity : 0.7;

    function makeTom(freq) {
      var osc = ctx().createOscillator(); osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, t);
      osc.frequency.exponentialRampToValueAtTime(freq * 0.6, t + 0.15);
      var g = ctx().createGain();
      g.gain.setValueAtTime(vel * 0.5, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
      osc.connect(g); g.connect(masterNode());
      osc.start(t); osc.stop(t + 0.4);
      return [osc];
    }

    var synths = {
      'kick': function () {
        var osc = ctx().createOscillator(); osc.type = 'sine';
        osc.frequency.setValueAtTime(150, t);
        osc.frequency.exponentialRampToValueAtTime(50, t + 0.1);
        var g = ctx().createGain();
        g.gain.setValueAtTime(vel, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
        osc.connect(g); g.connect(masterNode());
        var click = ctx().createOscillator(); click.type = 'square'; click.frequency.value = 800;
        var cg = ctx().createGain();
        cg.gain.setValueAtTime(vel * 0.3, t);
        cg.gain.exponentialRampToValueAtTime(0.001, t + 0.02);
        click.connect(cg); cg.connect(masterNode());
        osc.start(t); osc.stop(t + 0.5);
        click.start(t); click.stop(t + 0.05);
        return [osc, click];
      },
      'snare': function () {
        var bufLen = Math.round(ctx().sampleRate * 0.15);
        var buf = ctx().createBuffer(1, bufLen, ctx().sampleRate);
        var d = buf.getChannelData(0);
        for (var i = 0; i < bufLen; i++) d[i] = (Math.random() * 2 - 1);
        var noise = ctx().createBufferSource(); noise.buffer = buf;
        var nf = ctx().createBiquadFilter(); nf.type = 'highpass'; nf.frequency.value = 1000;
        var ng = ctx().createGain();
        ng.gain.setValueAtTime(vel * 0.6, t);
        ng.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
        noise.connect(nf); nf.connect(ng); ng.connect(masterNode());
        var osc = ctx().createOscillator(); osc.type = 'sine'; osc.frequency.value = 200;
        var og = ctx().createGain();
        og.gain.setValueAtTime(vel * 0.5, t);
        og.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
        osc.connect(og); og.connect(masterNode());
        noise.start(t); osc.start(t); osc.stop(t + 0.2);
        return [noise, osc];
      },
      'hihat': function () {
        var bufLen = Math.round(ctx().sampleRate * 0.05);
        var buf = ctx().createBuffer(1, bufLen, ctx().sampleRate);
        var d = buf.getChannelData(0);
        for (var i = 0; i < bufLen; i++) d[i] = (Math.random() * 2 - 1);
        var noise = ctx().createBufferSource(); noise.buffer = buf;
        var f = ctx().createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 7000;
        var g = ctx().createGain();
        g.gain.setValueAtTime(vel * 0.3, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
        noise.connect(f); f.connect(g); g.connect(masterNode());
        noise.start(t);
        return [noise];
      },
      'hihat-open': function () {
        var bufLen = Math.round(ctx().sampleRate * 0.3);
        var buf = ctx().createBuffer(1, bufLen, ctx().sampleRate);
        var d = buf.getChannelData(0);
        for (var i = 0; i < bufLen; i++) d[i] = (Math.random() * 2 - 1);
        var noise = ctx().createBufferSource(); noise.buffer = buf;
        var f = ctx().createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 6000;
        var g = ctx().createGain();
        g.gain.setValueAtTime(vel * 0.3, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
        noise.connect(f); f.connect(g); g.connect(masterNode());
        noise.start(t);
        return [noise];
      },
      'crash': function () {
        var bufLen = Math.round(ctx().sampleRate * 1.0);
        var buf = ctx().createBuffer(1, bufLen, ctx().sampleRate);
        var d = buf.getChannelData(0);
        for (var i = 0; i < bufLen; i++) d[i] = (Math.random() * 2 - 1);
        var noise = ctx().createBufferSource(); noise.buffer = buf;
        var f = ctx().createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 4000;
        var g = ctx().createGain();
        g.gain.setValueAtTime(vel * 0.5, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 1.0);
        noise.connect(f); f.connect(g); g.connect(masterNode());
        noise.start(t);
        return [noise];
      },
      'ride': function () {
        var bufLen = Math.round(ctx().sampleRate * 0.8);
        var buf = ctx().createBuffer(1, bufLen, ctx().sampleRate);
        var d = buf.getChannelData(0);
        for (var i = 0; i < bufLen; i++) d[i] = (Math.random() * 2 - 1);
        var noise = ctx().createBufferSource(); noise.buffer = buf;
        var f = ctx().createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 8000; f.Q.value = 1;
        var g = ctx().createGain();
        g.gain.setValueAtTime(vel * 0.3, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.8);
        noise.connect(f); f.connect(g); g.connect(masterNode());
        noise.start(t);
        return [noise];
      },
      'tom-high': function () { return makeTom(300); },
      'tom-mid': function () { return makeTom(220); },
      'tom-low': function () { return makeTom(150); },
      'clap': function () {
        var nodes = [];
        for (var ci = 0; ci < 3; ci++) {
          var delay = ci * 0.01;
          var bufLen = Math.round(ctx().sampleRate * 0.02);
          var buf = ctx().createBuffer(1, bufLen, ctx().sampleRate);
          var d = buf.getChannelData(0);
          for (var j = 0; j < bufLen; j++) d[j] = (Math.random() * 2 - 1);
          var noise = ctx().createBufferSource(); noise.buffer = buf;
          var f = ctx().createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 2500; f.Q.value = 3;
          var g = ctx().createGain();
          g.gain.setValueAtTime(vel * 0.4, t + delay);
          g.gain.exponentialRampToValueAtTime(0.001, t + delay + 0.08);
          noise.connect(f); f.connect(g); g.connect(masterNode());
          noise.start(t + delay);
          nodes.push(noise);
        }
        return nodes;
      },
      'cowbell': function () {
        var osc1 = ctx().createOscillator(); osc1.type = 'square'; osc1.frequency.value = 587;
        var osc2 = ctx().createOscillator(); osc2.type = 'square'; osc2.frequency.value = 845;
        var g = ctx().createGain();
        g.gain.setValueAtTime(vel * 0.3, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
        var f = ctx().createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 700; f.Q.value = 3;
        osc1.connect(g); osc2.connect(g); g.connect(f); f.connect(masterNode());
        osc1.start(t); osc2.start(t);
        osc1.stop(t + 0.5); osc2.stop(t + 0.5);
        return [osc1, osc2];
      },
    };

    var fn = synths[hit];
    if (!fn) { console.warn('[aimeat-audio] Unknown drum hit:', hit); return; }
    var nodes = fn();
    registerActive('drums', hit, nodes, function () {
      nodes.forEach(function (n) { try { n.stop(ctx().currentTime + 0.01); } catch { /* already stopped */ } });
    });
  },
};

// ── Flute: sine + breath noise + vibrato LFO ──
instruments.flute = {
  play: function (note, opts) {
    var freq = noteToFreq(note);
    if (!freq) return;
    var t = ctx().currentTime;
    var vel = (opts && opts.velocity !== undefined) ? opts.velocity : 0.6;
    var dur = (opts && opts.duration) || 1.5;
    var vibDepth = (opts && opts.vibrato !== undefined) ? opts.vibrato : 0.15;

    var osc = ctx().createOscillator(); osc.type = 'sine'; osc.frequency.value = freq;

    var lfo = ctx().createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 5.5;
    var lfoGain = ctx().createGain(); lfoGain.gain.value = freq * vibDepth * 0.02;
    lfo.connect(lfoGain); lfoGain.connect(osc.frequency);

    var noiseBufLen = Math.round(ctx().sampleRate * dur);
    var noiseBuf = ctx().createBuffer(1, noiseBufLen, ctx().sampleRate);
    var nd = noiseBuf.getChannelData(0);
    for (var i = 0; i < noiseBufLen; i++) nd[i] = (Math.random() * 2 - 1);
    var noiseNode = ctx().createBufferSource(); noiseNode.buffer = noiseBuf;
    var noiseFilt = ctx().createBiquadFilter(); noiseFilt.type = 'bandpass';
    noiseFilt.frequency.value = freq; noiseFilt.Q.value = 2;
    var noiseGain = ctx().createGain(); noiseGain.gain.value = vel * 0.06;
    noiseNode.connect(noiseFilt); noiseFilt.connect(noiseGain);

    var env = ctx().createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(vel * 0.3, t + 0.08);
    env.gain.setValueAtTime(vel * 0.3, t + dur - 0.1);
    env.gain.linearRampToValueAtTime(0, t + dur);

    osc.connect(env); noiseGain.connect(env); env.connect(masterNode());
    lfo.start(t); osc.start(t); noiseNode.start(t);
    lfo.stop(t + dur + 0.1); osc.stop(t + dur + 0.1);

    registerActive('flute', note, [osc, lfo, noiseNode], function () {
      try { env.gain.cancelScheduledValues(ctx().currentTime);
        env.gain.linearRampToValueAtTime(0, ctx().currentTime + 0.05);
        osc.stop(ctx().currentTime + 0.1); lfo.stop(ctx().currentTime + 0.1); } catch { /* already stopped */ }
    });
  },
};

// ── Synth: configurable oscillator ──
instruments.synth = {
  play: function (note, opts) {
    var freq = noteToFreq(note);
    if (!freq) return;
    var t = ctx().currentTime;
    var vel = (opts && opts.velocity !== undefined) ? opts.velocity : 0.7;
    var dur = (opts && opts.duration) || 1.0;
    var wave = (opts && opts.wave) || 'sawtooth';
    var filterFreq = (opts && opts.filter) || 2000;

    var osc = ctx().createOscillator(); osc.type = wave; osc.frequency.value = freq;
    var osc2 = ctx().createOscillator(); osc2.type = wave; osc2.frequency.value = freq; osc2.detune.value = 7;
    var osc2Gain = ctx().createGain(); osc2Gain.gain.value = 0.5;
    osc2.connect(osc2Gain);

    var filter = ctx().createBiquadFilter(); filter.type = 'lowpass';
    filter.frequency.value = filterFreq; filter.Q.value = 1;

    var env = ctx().createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(vel * 0.3, t + 0.02);
    env.gain.setValueAtTime(vel * 0.3, t + dur * 0.7);
    env.gain.exponentialRampToValueAtTime(0.001, t + dur);

    osc.connect(filter); osc2Gain.connect(filter);
    filter.connect(env); env.connect(masterNode());
    osc.start(t); osc2.start(t);
    osc.stop(t + dur + 0.05); osc2.stop(t + dur + 0.05);

    registerActive('synth', note, [osc, osc2], function () {
      try { env.gain.cancelScheduledValues(ctx().currentTime);
        env.gain.linearRampToValueAtTime(0, ctx().currentTime + 0.05);
        osc.stop(ctx().currentTime + 0.1); osc2.stop(ctx().currentTime + 0.1); } catch { /* already stopped */ }
    });
  },
};
