const STORAGE_KEY = "bakasha:sound-muted";

const SOUND_PATTERNS = {
  play: {
    notes: [1047, 698],
    spacing: 0.025,
    duration: 0.065,
    volume: 0.035,
    type: "triangle",
    noise: [{ duration: 0.035, volume: 0.018, frequency: 1500 }],
  },
  draw: {
    notes: [392, 262],
    spacing: 0.045,
    duration: 0.1,
    volume: 0.025,
    type: "sine",
    noise: [{ duration: 0.15, volume: 0.026, frequency: 1800, endFrequency: 420 }],
  },
  shuffle: {
    noise: [
      { duration: 0.065, volume: 0.028, frequency: 1700 },
      { offset: 0.09, duration: 0.06, volume: 0.025, frequency: 1450 },
      { offset: 0.18, duration: 0.065, volume: 0.023, frequency: 1250 },
      { offset: 0.27, duration: 0.08, volume: 0.02, frequency: 1050 },
    ],
  },
  error: {
    notes: [165, 110],
    spacing: 0.045,
    duration: 0.085,
    volume: 0.035,
    type: "triangle",
    noise: [{ duration: 0.045, volume: 0.018, frequency: 350, filter: "lowpass" }],
  },
  jack: { notes: [220, 165, 130], spacing: 0.045, duration: 0.085, volume: 0.035, type: "sawtooth" },
  two: {
    notes: [165, 110, 82],
    spacing: 0.045,
    duration: 0.1,
    volume: 0.045,
    type: "triangle",
    noise: [{ duration: 0.06, volume: 0.023, frequency: 420, filter: "lowpass" }],
  },
  joker: { notes: [587, 440, 293, 174], spacing: 0.075, duration: 0.18, volume: 0.045, type: "sawtooth" },
  ace: { notes: [1174, 1568, 1976], spacing: 0.055, duration: 0.12, volume: 0.032, type: "sine" },
  block: {
    notes: [196, 392, 587],
    spacing: 0.045,
    duration: 0.1,
    volume: 0.04,
    type: "triangle",
    noise: [{ duration: 0.07, volume: 0.022, frequency: 750 }],
  },
  lastCard: { notes: [370, 440, 554], spacing: 0.075, duration: 0.13, volume: 0.03, type: "sine" },
  win: { notes: [523, 659, 784, 1047, 784, 1047, 1318], spacing: 0.075, duration: 0.22, volume: 0.06, type: "triangle" },
  lose: { notes: [440, 349, 294, 220], spacing: 0.09, duration: 0.18, volume: 0.03, type: "sine" },
  click: { notes: [740], spacing: 0, duration: 0.055, volume: 0.025, type: "sine" },
  turn: { notes: [659, 784], spacing: 0.11, duration: 0.16, volume: 0.04, type: "sine" },
  join: { notes: [523, 784, 1047], spacing: 0.055, duration: 0.12, volume: 0.032, type: "sine" },
};

let audioContext = null;
let muted = readMutePreference();

function readMutePreference() {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function persistMutePreference() {
  try {
    window.localStorage.setItem(STORAGE_KEY, String(muted));
  } catch {
    console.warn("Could not save the game sound preference.");
  }
}

function getAudioContext() {
  const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextConstructor) return null;
  if (!audioContext) audioContext = new AudioContextConstructor();
  return audioContext;
}

function unlockAudio() {
  try {
    const context = getAudioContext();
    if (context && context.state === "suspended") {
      context.resume().catch((error) => console.warn("Could not resume game audio.", error));
    }
  } catch (error) {
    console.warn("Could not initialize game audio.", error);
  }
}

export function enableAudioUnlock() {
  document.addEventListener("pointerdown", unlockAudio, { once: true, passive: true });
  document.addEventListener("keydown", unlockAudio, { once: true });
}

export function isMuted() {
  return muted;
}

export function setMuted(value) {
  muted = Boolean(value);
  persistMutePreference();
  if (!muted) unlockAudio();
  return muted;
}

function playNoise(context, start, burst, volumeScale) {
  const duration = burst.duration;
  const buffer = context.createBuffer(1, Math.max(1, Math.ceil(context.sampleRate * duration)), context.sampleRate);
  const samples = buffer.getChannelData(0);
  for (let index = 0; index < samples.length; index += 1) samples[index] = Math.random() * 2 - 1;

  const source = context.createBufferSource();
  const filter = context.createBiquadFilter();
  const gain = context.createGain();
  const burstStart = start + (burst.offset || 0);
  source.buffer = buffer;
  filter.type = burst.filter || "highpass";
  filter.frequency.setValueAtTime(burst.frequency, burstStart);
  if (burst.endFrequency) {
    filter.frequency.exponentialRampToValueAtTime(burst.endFrequency, burstStart + duration);
  }
  gain.gain.setValueAtTime(0.0001, burstStart);
  gain.gain.exponentialRampToValueAtTime(burst.volume * volumeScale, burstStart + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, burstStart + duration);
  source.connect(filter);
  filter.connect(gain);
  gain.connect(context.destination);
  source.start(burstStart);
  source.stop(burstStart + duration + 0.01);
}

export function playSound(name, options = {}) {
  const pattern = SOUND_PATTERNS[name];
  if (!pattern || muted) return;
  const volumeScale = Number.isFinite(options.volumeScale)
    ? Math.max(0, Math.min(1, options.volumeScale))
    : 1;
  if (volumeScale === 0) return;

  try {
    const context = getAudioContext();
    if (!context) return;
    if (context.state === "suspended") {
      context.resume().catch((error) => console.warn("Could not resume game audio.", error));
    }
    const start = context.currentTime;
    for (const burst of pattern.noise || []) playNoise(context, start, burst, volumeScale);
    for (const [index, frequency] of (pattern.notes || []).entries()) {
      const noteStart = start + index * pattern.spacing;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = pattern.type;
      oscillator.frequency.setValueAtTime(frequency, noteStart);
      gain.gain.setValueAtTime(0.0001, noteStart);
      gain.gain.exponentialRampToValueAtTime(pattern.volume * volumeScale, noteStart + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, noteStart + pattern.duration);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(noteStart);
      oscillator.stop(noteStart + pattern.duration + 0.01);
    }
  } catch (error) {
    console.warn("Could not play a game sound.", error);
  }
}
