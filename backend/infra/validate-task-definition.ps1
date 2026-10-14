<#
.SYNOPSIS
    Pre-deployment validation for the Vedhic Foods backend.

.DESCRIPTION
    Refuses to let a template reach AWS with unsubstituted placeholders. Every
    REPLACE_ME marker is a value that was never filled in - a placeholder secret,
    account id, or region - and deploying one produces a task that boots
    successfully and then fails at runtime in ways that are tedious to diagnose
    (an unreachably-scoped IAM role, a wrong region, a sender identity that does
    not exist).

    Checks performed:
      1. Unsubstituted placeholders in the task definition, IAM policies and the
         CloudFormation edge template.
      2. No literal secret value in the task definition's `secrets` block.
      3. JSON well-formedness.
      4. Security invariants on the IAM task role.
      5. Edge/backend timeout consistency (ALB idle timeout vs
         KEEP_ALIVE_TIMEOUT_MS / REQUEST_TIMEOUT_MS, deregistration delay vs
         SHUTDOWN_GRACE_MS). These numbers live in two files that no compiler
         sees together, and getting the relationship wrong produces intermittent
         502s that cannot be reproduced from a single request.
      6. CloudFormation reference integrity: every !Ref, !GetAtt and condition
         name resolves to something the template actually declares.

    This script is deliberately read-only. It never calls the AWS CLI and never
    contacts AWS, so it is safe to run anywhere, including before credentials
    exist. It is NOT a schema validator: it does not prove the templates are
    syntactically valid. Run `aws cloudformation validate-template` for that.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File backend\infra\validate-task-definition.ps1
#>
[CmdletBinding()]
param(
    [string]$TaskDefinitionPath,
    [string]$IamPoliciesPath
)

$ErrorActionPreference = 'Stop'
$script:Failures = @()

# Resolved in the body, not as param() defaults: $PSScriptRoot is not yet
# initialised while default parameter values are evaluated under Windows
# PowerShell 5.1, which is what ships on this machine.
$script:Here = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
if (-not $TaskDefinitionPath) { $TaskDefinitionPath = Join-Path $script:Here 'ecs-task-definition.json' }
if (-not $IamPoliciesPath)    { $IamPoliciesPath    = Join-Path $script:Here 'iam-policies.json' }
$s3CorsPath = Join-Path $script:Here 's3-cors.json'

function Add-Failure { param([string]$Message) $script:Failures += $Message }

function Test-PlaceholderMarkers {
    param(
        [string]$Path,
        [string]$Label
    )

    if (-not (Test-Path -LiteralPath $Path)) {
        Add-Failure "$Label not found at $Path"
        return
    }

    $raw = Get-Content -LiteralPath $Path -Raw

    # _README / _Note keys are documentation and legitimately contain the
    # word REPLACE_ME, so strip comments before scanning.
    $withoutComments = [regex]::Replace($raw, '"_[^"]*"\s*:\s*\[[\s\S]*?\]', ' ')
    $withoutComments = [regex]::Replace($withoutComments, '"_[^"]*"\s*:\s*"[^"]*"', ' ')

    $markers = [regex]::Matches($withoutComments, 'REPLACE_ME[A-Z0-9_]*') |
        ForEach-Object { $_.Value } |
        Sort-Object -Unique

    if ($markers) {
        foreach ($m in $markers) {
            Add-Failure "$Label still contains unsubstituted marker: $m"
        }
    }
    else {
        Write-Host "  [OK] $Label has no unresolved placeholders" -ForegroundColor Green
    }
}

