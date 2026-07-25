/**
 * AudioSynth - Real-time procedural audio synthesizer using HTML5 Web Audio API.
 * Eliminates the need for external audio asset files while providing dynamic engine RPM pitch modulation.
 */
export class AudioSynth {
  constructor() {
    this.ctx = null;
    this.isInitialized = false;
    this.engineOsc = null;
    this.engineGain = null;
    this.windNode = null;
    this.windGain = null;
    this.isMuted = false;
  }

  /**
   * Initializes Web Audio Context on first user interaction (to respect browser autoplay policy).
   */
  init() {
    if (this.isInitialized) return;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;

    this.ctx = new AudioContextClass();
    this.isInitialized = true;
    this.startEngineLoop();
  }

  startEngineLoop() {
    if (!this.ctx) return;

    // 1. Engine Oscillator (Sawtooth waveform with low-pass filter for rich rumble)
    this.engineOsc = this.ctx.createOscillator();
    this.engineOsc.type = 'sawtooth';
    this.engineOsc.frequency.setValueAtTime(65, this.ctx.currentTime); // 65Hz base rumble

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(320, this.ctx.currentTime);

    this.engineGain = this.ctx.createGain();
    this.engineGain.gain.setValueAtTime(0.0, this.ctx.currentTime); // Start silent

    this.engineOsc.connect(filter);
    filter.connect(this.engineGain);
    this.engineGain.connect(this.ctx.destination);
    this.engineOsc.start();

    // 2. Wind Rush Hiss (White noise buffer through bandpass filter)
    const bufferSize = this.ctx.sampleRate * 2;
    const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      output[i] = Math.random() * 2 - 1;
    }

    this.windNode = this.ctx.createBufferSource();
    this.windNode.buffer = noiseBuffer;
    this.windNode.loop = true;

    const windFilter = this.ctx.createBiquadFilter();
    windFilter.type = 'bandpass';
    windFilter.frequency.setValueAtTime(800, this.ctx.currentTime);
    windFilter.Q.setValueAtTime(1.5, this.ctx.currentTime);

    this.windGain = this.ctx.createGain();
    this.windGain.gain.setValueAtTime(0.0, this.ctx.currentTime);

    this.windNode.connect(windFilter);
    windFilter.connect(this.windGain);
    this.windGain.connect(this.ctx.destination);
    this.windNode.start();
  }

  /**
   * Updates engine RPM pitch and wind volume per frame based on airspeed and boost state.
   * @param {number} speed - Current airspeed (40 to 360 units/s)
   * @param {boolean} isBoosting - Whether hyper-boost is active
   */
  updateEngine(speed, isBoosting) {
    if (!this.isInitialized || !this.ctx || this.isMuted) return;
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }

    const now = this.ctx.currentTime;
    
    // Calculate normalized speed (0.0 to 1.0+)
    const normSpeed = Math.max(0, (speed - 40) / 180);

    // Engine frequency rises from 65Hz to 210Hz (or 290Hz when boosting)
    const targetFreq = isBoosting ? 280 + normSpeed * 40 : 65 + normSpeed * 135;
    this.engineOsc.frequency.setTargetAtTime(targetFreq, now, 0.08);

    // Engine gain
    const targetGain = isBoosting ? 0.22 : 0.12 + normSpeed * 0.06;
    this.engineGain.gain.setTargetAtTime(targetGain, now, 0.1);

    // Wind rush gain rises sharply at high speeds
    const windVol = Math.pow(normSpeed, 1.5) * 0.15;
    this.windGain.gain.setTargetAtTime(windVol, now, 0.15);
  }

  /**
   * Plays a bright, crystalline 3-note arpeggio chime when a checkpoint is collected.
   */
  playCheckpointChime(combo = 1) {
    if (!this.isInitialized || !this.ctx || this.isMuted) return;
    const now = this.ctx.currentTime;

    // Notes scale higher slightly with combo streak
    const baseFreqs = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6
    const multiplier = Math.min(1.5, 1 + (combo - 1) * 0.05);

    baseFreqs.forEach((freq, idx) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq * multiplier, now + idx * 0.06);

      gain.gain.setValueAtTime(0, now + idx * 0.06);
      gain.gain.linearRampToValueAtTime(0.18, now + idx * 0.06 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.06 + 0.35);

      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(now + idx * 0.06);
      osc.stop(now + idx * 0.06 + 0.4);
    });
  }

  /**
   * Plays a swooshing roar when Hyper-Boost is triggered.
   */
  playBoostWhoosh() {
    if (!this.isInitialized || !this.ctx || this.isMuted) return;
    const now = this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(120, now);
    osc.frequency.exponentialRampToValueAtTime(450, now + 0.3);
    osc.frequency.exponentialRampToValueAtTime(80, now + 1.2);

    gain.gain.setValueAtTime(0.25, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 1.2);

    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 1.25);
  }

  /**
   * Plays a triumphant fanfare chord upon run completion.
   */
  playMissionComplete() {
    if (!this.isInitialized || !this.ctx || this.isMuted) return;
    const now = this.ctx.currentTime;
    const notes = [440, 554.37, 659.25, 880]; // A4 major chord

    notes.forEach((freq, idx) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now + idx * 0.08);

      gain.gain.setValueAtTime(0, now + idx * 0.08);
      gain.gain.linearRampToValueAtTime(0.2, now + idx * 0.08 + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.08 + 1.5);

      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(now + idx * 0.08);
      osc.stop(now + idx * 0.08 + 1.6);
    });
  }

  /**
   * Plays a dramatic descending crash/failure stinger.
   * @param {number} baseFreq - Starting frequency in Hz
   * @param {number} volume - Gain 0..1
   * @param {string} type - Oscillator type ('sawtooth'|'square'|'sine')
   */
  playStinger(baseFreq = 150, volume = 0.8, type = 'sawtooth') {
    if (!this.isInitialized || !this.ctx || this.isMuted) return;
    const now = this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(baseFreq, now);
    osc.frequency.exponentialRampToValueAtTime(baseFreq * 0.15, now + 1.4);

    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 1.5);

    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 1.6);
  }

  stopAll() {
    if (this.engineGain && this.ctx) {
      this.engineGain.gain.setValueAtTime(0, this.ctx.currentTime);
      this.windGain.gain.setValueAtTime(0, this.ctx.currentTime);
    }
  }

  dispose() {
    this.stopAll();
    if (this.ctx && this.ctx.state !== 'closed') {
      this.ctx.close();
    }
    this.isInitialized = false;
  }
}

export const audioSynth = new AudioSynth();
