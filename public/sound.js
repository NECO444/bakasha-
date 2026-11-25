const STORAGE_KEY = "bakasha:sound-muted";

const SOUND_PATTERNS = {
  play: { notes: [587, 740], spacing: 0.075, duration: 0.11, volume: 0.045, type: "sine" },
  draw: { notes: [494, 392], spacing: 0.08, duration: 0.12, volume: 0.04, type: "sine" },
  error: { notes: [262, 196], spacing: 0.07, duration: 0.1, volume: 0.035, type: "triangle" },
  penalty: { notes: [349, 277, 208], spacing: 0.075, duration: 0.13, volume: 0.045, type: "triangle" },
  win: { notes: [523, 659, 784, 1047], spacing: 0.085, duration: 0.18, volume: 0.05, type: "sine" },
  lose: { notes: [392, 330, 262], spacing: 0.1, duration: 0.2, volume: 0.035, type: "sine" },
  click: { notes: [740], spacing: 0, duration: 0.055, volume: 0.025, type: "sine" },
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

export function playSound(name) {
  const pattern = SOUND_PATTERNS[name];
  if (!pattern || muted) return;

  try {
    const context = getAudioContext();
    if (!context) return;
    if (context.state === "suspended") {
      context.resume().catch((error) => console.warn("Could not resume game audio.", error));
    }
    const start = context.currentTime;
    pattern.notes.forEach((frequency, index) => {
      const noteStart = start + index * pattern.spacing;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = pattern.type;
      oscillator.frequency.setValueAtTime(frequency, noteStart);
      gain.gain.setValueAtTime(0.0001, noteStart);
      gain.gain.exponentialRampToValueAtTime(pattern.volume, noteStart + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, noteStart + pattern.duration);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(noteStart);
      oscillator.stop(noteStart + pattern.duration + 0.01);
    });
  } catch (error) {
    console.warn("Could not play a game sound.", error);
  }
}
