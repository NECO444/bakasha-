const STORAGE_KEY = "bakasha:sound-muted";
const VOLUME_STORAGE_KEY = "bakasha:sound-volume";
const DEFAULT_VOLUME = 0.3;
const SOUND_GAIN = 4;
const SOUND_BATCH_DELAY = 32;

const SOUND_PATTERNS = {
  play: {
    notes: [392],
    duration: 0.24,
    volume: 0.018,
    type: "sine",
    noise: [{ duration: 0.045, volume: 0.005, frequency: 850, filter: "lowpass" }],
  },
  draw: {
    noise: [{ duration: 0.22, volume: 0.012, frequency: 1400, endFrequency: 520, filter: "lowpass" }],
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
    notes: [146.83],
    duration: 0.22,
    volume: 0.012,
    type: "sine",
    noise: [{ duration: 0.035, volume: 0.004, frequency: 240, filter: "lowpass" }],
  },
  jack: { notes: [440, 392], spacing: 0.12, duration: 0.24, volume: 0.022, type: "triangle" },
  two: { notes: [196], duration: 0.24, volume: 0.026, type: "sine" },
  joker: { notes: [130.81], duration: 0.28, volume: 0.028, type: "sine" },
  ace: { notes: [523.25, 587.33, 659.25, 783.99, 880, 1046.5], spacing: 0.07, duration: 0.22, volume: 0.018, type: "sine" },
  block: { notes: [392, 523.25, 440], spacing: 0.07, duration: 0.22, volume: 0.018, type: "sine" },
  lastCard: { notes: [164.81, 146.83], spacing: 0.32, duration: 0.28, volume: 0.019, type: "sine" },
  win: { notes: [392, 523.25, 587.33, 783.99], spacing: 0.11, duration: 0.28, volume: 0.035, type: "triangle" },
  lose: { notes: [392, 329.63, 261.63], spacing: 0.15, duration: 0.24, volume: 0.022, type: "sine" },
  click: { notes: [659.25], duration: 0.22, volume: 0.008, type: "sine" },
  turn: { notes: [783.99], duration: 0.24, volume: 0.022, type: "sine" },
  join: { notes: [392, 523.25, 587.33], spacing: 0.1, duration: 0.23, volume: 0.024, type: "sine" },
};

const SOUND_PRIORITY = {
  click: 1,
  play: 2,
  draw: 3,
  shuffle: 3,
  join: 3,
  turn: 4,
  error: 4,
  jack: 5,
  two: 5,
  joker: 5,
  ace: 5,
  block: 6,
  lastCard: 7,
  lose: 8,
  win: 9,
};

let audioContext = null;
let masterGain = null;
let muted = readMutePreference();
let volume = readVolumePreference();
let audioUnlocked = false;
let pendingSounds = [];
let soundBatchTimer = null;

function readMutePreference() {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function readVolumePreference() {
  try {
    const storedVolume = Number(window.localStorage.getItem(VOLUME_STORAGE_KEY));
    return window.localStorage.getItem(VOLUME_STORAGE_KEY) !== null
      && Number.isFinite(storedVolume)
      && storedVolume >= 0
      && storedVolume <= 1
      ? storedVolume
      : DEFAULT_VOLUME;
  } catch {
    return DEFAULT_VOLUME;
  }
}

function persistMutePreference() {
  try {
    window.localStorage.setItem(STORAGE_KEY, String(muted));
  } catch {
    console.warn("Could not save the game sound preference.");
  }
}

function persistVolumePreference() {
  try {
    window.localStorage.setItem(VOLUME_STORAGE_KEY, String(volume));
  } catch {
    console.warn("Could not save the game sound volume.");
  }
}

function getAudioContext() {
  const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextConstructor) return null;
  if (!audioContext) {
    const context = new AudioContextConstructor();
    const gain = context.createGain();
    const filter = context.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 2400;
    filter.Q.value = 0.7;
    gain.connect(filter);
    filter.connect(context.destination);
    audioContext = context;
    masterGain = gain;
    updateMasterGain();
  }
  return audioContext;
}

