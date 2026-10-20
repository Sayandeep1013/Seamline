import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.sayandeep.seamline',
  appName: 'Seamline',
  webDir: 'dist',
  backgroundColor: '#E3DC4E',
  android: {
    backgroundColor: '#E3DC4E',
    // The game is fully offline; no mixed content or remote debugging in release builds.
    allowMixedContent: false,
  },
};

export default config;