function Test-NoSecretsInFiles {
    param([string]$Path)

    Write-Host "`nChecking for committed secrets..." -ForegroundColor Cyan

# A JSON task definition that carries a secret VALUE (rather than an ARN) is
    # the specific failure this catches. A legitimate valueFrom is either a real
    # arn:aws:... ARN or an unreplaced REPLACE_ME_SECRET_ARN_* template marker.
    # The marker case is already reported by the placeholder check above, so it is
    # deliberately not counted as a leaked secret here - otherwise every template
    # would report a false positive until it was otherwise deployable.
    if (-not (Test-Path -LiteralPath $Path)) { return }
    $taskDef = Get-Content -LiteralPath $Path -Raw

    # Values that look like real credentials assigned to a secrets[] name.
    $secretLeak = [regex]::Matches(
        $taskDef,
        '"secrets"\s*:\s*\[[\s\S]*?"valueFrom"\s*:\s*"(?!(arn:aws:|REPLACE_ME_SECRET_ARN_))[^"]+"'
    )
    if ($secretLeak.Count -gt 0) {
        Add-Failure "task definition appears to contain a literal secret value; secrets[] must reference ARNs only"
    }
    else {
        Write-Host "  [OK] secrets[] references ARNs, not literal values" -ForegroundColor Green
    }
}

Write-Host "Validating backend deployment templates..." -ForegroundColor Cyan

Write-Host "`n1. Placeholder markers" -ForegroundColor Cyan
Test-PlaceholderMarkers -Path $TaskDefinitionPath -Label 'ecs-task-definition.json'
Test-PlaceholderMarkers -Path $IamPoliciesPath    -Label 'iam-policies.json'

Write-Host "`n2. Secret leakage" -ForegroundColor Cyan
Test-NoSecretsInFiles -Path $TaskDefinitionPath

Write-Host "`n3. JSON well-formedness" -ForegroundColor Cyan
foreach ($p in @($TaskDefinitionPath, $IamPoliciesPath, $s3CorsPath)) {
    if (Test-Path -LiteralPath $p) {
        try {
            Get-Content -LiteralPath $p -Raw | ConvertFrom-Json | Out-Null
            Write-Host "  [OK] $(Split-Path $p -Leaf) parses as JSON" -ForegroundColor Green
        }
        catch {
            Add-Failure "$(Split-Path $p -Leaf) is not valid JSON: $($_.Exception.Message)"
        }
    }
}

Write-Host "`n4. Security invariants" -ForegroundColor Cyan
if (Test-Path -LiteralPath $IamPoliciesPath) {
    $iam = Get-Content -LiteralPath $IamPoliciesPath -Raw | ConvertFrom-Json

    # Only Allow statements count. An explicit Deny of secretsmanager is the
    # desired hardening, so scanning all statements produced a false positive.
    $allowStatements = $iam.TaskRole.Statement | Where-Object { $_.Effect -eq 'Allow' }
    $grantsSecretRead = $allowStatements |
        Where-Object { ($_.Action -join ',') -match 'secretsmanager:GetSecretValue' }
    if ($grantsSecretRead) {
        Add-Failure 'TaskRole ALLOWS secretsmanager:GetSecretValue; the application must not read Secrets Manager at runtime'
    }
    else {
        Write-Host "  [OK] TaskRole cannot read Secrets Manager" -ForegroundColor Green
    }

    $deniesSecretRead = $iam.TaskRole.Statement |
        Where-Object { $_.Effect -eq 'Deny' -and ($_.Action -join ',') -match 'secretsmanager:GetSecretValue' }
    if ($deniesSecretRead) {
        Write-Host "  [OK] TaskRole explicitly Denies secretsmanager access" -ForegroundColor Green
    }
    else {
        Add-Failure 'TaskRole has no explicit Deny on secretsmanager; add one so a compromised app cannot read other secrets'
    }

    $sesWildcard = $iam.TaskRole.Statement |
        Where-Object { $_.Action -contains 'ses:SendEmail' -and $_.Resource -eq '*' }
    if ($sesWildcard) {
        Add-Failure 'TaskRole grants ses:SendEmail on Resource "*"; scope it to the verified identity'
    }
    else {
        Write-Host "  [OK] ses:SendEmail is identity-scoped" -ForegroundColor Green
    }
}

