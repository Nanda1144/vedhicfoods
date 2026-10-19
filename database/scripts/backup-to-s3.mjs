#!/usr/bin/env node
// =============================================================================
// Automated PostgreSQL backup -> Amazon S3
//
// WHAT THIS DOES
//   1. Runs `pg_dump` against DATABASE_URL in PostgreSQL's custom format.
//      Custom format (`-Fc`) is already compressed by pg_dump, so no separate
//      gzip pass runs for it; a plain-text dump (`BACKUP_FORMAT=plain`) is piped
//      through gzip unless compression is disabled.
//   2. Validates the dump with `pg_restore --list` before it is uploaded, so a
//      truncated or corrupt archive fails here rather than at restore time.
//   3. Uploads it to `s3://BACKUP_S3_BUCKET/BACKUP_S3_PREFIX/...` with the AWS
//      CLI, then re-reads the object metadata and compares the byte count to the
//      local file - a "successful" upload that silently stored zero bytes is the
//      failure mode worth catching.
//   4. Applies a retention policy: any object under the prefix whose key looks
//      like a backup and whose LastModified is older than BACKUP_RETENTION_DAYS
//      is deleted in batches.
//
// WHY pg_dump AND NOT A SNAPSHOT
//   Supabase PostgreSQL (the managed target) exposes pg_dump through the standard
//   client tools, and this script uses that supported path. It is portable to the
//   self-managed RDS deployment too. Provider-native point-in-time recovery
//   (RDS `BackupRetentionPeriod`, Supabase PITR) is a COMPLEMENTARY control, not
//   a replacement: PITR restores the whole cluster to a moment and lives with the
//   provider, while this produces a restorable logical dump you own and can hold
//   off-provider. Run both.
//
// CONNECTION NOTE (Supabase)
//   Use the DIRECT connection string (port 5432) or the "Session" pooler, never
//   the transaction pooler (port 6543): pg_dump needs a session, and a
//   transaction-mode pooler does not provide one. A port of 6543 is logged as a
//   warning because the failure it causes is obscure.
//
// DEPENDENCIES
//   * Node.js 20+ (uses only the standard library - no npm install).
//   * `pg_dump` / `pg_restore` on PATH (install postgresql-client; the client
//     major version must be >= the server's).
//   * AWS CLI v2 on PATH, already authenticated (in CI, via GitHub OIDC).
// =============================================================================

import { spawn, spawnSync } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';

const DAY_MS = 24 * 60 * 60 * 1000;

function log(level, message) {
  process.stderr.write(`[${new Date().toISOString()}] ${level} ${message}\n`);
}

function die(message) {
  throw new Error(message);
}

function readEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return raw;
}

function readBool(name, fallback) {
  const raw = readEnv(name);
  if (raw === undefined) return fallback;
  return !/^(false|0|no|off)$/i.test(raw.trim());
}

// -----------------------------------------------------------------------------
// Configuration
// -----------------------------------------------------------------------------
function readConfig() {
  const databaseUrl = readEnv('BACKUP_DATABASE_URL') ?? readEnv('DATABASE_URL');
  if (!databaseUrl) {
    die('No database URL. Set DATABASE_URL (or BACKUP_DATABASE_URL to override it).');
  }

  const bucket = readEnv('BACKUP_S3_BUCKET');
  if (!bucket) die('BACKUP_S3_BUCKET is required (the bucket the dump is written to).');

  let prefix = readEnv('BACKUP_S3_PREFIX', 'database-backups/');
  if (!prefix.endsWith('/')) prefix += '/';

  const retentionRaw = readEnv('BACKUP_RETENTION_DAYS', '30');
  const retentionDays = Number.parseInt(retentionRaw, 10);
  if (!Number.isFinite(retentionDays) || retentionDays < 0) {
    die(`BACKUP_RETENTION_DAYS must be a non-negative integer, got "${retentionRaw}".`);
  }

  const format = (readEnv('BACKUP_FORMAT', 'custom') ?? 'custom').toLowerCase();
  if (format !== 'custom' && format !== 'plain') {
    die(`BACKUP_FORMAT must be "custom" or "plain", got "${format}".`);
  }

  const compressRequested = readBool('BACKUP_COMPRESS', true);
  const compress = format === 'plain' && compressRequested;

  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const extension = format === 'custom' ? 'dump' : compress ? 'sql.gz' : 'sql';
  const fileName = `vedhicfoods-${stamp}.${extension}`;

  return {
    databaseUrl,
    bucket,
    prefix,
    retentionDays,
    format,
    compress,
    compressRequested,
    fileName,
    objectKey: `${prefix}${fileName}`,
    region: readEnv('BACKUP_AWS_REGION') ?? readEnv('AWS_REGION') ?? readEnv('AWS_DEFAULT_REGION'),
    pgDump: readEnv('PG_DUMP', 'pg_dump'),
    pgRestore: readEnv('PG_RESTORE', 'pg_restore'),
    awsCli: readEnv('AWS_CLI', 'aws'),
    dryRun: readBool('BACKUP_DRY_RUN', false),
  };
}