function updateMasterGain() {
  if (!audioContext || !masterGain) return;
  const targetGain = muted ? 0.0001 : volume / DEFAULT_VOLUME;
  const now = audioContext.currentTime;
  masterGain.gain.cancelScheduledValues(now);
  masterGain.gain.setTargetAtTime(targetGain, now, 0.018);
}

function unlockAudio() {
  audioUnlocked = true;
  try {
    const context = getAudioContext();
    if (context && !muted && volume > 0 && context.state === "suspended") {
      context.resume().catch((error) => console.warn("Could not resume game audio.", error));
    }
  } catch (error) {
    console.warn("Could not initialize game audio.", error);
  }
}

export function enableAudioUnlock() {
  const unlockOnFirstInput = () => {
    document.removeEventListener("pointerdown", unlockOnFirstInput);
    document.removeEventListener("keydown", unlockOnFirstInput);
    unlockAudio();
  };
  document.addEventListener("pointerdown", unlockOnFirstInput, { once: true, passive: true });
  document.addEventListener("keydown", unlockOnFirstInput, { once: true });
}

export function isMuted() {
  return muted;
}

export function getVolume() {
  return volume;
}

export function setMuted(value) {
  muted = Boolean(value);
  persistMutePreference();
  updateMasterGain();
  if (muted) {
    pendingSounds = [];
    window.clearTimeout(soundBatchTimer);
    soundBatchTimer = null;
  } else {
    unlockAudio();
  }
  return muted;
}

export function setVolume(value) {
  volume = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : DEFAULT_VOLUME;
  persistVolumePreference();
  updateMasterGain();
  if (!muted && volume > 0 && audioUnlocked) unlockAudio();
  if (volume === 0) {
    pendingSounds = [];
    window.clearTimeout(soundBatchTimer);
    soundBatchTimer = null;
  }
  return volume;
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
  filter.type = burst.filter || "lowpass";
  filter.frequency.setValueAtTime(burst.frequency, burstStart);
  if (burst.endFrequency) {
    filter.frequency.exponentialRampToValueAtTime(burst.endFrequency, burstStart + duration);
  }
  gain.gain.setValueAtTime(0.0001, burstStart);
  gain.gain.exponentialRampToValueAtTime(burst.volume * volumeScale * SOUND_GAIN, burstStart + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, burstStart + duration);
  source.connect(filter);
  filter.connect(gain);
  gain.connect(masterGain);
  source.start(burstStart);
  source.stop(burstStart + duration + 0.01);
}

function playPattern(name, volumeScale) {
  const pattern = SOUND_PATTERNS[name];
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
      gain.gain.exponentialRampToValueAtTime(
        pattern.volume * volumeScale * SOUND_GAIN,
        noteStart + Math.min(pattern.attack || 0.018, pattern.duration / 3),
      );
      gain.gain.exponentialRampToValueAtTime(0.0001, noteStart + pattern.duration);
      oscillator.connect(gain);
      gain.connect(masterGain);
      oscillator.start(noteStart);
      oscillator.stop(noteStart + pattern.duration + 0.01);
    }
  } catch (error) {
    console.warn("Could not play a game sound.", error);
  }
}

function flushPendingSounds() {
  soundBatchTimer = null;
  if (muted || volume === 0 || !audioUnlocked || pendingSounds.length === 0) {
    pendingSounds = [];
    return;
  }
  const selectedSound = pendingSounds.reduce((selected, sound) =>
    SOUND_PRIORITY[sound.name] > SOUND_PRIORITY[selected.name] ? sound : selected,
  );
  pendingSounds = [];
  playPattern(selectedSound.name, selectedSound.volumeScale);
}

export function playSound(name, options = {}) {
  if (!SOUND_PATTERNS[name] || muted || volume === 0 || !audioUnlocked) return;
  const volumeScale = Number.isFinite(options.volumeScale)
    ? Math.max(0, Math.min(1, options.volumeScale))
    : 1;
  if (volumeScale === 0) return;

  pendingSounds.push({ name, volumeScale });
  if (soundBatchTimer === null) {
    soundBatchTimer = window.setTimeout(flushPendingSounds, SOUND_BATCH_DELAY);
  }
}
