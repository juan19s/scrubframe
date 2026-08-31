import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

// https://wxt.dev/api/config.html
export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-react'],

  vite: () => ({
    plugins: [tailwindcss()],
    build: {
      // Vite's modulepreload polyfill ships a literal `fetch()` call. Chrome
      // supports modulepreload natively, so the polyfill is dead weight that
      // would put a network primitive in a bundle we claim has none (SPEC 7.4).
      modulePreload: { polyfill: false },
    },
  }),

  manifest: ({ mode }) => ({
    name: 'Scrubframe',
    description:
      'Turn any web animation into a labeled frame sheet and a real timing spec.',
    // ADR-002: no fixed host_permissions. Access is granted per tab, per
    // session, when the user clicks the toolbar icon.
    permissions: ['debugger', 'activeTab', 'scripting', 'downloads', 'storage'],
    // Reserved for a future batch mode. Never requested at install time.
    optional_host_permissions: ['<all_urls>'],
    // Dev builds need a websocket back to the WXT dev server for HMR, so the
    // hard no-network CSP is only applied to what we actually ship (see §7.1).
    ...(mode === 'production'
      ? {
          content_security_policy: {
            extension_pages:
              "script-src 'self'; object-src 'self'; connect-src 'self'; default-src 'self'",
          },
        }
      : {}),
  }),
});
