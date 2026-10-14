import { S3Client } from '@aws-sdk/client-s3'
import { getAwsConfig } from '../../../config/aws'

const awsConfig = getAwsConfig()

export const s3Client = new S3Client({
  region: awsConfig.region,
  credentials: awsConfig.credentials,
})
