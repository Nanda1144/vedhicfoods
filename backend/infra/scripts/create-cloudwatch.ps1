<#
.SYNOPSIS
    Creates the CloudWatch Logs group the backend logs to, with retention.

.DESCRIPTION
    The task definition sets `awslogs-create-group: true`, but the execution role
    in iam-policies.json deliberately grants NO `logs:CreateLogGroup` - the two
    documents disagree about who makes the group. If the group does not exist,
    the agent's create call is denied and the task logs to nothing. This script
    settles the question in one place, before the first task starts.

    It also sets retention. A group created by `awslogs-create-group` defaults to
    "never expire", which is a cost and a legal problem for a business that keeps
    order and payment data for exactly as long as its policy says. The default is
    30 days, the value AWS_DEPLOYMENT.md promises.

    Semantics, deliberately plain:
      * group missing          -> create, then set retention
      * group with no retention -> set retention
      * group with retention == target -> nothing to do
      * group with retention != target -> leave it, warn, pass -Force to change it

    Required AWS permissions: logs:DescribeLogGroups, logs:CreateLogGroup,
    logs:PutRetentionPolicy.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File backend\infra\scripts\create-cloudwatch.ps1

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File backend\infra\scripts\create-cloudwatch.ps1 -WhatIf

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File backend\infra\scripts\create-cloudwatch.ps1 -LogGroupName vedhicfoods/backend -RetentionInDays 90
#>
[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'Medium')]
param(
    # Passed straight to the AWS CLI. Leave empty to use your configured default.
    [string]$Region,

    # Must equal the value substituted into `awslogs-group` in
    # ecs-task-definition.json.
    [string]$LogGroupName = 'vedhicfoods/backend',

    # Must be one of the values CloudWatch accepts:
    # 1, 3, 5, 7, 14, 30, 60, 90, 120, 150, 180, 365, 400, 545, 731, 1096,
    # 1827, 2192, 2557, 2922, 3288, 3653.
    [ValidateSet(1, 3, 5, 7, 14, 30, 60, 90, 120, 150, 180, 365, 400, 545, 731,
        1096, 1827, 2192, 2557, 2922, 3288, 3653)]
    [int]$RetentionInDays = 30,

    # Override a retention policy that already exists with a different value.
    [switch]$Force
)

$ErrorActionPreference = 'Stop'
$script:Failures = @()
$script:AwsArgs = @()
if ($Region) { $script:AwsArgs = @('--region', $Region) }

function Add-Failure { param([string]$Message) $script:Failures += $Message }

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
    return "$output"
}

# Returns the log group name or ''. Using describe-log-groups with a prefix and
# an exact JSPath equality afterwards means "does not exist yet" is an ordinary
# empty result, not a failing call whose stderr would have to be swallowed.
function Get-LogGroupState {
    param([string]$Name)

    $nameQuery = "logGroups[?logGroupName=='$Name'].logGroupName"
    $retQuery  = "logGroups[?logGroupName=='$Name'].retentionInDays"

    $exists = (Invoke-Aws logs describe-log-groups `
        --log-group-name-prefix $Name `
        --query $nameQuery `
        --output text @script:AwsArgs).Trim()
    $retention = (Invoke-Aws logs describe-log-groups `
        --log-group-name-prefix $Name `
        --query $retQuery `
        --output text @script:AwsArgs).Trim()

    $retentionValue = -1
    if ($retention -match '^\d+$') { $retentionValue = [int]$retention }

    return [pscustomobject]@{
        Exists        = ($exists -eq $Name)
        RetentionText = $retention
        Retention     = $retentionValue
    }
}

Write-Host "Ensuring CloudWatch log group '$LogGroupName' exists with $RetentionInDays-day retention..." -ForegroundColor Cyan

if (-not (Get-Command aws -ErrorAction SilentlyContinue)) {
    Write-Host "`nFAILED - aws CLI not found on PATH. Install AWS CLI v2 first." -ForegroundColor Red
    exit 1
}

