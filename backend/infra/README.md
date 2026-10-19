# `backend/infra` — what lives here, what to configure, and why

Everything in this directory describes a *production* AWS deployment: the ECS Fargate
task shape, the IAM roles, and the CloudFormation stacks for the edge (ALB/ACM/Route 53
to the app), the database, and monitoring. `AWS_DEPLOYMENT.md` (one directory up) is the
long-form walkthrough; this file is the reference for the pieces the workflows and
scripts depend on.

## Files

| File | Purpose |
| --- | --- |
| `ecs-task-definition.json` | Fargate task definition for the backend, with every account-specific value left as a `REPLACE_ME_*` marker. Committed on purpose: it carries ARNs, never values. |
| `iam-policies.json` | The two roles — **ExecutionRole** (ECS agent) and **TaskRole** (the app). |
| `s3-cors.json` | CORS policy applied to the product-images/invoices bucket. |
| `validate-task-definition.ps1` | Read-only pre-flight that fails on leftover `REPLACE_ME_*`, embedded secret values, broken `!Ref`/`!GetAtt`, and edge/backend timeout mismatches. Run before every deploy; it never calls AWS. |
| `scripts/create-secrets.ps1` | Creates the seven Secrets Manager secrets the task definition references. See "Secrets" below. |
| `scripts/create-cloudwatch.ps1` | Creates the CloudWatch log group with retention. See "CloudWatch" below. |
| `cloudformation/vedhicfoods-edge.yaml` | ALB, ACM certificate, hostnames, Route 53 records, security groups. |
| `cloudformation/vedhicfoods-database.yaml` | RDS PostgreSQL (`postgres16` by parameter), its subnet group, security group and parameter group. |
| `cloudformation/vedhicfoods-ses.yaml` | SES sending domain (DKIM), configuration set with reputation metrics, and the SNS topic carrying bounce/complaint events to `/api/v1/webhooks/email/sns`. |
| `cloudformation/vedhicfoods-monitoring.yaml` | Log groups, alarms, budget. |

## The two roles (do not collapse them)

- **ExecutionRole** — what the *ECS agent* does for the task: pull the ECR image, resolve
  the `secrets[].valueFrom` ARNs from Secrets Manager, and write stdout to CloudWatch.
  It can read `vedhicfoods/backend/*` secrets and nothing else.
- **TaskRole** — what the *application* runs as: S3 `products/*` + `invoices/*`, SES, and
  an **explicit Deny on every `secretsmanager` action**. The app receives its secrets
  through ECS injection; if it could also read Secrets Manager directly, a compromised
  process could read every secret in the account through an SDK already installed.

## Secrets (`scripts/create-secrets.ps1`)

The task definition references seven ARNs — `DATABASE_URL`, `JWT_SECRET`,
`ENCRYPTION_KEY`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`,
`BREVO_API_KEY` — under the prefix `vedhicfoods/backend/`. **All seven must exist before
the first task starts**; a task whose `secrets[].valueFrom` resolves to nothing never
becomes healthy.

The script is idempotent (existing secrets are left untouched), generates
`JWT_SECRET` and `ENCRYPTION_KEY` from a CSPRNG when not supplied, and never prints or
argv-exposes a value — secrets pass to Secrets Manager through a temp file that is
deleted immediately. `-WhatIf` shows the plan without writing. Values are supplied with
`-Value @{ NAME = '...' }`, an environment variable `VF_SECRET_<NAME>`, or interactively.

Do **not** pass `-Force` against `ENCRYPTION_KEY`: stored payment credentials are
AES-256-GCM encrypted under it with no key version in the ciphertext, so overwriting
the key without first re-encrypting makes them permanently unreadable and takes online
payment down. See `PRODUCTION_RUNBOOK.md` §6.2.

## CloudWatch (`scripts/create-cloudwatch.ps1`)

The task definition sets `awslogs-create-group: true` and the execution role grants
`logs:CreateLogGroup` on the backend log group, so a missing group no longer blocks
logging. The script still creates the group and sets a 30-day retention in one step — a
group created by `awslogs-create-group` alone defaults to "never expire", which is a
cost and, for order/payment data, a policy failure — so prefer running it before the
first deploy.

## What GitHub needs before a workflow can deploy

Two failures bite the first deploy:

1. **The OIDC provider must exist before `configure-aws-credentials` runs.** Create the
   GitHub OIDC provider for `token.actions.githubusercontent.com` in IAM, then the deploy
   role with this trust policy:

   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Effect": "Allow",
         "Principal": {
           "Federated": "arn:aws:iam::ACCOUNT_ID:oidc-provider/token.actions.githubusercontent.com"
         },
         "Action": "sts:AssumeRoleWithWebIdentity",
         "Condition": {
           "StringEquals": {
             "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
           },
           "StringLike": {
             "token.actions.githubusercontent.com:sub": "repo:OWNER/vedhifoods:ref:refs/heads/main"
           }
         }
       }
     ]
   }
   ```

   Pinning `sub` to `refs/heads/main` is what stops a `workflow_dispatch` on an
   arbitrary branch — or a compromised fork — from assuming the deploy role. Give the
   role the permissions the deploy script performs: ECR `GetAuthorizationToken` +
   push, ECS run-task/register-task-definition/update-service/describe, Secrets Manager
   `GetSecretValue` on `vedhicfoods/backend/*`, the S3/SES/CloudWatch actions the execute
   steps need, and `iam:PassRole` limited to the execution and task roles.

