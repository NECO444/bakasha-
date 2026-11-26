const STORAGE_KEY = "bakasha:sound-muted";
const SOUND_GAIN = 4;

const SOUND_PATTERNS = {
  play: {
    notes: [392],
    duration: 0.075,
    volume: 0.018,
    type: "sine",
    noise: [{ duration: 0.035, volume: 0.007, frequency: 900, filter: "lowpass" }],
  },
  draw: {
    noise: [{ duration: 0.16, volume: 0.012, frequency: 1400, endFrequency: 520, filter: "lowpass" }],
  },
  shuffle: {
    noise: [
      { duration: 0.11, volume: 0.012, frequency: 1100, endFrequency: 760, filter: "lowpass" },
      { offset: 0.13, duration: 0.11, volume: 0.011, frequency: 980, endFrequency: 680, filter: "lowpass" },
      { offset: 0.26, duration: 0.11, volume: 0.01, frequency: 880, endFrequency: 610, filter: "lowpass" },
      { offset: 0.39, duration: 0.12, volume: 0.009, frequency: 780, endFrequency: 540, filter: "lowpass" },
    ],
  },
  error: {
    notes: [146],
    duration: 0.085,
    volume: 0.012,
    type: "sine",
    noise: [{ duration: 0.035, volume: 0.005, frequency: 240, filter: "lowpass" }],
  },
  jack: { notes: [440, 349], spacing: 0.12, duration: 0.17, volume: 0.022, type: "triangle" },
  two: { notes: [196], duration: 0.22, volume: 0.026, type: "sine" },
  joker: { notes: [130.81], duration: 0.28, volume: 0.028, type: "sine" },
  ace: { notes: [523, 587, 659, 784, 880, 1047], spacing: 0.045, duration: 0.12, volume: 0.018, type: "sine" },
  block: { notes: [392, 523, 440], spacing: 0.055, duration: 0.12, volume: 0.018, type: "sine" },
  lastCard: { notes: [164.81, 146.83], spacing: 0.32, duration: 0.28, volume: 0.019, type: "sine" },
  win: { notes: [392, 494, 587, 784], spacing: 0.09, duration: 0.25, volume: 0.035, type: "triangle" },
  lose: { notes: [392, 330, 262], spacing: 0.13, duration: 0.22, volume: 0.022, type: "sine" },
  click: { notes: [659], duration: 0.045, volume: 0.012, type: "sine" },
  turn: { notes: [784], duration: 0.2, volume: 0.022, type: "sine" },
  join: { notes: [392, 494, 587], spacing: 0.08, duration: 0.17, volume: 0.024, type: "sine" },
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
    for (const burst of pattern.noise || []) playNoise(context, start, burst, volumeScale * SOUND_GAIN);
    for (const [index, frequency] of (pattern.notes || []).entries()) {
      const noteStart = start + index * pattern.spacing;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = pattern.type;
      oscillator.frequency.setValueAtTime(frequency, noteStart);
      gain.gain.setValueAtTime(0.0001, noteStart);
      gain.gain.exponentialRampToValueAtTime(
        pattern.volume * volumeScale * SOUND_GAIN,
        noteStart + Math.min(pattern.attack || 0.012, pattern.duration / 3),
      );
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