$state = try { Get-LogGroupState -Name $LogGroupName }
         catch { $script:Failures += $_.Exception.Message; $null }
if ($script:Failures.Count -gt 0) {
    Write-Host "`nFAILED - $($script:Failures.Count) problem(s):" -ForegroundColor Red
    $script:Failures | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
    exit 1
}

if (-not $state.Exists) {
    Write-Host "  [--] log group does not exist" -ForegroundColor Yellow
    if ($PSCmdlet.ShouldProcess($LogGroupName, 'Create CloudWatch log group')) {
        try {
            & aws @($script:AwsArgs + @(
                    'logs', 'create-log-group',
                    '--log-group-name', $LogGroupName,
                    '--tags', 'Application=vedhicfoods', 'ManagedBy=create-cloudwatch.ps1'
                ))
            if ($LASTEXITCODE -ne 0) { throw "aws create-log-group exited with code $LASTEXITCODE" }
            Write-Host "  [OK] created" -ForegroundColor Green
        }
        catch {
            Add-Failure $_.Exception.Message
        }
    }

    # A freshly created group defaults to "never expire"; retention must be
    # asserted right after creation, or every run of this script starts by
    # pointing at a group it knows fails the retention goal.
    if ($script:Failures.Count -eq 0 -and $PSCmdlet.ShouldProcess($LogGroupName, "Set retention policy to $RetentionInDays days")) {
        try {
            & aws @($script:AwsArgs + @(
                    'logs', 'put-retention-policy',
                    '--log-group-name', $LogGroupName,
                    '--retention-in-days', "$RetentionInDays"
                ))
            if ($LASTEXITCODE -ne 0) { throw "aws put-retention-policy exited with code $LASTEXITCODE" }
            Write-Host ("  [OK] retention set to {0} days" -f $RetentionInDays) -ForegroundColor Green
        }
        catch {
            Add-Failure $_.Exception.Message
        }
    }
}
else {
    $current = if ($state.Retention -gt 0) { "$($state.Retention) days" } else { 'never expire' }
    Write-Host ("  [--] exists; retention currently {0}" -f $current) -ForegroundColor Yellow

    if ($state.Retention -eq $RetentionInDays) {
        Write-Host ("  [OK] retention already {0} days; nothing to do" -f $RetentionInDays) -ForegroundColor Green
    }
    elseif ($Force -or $state.Retention -lt 0) {
        # No policy yet -> set it (the whole point of the script). A policy set to
        # a different value is someone's deliberate choice -> only -Force changes it.
        if ($PSCmdlet.ShouldProcess($LogGroupName, "Set retention policy to $RetentionInDays days")) {
            try {
                & aws @($script:AwsArgs + @(
                        'logs', 'put-retention-policy',
                        '--log-group-name', $LogGroupName,
                        '--retention-in-days', "$RetentionInDays"
                    ))
                if ($LASTEXITCODE -ne 0) { throw "aws put-retention-policy exited with code $LASTEXITCODE" }
                Write-Host ("  [OK] retention set to {0} days" -f $RetentionInDays) -ForegroundColor Green
            }
            catch {
                Add-Failure $_.Exception.Message
            }
        }
    }
    else {
        Write-Host ("  [--] retention is {0} days; different from requested {1}. Pass -Force to change it." -f `
                $state.Retention, $RetentionInDays) -ForegroundColor Yellow
    }
}

if ($script:Failures.Count -gt 0) {
    Write-Host "`nFAILED - $($script:Failures.Count) problem(s):" -ForegroundColor Red
    $script:Failures | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
    exit 1
}

if ($WhatIfPreference) {
    Write-Host "`n-WhatIf: nothing was written. Re-run without -WhatIf to make the change." -ForegroundColor Green
    exit 0
}

Write-Host "`nLog group '$LogGroupName' is ready in CloudWatch. It is the value" -ForegroundColor Green
Write-Host "to substitute for REPLACE_ME_LOG_GROUP in ecs-task-definition.json." -ForegroundColor Green
exit 0