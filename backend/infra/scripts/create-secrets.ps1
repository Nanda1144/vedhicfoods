<#
.SYNOPSIS
    Creates the AWS Secrets Manager secrets referenced by the backend task definition.

.DESCRIPTION
    `ecs-task-definition.json` refers to seven secrets by ARN and never carries a
    value, so the secrets have to exist BEFORE the first task is started - an ECS
    task whose `secrets[].valueFrom` names a missing secret never becomes healthy.
    This script creates them, and only them, under one prefix.

    Properties that matter:
      * IDEMPOTENT. An existing secret is left exactly as it is. Re-running the
        script never overwrites a value unless -Force is passed, because the
        cheap-looking "just create it again" is how a working JWT_SECRET or
        ENCRYPTION_KEY gets replaced by a fresh random one and every stored
        session and stored payment credential stops verifying.
      * GENERATES. JWT_SECRET and ENCRYPTION_KEY are produced from a CSPRNG when
        you do not supply them, rather than being invented by a human or reused
        from an example file.
      * QUIET. No secret value is ever written to the console, to a log, or to
        the `aws` command line. Values reach Secrets Manager through a temp file
        that is deleted in a `finally` block, because a value on argv is readable
        in the process list by anything else running as your user.

    Secrets and where their values come from, in order:
      1. -Value @{ NAME = '...' }
      2. environment variable VF_SECRET_NAME   (e.g. VF_SECRET_DATABASE_URL)
      3. generated, for JWT_SECRET and ENCRYPTION_KEY only
      4. an interactive prompt, unless -NonInteractive was given

    Required AWS permissions (your own credentials, not the task roles):
    secretsmanager:ListSecrets, secretsmanager:CreateSecret,
    secretsmanager:PutSecretValue.

.NOTES
    ENCRYPTION_KEY rotation is NOT what this script is for. Payment credentials
    are AES-256-GCM encrypted under this key with no key version in the
    ciphertext; -Force against ENCRYPTION_KEY makes them permanently unreadable
    and takes online payment down. See PRODUCTION_RUNBOOK.md section 6.2.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File backend\infra\scripts\create-secrets.ps1 -WhatIf

    Shows what would be created without contacting AWS for writes.

.EXAMPLE
    $env:VF_SECRET_DATABASE_URL = 'postgresql://...'
    powershell -ExecutionPolicy Bypass -File backend\infra\scripts\create-secrets.ps1

.EXAMPLE
    # Non-interactive: fail loudly instead of prompting.
    powershell -ExecutionPolicy Bypass -File backend\infra\scripts\create-secrets.ps1 -NonInteractive
#>
[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'Medium')]
param(
    # Passed straight to the AWS CLI. Leave empty to use your configured default.
    [string]$Region,

    # Must match the `arn:aws:secretsmanager:...:secret:<Prefix>/*` resource the
    # execution role is allowed to read in iam-policies.json.
    [string]$Prefix = 'vedhicfoods/backend',

    # Explicit values, e.g. -Value @{ DATABASE_URL = 'postgresql://...' }
    [hashtable]$Value,

    # Never prompt; missing required values become failures instead of questions.
    [switch]$NonInteractive,

    # Overwrite an existing secret. See the ENCRYPTION_KEY warning above.
    [switch]$Force
)

$ErrorActionPreference = 'Stop'
$script:Failures = @()
$script:AwsArgs = @()
if ($Region) { $script:AwsArgs = @('--region', $Region) }

# Secret definitions. `Generated` means a CSPRNG value is made when nothing is
# supplied. `Required` is whether an empty value is acceptable - an empty
# BREVO_API_KEY is fine when EMAIL_PROVIDER=ses, an empty DATABASE_URL is not.
$script:SecretSpecs = @(
    @{ Name = 'DATABASE_URL';           Generated = $false; Required = $true;  Description = 'PostgreSQL connection string used by Prisma' }
    @{ Name = 'JWT_SECRET';             Generated = $true;  Required = $true;  Description = 'HS256 signing key for access and refresh tokens' }
    @{ Name = 'ENCRYPTION_KEY';         Generated = $true;  Required = $true;  Description = 'Source key for AES-256-GCM encryption of stored payment credentials' }
    @{ Name = 'RAZORPAY_KEY_ID';        Generated = $false; Required = $false; Description = 'Razorpay key id; may be empty when payments are disabled' }
    @{ Name = 'RAZORPAY_KEY_SECRET';    Generated = $false; Required = $false; Description = 'Razorpay key secret; may be empty when payments are disabled' }
    @{ Name = 'RAZORPAY_WEBHOOK_SECRET'; Generated = $false; Required = $true;  Description = 'Signature secret for inbound Razorpay webhooks' }
    @{ Name = 'BREVO_API_KEY';          Generated = $false; Required = $false; Description = 'Brevo API key; may be empty when EMAIL_PROVIDER=ses' }
)

