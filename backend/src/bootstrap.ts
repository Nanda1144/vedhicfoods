/**
 * Process entrypoint.
 *
 * Exists solely so configuration can be resolved before ANY module reads it.
 *
 * `config/env.ts` validates `process.env` at import time and exports a frozen
 * `env` object that the whole codebase imports directly. That means secrets
 * cannot be fetched later "just before use" - by then every consumer already
 * holds the pre-secret values. So the order has to be:
 *
 *   1. load secrets from AWS Secrets Manager (if configured)
 *   2. only then dynamically import ./server, which pulls in env.ts
 *
 * A static `import './server'` at the top of this file would be hoisted above the
 * secret fetch and silently defeat it, which is why the import is dynamic.
 *
 * On ECS/Fargate this step is a no-op: the task definition injects secrets as
 * environment variables, so `SECRETS_MANAGER_SECRET_ID` is unset and there is
 * nothing to fetch.
 */
async function main(): Promise<void> {
  // Imported here rather than at the top so this module's own logger is
  // available before anything else is evaluated.
  const { loadSecretsFromSecretsManager } = await import('./config/secrets-manager')

  try {
    await loadSecretsFromSecretsManager()
  } catch {
    // Already logged with the secret ARN and reason. Exiting non-zero makes the
    // task fail its start rather than run on development defaults.
    process.exit(1)
  }

  // Dynamic: everything below is evaluated only after secrets are in place.
  await import('./server')
}

void main()