# ---------------------------------------------------------------------------
# 5. Timeout consistency between the edge stack and the backend.
#
# This is the check that catches the failure AWS_DEPLOYMENT.md describes in
# prose but which nothing enforces: the ALB's 60 s default idle timeout sits
# BELOW the backend's KEEP_ALIVE_TIMEOUT_MS of 65 s. When the proxy tears down an
# idle keep-alive socket the server was still willing to reuse, the customer gets
# a 502 for a request that never ran - intermittently, under load, and
# impossible to reproduce from a single curl. The numbers live in two files that
# no compiler or test sees together, so they are compared here.
# ---------------------------------------------------------------------------
Write-Host "`n5. Edge/backend timeout consistency" -ForegroundColor Cyan

$edgeTemplatePath = Join-Path $script:Here 'cloudformation\vedhicfoods-edge.yaml'

function Get-NumericEnvValue {
    param(
        [hashtable]$EnvBlock,
        [string]$Name,
        [int]$Default
    )
    $raw = $EnvBlock[$Name]
    if ($null -eq $raw -or "$raw".Trim() -eq '') { return $Default }
    $parsed = 0
    if ([int]::TryParse(("$raw".Trim()), [ref]$parsed)) { return $parsed }
    return $Default
}

if (Test-Path -LiteralPath $TaskDefinitionPath) {
    $taskJson = Get-Content -LiteralPath $TaskDefinitionPath -Raw | ConvertFrom-Json
    $taskEnv = @{}
    foreach ($entry in $taskJson.containerDefinitions[0].environment) {
        $taskEnv[$entry.name] = $entry.value
    }

    $keepAlive = Get-NumericEnvValue -EnvBlock $taskEnv -Name 'KEEP_ALIVE_TIMEOUT_MS' -Default 65000
    $requestTimeout = Get-NumericEnvValue -EnvBlock $taskEnv -Name 'REQUEST_TIMEOUT_MS' -Default 60000
    $shutdownGrace = Get-NumericEnvValue -EnvBlock $taskEnv -Name 'SHUTDOWN_GRACE_MS' -Default 25000

    $albIdleSeconds = 120
    $deregSeconds = 90
    $edgeRaw = if (Test-Path -LiteralPath $edgeTemplatePath) {
        Get-Content -LiteralPath $edgeTemplatePath -Raw
    } else { '' }

    # Anchored on the parameter's own `Type:` line, which immediately follows its
    # name and precedes its `Default:`. A loose `AlbIdleTimeoutSeconds[\s\S]*?
    # Default:\s*(\d+)` silently matched `AllowedCidr`'s `Default: 0.0.0.0/0`
    # first - PowerShell `-match` is case-insensitive and `default:` also occurs
    # in the Metadata block - yielding 0 and turning the whole check into noise.
    if ($edgeRaw -match '(?ms)^\s{2}AlbIdleTimeoutSeconds:\s*\r?\n\s+Type:[^\r\n]*\r?\n\s+Default:\s*(\d+)') {
        $albIdleSeconds = [int]$Matches[1]
    }
    if ($edgeRaw -match '(?ms)^\s{2}DeregistrationDelaySeconds:\s*\r?\n\s+Type:[^\r\n]*\r?\n\s+Default:\s*(\d+)') {
        $deregSeconds = [int]$Matches[1]
    }

    if ($albIdleSeconds -le 0 -or $deregSeconds -le 0) {
        Add-Failure "could not read AlbIdleTimeoutSeconds / DeregistrationDelaySeconds defaults from the edge template; the timeout cross-check did not run"
    }
    elseif (Test-Path -LiteralPath $edgeTemplatePath) {
        if ($albIdleSeconds * 1000 -le $keepAlive) {
            Add-Failure (("ALB idle timeout ({0}s) must EXCEED KEEP_ALIVE_TIMEOUT_MS ({1}ms); " +
                "otherwise the proxy closes idle sockets first and customers see 502s on " +
                "requests that never executed") -f $albIdleSeconds, $keepAlive)
        } else {
            Write-Host ("  [OK] ALB idle timeout {0}s exceeds KEEP_ALIVE_TIMEOUT_MS {1}ms" -f $albIdleSeconds, $keepAlive) -ForegroundColor Green
        }

        if ($deregSeconds -le [math]::Floor($shutdownGrace / 1000)) {
            Add-Failure (("ALB deregistration delay ({0}s) must exceed SHUTDOWN_GRACE_MS ({1}ms); " +
                "otherwise a rolling deploy cuts off in-flight checkouts") -f $deregSeconds, $shutdownGrace)
        } else {
            Write-Host ("  [OK] deregistration delay {0}s exceeds SHUTDOWN_GRACE_MS {1}ms" -f $deregSeconds, $shutdownGrace) -ForegroundColor Green
        }

        # REQUEST_TIMEOUT_MS must also sit under the proxy idle timeout, otherwise
        # a legitimately slow invoice request is killed mid-flight.
        if ($requestTimeout -ge ($albIdleSeconds * 1000)) {
            Add-Failure (("REQUEST_TIMEOUT_MS ({0}ms) must be below the ALB idle timeout ({1}s); " +
                "invoice PDF generation plus S3 upload is a legitimate slow operation and the " +
                "proxy will report a 502 for work that actually succeeded") -f $requestTimeout, $albIdleSeconds)
        } else {
            Write-Host ("  [OK] REQUEST_TIMEOUT_MS {0}ms is below the ALB idle timeout {1}s" -f $requestTimeout, $albIdleSeconds) -ForegroundColor Green
        }
    }
    else {
        Write-Host "  [--] edge template not found; skipped timeout cross-check" -ForegroundColor Yellow
    }
}

