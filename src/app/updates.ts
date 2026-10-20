// In-app update check: anyone who installed from GitHub Releases hears about newer releases.
// One small request to GitHub's public API, at most every few hours, and it can be turned off in Settings.
import { Browser } from '@capacitor/browser';
import { Preferences } from '@capacitor/preferences';
import { newer } from '../core/version';
import { isNative } from './platform';

const LATEST = 'https://api.github.com/repos/Sayandeep1013/Seamline/releases/latest';
const EVERY_MS = 6 * 60 * 60 * 1000;

export interface Update { version: string; url: string }

export const APP_VERSION = __APP_VERSION__;

/** The newest release if it's newer than this app, else null. Never throws; offline is fine. */
export async function checkForUpdate(force = false): Promise<Update | null> {
  if (!isNative && !force) return null; // the web build is always current
  try {
    if (!force) {
      const { value } = await Preferences.get({ key: 'updateCheckedAt' });
      if (value && Date.now() - Number(value) < EVERY_MS) {
        const cached = (await Preferences.get({ key: 'updateAvailable' })).value;
        const u = cached ? (JSON.parse(cached) as Update) : null;
        return u && newer(u.version, APP_VERSION) ? u : null;
      }
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    const res = await fetch(LATEST, { signal: ctrl.signal, headers: { Accept: 'application/vnd.github+json' } });
    clearTimeout(timer);
    if (!res.ok) return null;
    const rel = (await res.json()) as { tag_name: string; html_url: string; assets?: { name: string; browser_download_url: string }[] };
    const apk = rel.assets?.find((a) => a.name.endsWith('.apk'));
    const update: Update = { version: rel.tag_name.replace(/^v/, ''), url: apk?.browser_download_url ?? rel.html_url };
    await Preferences.set({ key: 'updateCheckedAt', value: String(Date.now()) });
    await Preferences.set({ key: 'updateAvailable', value: JSON.stringify(update) });
    return newer(update.version, APP_VERSION) ? update : null;
  } catch {
    return null;
  }
}

/** Open the download in the phone's browser; Android then offers to install it over this version. */
export async function openUpdate(u: Update) {
  try { await Browser.open({ url: u.url }); } catch { window.open(u.url, '_blank'); }
}