function Add-Failure { param([string]$Message) $script:Failures += $Message }

function New-RandomValue {
    # PS 5.1 runs on .NET Framework, which has no RandomNumberGenerator.GetRandomBytes
    # static helper - Create() + GetBytes() is the portable form.
    param([int]$ByteCount = 48)
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $bytes = New-Object byte[] $ByteCount
        $rng.GetBytes($bytes)
        return [Convert]::ToBase64String($bytes)
    }
    finally {
        $rng.Dispose()
    }
}

# Runs the AWS CLI and turns a non-zero exit into a PowerShell exception.
#
# stderr is deliberately NOT redirected: under `$ErrorActionPreference = 'Stop'`
# in Windows PowerShell 5.1, redirecting a native command's stderr (`2>&1`,
# `2>$null`, `2>file`) rethrows it as a terminating RemoteException. Letting it
# flow to the console keeps real AWS errors visible and keeps this script's
# control flow in `$LASTEXITCODE`.
function Invoke-Aws {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true, ValueFromRemainingArguments = $true)][string[]]$Arguments)

    $output = & aws @Arguments
    $code = $LASTEXITCODE
    if ($code -ne 0) {
        throw "aws $($Arguments -join ' ') exited with code $code"
    }
    return $output
}

# Returns the ARN of an existing secret, or an empty string. Uses list-secrets
# rather than describe-secret so the "not created yet" case is a normal empty
# result instead of a failing call whose stderr has to be swallowed.
function Get-SecretArn {
    param([string]$Name)

    $query = "SecretList[?Name=='$Name'].Arn"
    $arn = Invoke-Aws secretsmanager list-secrets `
        --filters "Key=name,Values=$Name" `
        --query $query `
        --output text @script:AwsArgs
    return ("$arn".Trim())
}

# Writes the value through a temp file rather than through argv. A value passed
# as a command-line argument is visible in the process list to anything else
# running as the same user; the file is deleted in a `finally` block on both the
# success and the failure path.
function Invoke-AwsWithSecret {
    param(
        # Arguments that precede --secret-string, e.g. secretsmanager create-secret ...
        [string[]]$PreArguments,
        [string]$Value
    )

    $tempFile = Join-Path ([System.IO.Path]::GetTempPath()) `
        ('vedhicfoods-' + [guid]::NewGuid().ToString('N') + '.txt')
    try {
        [System.IO.File]::WriteAllText($tempFile, $Value)
        # AWS CLI accepts file:// for any string parameter. Forward slashes stop
        # the backslashes in a Windows temp path from being read as escapes.
        $uri = 'file://' + ($tempFile -replace '\\', '/')
        $full = @($script:AwsArgs) + @($PreArguments) + @('--secret-string', $uri)
        $output = & aws @full
        $code = $LASTEXITCODE
        if ($code -ne 0) {
            throw "aws $($PreArguments -join ' ') exited with code $code"
        }
        return ("$output".Trim())
    }
    finally {
        Remove-Item -LiteralPath $tempFile -Force -ErrorAction SilentlyContinue
    }
}

function New-Secret {
    param(
        [string]$Name,
        [string]$Value,
        [string]$Description
    )

    $arn = Invoke-AwsWithSecret -Value $Value -PreArguments @(
        'secretsmanager', 'create-secret',
        '--name', $Name,
        '--description', $Description,
        '--tags', 'Key=Application,Value=vedhicfoods', 'Key=ManagedBy,Value=create-secrets.ps1'
    )
    if ($arn) { return $arn }
    return $Name
}

function Set-SecretValue {
    param(
        [string]$Name,
        [string]$Value
    )

    [void](Invoke-AwsWithSecret -Value $Value -PreArguments @(
            'secretsmanager', 'put-secret-value',
            '--secret-id', $Name
        ))
}

Write-Host "Creating Secrets Manager secrets under '$Prefix/'..." -ForegroundColor Cyan
Write-Host "  Values are never printed; the plan is shown before anything is written." -ForegroundColor DarkGray

if (-not (Get-Command aws -ErrorAction SilentlyContinue)) {
    # Fail before prompting for anything: there is nothing to do without the CLI.
    Write-Host "`nFAILED - aws CLI not found on PATH. Install AWS CLI v2 first." -ForegroundColor Red
    exit 1
}
if ($null -eq $Value) { $Value = @{} }

# ---------------------------------------------------------------------------
# 1. Resolve a value for every secret, then report the plan.
# ---------------------------------------------------------------------------
Write-Host "`n1. Resolving values" -ForegroundColor Cyan

