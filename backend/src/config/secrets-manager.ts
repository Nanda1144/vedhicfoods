import {
  SecretsManagerClient,
  GetSecretValueCommand,
  type GetSecretValueCommandInput,
} from '@aws-sdk/client-secrets-manager'
import { logger } from './logger'

/**
 * Optional startup loader for AWS Secrets Manager.
 *
 * PREFER THE NATIVE MECHANISM. On ECS/Fargate the task definition injects
 * secrets directly into the container environment:
 *
 *   "secrets": [
 *     { "name": "JWT_SECRET", "valueFrom": "arn:aws:secretsmanager:...:secret:vedhicfoods/backend:jwt" }
 *   ]
 *
 * That needs no code, shows up in `describe-task-definition`, and is auditable by
 * anyone with `ecs:DescribeTaskDefinition`. Use it.
 *
 * This loader exists for the cases where that is not available: running the same
 * image on EC2, Elastic Beanstalk, App Runner, or in a CI task, where there is no
 * ECS agent to perform the injection. It is inert unless
 * `SECRETS_MANAGER_SECRET_ID` is set, so the ECS path stays code-free.
 *
 * SECURITY:
 *  - The task/instance role is granted `secretsmanager:GetSecretValue` on that
 *    one secret ARN only, never `*`.
 *  - Values are written to `process.env` before `env.ts` validation runs, so a
 *    missing secret still fails the Zod schema rather than defaulting.
 *  - Nothing is logged except the secret's ARN and the KEY NAMES - never values.
 */

export interface SecretsManagerLoadResult {
  loaded: boolean
  keys: string[]
}

export async function loadSecretsFromSecretsManager(): Promise<SecretsManagerLoadResult> {
  const secretId = process.env.SECRETS_MANAGER_SECRET_ID
  if (!secretId) return { loaded: false, keys: [] }

  const region = process.env.AWS_REGION
  const client = new SecretsManagerClient(region ? { region } : {})

  try {
    const input: GetSecretValueCommandInput = { SecretId: secretId }
    const result = await client.send(new GetSecretValueCommand(input))

    if (!result.SecretString) {
      // A binary secret would have to be base64-decoded before parsing. Failing
      // loudly is safer than guessing at an encoding.
      throw new Error('Secret has no SecretString payload (binary secrets are not supported)')
    }

    const parsed: unknown = JSON.parse(result.SecretString)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Secret payload is not a JSON object of KEY: "value" pairs')
    }

    const entries = parsed as Record<string, unknown>
    const applied: string[] = []

    for (const [key, value] of Object.entries(entries)) {
      if (value === null || value === undefined) continue
      // Environment variables are strings; numbers would otherwise arrive as
      // "[object Object]" through String() on objects.
      process.env[key] = typeof value === 'string' ? value : String(value)
      applied.push(key)
    }

    logger.info({ secretId, keys: applied.sort() }, 'Loaded configuration from AWS Secrets Manager')
    return { loaded: true, keys: applied.sort() }
  } catch (err: any) {
    // Fail the boot. Continuing would let the Zod schema fall back to a
    // development default for JWT_SECRET, which is the exact failure mode this
    // whole exercise exists to prevent.
    logger.error(
      { secretId, error: err?.message },
      'Failed to load configuration from AWS Secrets Manager. Refusing to start.'
    )
    throw err
  } finally {
    client.destroy()
  }
}