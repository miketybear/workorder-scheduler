import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { defineConfig, mergeConfig } from 'vitest/config';
import baseConfig from './vite.config.ts';

export default mergeConfig(baseConfig, defineConfig({
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    forwardConsole: false,
    https: {
      pfx: readFileSync(new URL('../.cache/local-https/localhost.pfx', import.meta.url)),
      passphrase: readFileSync(
        new URL('../.cache/local-https/pfx-password.txt', import.meta.url), 'utf8',
      ).trim(),
    },
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        configure(proxy) {
          // Vite logs the request URL on proxy failure; never log OIDC code/state.
          proxy.on('error', (_error, request) => {
            request.url = request.url?.split('?')[0];
          });
        },
      },
    },
  },
}));
