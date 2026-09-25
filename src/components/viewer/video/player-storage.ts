import type { MediaStorage, SerializedVideoQuality } from "@vidstack/react";

const STORAGE_KEY = "deccan-lens:player";

interface Saved {
  volume?: number;
  muted?: boolean;
  rate?: number;
  captions?: boolean;
}

function read(): Saved {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const value: unknown = raw ? JSON.parse(raw) : null;
    return value && typeof value === "object" ? (value as Saved) : {};
  } catch {
    return {};
  }
}

function write(patch: Saved) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...read(), ...patch }));
  } catch {
    // Private mode, quota or blocked storage: preferences just don't persist.
  }
}

const num = (v: unknown, min: number, max: number) => (typeof v === "number" && Number.isFinite(v) && v >= min && v <= max ? v : null);

// Unlike Vidstack's LocalMediaStorage, never stores playback position: presigned URLs change on every
// visit, so it would never match.
export class PlayerPreferences implements MediaStorage {
  async getVolume() {
    return num(read().volume, 0, 1);
  }
  async setVolume(volume: number) {
    write({ volume });
  }
  async getMuted() {
    const v = read().muted;
    return typeof v === "boolean" ? v : null;
  }
  async setMuted(muted: boolean) {
    write({ muted });
  }
  async getPlaybackRate() {
    return num(read().rate, 0.25, 4);
  }
  async setPlaybackRate(rate: number) {
    write({ rate });
  }
  async getCaptions() {
    const v = read().captions;
    return typeof v === "boolean" ? v : null;
  }
  async setCaptions(captions: boolean) {
    write({ captions });
  }
  async getTime() {
    return null;
  }
  async getLang() {
    return null;
  }
  async getVideoQuality(): Promise<SerializedVideoQuality | null> {
    return null;
  }
  async getAudioGain() {
    return null;
  }
}
