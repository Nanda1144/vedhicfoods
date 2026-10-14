import { fileURLToPath, URL } from 'node:url'

import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

/**
 * Refuses to build a production bundle that cannot possibly reach production.
 *
 * `import.meta.env.VITE_API_URL` is inlined into the JavaScript at build time.
 * If it is missing, `src/services/http.ts` falls back to
 * `http://localhost:5000/api/v1` — and the resulting bundle ships a storefront
 * whose every API call goes to the customer's own machine. It renders, it looks
 * fine, the catalogue appears, and then login, cart, checkout and payment all
 * fail. Nothing in the deployed site says "misconfigured"; the symptom is a
 * support ticket.
 *
 * The only moment this can be caught cheaply is here, while building, so this
 * throws instead. Development and preview builds are unaffected: `localhost` is
 * the correct target for them.
 */
function assertProductionApiUrl(apiUrl: string | undefined, mode: string): void {
  if (mode !== 'production') return

  if (!apiUrl || apiUrl.trim() === '') {
    throw new Error(
      '[build] VITE_API_URL is not set for a production build.\n' +
        'Create frontend/.env.production (tracked in git) or export VITE_API_URL in the\n' +
        'build environment. Without it every API call targets http://localhost:5000.',
    )
  }

  let parsed: URL
  try {
    parsed = new URL(apiUrl)
  } catch {
    throw new Error(`[build] VITE_API_URL is not a valid URL: ${apiUrl}`)
  }

  if (parsed.protocol !== 'https:') {
    throw new Error(
      `[build] VITE_API_URL must use https in a production build, got ${parsed.protocol}//\n` +
        'A production build served over HTTPS cannot make plaintext requests without the\n' +
        'browser blocking them as mixed content — the customer sees no error at all.\n' +
        `Set VITE_API_URL=https://api.vedhicfoods.com/api/v1 (got: ${apiUrl})`,
    )
  }

  if (/^(localhost|127\.0\.0\.1|\[::1\])$/i.test(parsed.hostname)) {
    throw new Error(
      `[build] VITE_API_URL points at loopback (${parsed.hostname}).\n` +
        'That is the local development API. A production bundle must target the\n' +
        'load-balanced backend at api.vedhicfoods.com.',
    )
  }

  if (/\.(example|invalid|localhost|test)$/i.test(parsed.hostname)) {
    throw new Error(
      `[build] VITE_API_URL uses the reserved hostname ${parsed.hostname}.\n` +
        'Reserved names cannot be registered in DNS, so every request fails at runtime\n' +
        'with no build-time signal. Replace the placeholder with the real API hostname.',
    )
  }

  // The backend mounts everything under /api/v1. A bare origin builds fine and
  // then 404s on every call, so treat the omission as a build error too.
  if (!parsed.pathname.replace(/\/+$/, '').endsWith('/api/v1')) {
    throw new Error(
      `[build] VITE_API_URL must include the /api/v1 prefix, got "${parsed.pathname}".\n` +
        'The backend mounts its router at /api/v1 (src/routes/index.ts).',
    )
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Third argument '' would expose non-VITE_ vars; only VITE_ are public anyway.
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  assertProductionApiUrl(env.VITE_API_URL, mode)

  return {
    plugins: [react()],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
        // Repo-root `assests/` folder (as named by the team). Hero images dropped
        // in here are discovered automatically by `site.ts` via import.meta.glob.
        '@assets': fileURLToPath(new URL('../assests', import.meta.url)),
      },
    },
    build: {
      target: 'es2020',
      cssCodeSplit: true,
      sourcemap: false,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('node_modules/react')) return 'react'
            if (id.includes('react-router')) return 'router'
            if (id.includes('node_modules')) return 'vendor'
          },
        },
      },
    },
  }
})