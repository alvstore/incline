import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.lovable.d93958694f5c4b428e1d4027aacab172',
  appName: 'incline',
  webDir: 'dist',
  server: {
    // Hot-reload from the Lovable sandbox. Remove `url` before store release
    // so the app ships the bundled build from `dist`.
    url: 'https://d9395869-4f5c-4b42-8e1d-4027aacab172.lovableproject.com?forceHideBadge=true',
    cleartext: true,
  },
};

export default config;
