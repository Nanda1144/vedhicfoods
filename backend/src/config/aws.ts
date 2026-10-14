import { env } from './env'

export interface AwsConfig {
  region: string
  credentials?: {
    accessKeyId: string
    secretAccessKey: string
  }
}

/**
 * Resolves AWS Client configuration:
 * In development, uses explicit ACCESS_KEY_ID / SECRET_ACCESS_KEY if supplied in .env.
 * In production AWS (EC2/ECS/App Runner), credentials should be provided by IAM Instance/Task Role.
 */
export function getAwsConfig(): AwsConfig {
  const config: AwsConfig = {
    region: env.AWS_REGION,
  }

  if (env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY) {
    config.credentials = {
      accessKeyId: env.AWS_ACCESS_KEY_ID,
      secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
    }
  }

  return config
}
