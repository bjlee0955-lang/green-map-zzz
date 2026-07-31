import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.greenmapz.app",
  appName: "Green Map-Z",
  webDir: "dist",
  server: {
    androidScheme: "https",
  },
};

export default config;