$resolved = @()
foreach ($spec in $script:SecretSpecs) {
    $name = $spec.Name
    $envName = "VF_SECRET_$name"
    $source = $null
    $secretValue = $null

    if ($Value.ContainsKey($name)) {
        $secretValue = [string]$Value[$name]
        $source = '-Value'
    }
    else {
        $fromEnv = [Environment]::GetEnvironmentVariable($envName)
        if ($null -ne $fromEnv -and $fromEnv -ne '') {
            $secretValue = $fromEnv
            $source = "environment variable $envName"
        }
        elseif ($spec.Generated) {
            # 48 bytes of CSPRNG output, base64 = 64 characters. Well clear of the
            # 32-character minimum env.ts enforces for JWT_SECRET and ENCRYPTION_KEY.
            $secretValue = New-RandomValue -ByteCount 48
            $source = 'generated (CSPRNG)'
        }
        elseif ($NonInteractive) {
            $secretValue = ''
            $source = 'not supplied'
        }
        else {
            $secretValue = Read-Host "Value for $name (blank to leave empty)"
            $source = 'prompted'
        }
    }

    if ($spec.Required -and "$secretValue".Length -eq 0) {
        Add-Failure "$name has no value. Supply -Value @{ $name = '...' } or set $envName."
        continue
    }
    if (-not $spec.Required -and "$secretValue".Length -eq 0) {
        Write-Host ("  [--] {0,-24} empty ({1})" -f $name, $spec.Description) -ForegroundColor Yellow
    }

    $resolved += [pscustomobject]@{
        Name        = $name
        Value       = $secretValue
        Src         = $source
        Description = $spec.Description
    }
    # Source only. Printing the value here would defeat the point of the script.
    Write-Host ("  [--] {0,-24} from {1}" -f $name, $source) -ForegroundColor DarkGray
}

# ---------------------------------------------------------------------------
# 2. Create what is missing.
# ---------------------------------------------------------------------------
if ($script:Failures.Count -eq 0 -and $resolved.Count -gt 0) {
    if ($WhatIfPreference) {
        Write-Host "`n2. Existing secrets (read-only under -WhatIf; nothing will be written)" -ForegroundColor Cyan
    }
    else {
        Write-Host "`n2. Creating" -ForegroundColor Cyan
    }

    foreach ($item in $resolved) {
        $arn = try { Get-SecretArn -Name "$Prefix/$($item.Name)" } catch { Add-Failure "$($item.Name): $($_.Exception.Message)"; '' }
        if ($script:Failures.Count -gt 0) { break }

        if ($arn) {
            if ($Force) {
                if ($item.Name -eq 'ENCRYPTION_KEY') {
                    Write-Host "`n  WARNING: overwriting ENCRYPTION_KEY." -ForegroundColor Red
                    Write-Host "  Stored payment credentials are encrypted under this key with no key" -ForegroundColor Red
                    Write-Host "  version in the ciphertext. Without first re-encrypting them under the" -ForegroundColor Red
                    Write-Host "  new value they become permanently unreadable and online payment stops." -ForegroundColor Red
                }
                if ($PSCmdlet.ShouldProcess("$Prefix/$($item.Name)", 'Overwrite existing secret value')) {
                    try {
                        Set-SecretValue -Name "$Prefix/$($item.Name)" -Value $item.Value
                        Write-Host ("  [OK] {0,-24} overwritten" -f $item.Name) -ForegroundColor Green
                    }
                    catch { Add-Failure "$($item.Name): $($_.Exception.Message)" }
                }
            }
            else {
                Write-Host ("  [--] {0,-24} already exists; left untouched (pass -Force to overwrite)" -f $item.Name) -ForegroundColor Yellow
            }
            continue
        }

        if ($PSCmdlet.ShouldProcess("$Prefix/$($item.Name)", 'Create secret')) {
            try {
                $arn = New-Secret -Name "$Prefix/$($item.Name)" -Value $item.Value -Description $item.Description
                Write-Host ("  [OK] {0,-24} created" -f $item.Name) -ForegroundColor Green
                Write-Host ("       {0}" -f $arn) -ForegroundColor DarkGray
            }
            catch { Add-Failure "$($item.Name): $($_.Exception.Message)" }
        }
    }
}

if ($script:Failures.Count -gt 0) {
    Write-Host "`nFAILED - $($script:Failures.Count) problem(s):" -ForegroundColor Red
    $script:Failures | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
    exit 1
}

if ($WhatIfPreference) {
    Write-Host "`n-WhatIf: nothing was written. Re-run without -WhatIf to create the secrets." -ForegroundColor Green
    exit 0
}

Write-Host "`nAll seven secrets are present under '$Prefix/'. Next: substitute the" -ForegroundColor Green
Write-Host "REPLACE_ME_SECRET_ARN_* markers in ecs-task-definition.json with these ARNs," -ForegroundColor Green
Write-Host "then run backend\infra\validate-task-definition.ps1." -ForegroundColor Green
exit 0
