# =============================================================================
# Vedhic Foods - database backup image
#
# BUILD CONTEXT IS THE MONOREPO ROOT:
#
#   docker build -f database/backup.Dockerfile -t vedhicfoods-backup:latest .
#
# WHY A SEPARATE IMAGE
#   The backup workflow runs `pg_dump` INSIDE the private VPC (as an ECS Fargate
#   one-off task), because the RDS instance is not publicly reachable and a
#   GitHub-hosted runner has no network path to it. That task needs three things
#   the production runtime image deliberately does not ship:
#
#     * `pg_dump` / `pg_restore`  (postgresql-client)
#     * the AWS CLI               (to upload the archive to S3 and apply retention)
#     * `database/scripts/backup-to-s3.mjs`
#
#   Baking those into `backend/Dockerfile` would grow the runtime image and widen
#   its attack surface for no operational benefit, so they live here instead.
# =============================================================================

FROM node:22-alpine

# `postgresql-client` provides pg_dump/pg_restore. The client major version must
# be >= the server's; bump the Alpine release (which tracks the current default)
# before upgrading PostgreSQL beyond it.
#
# `aws-cli` is the Alpine package (community repo, Python-based). It is
# sufficient for the `aws s3`/`aws s3api` calls the script makes and reads the
# ECS task role credentials from the container credential endpoint automatically.
RUN apk add --no-cache postgresql-client aws-cli \
  && pg_dump --version \
  && aws --version

WORKDIR /app

# Only the backup script is needed - no npm install, no application code.
COPY database/scripts/backup-to-s3.mjs ./database/scripts/backup-to-s3.mjs

# `CMD`, not `ENTRYPOINT`: the workflow overrides the command with an identical
# value, and an ENTRYPOINT here would make that override append arguments to
# `node` instead of replacing the command.
#
# DATABASE_URL is injected by the backup task definition's `secrets` block;
# BACKUP_S3_BUCKET / BACKUP_S3_PREFIX / BACKUP_RETENTION_DAYS / BACKUP_DRY_RUN
# arrive as container environment overrides. Nothing is baked into the image.
CMD ["node", "database/scripts/backup-to-s3.mjs"]
