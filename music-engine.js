/* ============================================================================
 * Godaigo Elements — Adaptive Music Engine
 * ----------------------------------------------------------------------------
 * A procedural, adaptive, generative composition engine for Godaigo. It does
 * not play songs — it plays a *system*. The board writes the music: as tiles
 * are revealed, scrolls are cast, and one element comes to dominate, the engine
 * unmutes voices, reshapes the groove, and builds toward a finale only this
 * specific game could produce.
 *
 * No dependencies, no audio assets — every voice is synthesised live through
 * the Web Audio API. Drop this file in and wire the game's existing event hooks
 * (see the §"Game hooks" block at the bottom and MUSIC-ENGINE.md) to the public
 * API:
 *
 *     const music = new GodaigoMusicEngine();
 *     await music.start();
 *     music.setElementTiles('fire', revealed, total);   // or setElementIntensity
 *     music.triggerEvent('scroll-cast', 'water');
 *     music.openResponseWindow();
 *     music.resolveResponseWindow('void');               // or (null) for no response
 *     music.setGameState('contested');                   // peaceful | contested | endgame
 *     music.triggerConvergence(['fire', 'void']);
 *
 * Percussion is a FIRST-CLASS layer here, not a sidecar (§1 / §5):
 *   1. a base spine — frame drum + hand percussion, always audible (the board
 *      before discovery);
 *   2. six per-element rhythmic personalities that switch in with each stem;
 *   3. a game-state modulator that adds swing, drive and crescendo so the
 *      *feel* of the music — not just its volume — tracks the board.
 * ========================================================================== */

