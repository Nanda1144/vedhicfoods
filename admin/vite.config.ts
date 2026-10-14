import { fileURLToPath, URL } from 'node:url'

import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

/**
 * Same production guard as the storefront (frontend/vite.config.ts), kept as a
 * copy rather than a shared module because these two SPAs are built and deployed
 * independently.
 *
 * The admin case is the more dangerous of the two. An admin bundle pointed at
 * `http://localhost:5000` does not merely fail to save a product image: staff see
 * a login form, enter real credentials, and the credentials go nowhere. Worse, if
 * the backend ever served an admin origin over plaintext HTTP, a network attacker
 * could rewrite the admin page to point at their own host and harvest the session
 * token as it is typed. Neither failure announces itself.
 */
function assertProductionApiUrl(apiUrl: string | undefined, mode: string): void {
  if (mode !== 'production') return

  if (!apiUrl || apiUrl.trim() === '') {
    throw new Error(
      '[build] VITE_API_URL is not set for a production build.\n' +
        'Create admin/.env.production (tracked in git) or export VITE_API_URL in the\n' +
        'build environment. Without it the admin portal talks to http://localhost:5000.',
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
        'The admin portal carries staff credentials and session tokens. Transporting them\n' +
        'over plaintext HTTP is not a configuration nit; it is credential theft waiting\n' +
        'for someone on the same network.\n' +
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
        'Reserved names cannot be registered in DNS. Replace the placeholder with the\n' +
        'real API hostname.',
    )
  }

  if (!parsed.pathname.replace(/\/+$/, '').endsWith('/api/v1')) {
    throw new Error(
      `[build] VITE_API_URL must include the /api/v1 prefix, got "${parsed.pathname}".\n` +
        'The backend mounts its router at /api/v1 (src/routes/index.ts).',
    )
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  assertProductionApiUrl(env.VITE_API_URL, mode)

  return {
    plugins: [react()],
    server: {
      port: 5174,
    },
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
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