2. **Repository variables must exist before either workflow runs.** The workflows read
   them via `vars.*`; a missing variable fails the deploy's own "Assert configuration is
   present" step. Set all of these in **Settings → Secrets and variables → Actions →
   Variables** (they are *variables*, not secrets — none of them is confidential):

   | Variable | Used for |
   | --- | --- |
   | `AWS_REGION` | Every `aws` call in deploy; the OIDC credential session |
   | `AWS_DEPLOY_ROLE_ARN` | The OIDC role the deploy assumes |
   | `ECR_REGISTRY` | `ACCOUNT.dkr.ecr.REGION.amazonaws.com` — image push/pull host |
   | `ECR_REPOSITORY` | Image repository name (the deploy tags `:sha` and `:stable`) |
   | `ECS_CLUSTER_NAME` | Cluster for the service and the migration one-off task |
   | `ECS_SERVICE_NAME` | Service that is updated on deploy |
   | `ECS_TASK_FAMILY` | Task-definition family for the register/update calls |
   | `ECS_MIGRATION_TASK_DEFINITION` | Task-definition family used for the migration run-task |
   | `PRIVATE_SUBNET_IDS` | Subnets for Fargate tasks (`run-task` needs them) |
   | `TASK_SECURITY_GROUP_ID` | Security group for the tasks |
   | `FRONTEND_URL` | The `production` environment URL shown in the deploy panel |
   | `API_URL` | Deploy summary link (also expected by env docs) |

   No repository **Secret** is referenced by either workflow. The CI integration job
   points its own databases at a runner-local `postgres:16-alpine` and hard-codes a
   loopback `TEST_DATABASE_URL`, so nothing needs to be stored as a Secret.

   `frontend/.env.production` and `admin/.env.production` exist in the repo with
   committed values (`VITE_API_URL` + the S3/CloudFront origin they are uploaded to).
   Point `API_URL`/`FRONTEND_URL` at the same values so the deploy summary, and the
   front-end builds, agree with the actual deployment target.

## Validation, before and after substitution

```powershell
# Pre-flight, no AWS needed. Fails while any REPLACE_ME marker remains.
powershell -ExecutionPolicy Bypass -File backend\infra\validate-task-definition.ps1

# Once the markers are substituted: prove the templates parse (AWS syntax).
aws cloudformation validate-template --template-body file://backend/infra/cloudformation/vedhicfoods-edge.yaml
aws cloudformation validate-template --template-body file://backend/infra/cloudformation/vedhicfoods-database.yaml
aws cloudformation validate-template --template-body file://backend/infra/cloudformation/vedhicfoods-ses.yaml
aws cloudformation validate-template --template-body file://backend/infra/cloudformation/vedhicfoods-monitoring.yaml
```

`validate-task-definition.ps1` is a *reference* check; run the three
`validate-template` calls for *syntax*. The full order of operations — secrets, log
group, stacks, migration task, service update — is in `PRODUCTION_RUNBOOK.md` §6.