// -----------------------------------------------------------------------------
// Connection: turn the URL into libpq environment variables.
//
// The password is deliberately NOT placed on any command line - pg_dump is
// handed PGHOST/PGUSER/PGPASSWORD/... through the environment instead, so it
// never appears in the process list where another user could read it.
// -----------------------------------------------------------------------------
function buildPgEnv(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    die('DATABASE_URL is not a parseable URL.');
  }

  const protocol = url.protocol.replace(/:$/, '');
  if (protocol !== 'postgres' && protocol !== 'postgresql') {
    die(`DATABASE_URL must use the postgres:// or postgresql:// scheme, got "${protocol}://".`);
  }

  const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!database) die('DATABASE_URL is missing a database name.');

  const env = {
    PGHOST: url.hostname,
    PGPORT: url.port || '5432',
    PGUSER: decodeURIComponent(url.username),
    PGDATABASE: database,
  };
  if (url.password) env.PGPASSWORD = decodeURIComponent(url.password);

  // Translate the libpq query parameters we recognise into their PG* variables,
  // and drop `schema` (a Prisma-only parameter that libpq would reject).
  const recognised = {
    sslmode: 'PGSSLMODE',
    options: 'PGOPTIONS',
    connect_timeout: 'PGCONNECT_TIMEOUT',
    application_name: 'PGAPPNAME',
  };
  for (const [key, value] of new URLSearchParams(url.search)) {
    if (key === 'schema') continue;
    const target = recognised[key];
    if (target) env[target] = value;
    else log('WARN', `Ignoring unrecognised connection parameter "${key}" in DATABASE_URL.`);
  }

  if (env.PGPORT === '6543') {
    log('WARN', 'Port 6543 looks like the Supabase transaction pooler; pg_dump needs a session. Use the direct (5432) or session-pooler connection string.');
  }

  return env;
}