# ---------------------------------------------------------------------------
# 6. Edge template reference integrity.
#
# `cfn-lint` is the real answer but is not installed here and pulls in a Python
# dependency chain. What this does catch is the failure mode that actually bit
# while writing the template: a `!If` naming a condition that was never declared,
# and a `!Ref`/`!GetAtt` pointing at a logical id that does not exist. Both fail
# only at deploy time, after a partial rollback.
#
# This is a reference check, not a YAML parser. It does NOT prove the file is
# syntactically valid. Run `aws cloudformation validate-template` for that.
# ---------------------------------------------------------------------------
Write-Host "`n6. Edge template reference integrity" -ForegroundColor Cyan

if (Test-Path -LiteralPath $edgeTemplatePath) {
    $edge = Get-Content -LiteralPath $edgeTemplatePath -Raw

    $declared = New-Object 'System.Collections.Generic.HashSet[string]'

    # Parameters
    foreach ($m in [regex]::Matches($edge, '(?m)^  ([A-Za-z0-9]+):\r?\n    Type:')) {
        [void]$declared.Add($m.Groups[1].Value)
    }
    # Conditions
    if ($edge -match '(?ms)^Conditions:\r?\n(.*?)\r?\nResources:') {
        foreach ($m in [regex]::Matches($Matches[1], '(?m)^  ([A-Za-z0-9]+):')) {
            [void]$declared.Add($m.Groups[1].Value)
        }
    }
    # Resources
    if ($edge -match '(?ms)^Resources:\r?\n(.*?)\r?\nOutputs:') {
        foreach ($m in [regex]::Matches($Matches[1], '(?m)^  ([A-Za-z0-9]+):')) {
            [void]$declared.Add($m.Groups[1].Value)
        }
    }
    # Outputs
    if ($edge -match '(?ms)^Outputs:\r?\n(.*)$') {
        foreach ($m in [regex]::Matches($Matches[1], '(?m)^  ([A-Za-z0-9]+):')) {
            [void]$declared.Add($m.Groups[1].Value)
        }
    }

    if ($declared.Count -eq 0) {
        Add-Failure "could not extract any logical ids from the edge template; the parsing below is unreliable"
    }

    # !Ref <Name>, ignoring pseudo-parameters and property dereferences.
    $badRefs = 0
    $refTargets = [regex]::Matches($edge, '!Ref\s+([A-Za-z0-9:.]+)') |
        ForEach-Object { $_.Groups[1].Value } |
        Sort-Object -Unique

    foreach ($t in $refTargets) {
        if ($t -like 'AWS::*') { continue }
        if ($t.Contains('.')) { continue }
        if (-not $declared.Contains($t)) {
            Add-Failure "edge template !Ref references undeclared name: $t"
            $badRefs++
        }
    }
    if ($badRefs -eq 0) {
        Write-Host "  [OK] every !Ref resolves" -ForegroundColor Green
    }

    # !GetAtt <Resource>.<Attr>
    $badGetAtt = 0
    $getAttTargets = [regex]::Matches($edge, '!GetAtt\s+([A-Za-z0-9]+)\.') |
        ForEach-Object { $_.Groups[1].Value } |
        Sort-Object -Unique

    foreach ($t in $getAttTargets) {
        if (-not $declared.Contains($t)) {
            Add-Failure "edge template !GetAtt references undeclared resource: $t"
            $badGetAtt++
        }
    }
    if ($badGetAtt -eq 0) {
        Write-Host "  [OK] every !GetAtt resolves" -ForegroundColor Green
    }

    # Conditions referenced by !If / !Not / !Equals inside Fn:: style usage.
    $conditionTargets = [regex]::Matches($edge, '!If\s*\[\s*([A-Za-z0-9]+)') |
        ForEach-Object { $_.Groups[1].Value } |
        Sort-Object -Unique
    $conditionTargets += [regex]::Matches($edge, 'Condition:\s*([A-Za-z0-9]+)') |
        ForEach-Object { $_.Groups[1].Value } |
        Sort-Object -Unique

    foreach ($t in ($conditionTargets | Sort-Object -Unique)) {
        if (-not $declared.Contains($t)) {
            Add-Failure "edge template references undeclared condition: $t"
        }
    }
    if (-not ($conditionTargets | Where-Object { $_ })) {
        Write-Host "  [--] no conditions referenced"
    }

    # A stray REPLACE_ME in the edge stack would deploy but misconfigure.
    $edgeMarkers = [regex]::Matches($edge, 'REPLACE_ME[A-Z0-9_]*') |
        ForEach-Object { $_.Value } | Sort-Object -Unique
    if ($edgeMarkers) {
        foreach ($m in $edgeMarkers) {
            Add-Failure "edge template still contains unsubstituted marker: $m"
        }
    }
    else {
        Write-Host "  [OK] edge template has no unresolved placeholders" -ForegroundColor Green
    }

    # Duplicate logical ids in one section silently shadow each other in some
    # tooling and are always a mistake.
    if ($edge -match '(?ms)^Resources:\r?\n(.*?)\r?\nOutputs:') {
        $dups = [regex]::Matches($Matches[1], '(?m)^  ([A-Za-z0-9]+):') |
            ForEach-Object { $_.Groups[1].Value } |
            Group-Object | Where-Object { $_.Count -gt 1 }
        if ($dups) { $dups | ForEach-Object { Add-Failure "duplicate resource logical id: $($_.Name)" } }
    }

    Write-Host "  [--] reference check only. Run: aws cloudformation validate-template --template-body file://backend/infra/cloudformation/vedhicfoods-edge.yaml" -ForegroundColor Yellow
}
else {
    Write-Host "  [--] edge template not found at $edgeTemplatePath; skipped" -ForegroundColor Yellow
}

if ($script:Failures.Count -gt 0) {
    Write-Host "`nFAILED - $($script:Failures.Count) problem(s):" -ForegroundColor Red
    $script:Failures | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
    exit 1
}

Write-Host "`nAll checks passed." -ForegroundColor Green
exit 0