(function (global) {
  'use strict';

  const ELEMENTS = ['earth', 'water', 'fire', 'wind', 'void', 'catacomb'];

  // ── Shared harmonic grid ───────────────────────────────────────────────────
  // A minor pentatonic is the neutral bed: A C D E G. Any combination of stems
  // drawn from it stays consonant no matter the order tiles are revealed in.
  // Catacomb deliberately reaches outside it (§3) for controlled dissonance.
  const ROOT_MIDI = 45;               // A2
  const PENT = [0, 3, 5, 7, 10];      // scale degrees, semitones from root
  const mtof = m => 440 * Math.pow(2, (m - 69) / 12);

  // ── Leitmotifs (§3) — contrary-motion micro-motifs ─────────────────────────
  // Each element owns a 2–4 bar phrase written to weave with its neighbours:
  // Earth falls low & slow against Wind's high rising dash; Fire's syncopation
  // against Water's legato; Void's single shifting tone against Catacomb's
  // circular cluster. `beat` is absolute within the loop (loopBars * 4).
  const N = (beat, midi, dur, opt) => Object.assign({ beat, midi, dur }, opt);

  const MOTIFS = {
    earth: { loopBars: 4, voice: 'earth', events: [
      N(0, 45, 4), N(4, 43, 4), N(8, 40, 4), N(12, 38, 4),   // A2 G2 E2 D2 — falling bass
    ] },
    water: { loopBars: 2, voice: 'water', events: [
      N(0, 57, .9), N(1, 60, .9), N(2, 64, .9), N(3, 67, .9), // rising…
      N(4, 64, .9), N(5, 60, .9), N(6, 64, .9), N(7, 57, .9), // …and turning back
    ] },
    fire: { loopBars: 2, voice: 'fire', events: [           // syncopated shamisen (taiko lives in PERC)
      N(0.5, 69, .35), N(1, 64, .35), N(1.75, 72, .35),
      N(2.5, 67, .35), N(3, 69, .35), N(3.5, 64, .35),
      N(4.5, 69, .35), N(5, 64, .35), N(5.75, 72, .35),
      N(6.5, 76, .35), N(7, 72, .35), N(7.5, 69, .35),
    ] },
    wind: { loopBars: 2, voice: 'wind', events: [
      N(0, 81, .4), N(0.5, 84, .4), N(1, 88, .4), N(1.5, 91, .9),   // high ascending, dissolving
      N(4, 84, .4), N(4.5, 88, .4), N(5, 91, .4), N(5.5, 96, 1.4),
    ] },
    void: { loopBars: 4, voice: 'void', events: [
      N(0, 33, 16, { sub: true }),   // sustained A1 sub-bass through the whole loop
      N(0, 69, 8), N(8, 68, 8),      // a single tone that shifts a half-step
    ] },
    catacomb: { loopBars: 4, voice: 'catacomb', events: [
      ...cluster(0, 57), ...cluster(4, 56), ...cluster(8, 55), ...cluster(12, 56), // walking clusters
    ] },
  };

  function cluster(beat, root) {
    return [
      N(beat, root, 3.6), N(beat, root + 1, 3.6),   // root + minor 2nd (the bite)
      N(beat, root + 7, 3.6), N(beat, root + 6, 3.6), // 5th (anchor) + tritone (unresolved)
    ];
  }

  // ── Percussion personalities (§1 / §5) — FIRST CLASS ───────────────────────
  // Each element brings its own rhythmic character, routed through that
  // element's stem so it fades in/out with the stem's intensity (density-driven).
  // drum ∈ frame | taiko | shaker | tick | sub | rim. `off` marks off-beat hits
  // that the §5 swing modulator is allowed to push late.
  const P = (beat, drum, gain, off) => ({ beat, drum, gain, off: !!off });

  const PERCUSSION = {
    // Grounded: slow, heavy frame-drum on the strong beats.
    earth: { loopBars: 2, hits: [
      P(0, 'frame', 1.0), P(2, 'frame', .7), P(4, 'frame', 1.0), P(6, 'frame', .7), P(7, 'frame', .4, true),
    ] },
    // Fluid, unpredictable: soft shakers on the off-beats, occasional rim.
    water: { loopBars: 2, hits: [
      P(0.5, 'shaker', .5, true), P(1.5, 'shaker', .4, true), P(2.75, 'rim', .5, true),
      P(3.5, 'shaker', .45, true), P(5.5, 'shaker', .4, true), P(6.5, 'rim', .5, true), P(7.25, 'shaker', .4, true),
    ] },
    // The rhythmic engine: driving taiko.
    fire: { loopBars: 1, hits: [
      P(0, 'taiko', 1.0), P(1.5, 'taiko', .7, true), P(2, 'taiko', .85), P(2.5, 'tick', .5, true), P(3.5, 'taiko', .7, true),
    ] },
    // Ethereal, quick: light high wood-ticks.
    wind: { loopBars: 1, hits: [
      P(0.25, 'tick', .4, true), P(0.75, 'tick', .3, true), P(1.5, 'tick', .45, true),
      P(2.25, 'tick', .35, true), P(3.25, 'tick', .4, true), P(3.75, 'tick', .3, true),
    ] },
    // Empty, alien: almost nothing — one deep sub-pulse every two bars.
    void: { loopBars: 2, hits: [ P(0, 'sub', .9) ] },
    // Labyrinthine: irregular, syncopated clicks that never settle.
    catacomb: { loopBars: 2, hits: [
      P(0, 'rim', .8), P(1.25, 'rim', .5, true), P(2.5, 'frame', .6, true), P(3.75, 'rim', .5, true),
      P(4.5, 'rim', .6, true), P(5.75, 'frame', .55, true), P(7, 'rim', .5, true),
    ] },
  };

  // ── Per-voice synthesis presets ────────────────────────────────────────────
  const VOICES = {
    earth:    { type: 'sawtooth', cutoff: 420,  atk: .25, rel: .8,  gain: .9,  reverb: .25, detune: 6 },
    water:    { type: 'sine',     cutoff: 2600, atk: .02, rel: .35, gain: .55, reverb: .4 },
    fire:     { type: 'sawtooth', cutoff: 2200, atk: .005,rel: .18, gain: .42, reverb: .12, dist: .5, detune: 10 },
    wind:     { type: 'triangle', cutoff: 5000, atk: .04, rel: .5,  gain: .4,  reverb: .45, breath: true },
    void:     { type: 'sine',     cutoff: 700,  atk: .9,  rel: 2.2, gain: .8,  reverb: .6,  swell: true },
    catacomb: { type: 'sawtooth', cutoff: 2000, atk: .03, rel: .9,  gain: .3,  reverb: .5,  detune: 8 },
  };

  // ───────────────────────────────────────────────────────────────────────────
  class GodaigoMusicEngine {
    constructor(opts = {}) {
      this.bpm = opts.bpm || 84;
      this.onStatus = opts.onStatus || null;   // optional (msg) => void for UIs
      this.ctx = null;
      this.running = false;

      // Lookahead scheduler ("a tale of two clocks").
      this._lookahead = 0.025;
      this._scheduleAhead = 0.18;
      this._timer = null;
      this._nextBarTime = 0;
      this._bar = 0;

      this.stems = {};
      for (const el of ELEMENTS) this.stems[el] = { intensity: 0, tier: 0, node: null };

      this.baseIntensity = 0.85;       // base spine is never fully silent (§1)
      this.gameState = 'peaceful';     // peaceful | contested | endgame (§5)
      this._response = null;
      this._converging = false;
      this._convElements = [];
    }

    get beatDur() { return 60 / this.bpm; }
    get barDur() { return this.beatDur * 4; }

    /* ── Lifecycle ─────────────────────────────────────────────────────────── */
    async start() {
      if (this.running) return;
      const AC = global.AudioContext || global.webkitAudioContext;
      if (!this.ctx) { this.ctx = new AC(); this._buildGraph(); }
      if (this.ctx.state === 'suspended') await this.ctx.resume();
      this.running = true;
      this._bar = 0;
      this._nextBarTime = this.ctx.currentTime + 0.1;
      this._timer = setInterval(() => this._scheduler(), this._lookahead * 1000);
      this._status('Adaptive engine running');
    }

    stop() {
      this.running = false;
      if (this._timer) { clearInterval(this._timer); this._timer = null; }
      this._status('Adaptive engine stopped');
    }

    setBPM(bpm) { this.bpm = Math.max(40, Math.min(200, bpm)); }

    // Snapshot for UIs.
    getState() {
      const stems = {};
      for (const el of ELEMENTS) stems[el] = { intensity: this.stems[el].intensity, tier: this.stems[el].tier };
      return {
        running: this.running, gameState: this.gameState,
        converging: this._converging, response: !!this._response, stems,
      };
    }

    _status(msg) { if (this.onStatus) try { this.onStatus(msg); } catch (e) {} }

    /* ── Master / bus graph ────────────────────────────────────────────────── */
    _buildGraph() {
      const ctx = this.ctx;
      this._noise = makeNoiseBuffer(ctx);

      this.master = ctx.createGain(); this.master.gain.value = 0.9;
      this.duck = ctx.createGain(); this.duck.gain.value = 1;   // §4 ducks the whole mix

      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -16; comp.ratio.value = 4;
      comp.attack.value = 0.004; comp.release.value = 0.18;

      this.duck.connect(this.master);
      this.master.connect(comp);
      comp.connect(ctx.destination);

      this.reverb = ctx.createConvolver();
      this.reverb.buffer = makeReverbIR(ctx, 2.6);
      this.reverbIn = ctx.createGain();
      const rvHp = ctx.createBiquadFilter(); rvHp.type = 'highpass'; rvHp.frequency.value = 200;
      this.reverbIn.connect(this.reverb); this.reverb.connect(rvHp); rvHp.connect(this.duck);

      this.baseNode = ctx.createGain();
      this.baseNode.gain.value = this.baseIntensity;
      this.baseNode.connect(this.duck);

      for (const el of ELEMENTS) {
        const g = ctx.createGain(); g.gain.value = 0; g.connect(this.duck);
        this.stems[el].node = g;
      }
    }

    /* ── §2 Density & intensity ────────────────────────────────────────────── */
    setElementIntensity(element, value) {
      const s = this.stems[element];
      if (!s) return;
      value = Math.max(0, Math.min(1, value));
      s.intensity = value;
      s.tier = value < 0.02 ? 0 : value < 0.34 ? 1 : value < 0.72 ? 2 : 3;
      if (s.node && this.ctx) s.node.gain.setTargetAtTime(value, this.ctx.currentTime, 1.0); // ~3s crossfade
    }

    // Maps the §2 tiers literally: 1 tile → solo, 3–4 → section, most/all → foreground.
    setElementTiles(element, revealed, total) {
      total = Math.max(1, total || 1);
      let intensity;
      if (revealed <= 0) intensity = 0;
      else if (revealed === 1) intensity = 0.28;                          // Tier 1
      else if (revealed <= 4) intensity = 0.45 + 0.1 * (revealed - 2);    // Tier 2
      else intensity = 0.7 + 0.3 * Math.min(1, revealed / total);         // Tier 3
      this.setElementIntensity(element, Math.min(1, intensity));
    }

    /* ── §5 Game-state rhythm shifts ───────────────────────────────────────── */
    setGameState(state) {
      if (['peaceful', 'contested', 'endgame'].includes(state)) {
        this.gameState = state;
        this._status('Game state: ' + state);
      }
    }

    /* ── §4 Scroll accents & response window ───────────────────────────────── */
    castAccent(element) {
      if (!this.ctx) return;
      const t = this.ctx.currentTime + 0.01;
      const node = this.stems[element]?.node || this.baseNode;
      if (element === 'fire') { this._taiko(t, node, 1.1); }
      else if (element === 'earth') { this._frame(t, node, 1.2); this._playVoice(VOICES.earth, 45, t, 1.2, node, 1.1, 'earth'); }
      else if (element === 'water') { this._rim(t, node, 1.0); this._playVoice(VOICES.water, 72, t, .6, node, 1.0, 'water'); }
      else if (element === 'wind') { this._tick(t, node, 1.0); this._playVoice(VOICES.wind, 91, t, .5, node, 1.0, 'wind'); }
      else if (element === 'void') { this._sub(t, node, 1.0); this._playVoice(VOICES.void, 57, t, 1.5, node, 1.0, 'void'); }
      else { this._rim(t, node, 1.0); for (const ev of cluster(0, 57)) this._playVoice(VOICES.catacomb, ev.midi, t, .8, node, .9, 'catacomb'); }
      this._status('Scroll cast: ' + element);
    }

    openResponseWindow() {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      this.duck.gain.setTargetAtTime(0.62, t, 0.15);   // ambient ducks — time slows
      const hold = this.ctx.createGain(); hold.gain.value = 0;
      hold.gain.setTargetAtTime(0.5, t, 0.4);
      hold.connect(this.duck);
      const oscs = [33, 45, 57].map(m => {            // sustained unison — the held breath
        const o = this.ctx.createOscillator();
        o.type = 'sine'; o.frequency.value = mtof(m);
        o.connect(hold); o.start(t); return o;
      });
      this._response = { hold, oscs, startBar: this._bar };
      this._status('Response window OPEN');
    }

    resolveResponseWindow(element) {
      if (!this.ctx || !this._response) return;
      const t = this.ctx.currentTime;
      const r = this._response; this._response = null;
      this.duck.gain.setTargetAtTime(1, t + 0.05, 0.25);

      if (element && MOTIFS[element]) {            // suspension resolves into the responder's voice
        r.hold.gain.setTargetAtTime(0, t, 0.25);
        const node = this.stems[element].node, v = VOICES[element], m = MOTIFS[element];
        const span = Math.min(8, m.loopBars * 4);
        for (const ev of m.events) {
          if (ev.beat >= span) break;
          this._playVoice(v, ev.midi, t + ev.beat * this.beatDur, ev.dur, node, 1.0, element, ev);
        }
        this._status('Response played: ' + element);
      } else {                                     // no response — fade, a breath
        r.hold.gain.setTargetAtTime(0, t, 0.6);
        this._status('Response window resolved — no response');
      }
      for (const o of r.oscs) try { o.stop(t + 2.5); } catch (e) {}
    }

    counterAccent(element) {                        // counter scroll: sharp cluster, then release
      if (!this.ctx) return;
      const t = this.ctx.currentTime + 0.01;
      for (const ev of cluster(0, 57))
        this._playVoice(VOICES.catacomb, ev.midi, t, 0.8, this.stems.catacomb.node || this.baseNode, 1.2, 'catacomb');
      this._status('Counter scroll!');
      if (this._response) setTimeout(() => this.resolveResponseWindow(element || null), 380);
    }

    /* ── §6 The Great Convergence ──────────────────────────────────────────── */
    triggerConvergence(dominantElements) {
      const dom = (dominantElements && dominantElements.length ? dominantElements : ELEMENTS).filter(e => ELEMENTS.includes(e));
      this._convElements = dom.length ? dom : ELEMENTS.slice();
      this._converging = true;
      this.gameState = 'endgame';
      for (const el of ELEMENTS) this.setElementIntensity(el, this._convElements.includes(el) ? 1 : 0);
      this.baseIntensity = 1;
      if (this.baseNode && this.ctx) this.baseNode.gain.setTargetAtTime(1, this.ctx.currentTime, 1.5);
      this._status('CONVERGENCE: ' + this._convElements.join(' · '));
    }

    reset() {
      this._converging = false; this._convElements = [];
      this.gameState = 'peaceful'; this.baseIntensity = 0.85;
      for (const el of ELEMENTS) this.setElementIntensity(el, 0);
      if (this.baseNode && this.ctx) this.baseNode.gain.setTargetAtTime(0.85, this.ctx.currentTime, 1.0);
      this._status('Board reset');
    }

    /* ── Named-event dispatch (mirrors the framework's events) ─────────────── */
    triggerEvent(type, payload) {
      switch (type) {
        case 'tile-revealed': if (payload && payload.element) this.setElementTiles(payload.element, payload.revealed, payload.total); break;
        case 'scroll-cast':   this.castAccent(payload); break;
        case 'response-open': this.openResponseWindow(); break;
        case 'response-played': this.resolveResponseWindow(payload || null); break;
        case 'counter-played': this.counterAccent(payload || null); break;
        case 'response-none':
        case 'response-close': this.resolveResponseWindow(null); break;
        case 'turn-change':   this._turnBreath(); break;
        case 'convergence':   this.triggerConvergence(payload); break;
        default: break;
      }
    }

    _turnBreath() {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      this.duck.gain.cancelScheduledValues(t);
      this.duck.gain.setValueAtTime(this.duck.gain.value, t);
      this.duck.gain.linearRampToValueAtTime(0.8, t + 0.06);
      this.duck.gain.linearRampToValueAtTime(this._response ? 0.62 : 1, t + 0.4);
      this._status('Turn change');
    }

    /* ── Scheduler ─────────────────────────────────────────────────────────── */
    _scheduler() {
      if (!this.running) return;
      const until = this.ctx.currentTime + this._scheduleAhead;
      while (this._nextBarTime < until) {
        this._scheduleBar(this._bar, this._nextBarTime);
        this._nextBarTime += this.barDur;
        this._bar++;
      }
    }

    _scheduleBar(bar, t) {
      this._scheduleSpine(bar, t);
      if (this._converging) { this._scheduleConvergence(bar, t); return; }
      for (const el of ELEMENTS) {
        const s = this.stems[el];
        if (s.intensity < 0.02) continue;
        this._schedulePercussion(el, bar, t);
        this._scheduleMotif(el, bar, t);
      }
    }

    // §1 base spine — always-audible frame drum + hand ticks. §5 colours it:
    // contested adds swing ghosts, endgame adds a driving 8th pulse, and an
    // open response window builds a crescendo beneath the held tone.
    _scheduleSpine(bar, t) {
      const bd = this.beatDur;
      const contested = this.gameState === 'contested';
      const endgame = this.gameState === 'endgame' || this._converging;
      const pressure = this._response ? Math.min(1, (bar - this._response.startBar + 1) * 0.35) : 0;
      for (let b = 0; b < 4; b++) {
        if (b === 0) this._frame(t, this.baseNode, .8);
        else if (b === 2) this._frame(t + b * bd, this.baseNode, .55);
        this._hand(t + b * bd, this.baseNode, b % 2 ? .35 : .5);
        if ((contested || endgame) && (b === 1 || b === 3)) this._hand(t + (b + 0.66) * bd, this.baseNode, .3); // swing ghost
        if (endgame) this._hand(t + (b + 0.5) * bd, this.baseNode, .28);                                       // driving 8ths
        if (pressure > 0) this._hand(t + (b + 0.5) * bd, this.baseNode, .25 + 0.45 * pressure);                // §4 crescendo
      }
    }

    // §5 swing: push flagged off-beats late once the board is contested.
    _swing(beat, off) {
      if (!off) return beat;
      if (this.gameState === 'contested' || this.gameState === 'endgame' || this._converging) return beat + 0.12;
      return beat;
    }

    _schedulePercussion(el, bar, t) {
      const p = PERCUSSION[el]; if (!p) return;
      const s = this.stems[el];
      const barInLoop = bar % p.loopBars, lo = barInLoop * 4, hi = lo + 4;
      // Density: thin the kit at Tier 1, full kit by Tier 3.
      const density = s.tier >= 3 ? 1 : s.tier >= 2 ? 0.8 : 0.55;
      for (const h of p.hits) {
        if (h.beat < lo || h.beat >= hi) continue;
        if (h.gain * density < 0.12 && s.tier < 2 && Math.random() > density) continue;
        const tt = t + (this._swing(h.beat, h.off) - lo) * this.beatDur;
        this._drum(h.drum, tt, s.node, h.gain * (0.6 + 0.4 * density));
      }
    }

    _scheduleMotif(el, bar, t) {
      const m = MOTIFS[el], s = this.stems[el], v = VOICES[el];
      const barInLoop = bar % m.loopBars, lo = barInLoop * 4, hi = lo + 4;
      for (const ev of m.events) {
        if (ev.beat < lo || ev.beat >= hi) continue;
        const tt = t + (ev.beat - lo) * this.beatDur;
        const tierGain = s.tier >= 3 ? 1.15 : 1.0;
        this._playVoice(v, ev.midi, tt, ev.dur, s.node, tierGain, el, ev);
        if (s.tier >= 2 && !ev.sub) this._playVoice(v, ev.midi + 12, tt, ev.dur, s.node, 0.5, el, ev); // §2: solo → section
      }
    }

    // §6 composed finale — a fixed i–♭VI–♭III–♭VII progression in A minor voiced
    // by the dominant elements, each in its own register, over a full kit.
    _scheduleConvergence(bar, t) {
      const PROG = [[45, 48, 52], [41, 45, 48], [48, 52, 55], [43, 47, 50]]; // Am F C G
      const chord = PROG[(bar >> 1) % PROG.length];
      const bd = this.beatDur;
      for (const el of this._convElements) {
        const v = VOICES[el], node = this.stems[el].node;
        this._schedulePercussion(el, bar, t);
        if (el === 'earth' || el === 'void') this._playVoice(v, chord[0] - 12, t, 4, node, 1.0, el);
        else if (el === 'fire') for (let b = 0; b < 4; b++) this._playVoice(v, chord[b % 3] + 12, t + (b + 0.5) * bd, .4, node, .9, el);
        else if (el === 'catacomb') for (const m of chord) this._playVoice(v, m, t, 4, node, .8, el);
        else for (let i = 0; i < 4; i++) this._playVoice(v, chord[i % 3] + (el === 'wind' ? 24 : 12), t + i * bd, .8, node, .9, el);
      }
    }

    /* ── Melodic synthesis ─────────────────────────────────────────────────── */
    _playVoice(v, midi, t, durBeats, destNode, gainMul, element, ev) {
      const ctx = this.ctx;
      const dur = durBeats * this.beatDur;
      const env = ctx.createGain();
      const peak = (v.gain || 0.5) * (gainMul || 1) * 0.5;
      const atk = (ev && ev.sub) ? 1.5 : v.atk;
      const rel = (ev && ev.sub) ? 3.0 : v.rel;
      env.gain.setValueAtTime(0.0001, t);
      env.gain.linearRampToValueAtTime(peak, t + atk);                     // swell handles Void's reverse-reverb feel
      env.gain.setTargetAtTime(0.0001, t + Math.max(dur - rel, atk + 0.01), rel * 0.4 + 0.05);

      const filt = ctx.createBiquadFilter();
      filt.type = 'lowpass'; filt.frequency.value = v.cutoff;
      filt.Q.value = element === 'catacomb' ? 4 : 0.8;

      let tail = filt;
      if (v.dist) { const ws = ctx.createWaveShaper(); ws.curve = makeDistCurve(v.dist); filt.connect(ws); tail = ws; }
      tail.connect(env); env.connect(destNode);
      if (v.reverb) { const send = ctx.createGain(); send.gain.value = v.reverb; env.connect(send); send.connect(this.reverbIn); }

      const f = mtof(midi);
      const mk = detune => {
        const o = ctx.createOscillator();
        o.type = v.type; o.frequency.value = f;
        if (detune) o.detune.value = detune;
        o.connect(filt); o.start(t); o.stop(t + dur + rel + 0.1);
      };
      mk(0);
      if (v.detune) { mk(v.detune); mk(-v.detune); }

      if (v.breath) {  // Wind — filtered noise riding the note
        const ns = ctx.createBufferSource(); ns.buffer = this._noise; ns.loop = true;
        const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f * 1.5; bp.Q.value = 2;
        const ng = ctx.createGain(); ng.gain.value = 0.0001;
        ng.gain.linearRampToValueAtTime(peak * 0.4, t + atk);
        ng.gain.setTargetAtTime(0.0001, t + dur * 0.5, rel);
        ns.connect(bp); bp.connect(ng); ng.connect(destNode);
        ns.start(t); ns.stop(t + dur + rel + 0.1);
      }
    }

    /* ── Percussion synthesis (first-class kit) ────────────────────────────── */
    _drum(kind, t, dest, gain) {
      switch (kind) {
        case 'frame':  return this._frame(t, dest, gain);
        case 'taiko':  return this._taiko(t, dest, gain);
        case 'shaker': return this._shaker(t, dest, gain);
        case 'tick':   return this._tick(t, dest, gain);
        case 'sub':    return this._sub(t, dest, gain);
        case 'rim':    return this._rim(t, dest, gain);
        default:       return this._hand(t, dest, gain);
      }
    }

    _hand(t, dest, gain) {   // soft hand-percussion tick (base spine)
      const ctx = this.ctx;
      const ns = ctx.createBufferSource(); ns.buffer = this._noise;
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1400; bp.Q.value = 1.2;
      const g = ctx.createGain(); const peak = 0.12 * (gain || 1);
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(peak, t + 0.002);
      g.gain.setTargetAtTime(0.0001, t + 0.01, 0.03);
      ns.connect(bp); bp.connect(g); g.connect(dest); ns.start(t); ns.stop(t + 0.1);
    }

    _frame(t, dest, gain) {  // frame drum — low membrane thud with a short body
      const ctx = this.ctx;
      const o = ctx.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(105, t); o.frequency.exponentialRampToValueAtTime(62, t + 0.12);
      const g = ctx.createGain(); const peak = 0.42 * (gain || 1);
      g.gain.setValueAtTime(peak, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
      o.connect(g); g.connect(dest); o.start(t); o.stop(t + 0.26);
      const ns = ctx.createBufferSource(); ns.buffer = this._noise;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 800;
      const ng = ctx.createGain(); ng.gain.setValueAtTime(0.12 * (gain || 1), t);
      ng.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
      ns.connect(lp); lp.connect(ng); ng.connect(dest); ns.start(t); ns.stop(t + 0.09);
    }

    _taiko(t, dest, gain) {  // big pitch-dropping thump + transient (Fire)
      const ctx = this.ctx;
      const o = ctx.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(160, t); o.frequency.exponentialRampToValueAtTime(55, t + 0.18);
      const g = ctx.createGain(); const peak = 0.6 * (gain || 1);
      g.gain.setValueAtTime(peak, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.32);
      o.connect(g); g.connect(dest); o.start(t); o.stop(t + 0.36);
      const ns = ctx.createBufferSource(); ns.buffer = this._noise;
      const ng = ctx.createGain(); ng.gain.setValueAtTime(0.18 * (gain || 1), t);
      ng.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
      ns.connect(ng); ng.connect(dest); ns.start(t); ns.stop(t + 0.08);
    }

    _shaker(t, dest, gain) { // soft high noise burst (Water)
      const ctx = this.ctx;
      const ns = ctx.createBufferSource(); ns.buffer = this._noise;
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 6000;
      const g = ctx.createGain(); const peak = 0.09 * (gain || 1);
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(peak, t + 0.004);
      g.gain.setTargetAtTime(0.0001, t + 0.012, 0.025);
      ns.connect(hp); hp.connect(g); g.connect(dest); ns.start(t); ns.stop(t + 0.09);
    }

    _tick(t, dest, gain) {   // light high wood-tick (Wind)
      const ctx = this.ctx;
      const ns = ctx.createBufferSource(); ns.buffer = this._noise;
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 3800; bp.Q.value = 3;
      const g = ctx.createGain(); const peak = 0.08 * (gain || 1);
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(peak, t + 0.002);
      g.gain.setTargetAtTime(0.0001, t + 0.006, 0.02);
      ns.connect(bp); bp.connect(g); g.connect(dest); ns.start(t); ns.stop(t + 0.06);
    }

    _rim(t, dest, gain) {    // dry mid click (Catacomb / Water)
      const ctx = this.ctx;
      const ns = ctx.createBufferSource(); ns.buffer = this._noise;
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1900; bp.Q.value = 5;
      const g = ctx.createGain(); const peak = 0.14 * (gain || 1);
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(peak, t + 0.002);
      g.gain.setTargetAtTime(0.0001, t + 0.005, 0.018);
      ns.connect(bp); bp.connect(g); g.connect(dest); ns.start(t); ns.stop(t + 0.05);
    }

    _sub(t, dest, gain) {    // deep sub-pulse, slow swell (Void)
      const ctx = this.ctx;
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = 41;
      const g = ctx.createGain(); const peak = 0.5 * (gain || 1);
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(peak, t + 0.06);
      g.gain.exponentialRampToValueAtTime(0.001, t + 1.1);
      o.connect(g); g.connect(dest); o.start(t); o.stop(t + 1.2);
    }
  }

  /* ── Buffers / curves ────────────────────────────────────────────────────── */
  function makeNoiseBuffer(ctx) {
    const len = ctx.sampleRate * 2, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }
  function makeReverbIR(ctx, decay) {
    const len = Math.floor(ctx.sampleRate * Math.max(decay, 0.3)), buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay * 1.2);
    }
    return buf;
  }
  function makeDistCurve(drive) {
    const n = 512, c = new Float32Array(n), amount = Math.max(drive * 12, 0.001);
    for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(x * amount) / Math.tanh(amount); }
    return c;
  }

  /* ── Export ──────────────────────────────────────────────────────────────── */
  GodaigoMusicEngine.ELEMENTS = ELEMENTS;
  global.GodaigoMusicEngine = GodaigoMusicEngine;
  if (typeof module !== 'undefined' && module.exports) module.exports = GodaigoMusicEngine;

})(typeof window !== 'undefined' ? window : globalThis);

/* ============================================================================
 * Game hooks — wire these in the Godaigo codebase (see MUSIC-ENGINE.md):
 *   revealTile()           → music.setElementTiles(el, revealedCount, totalForEl)
 *   applyScrollEffects()   → music.triggerEvent('scroll-cast', el)
 *   openResponseWindow()   → music.openResponseWindow()
 *   resolveResponseStack() → music.resolveResponseWindow(respondingEl | null)
 *   win check              → music.triggerConvergence(dominantElements)
 *   turn handler (lobby)   → music.triggerEvent('turn-change')
 *   board read (peace/war) → music.setGameState('peaceful'|'contested'|'endgame')
 * ========================================================================== */