// -----------------------------------------------------------------------------
// Process helpers
// -----------------------------------------------------------------------------
function run(cmd, args) {
  const result = spawnSync(cmd, args, { encoding: 'utf8' });
  if (result.error) {
    die(`Could not run ${cmd}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || '').trim();
    die(`${cmd} ${args.join(' ')} exited with code ${result.status}${detail ? `:\n${detail}` : ''}`);
  }
  return result.stdout ?? '';
}

function ensureBinary(cmd) {
  const result = spawnSync(cmd, ['--version'], { encoding: 'utf8' });
  if (result.error || result.status !== 0) {
    die(`Required binary "${cmd}" is not available on PATH.`);
  }
  log('INFO', `${cmd}: ${(result.stdout || result.stderr || '').trim()}`);
}

function awsArgs(config, args) {
  return config.region ? [...args, '--region', config.region] : args;
}

// -----------------------------------------------------------------------------
// Dump
// -----------------------------------------------------------------------------
async function createDump(config, pgEnv, outputPath) {
  const args = ['--format', config.format === 'custom' ? 'c' : 'p', '--no-owner', '--no-acl'];
  if (config.format === 'custom') {
    log('INFO', 'Running pg_dump in custom format (already compressed by pg_dump).');
  } else if (config.compress) {
    log('INFO', 'Running pg_dump in plain format; output will be gzipped.');
  } else {
    log('INFO', 'Running pg_dump in plain format without compression.');
  }

  const child = spawn(config.pgDump, args, {
    env: { ...process.env, ...pgEnv },
    stdio: ['ignore', 'pipe', 'inherit'],
    windowsHide: true,
  });

  const sink = createWriteStream(outputPath, { flags: 'wx' });
  const finished = config.compress
    ? pipeline(child.stdout, createGzip(), sink)
    : pipeline(child.stdout, sink);
  const exited = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', resolve);
  });

  const [, code] = await Promise.all([finished, exited]);
  if (code !== 0) {
    die(`pg_dump exited with code ${code}.`);
  }
}

async function validateDump(config, pgEnv, outputPath) {
  if (config.format !== 'custom') {
    return;
  }
  // `pg_restore --list` reads the archive's table of contents without touching a
  // database; a non-zero exit or empty listing means the dump is unusable.
  const result = spawnSync(config.pgRestore, ['--list', outputPath], {
    env: { ...process.env, ...pgEnv },
    encoding: 'utf8',
  });
  if (result.error) {
    die(`Could not run pg_restore to validate the dump: ${result.error.message}`);
  }
  if (result.status !== 0) {
    die(`pg_restore --list rejected the dump (exit ${result.status}); the archive is not usable.`);
  }
  const entries = (result.stdout || '').split('\n').filter((line) => line && !line.startsWith(';')).length;
  if (entries === 0) {
    die('pg_restore --list produced no entries; the dump is empty.');
  }
  log('INFO', `Dump validated: ${entries} archive entries.`);
}

// -----------------------------------------------------------------------------
// Upload
// -----------------------------------------------------------------------------
function upload(config, localPath) {
  const target = `s3://${config.bucket}/${config.objectKey}`;
  log('INFO', `Uploading to ${target}`);
  run(config.awsCli, awsArgs(config, ['s3', 'cp', localPath, target, '--only-show-errors']));

  // Confirm the object exists and is the size we uploaded. A zero-byte or
  // missing object would otherwise only surface when someone tries to restore.
  const head = JSON.parse(
    run(config.awsCli, awsArgs(config, ['s3api', 'head-object', '--bucket', config.bucket, '--key', config.objectKey, '--output', 'json'])),
  );
  return Number.parseInt(head.ContentLength, 10);
}

// -----------------------------------------------------------------------------
// Retention
// -----------------------------------------------------------------------------
function isBackupKey(key, prefix) {
  const name = key.slice(prefix.length);
  return /^vedhicfoods-.*\.(dump|sql|sql\.gz)$/.test(name);
}

function listExpiredKeys(config, cutoffMs) {
  const expired = [];
  let token;
  do {
    const args = ['s3api', 'list-objects-v2', '--bucket', config.bucket, '--prefix', config.prefix, '--output', 'json'];
    if (token) args.push('--starting-token', token);
    const page = JSON.parse(run(config.awsCli, awsArgs(config, args)));
    for (const object of page.Contents ?? []) {
      if (!isBackupKey(object.Key, config.prefix)) continue;
      if (new Date(object.LastModified).getTime() < cutoffMs) expired.push(object.Key);
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  return expired;
}

function applyRetention(config) {
  if (config.retentionDays === 0) {
    log('INFO', 'BACKUP_RETENTION_DAYS=0; retention disabled, nothing will be deleted.');
    return;
  }
  const cutoffMs = Date.now() - config.retentionDays * DAY_MS;
  const expired = listExpiredKeys(config, cutoffMs);
  if (expired.length === 0) {
    log('INFO', `Retention: no backups older than ${config.retentionDays} day(s) to remove.`);
    return;
  }

  // delete-objects accepts at most 1000 keys per call; batches of 100 keep the
  // JSON payload well under the Windows command-line length limit as well.
  for (let index = 0; index < expired.length; index += 100) {
    const batch = expired.slice(index, index + 100);
    const payload = JSON.stringify({ Objects: batch.map((Key) => ({ Key })), Quiet: true });
    run(config.awsCli, awsArgs(config, ['s3api', 'delete-objects', '--bucket', config.bucket, '--delete', payload]));
  }
  log('INFO', `Retention: removed ${expired.length} backup(s) older than ${config.retentionDays} day(s).`);
}

// -----------------------------------------------------------------------------
// Main
// -----------------------------------------------------------------------------
async function main() {
  const config = readConfig();
  const pgEnv = buildPgEnv(config.databaseUrl);

  log('INFO', `Backup target: s3://${config.bucket}/${config.prefix}${config.fileName}`);
  log('INFO', `Region: ${config.region ?? '(AWS CLI default)'} | retention: ${config.retentionDays} day(s) | dry-run: ${config.dryRun}`);

  ensureBinary(config.pgDump);
  if (config.format === 'custom') ensureBinary(config.pgRestore);
  ensureBinary(config.awsCli);

  const workDir = await mkdtemp(join(tmpdir(), 'vedhicfoods-backup-'));
  try {
    const outputPath = join(workDir, config.fileName);
    await createDump(config, pgEnv, outputPath);

    const localSize = (await stat(outputPath)).size;
    if (localSize === 0) die('pg_dump produced an empty file.');
    log('INFO', `Dump written: ${config.fileName} (${(localSize / 1024 / 1024).toFixed(1)} MiB).`);

    await validateDump(config, pgEnv, outputPath);

    if (config.dryRun) {
      log('INFO', 'Dry-run complete: dump created and validated, upload and retention skipped.');
      return;
    }

    const uploadedSize = upload(config, outputPath);
    if (uploadedSize !== localSize) {
      die(`Uploaded size ${uploadedSize} does not match local size ${localSize}.`);
    }
    log('INFO', 'Upload verified (byte count matches).');

    applyRetention(config);
    log('INFO', 'Backup finished successfully.');
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  log('ERROR', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
