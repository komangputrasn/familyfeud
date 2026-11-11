// Sound for the board. Every sound is synthesized with Web Audio unless a matching
// file exists in /public/audio (drumroll, reveal, strike), in which case the file plays.
// Files in data/wrong replace the strike sound; one is picked at random each time.

const DEFAULT_ROLL_SECONDS = 3.6;

export class Sound {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.noise = null;
    this.files = {};
    this.elements = {};
  }

  // Browsers only allow audio after a click or key press on the page.
  unlock() {
    if (!this.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new Ctx();
      const compressor = this.ctx.createDynamicsCompressor();
      compressor.threshold.value = -14;
      compressor.ratio.value = 5;
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.9;
      this.master.connect(compressor).connect(this.ctx.destination);

      const length = this.ctx.sampleRate * 2;
      this.noise = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state !== 'running') this.ctx.resume();
  }

  get ready() {
    return Boolean(this.ctx) && this.ctx.state === 'running';
  }

  async loadFiles() {
    let manifest;
    try {
      manifest = await (await fetch('/api/audio', { cache: 'no-store' })).json();
    } catch {
      return;
    }
    // A manifest entry is one URL, or a list of URLs to pick from at random.
    const makeAudio = (url) => {
      const element = new Audio(url);
      element.preload = 'auto';
      return element;
    };
    for (const [name, url] of Object.entries(manifest)) {
      if (JSON.stringify(this.files[name]) === JSON.stringify(url)) continue;
      this.elements[name] = Array.isArray(url) ? url.map(makeAudio) : makeAudio(url);
    }
    for (const name of Object.keys(this.elements)) {
      if (!manifest[name]) delete this.elements[name];
    }
    this.files = manifest;
  }

  playFile(name) {
    let element = this.elements[name];
    if (Array.isArray(element)) {
      for (const other of element) other.pause();
      // Random pick, avoiding the same sound twice in a row when there is a choice.
      const options = element.length > 1 ? element.filter((e) => e !== this.lastPick?.[name]) : element;
      element = options[Math.floor(Math.random() * options.length)];
      this.lastPick = { ...this.lastPick, [name]: element };
    }
    if (!element) return null;
    try {
      element.pause();
      element.currentTime = 0;
      const started = element.play();
      started?.catch(() => {});
      return element;
    } catch {
      return null;
    }
  }

  // ------------------------------------------------------------ building blocks

  bus(volume) {
    const gain = this.ctx.createGain();
    gain.gain.value = volume;
    gain.connect(this.master);
    return gain;
  }

  tone(out, { type = 'sine', from, to = from, at, length, peak, attack = 0.005 }) {
    const osc = this.ctx.createOscillator();
    const env = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, at);
    if (to !== from) osc.frequency.exponentialRampToValueAtTime(to, at + length);
    env.gain.setValueAtTime(0.0001, at);
    env.gain.exponentialRampToValueAtTime(peak, at + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, at + length);
    osc.connect(env).connect(out);
    osc.start(at);
    osc.stop(at + length + 0.05);
  }

  hiss(out, { at, length, peak, attack = 0.004, filter = 'bandpass', from, to = from, q = 1 }) {
    const source = this.ctx.createBufferSource();
    source.buffer = this.noise;
    source.loop = true;
    const biquad = this.ctx.createBiquadFilter();
    biquad.type = filter;
    biquad.Q.value = q;
    biquad.frequency.setValueAtTime(from, at);
    if (to !== from) biquad.frequency.exponentialRampToValueAtTime(to, at + length);
    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0.0001, at);
    env.gain.exponentialRampToValueAtTime(peak, at + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, at + length);
    source.connect(biquad).connect(env).connect(out);
    source.start(at, Math.random() * 1.5);
    source.stop(at + length + 0.05);
  }

  // ------------------------------------------------------------ sounds

  ding() {
    if (this.playFile('reveal') || !this.ready) return;
    const at = this.ctx.currentTime;
    const out = this.bus(0.5);
    for (const [freq, peak, length] of [[1174.7, 1, 1.6], [1760, 0.3, 1.2], [2349.3, 0.42, 1.1], [3520, 0.16, 0.7]]) {
      this.tone(out, { from: freq, at, length, peak });
    }
  }

  buzzer() {
    if (this.playFile('strike') || !this.ready) return;
    const at = this.ctx.currentTime;
    const length = 0.85;
    const out = this.bus(0.4);
    const lowpass = this.ctx.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = 1500;
    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0.0001, at);
    env.gain.linearRampToValueAtTime(1, at + 0.012);
    env.gain.setValueAtTime(1, at + length - 0.07);
    env.gain.linearRampToValueAtTime(0.0001, at + length);
    lowpass.connect(env).connect(out);
    for (const [type, freq] of [['sawtooth', 116.5], ['sawtooth', 123.4], ['square', 58.3]]) {
      const osc = this.ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = freq;
      osc.connect(lowpass);
      osc.start(at);
      osc.stop(at + length + 0.05);
    }
  }

  whoosh() {
    if (!this.ready) return;
    this.hiss(this.bus(0.3), { at: this.ctx.currentTime, length: 0.42, peak: 1, attack: 0.16, from: 350, to: 3200, q: 1.4 });
  }

  tock() {
    if (!this.ready) return;
    const at = this.ctx.currentTime;
    const out = this.bus(0.55);
    this.tone(out, { from: 190, to: 70, at, length: 0.12, peak: 1 });
    this.hiss(out, { at, length: 0.04, peak: 0.3, from: 2500, q: 0.8 });
  }

  tick() {
    if (!this.ready) return;
    this.tone(this.bus(0.16), { type: 'triangle', from: 1500, to: 900, at: this.ctx.currentTime, length: 0.05, peak: 1, attack: 0.002 });
  }

  crash() {
    if (!this.ready) return;
    const at = this.ctx.currentTime;
    const out = this.bus(0.7);
    this.hiss(out, { at, length: 2, peak: 0.55, filter: 'highpass', from: 4200, q: 0.5 });
    this.hiss(out, { at, length: 0.5, peak: 0.5, from: 1100, q: 0.6 });
    this.tone(out, { from: 120, to: 42, at, length: 0.4, peak: 1 });
  }

  // Starts the drum roll and resolves with how long to wait before the reveal.
  // cueSeconds > 0 overrides the wait; otherwise the reveal lands when the track ends.
  // The real roll keeps playing past the cue, so the beat drop lands as the answer appears.
  // A fake-out (tease) uses tease.* when present, otherwise the normal roll, and stops
  // at the same cue: it lasts just as long as the real roll but never plays the drop.
  async drumroll(cueSeconds = 0, { tease = false } = {}) {
    const useTease = tease && Boolean(this.elements.tease);
    const element = useTease ? this.elements.tease : this.elements.drumroll;
    if (element) {
      try {
        element.pause();
        element.currentTime = 0;
        await element.play();
        const length = Number.isFinite(element.duration) && element.duration > 0 ? element.duration : DEFAULT_ROLL_SECONDS;
        const cue = cueSeconds > 0 ? Math.min(cueSeconds, length) : length;
        const reached = this.untilPosition(element, cue).then(() => {
          if (tease) element.pause();
        });
        return { ms: cue * 1000, synthesized: false, reached };
      } catch {
        // Blocked or broken file: fall through to the built-in roll.
      }
    }
    const seconds = cueSeconds > 0 ? cueSeconds : DEFAULT_ROLL_SECONDS;
    if (this.ready) this.synthRoll(seconds);
    return { ms: seconds * 1000, synthesized: true };
  }

  // Resolves when the track's own playhead reaches `seconds`, so a slow start or a
  // stutter can't knock the reveal off the beat. Falls back to a timer if the
  // element stops reporting progress.
  untilPosition(element, seconds) {
    const deadline = performance.now() + seconds * 1000 + 1500;
    return new Promise((resolve) => {
      const check = () => {
        const done = element.ended || element.paused || element.currentTime >= seconds || performance.now() > deadline;
        if (done) resolve();
        else requestAnimationFrame(check);
      };
      check();
    });
  }

  synthRoll(seconds) {
    const start = this.ctx.currentTime + 0.03;
    const out = this.bus(0.85);
    let t = 0;
    let stroke = 0;
    while (t < seconds) {
      const progress = t / seconds;
      const accent = stroke % 2 ? 0.8 : 1;
      const level = (0.1 + 0.55 * progress * progress) * (0.75 + Math.random() * 0.45) * accent;
      this.hiss(out, { at: start + t, length: 0.06, peak: level, attack: 0.002, from: 1900, q: 0.7 });
      this.tone(out, { type: 'triangle', from: 196, to: 150, at: start + t, length: 0.045, peak: level * 0.5, attack: 0.002 });
      t += 0.074 - 0.04 * progress;
      stroke += 1;
    }
  }
}
