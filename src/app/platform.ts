// Native bridges (Capacitor) with web fallbacks: storage, haptics, status bar, back button.
import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { Preferences } from '@capacitor/preferences';
import { StatusBar } from '@capacitor/status-bar';

export const isNative = Capacitor.isNativePlatform();

export interface Settings { sound: boolean; music: boolean; haptics: boolean; reduceMotion: boolean | null; updates: boolean }
export interface Progress { solved: Record<string, number> }

const DEFAULT_SETTINGS: Settings = { sound: true, music: true, haptics: true, reduceMotion: null, updates: true };

async function load<T>(key: string, fallback: T): Promise<T> {
  try {
    const { value } = await Preferences.get({ key });
    return value ? { ...fallback, ...JSON.parse(value) } : fallback;
  } catch {
    return fallback;
  }
}

async function save(key: string, value: unknown) {
  try { await Preferences.set({ key, value: JSON.stringify(value) }); } catch { /* storage unavailable */ }
}

export const loadSettings = () => load<Settings>('settings', DEFAULT_SETTINGS);
export const saveSettings = (s: Settings) => save('settings', s);
export const loadProgress = () => load<Progress>('progress', { solved: {} });
export const saveProgress = (p: Progress) => save('progress', p);

let hapticsOn = true;
export const setHaptics = (on: boolean) => { hapticsOn = on; };

/** Soft taps only — never buzzy notification patterns (research §4). */
export function haptic(kind: 'tick' | 'light' = 'light') {
  if (!hapticsOn) return;
  if (isNative) {
    void (kind === 'tick' ? Haptics.selectionChanged() : Haptics.impact({ style: ImpactStyle.Light })).catch(() => {});
  } else {
    try { navigator.vibrate?.(kind === 'tick' ? 4 : 8); } catch { /* unsupported */ }
  }
}

export function hapticSelectionStart() {
  if (hapticsOn && isNative) void Haptics.selectionStart().catch(() => {});
}

export function hapticSelectionEnd() {
  if (hapticsOn && isNative) void Haptics.selectionEnd().catch(() => {});
}

export async function setupNative(onBack: () => boolean, onPause: () => void, onResume: () => void) {
  if (!isNative) return;
  try { await StatusBar.hide(); } catch { /* not available */ }
  await App.addListener('backButton', () => { if (!onBack()) void App.exitApp(); });
  await App.addListener('pause', onPause);
  await App.addListener('resume', onResume);
}
