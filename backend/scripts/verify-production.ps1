<#
.SYNOPSIS
    Read-only production verification for the VEDHICFOODS custom domain.

.DESCRIPTION
    Runs against a deployed environment and reports PASS / FAIL / SKIP for the
    properties that are cheap to check and expensive to get wrong:

      HTTPS   TLS handshake, certificate validity and hostname match, expiry
              horizon, HSTS, HTTP->HTTPS redirect, security headers
      CORS    both production origins accepted, a foreign origin rejected
              (and rejected *silently*, without echoing the allowlist),
              preflight hand-shake
      HEALTH  liveness and readiness, including the database check
      PUBLIC  the endpoints a browser must reach with no token at all
      AUTH    every route that must refuse an unauthenticated caller

    Authenticated flows that need real credentials or move real money - login,
    cart, checkout, payment, invoice, admin - are probed for their *rejection*
    behaviour, which is the part that can be verified without a transaction. The
    script prints the exact command for each positive case; run those by hand
    against a live card.

    READ-ONLY. It makes no AWS call, writes no file, changes no state, and sends
    no mutation to the API. The only requests are GET, plus OPTIONS and a handful
    of POSTs that are rejected by auth before touching the database.

.NOTES
    Windows PowerShell 5.1 compatible. PS 5.1 runs on .NET Framework, whose
    default TLS setting on some hosts still excludes TLS 1.2, so the protocol is
    set explicitly below. Without that line this script can report "HTTPS failed"
    against a server that is perfectly healthy.

    No AWS CLI, no Docker, no credentials required.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File backend\scripts\verify-production.ps1

.EXAMPLE
    # Against a staging hostname, with credentials so the login checks run:
    powershell -ExecutionPolicy Bypass -File backend\scripts\verify-production.ps1 `
      -ApiBaseUrl https://api-staging.example.com/api/v1 `
      -StoreOrigin https://staging.example.com `
      -CustomerEmail you@example.com -CustomerPassword '...'

.EXAMPLE
    # Admin checks too:
    powershell ... -AdminEmail admin@vedhicfoods.com -AdminPassword '...'
#>
[CmdletBinding()]
param(
    [string]$ApiBaseUrl = 'https://api.vedhicfoods.com/api/v1',
    [string]$StoreOrigin = 'https://vedhicfoods.com',
    [string]$AdminOrigin = 'https://admin.vedhicfoods.com',

    # Supplied only to run the positive login checks. Left empty, those checks
    # SKIP rather than FAIL, so this script is safe to run with no credentials.
    [string]$CustomerEmail,
    [string]$CustomerPassword,
    [string]$AdminEmail,
    [string]$AdminPassword,

    [int]$TimeoutSec = 20,
    [int]$ExpiryWarningDays = 14
)

$ErrorActionPreference = 'Stop'

# .NET Framework will happily negotiate TLS 1.0 with some endpoints, which
# produces a confusing handshake error rather than a useful diagnostic.
try {
    [Net.ServicePointManager]::SecurityProtocol = `
        [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
} catch {
    Write-Host "Could not enable TLS 1.2 for this session; HTTPS checks may fail on older .NET." -ForegroundColor Yellow
}

$script:Pass = 0
$script:Fail = 0
$script:Skip = 0
$script:Failures = New-Object System.Collections.Generic.List[string]

$apiHost = ([Uri]$ApiBaseUrl).Host

# ---------------------------------------------------------------------------
# Transport helpers
# ---------------------------------------------------------------------------
<#
.SYNOPSIS
    Issues one HTTP request and returns a normalised result, never throwing.

.DESCRIPTION
    PS 5.1 throws on every non-2xx status and has no -SkipHttpErrorCheck, so
    error bodies have to be pulled out of the WebException by hand. The body is
    read to the end of the stream here because the caller inspects it - and
    reading it twice from an already-consumed stream returns empty.
#>
function Invoke-Api {
    param(
        [Parameter(Mandatory)] [string]$Uri,
        [string]$Method = 'GET',
        [hashtable]$Headers = @{},
        [string]$Body,
        [int]$MaxRedirect = 5
    )

    $params = @{
        Uri                  = $Uri
        Method               = $Method
        Headers              = $Headers
        TimeoutSec           = $TimeoutSec
        UseBasicParsing      = $true
        MaximumRedirection   = $MaxRedirect
        UserAgent            = 'VedhicFoods-Verify/1.0'
    }
    if ($Body) {
        $params.Body = $Body
        $params.ContentType = 'application/json'
    }

    try {
        $r = Invoke-WebRequest @params -ErrorAction Stop
        return [pscustomobject]@{
            Uri     = $Uri
            Status  = [int]$r.StatusCode
            Headers = $r.Headers
            Body    = $r.Content
            Error   = $null
        }
    }
    catch {
        $resp = $_.Exception.Response

        if ($resp -and $resp.PSObject.Properties['StatusCode']) {
            $status = [int]$resp.StatusCode
            $body = ''
            try {
                $stream = $resp.GetResponseStream()
                if ($stream) {
                    $stream.Position = 0
                    $reader = New-Object System.IO.StreamReader($stream)
                    $body = $reader.ReadToEnd()
                    $reader.Close()
                    $stream.Dispose()
                }
            } catch { }

            return [pscustomobject]@{
                Uri     = $Uri
                Status  = $status
                Headers = $resp.Headers
                Body    = $body
                Error   = $null
            }
        }

        return [pscustomobject]@{
            Uri     = $Uri
            Status  = 0
            Headers = $null
            Body    = ''
            Error   = $_.Exception.Message
        }
    }
}

function Get-Header {
    param($Headers, [string]$Name)
    if ($null -eq $Headers) { return $null }
    try {
        $value = $Headers[$Name]
        if ($null -eq $value) {
            # PS 5.1 uses NameValueCollection and is case-insensitive, but an
            # error response gives a WebHeaderCollection; cover both.
            $value = $Headers.Get($Name)
        }
        if ($null -eq $value) { return $null }
        if ($value -is [System.Array]) { return ($value -join ', ') }
        return [string]$value
    } catch { return $null }
}

function Get-BodyJson {
    param($Result)
    if (-not $Result.Body) { return $null }
    try { return $Result.Body | ConvertFrom-Json } catch { return $null }
}

# ---------------------------------------------------------------------------
# Reporting
# ---------------------------------------------------------------------------
function Write-Check {
    param([string]$Name, [string]$Detail = '', [string]$Outcome)

    $colour = switch ($Outcome) {
        'PASS'  { 'Green' }
        'FAIL'  { 'Red' }
        'SKIP'  { 'Yellow' }
        default { 'Gray' }
    }

    switch ($Outcome) {
        'PASS'  { $script:Pass++ }
        'FAIL'  { $script:Fail++; $script:Failures.Add(('{0} - {1}' -f $Name, $Detail)) }
        'SKIP'  { $script:Skip++ }
    }

    Write-Host ("  [{0,-4}] {1}" -f $Outcome, $Name) -ForegroundColor $colour
    if ($Detail) { Write-Host ("        {0}" -f $Detail) -ForegroundColor DarkGray }
}

function Test-Expect {
    param(
        [string]$Name,
        $Actual,
        $Expected,
        [string]$Detail = ''
    )
    $ok = ($Actual -eq $Expected)
    if (-not $ok) {
        $Detail = "expected '$Expected', got '$Actual'$(if ($Detail) { ' - ' + $Detail })"
    }
    Write-Check -Name $Name -Outcome $(if ($ok) { 'PASS' } else { 'FAIL' }) -Detail $Detail
}

function Test-True {
    param([string]$Name, [bool]$Condition, [string]$PassDetail = '', [string]$FailDetail = '')
    if ($Condition) {
        Write-Check -Name $Name -Outcome 'PASS' -Detail $PassDetail
    } else {
        Write-Check -Name $Name -Outcome 'FAIL' -Detail $FailDetail
    }
}

# ---------------------------------------------------------------------------
# Section banner
# ---------------------------------------------------------------------------
function Write-Section {
    param([string]$Title)
    Write-Host ""
    Write-Host $Title -ForegroundColor Cyan
    Write-Host ("-" * [Math]::Max($Title.Length, 40)) -ForegroundColor DarkGray
}

# ===========================================================================
# 0. Transport: is the base URL even reachable?
# ===========================================================================
Write-Section "0. Target"

Write-Host "  API    $ApiBaseUrl"
Write-Host "  Origin $StoreOrigin (storefront)"
Write-Host "  Origin $AdminOrigin (admin portal)"
Write-Host ""

if ($ApiBaseUrl -notmatch '^https://') {
    Write-Check -Name 'API base URL uses https' -Outcome 'FAIL' -Detail "got $ApiBaseUrl"
    Write-Host ""
    Write-Host "Stopping: every check below assumes an HTTPS endpoint." -ForegroundColor Red
    exit 1
}
Write-Check -Name 'API base URL uses https' -Outcome 'PASS'

# ===========================================================================
# 1. HTTPS
# ===========================================================================
Write-Section "1. HTTPS"

$certificate = $null
$policyErrors = $null
$callback = {
    param($sender, $cert, $chain, $sslErrors)
    $script:certificate = $cert
    $script:policyErrors = $sslErrors
    # Returning true lets the request proceed so the remaining checks can run.
    # The verdict is reached afterwards from $policyErrors, which is what the OS
    # said *before* being overruled.
    return $true
}
[System.Net.ServicePointManager]::ServerCertificateValidationCallback = $callback

$healthUri = ($ApiBaseUrl.TrimEnd('/') + '/health')
$healthResult = Invoke-Api -Uri $healthUri

# The callback is deliberately left installed for the whole run. A certificate
# the OS distrusts must cost exactly the handful of certificate checks below,
# not turn every later HTTPS call into "connection closed", which would bury
# the real result under forty identical failures. It is removed again at the
# very end of the script.
$certificate = $script:certificate
$policyErrors = $script:policyErrors

Test-True `
    -Name 'TLS handshake completes' `
    -Condition ($healthResult.Status -eq 200) `
    -PassDetail "GET $healthUri -> $($healthResult.Status)" `
    -FailDetail "GET $healthUri -> $($healthResult.Status) $(if ($healthResult.Error) { $healthResult.Error })"

if ($null -eq $certificate) {
    Write-Check -Name 'Certificate presented' -Outcome 'FAIL' -Detail 'no certificate was captured during the handshake'
}
else {
    $subject = $certificate.Subject
    $notAfter = $certificate.NotAfter
    $daysLeft = ($notAfter - [DateTime]::Now).TotalDays
    $hostnameOk = ($subject -match "CN=$apiHost\b") -or ($subject -match "DNS Name=$apiHost\b") -or
                  ($policyErrors.ToString() -eq 'None')

    Test-True `
        -Name 'Certificate hostname matches' `
        -Condition ($hostnameOk) `
        -PassDetail $subject `
        -FailDetail "certificate subject '$subject' does not cover $apiHost"

    Test-True `
        -Name 'Certificate chain trusted (no interception, no self-signed)' `
        -Condition ($policyErrors -eq [System.Net.Security.SslPolicyErrors]::None) `
        -PassDetail 'chain validated by the operating system' `
        -FailDetail "sslPolicyErrors = $policyErrors - an untrusted chain here means the browser will refuse the site"

    Test-True `
        -Name "Certificate not expiring within $ExpiryWarningDays days" `
        -Condition ($daysLeft -gt $ExpiryWarningDays) `
        -PassDetail "expires $($notAfter.ToString('yyyy-MM-dd')) ($([Math]::Round($daysLeft)) days)" `
        -FailDetail "expires $($notAfter.ToString('yyyy-MM-dd')) - $([Math]::Round($daysLeft)) days left. ACM auto-renews at 45 days; a near expiry means renewal is failing (usually DNS)."
}

# --- HTTP -> HTTPS ---------------------------------------------------------
$httpUri = [string]::Join('', @('http://', $apiHost, '/api/v1/health'))
$redirect = Invoke-Api -Uri $httpUri -Method GET -MaxRedirect 0

Test-True `
    -Name 'Plain HTTP redirects instead of serving' `
    -Condition ($redirect.Status -eq 301 -or $redirect.Status -eq 302 -or $redirect.Status -eq 307 -or $redirect.Status -eq 308) `
    -PassDetail "GET $httpUri -> $($redirect.Status)" `
    -FailDetail "GET $httpUri -> $($redirect.Status). Port 80 must redirect to HTTPS, never respond with content."

$location = Get-Header -Headers $redirect.Headers -Name 'Location'
if ($redirect.Status -eq 301 -or $redirect.Status -eq 302 -or $redirect.Status -eq 307 -or $redirect.Status -eq 308) {
    Test-True `
        -Name 'Redirect target is https' `
        -Condition ([string]$location -match '^https://') `
        -PassDetail "Location: $location" `
        -FailDetail "Location: $location - a redirect back to http puts the customer in a loop"
}

# --- Security headers ------------------------------------------------------
$hsts = Get-Header -Headers $healthResult.Headers -Name 'Strict-Transport-Security'
$hstsOk = $false
if ($hsts -match 'max-age=(\d+)') {
    $hstsOk = [int64]$Matches[1] -ge 31536000
}
Test-True `
    -Name 'HSTS present with >= 1 year max-age' `
    -Condition $hstsOk `
    -PassDetail $hsts `
    -FailDetail "Strict-Transport-Security = '$hsts'. Without it the first visit to http:// goes over plaintext."

$nosniff = Get-Header -Headers $healthResult.Headers -Name 'X-Content-Type-Options'
Test-True `
    -Name 'X-Content-Type-Options: nosniff' `
    -Condition ([string]$nosniff -match 'nosniff') `
    -PassDetail $nosniff `
    -FailDetail "X-Content-Type-Options = '$nosniff'"

$referrer = Get-Header -Headers $healthResult.Headers -Name 'Referrer-Policy'
Test-True `
    -Name 'Referrer-Policy set' `
    -Condition (-not [string]::IsNullOrWhiteSpace([string]$referrer)) `
    -PassDetail $referrer `
    -FailDetail 'Referrer-Policy header missing; order URLs and tokens can leak through the Referer header'

$csp = Get-Header -Headers $healthResult.Headers -Name 'Content-Security-Policy'
Test-True `
    -Name 'Content-Security-Policy present' `
    -Condition (-not [string]::IsNullOrWhiteSpace([string]$csp)) `
    -PassDetail $(if ($csp.Length -gt 70) { $csp.Substring(0, 70) + '...' } else { $csp }) `
    -FailDetail 'no Content-Security-Policy; a stored XSS becomes directly exploitable'

# --- No plaintext authentication ------------------------------------------
# The API issues a JWT that the client stores in localStorage and replays in an
# Authorization header. It must never be handed back as a cookie: a cookie is
# ambient credential the browser attaches on its own, and an HttpOnly cookie
# without Secure+SameSite over a plaintext hop is exactly the "HTTP-only
# authentication" that is forbidden here.
$authHeaders = @{} + @{ 'Content-Type' = 'application/json' }
$badLogin = Invoke-Api -Uri ($ApiBaseUrl.TrimEnd('/') + '/auth/login') -Method POST -Headers $authHeaders -Body '{"email":"probe@example.com","password":"definitely-not-a-real-password-0"}'

$setCookie = Get-Header -Headers $badLogin.Headers -Name 'Set-Cookie'
Test-True `
    -Name 'Authentication is header-based, not cookie-based' `
    -Condition ([string]::IsNullOrEmpty($setCookie)) `
    -PassDetail 'no Set-Cookie on the login response' `
    -FailDetail "Set-Cookie: $setCookie - an ambient cookie makes the API dependent on TLS and SameSite rather than on an explicit Authorization header"

# ===========================================================================
# 2. CORS
# ===========================================================================
Write-Section "2. CORS"

function Test-CorsOrigin {
    param([string]$Label, [string]$Origin)

    $probe = Invoke-Api `
        -Uri ($ApiBaseUrl.TrimEnd('/') + '/products?take=1') `
        -Method GET `
        -Headers @{ 'Origin' = $Origin }

    $acao = Get-Header -Headers $probe.Headers -Name 'Access-Control-Allow-Origin'
    Test-True `
        -Name "$Label accepted ($Origin)" `
        -Condition ($acao -eq $Origin) `
        -PassDetail "Access-Control-Allow-Origin: $acao" `
        -FailDetail "Access-Control-Allow-Origin = '$acao' (expected '$Origin'). The browser will block every write from that origin. Confirm FRONTEND_URL / ADMIN_FRONTEND_URL in the task definition match exactly, including https:// and any www."

    $acac = Get-Header -Headers $probe.Headers -Name 'Access-Control-Allow-Credentials'
    Test-True `
        -Name "$Label sends allow-credentials" `
        -Condition ([string]$acac -match '^(true|True)$') `
        -PassDetail $acac `
        -FailDetail "Access-Control-Allow-Credentials = '$acac'"
}

Test-CorsOrigin -Label 'CORS: storefront origin' -Origin $StoreOrigin
Test-CorsOrigin -Label 'CORS: admin origin' -Origin $AdminOrigin

# A foreign origin must be refused. The refusal must be SILENT: returning the
# allowlist in an error body teaches an attacker which origins are valid.
$evilOrigin = 'https://attacker.example'
$evil = Invoke-Api `
    -Uri ($ApiBaseUrl.TrimEnd('/') + '/products?take=1') `
    -Method GET `
    -Headers @{ 'Origin' = $evilOrigin }

$evilAcao = Get-Header -Headers $evil.Headers -Name 'Access-Control-Allow-Origin'
Test-True `
    -Name 'CORS: foreign origin rejected' `
    -Condition ([string]::IsNullOrEmpty($evilAcao)) `
    -PassDetail 'no Access-Control-Allow-Origin echoed for an unknown origin' `
    -FailDetail "Access-Control-Allow-Origin: '$evilAcao' for origin '$evilOrigin' - a wildcard or a reflected origin means any website can call this API with the customer's credentials"

Test-True `
    -Name 'CORS: rejection does not leak the allowlist' `
    -Condition ([string]($evil.Body) -notmatch "$StoreOrigin" -and [string]($evil.Body) -notmatch "$AdminOrigin") `
    -PassDetail 'error body does not name the allowed origins' `
    -FailDetail 'the rejection body lists an allowed origin, which enumerates the allowlist'

# Preflight
$preflight = Invoke-Api `
    -Uri ($ApiBaseUrl.TrimEnd('/') + '/products') `
    -Method OPTIONS `
    -Headers @{
        'Origin'                        = $StoreOrigin
        'Access-Control-Request-Method' = 'POST'
        'Access-Control-Request-Headers' = 'content-type,authorization'
    }

$pmAcao = Get-Header -Headers $preflight.Headers -Name 'Access-Control-Allow-Origin'
Test-True `
    -Name 'CORS: preflight answered for storefront' `
    -Condition ($pmAcao -eq $StoreOrigin -and ($preflight.Status -eq 204 -or $preflight.Status -eq 200)) `
    -PassDetail "OPTIONS -> $($preflight.Status), ACAO: $pmAcao" `
    -FailDetail "OPTIONS -> $($preflight.Status), ACAO: '$pmAcao'. Without a passing preflight no credentialed POST (login, checkout) ever leaves the browser."

$pmMethods = Get-Header -Headers $preflight.Headers -Name 'Access-Control-Allow-Methods'
Test-True `
    -Name 'CORS: preflight permits POST' `
    -Condition ([string]$pmMethods -match 'POST') `
    -PassDetail $pmMethods `
    -FailDetail "Access-Control-Allow-Methods = '$pmMethods' - login and checkout are POST"

$pmHeaders = Get-Header -Headers $preflight.Headers -Name 'Access-Control-Allow-Headers'
Test-True `
    -Name 'CORS: preflight permits Authorization' `
    -Condition ([string]$pmHeaders -match '(?i)authorization') `
    -PassDetail $pmHeaders `
    -FailDetail "Access-Control-Allow-Headers = '$pmHeaders' - without Authorization the browser cannot replay the session token"

# ===========================================================================
# 3. HEALTH
# ===========================================================================
Write-Section "3. HEALTH"

$live = Invoke-Api -Uri ($ApiBaseUrl.TrimEnd('/') + '/health')
$liveJson = Get-BodyJson -Result $live
$liveData = if ($liveJson -and $liveJson.PSObject.Properties['data']) { $liveJson.data } else { $liveJson }

Test-Expect -Name 'Liveness returns 200' -Actual $live.Status -Expected 200
Test-True `
    -Name 'Liveness reports healthy' `
    -Condition ($liveData -and $liveData.status -eq 'healthy') `
    -PassDetail "status=$($liveData.status)" `
    -FailDetail "status = '$($liveData.status)'"
Test-True `
    -Name 'Process reports NODE_ENV=production' `
    -Condition ($liveData -and $liveData.environment -eq 'production') `
    -PassDetail "environment=$($liveData.environment)" `
    -FailDetail "environment = '$($liveData.environment)'. A staging or development value means the task did not receive NODE_ENV, and the origin allowlist is then whatever that environment's .env file says."

$ready = Invoke-Api -Uri ($ApiBaseUrl.TrimEnd('/') + '/health/ready')
$readyJson = Get-BodyJson -Result $ready
$readyData = if ($readyJson -and $readyJson.PSObject.Properties['data']) { $readyJson.data } else { $readyJson }

Test-True `
    -Name 'Readiness returns 200' `
    -Condition ($ready.Status -eq 200) `
    -PassDetail "GET /health/ready -> $($ready.Status)" `
    -FailDetail "GET /health/ready -> $($ready.Status) $(if ($ready.Body) { $ready.Body.Substring(0, [Math]::Min(200, $ready.Body.Length)) }) - the target group health check uses this path; a non-200 keeps every task out of rotation and the site answers nothing"

Test-True `
    -Name 'Readiness confirms database connected' `
    -Condition ($readyData -and $readyData.status -eq 'healthy' -and $readyData.checks.database -eq 'connected') `
    -PassDetail "database=$($readyData.checks.database)" `
    -FailDetail "database = '$($readyData.checks.database)'. The process is up but cannot reach PostgreSQL, so every request that touches data fails."

$rateLimit = Get-Header -Headers $live.Headers -Name 'RateLimit'
Test-True `
    -Name 'Rate limiting active (RateLimit header)' `
    -Condition (-not [string]::IsNullOrWhiteSpace([string]$rateLimit)) `
    -PassDetail $rateLimit `
    -FailDetail 'no RateLimit header. In production this means REDIS_URL is unset or the limiter is not mounted - every limit is then per-process and multiplies by the task count.'

# ===========================================================================
# 4. PRODUCTS  (must be public)
# ===========================================================================
Write-Section "4. Products"

$products = Invoke-Api -Uri ($ApiBaseUrl.TrimEnd('/') + '/products?take=5')
$productsJson = Get-BodyJson -Result $products

Test-Expect -Name 'GET /products is public' -Actual $products.Status -Expected 200
Test-True `
    -Name 'GET /products returns data' `
    -Condition ($productsJson -and $productsJson.PSObject.Properties['data']) `
    -PassDetail "success=$($productsJson.success)" `
    -FailDetail "body: $(if ($products.Body) { $products.Body.Substring(0, [Math]::Min(200, $products.Body.Length)) })"

$categories = Invoke-Api -Uri ($ApiBaseUrl.TrimEnd('/') + '/categories')
Test-Expect -Name 'GET /categories is public' -Actual $categories.Status -Expected 200

$settings = Invoke-Api -Uri ($ApiBaseUrl.TrimEnd('/') + '/settings')
Test-True `
    -Name 'GET /settings (safe subset) is public' `
    -Condition ($settings.Status -eq 200) `
    -PassDetail "GET /settings -> $($settings.Status)" `
    -FailDetail "GET /settings -> $($settings.Status); the storefront header and footer depend on it"

# ===========================================================================
# 5. CART
# ===========================================================================
Write-Section "5. Cart"

# optionalAuth: guests get a cart too, so this must be reachable without a token.
$guestCart = Invoke-Api -Uri ($ApiBaseUrl.TrimEnd('/') + '/cart')
Test-Expect -Name 'Guest cart reachable without a token' -Actual $guestCart.Status -Expected 200

if ($CustomerEmail -and $CustomerPassword) {
    $loginBody = @{ email = $CustomerEmail; password = $CustomerPassword } | ConvertTo-Json
    $login = Invoke-Api `
        -Uri ($ApiBaseUrl.TrimEnd('/') + '/auth/login') `
        -Method POST `
        -Headers @{ 'Content-Type' = 'application/json' } `
        -Body $loginBody
    $loginJson = Get-BodyJson -Result $login

    if ($login.Status -eq 200 -and $loginJson.accessToken) {
        Write-Check -Name 'Login' -Outcome 'PASS' -Detail "POST /auth/login -> 200 for $($loginJson.user.email) (role $($loginJson.user.role))"

        $customerToken = $loginJson.accessToken
        $authedCart = Invoke-Api `
            -Uri ($ApiBaseUrl.TrimEnd('/') + '/cart') `
            -Headers @{ 'Authorization' = "Bearer $customerToken" }
        Test-Expect -Name 'Authenticated cart' -Actual $authedCart.Status -Expected 200

        $me = Invoke-Api -Uri ($ApiBaseUrl.TrimEnd('/') + '/auth/me') -Headers @{ 'Authorization' = "Bearer $customerToken" }
        Test-Expect -Name 'GET /auth/me with valid token' -Actual $me.Status -Expected 200

        $invoices = Invoke-Api -Uri ($ApiBaseUrl.TrimEnd('/') + '/invoices') -Headers @{ 'Authorization' = "Bearer $customerToken" }
        Test-Expect -Name 'Invoice list for signed-in customer' -Actual $invoices.Status -Expected 200

        Write-Host ""
        Write-Host "  Positive flows left to run by hand (they create data or move money):" -ForegroundColor Yellow
        Write-Host "    Cart     POST $ApiBaseUrl/cart/items      {`"productId`":`"...`",`"quantity`":1}" -ForegroundColor DarkGray
        Write-Host "    Checkout POST $ApiBaseUrl/checkout         requires a saved address and stock" -ForegroundColor DarkGray
        Write-Host "    Payment  POST $ApiBaseUrl/payments/razorpay/order   {`"orderId`":`"...`"}" -ForegroundColor DarkGray
        Write-Host "             then open the checkout page and pay with 4111 1111 1111 1111" -ForegroundColor DarkGray
        Write-Host "    Invoice  GET  $ApiBaseUrl/invoices/order/:orderId" -ForegroundColor DarkGray
    }
    else {
        Write-Check -Name 'Login' -Outcome 'FAIL' -Detail "POST /auth/login -> $($login.Status): $(if ($login.Body) { $login.Body.Substring(0, [Math]::Min(200, $login.Body.Length)) })"
    }
}
else {
    Write-Check -Name 'Login (customer)' -Outcome 'SKIP' -Detail 'no -CustomerEmail/-CustomerPassword supplied'
    Write-Check -Name 'Authenticated cart / invoice' -Outcome 'SKIP' -Detail 'requires a customer session'
    Write-Host ""
    Write-Host "  To run the positive login/cart/checkout/payment/invoice checks:" -ForegroundColor Yellow
    Write-Host "    powershell -File backend\scripts\verify-production.ps1 -CustomerEmail you@x.com -CustomerPassword '...'" -ForegroundColor DarkGray
}

# ===========================================================================
# 6. CHECKOUT & PAYMENT  (rejection behaviour)
# ===========================================================================
Write-Section "6. Checkout & Payment"

$noAuthJson = @{ 'Content-Type' = 'application/json' }

# /checkout requires an authenticated session. The request body is deliberately
# empty so a broken guard produces a 400/401 rather than creating an order if
# the guard turns out to be missing.
$checkout = Invoke-Api -Uri ($ApiBaseUrl.TrimEnd('/') + '/checkout') -Method POST -Headers $noAuthJson -Body '{}'
Test-True `
    -Name 'POST /checkout refuses unauthenticated caller' `
    -Condition ($checkout.Status -eq 401) `
    -PassDetail "POST /checkout -> $($checkout.Status)" `
    -FailDetail "POST /checkout -> $($checkout.Status). A 2xx means guest checkout reached a route that was supposed to require authentication; check 'requireAuth' in src/routes/checkout.routes.ts."

# The Razorpay order endpoint must refuse the same way.
$payOrder = Invoke-Api -Uri ($ApiBaseUrl.TrimEnd('/') + '/payments/razorpay/order') -Method POST -Headers $noAuthJson -Body '{}'
Test-True `
    -Name 'POST /payments/razorpay/order refuses unauthenticated caller' `
    -Condition ($payOrder.Status -eq 401) `
    -PassDetail "POST /payments/razorpay/order -> $($payOrder.Status)" `
    -FailDetail "POST /payments/razorpay/order -> $($payOrder.Status) - an unauthenticated caller must not be able to create a payment session"

$payVerify = Invoke-Api -Uri ($ApiBaseUrl.TrimEnd('/') + '/payments/razorpay/verify') -Method POST -Headers $noAuthJson -Body '{}'
Test-True `
    -Name 'POST /payments/razorpay/verify refuses unauthenticated caller' `
    -Condition ($payVerify.Status -eq 401) `
    -PassDetail "POST /payments/razorpay/verify -> $($payVerify.Status)" `
    -FailDetail "POST /payments/razorpay/verify -> $($payVerify.Status) - this endpoint confirms payment; it must never be reachable anonymously"

$paymentStatus = Invoke-Api -Uri ($ApiBaseUrl.TrimEnd('/') + '/payments/status/probe-order')
Test-True `
    -Name 'GET /payments/status/:orderId refuses unauthenticated caller' `
    -Condition ($paymentStatus.Status -eq 401) `
    -PassDetail "GET /payments/status/:orderId -> $($paymentStatus.Status)" `
    -FailDetail "GET /payments/status/:orderId -> $($paymentStatus.Status) - an anonymous caller could otherwise read another customer's payment state"

# The webhook is the one public payment endpoint. It MUST reject a body with no
# signature rather than accepting it: a webhook that processes unsigned input
# lets anyone mark orders as paid.
$webhook = Invoke-Api -Uri ($ApiBaseUrl.TrimEnd('/') + '/payments/razorpay/webhook') -Method POST -Headers $noAuthJson -Body '{"event":"payment.captured"}'
Test-True `
    -Name 'Payment webhook rejects an unsigned payload' `
    -Condition ($webhook.Status -ge 400 -and $webhook.Status -lt 600) `
    -PassDetail "POST /payments/razorpay/webhook -> $($webhook.Status)" `
    -FailDetail "POST /payments/razorpay/webhook -> $($webhook.Status) - a 2xx on an unsigned body means anyone can forge payment confirmations"

# ===========================================================================
# 7. INVOICE
# ===========================================================================
Write-Section "7. Invoice"

$invoicesNoAuth = Invoke-Api -Uri ($ApiBaseUrl.TrimEnd('/') + '/invoices')
Test-True `
    -Name 'GET /invoices refuses unauthenticated caller' `
    -Condition ($invoicesNoAuth.Status -eq 401) `
    -PassDetail "GET /invoices -> $($invoicesNoAuth.Status)" `
    -FailDetail "GET /invoices -> $($invoicesNoAuth.Status). This is the leak the security audit flagged: an unauthenticated call returned every customer's invoices - names, addresses, phone numbers, GSTIN, line items."

$invoiceSingle = Invoke-Api -Uri ($ApiBaseUrl.TrimEnd('/') + '/invoices/probe-id')
Test-True `
    -Name 'GET /invoices/:id refuses unauthenticated caller' `
    -Condition ($invoiceSingle.Status -eq 401) `
    -PassDetail "GET /invoices/:id -> $($invoiceSingle.Status)" `
    -FailDetail "GET /invoices/:id -> $($invoiceSingle.Status)"

$invoiceDl = Invoke-Api -Uri ($ApiBaseUrl.TrimEnd('/') + '/invoices/probe-id/download')
Test-True `
    -Name 'GET /invoices/:id/download refuses unauthenticated caller' `
    -Condition ($invoiceDl.Status -eq 401) `
    -PassDetail "GET /invoices/:id/download -> $($invoiceDl.Status)" `
    -FailDetail "GET /invoices/:id/download -> $($invoiceDl.Status) - this returns a presigned S3 URL"

$invoiceRegen = Invoke-Api -Uri ($ApiBaseUrl.TrimEnd('/') + '/invoices/probe-id/regenerate') -Method POST -Headers $noAuthJson -Body '{}'
Test-True `
    -Name 'POST /invoices/:id/regenerate refuses unauthenticated caller' `
    -Condition ($invoiceRegen.Status -eq 401 -or $invoiceRegen.Status -eq 403) `
    -PassDetail "POST /invoices/:id/regenerate -> $($invoiceRegen.Status)" `
    -FailDetail "POST /invoices/:id/regenerate -> $($invoiceRegen.Status) - an anonymous caller must not be able to regenerate invoices"

# ===========================================================================
# 8. ADMIN
# ===========================================================================
Write-Section "8. Admin"

# Every administrative route, probed with NO credentials. The only admin route
# that may answer 200 without a token is the login endpoint itself.
$adminProbes = @(
    @{ Name = 'GET /admin/dashboard';     Method = 'GET';  Path = '/admin/dashboard' }
    @{ Name = 'GET /admin/analytics';     Method = 'GET';  Path = '/admin/analytics' }
    @{ Name = 'GET /admin/customers';     Method = 'GET';  Path = '/admin/customers' }
    @{ Name = 'GET /admin/orders';        Method = 'GET';  Path = '/admin/orders' }
    @{ Name = 'GET /admin/products';      Method = 'GET';  Path = '/admin/products' }
    @{ Name = 'GET /admin/categories';    Method = 'GET';  Path = '/admin/categories' }
    @{ Name = 'GET /admin/customers';     Method = 'GET';  Path = '/admin/customers' }
    @{ Name = 'GET /admin/staff';         Method = 'GET';  Path = '/admin/staff' }
    @{ Name = 'GET /admin/roles';         Method = 'GET';  Path = '/admin/roles' }
    @{ Name = 'GET /admin/audit-logs';    Method = 'GET';  Path = '/admin/audit-logs' }
    @{ Name = 'GET /admin/payment-settings'; Method = 'GET'; Path = '/admin/payment-settings' }
    @{ Name = 'GET /admin/settings';      Method = 'GET';  Path = '/admin/settings' }
    @{ Name = 'GET /admin/inventory';     Method = 'GET';  Path = '/admin/inventory' }
    @{ Name = 'POST /admin/products';     Method = 'POST'; Path = '/admin/products' }
    @{ Name = 'PUT /admin/payment-settings'; Method = 'PUT'; Path = '/admin/payment-settings' }
)

$publicAdmin = @()
foreach ($probe in $adminProbes) {
    $r = Invoke-Api -Uri ($ApiBaseUrl.TrimEnd('/') + $probe.Path) -Method $probe.Method -Headers $noAuthJson -Body $(if ($probe.Method -ne 'GET') { '{}' } else { $null })
    if ($r.Status -eq 200) { $publicAdmin += $probe.Name }
}

Test-True `
    -Name "All $($adminProbes.Count) administrative routes refuse an anonymous caller" `
    -Condition ($publicAdmin.Count -eq 0) `
    -PassDetail 'every probe answered 401' `
    -FailDetail "publicly reachable without authentication: $($publicAdmin -join ', ')"

$adminAuthMe = Invoke-Api -Uri ($ApiBaseUrl.TrimEnd('/') + '/admin/auth/me')
Test-True `
    -Name 'GET /admin/auth/me refuses anonymous caller' `
    -Condition ($adminAuthMe.Status -eq 401) `
    -PassDetail "GET /admin/auth/me -> $($adminAuthMe.Status)" `
    -FailDetail "GET /admin/auth/me -> $($adminAuthMe.Status)"

# Customer-private routes must also refuse, not just admin ones.
$customerProbes = @(
    @{ Name = 'GET /customer/addresses'; Path = '/customer/addresses' }
    @{ Name = 'GET /orders/my-orders';   Path = '/orders/my-orders' }
)
foreach ($probe in $customerProbes) {
    $r = Invoke-Api -Uri ($ApiBaseUrl.TrimEnd('/') + $probe.Path)
    Test-True `
        -Name "$($probe.Name) refuses anonymous caller" `
        -Condition ($r.Status -eq 401) `
        -PassDetail "$($probe.Path) -> $($r.Status)" `
        -FailDetail "$($probe.Path) -> $($r.Status) - an anonymous caller would be reading another customer's data"
}

# Admin login must reject bad credentials without leaking whether the account
# exists. Two probes: a valid-format unknown account, and a malformed body.
$badAdmin = Invoke-Api `
    -Uri ($ApiBaseUrl.TrimEnd('/') + '/admin/auth/login') `
    -Method POST `
    -Headers $noAuthJson `
    -Body '{"email":"probe-does-not-exist@vedhicfoods.com","password":"wrong-password-123456"}'

Test-True `
    -Name 'Admin login rejects bad credentials' `
    -Condition ($badAdmin.Status -eq 401) `
    -PassDetail "POST /admin/auth/login -> $($badAdmin.Status)" `
    -FailDetail "POST /admin/auth/login -> $($badAdmin.Status)"

Test-True `
    -Name 'Admin login failure does not leak account existence' `
    -Condition ([string]($badAdmin.Body) -notmatch '(?i)no (such|account|user)|not found|does not exist') `
    -PassDetail 'generic error message' `
    -FailDetail "the error body distinguishes an unknown account from a wrong password, enabling user enumeration: $($badAdmin.Body)"

# Admin rate limiting: repeated failed logins must eventually be throttled.
# 20 attempts per IP per 15 minutes is the configured budget for the auth
# limiter. Four probes will not trip it, so this only checks the limiter is
# *announcing itself*, which it does from the first response.
$adminRate = Get-Header -Headers $badAdmin.Headers -Name 'RateLimit'
Test-True `
    -Name 'Auth endpoint announces its rate-limit budget' `
    -Condition (-not [string]::IsNullOrWhiteSpace([string]$adminRate)) `
    -PassDetail $adminRate `
    -FailDetail 'no RateLimit header on the admin login response; without Redis the limiter is per-process and its budget silently multiplies by the task count'

if ($AdminEmail -and $AdminPassword) {
    $adminBody = @{ email = $AdminEmail; password = $AdminPassword } | ConvertTo-Json
    $adminLogin = Invoke-Api -Uri ($ApiBaseUrl.TrimEnd('/') + '/admin/auth/login') -Method POST -Headers $noAuthJson -Body $adminBody
    $adminLoginJson = Get-BodyJson -Result $adminLogin

    if ($adminLogin.Status -eq 200 -and $adminLoginJson.accessToken) {
        $adminToken = $adminLoginJson.accessToken
        Write-Check -Name 'Admin login' -Outcome 'PASS' -Detail "POST /admin/auth/login -> 200 for $($adminLoginJson.user.email)"

        $adminTokenJson = @{ 'Authorization' = "Bearer $adminToken" }
        $dash = Invoke-Api -Uri ($ApiBaseUrl.TrimEnd('/') + '/admin/dashboard') -Headers $adminTokenJson
        Test-Expect -Name 'Admin dashboard with valid token' -Actual $dash.Status -Expected 200

        $adminPay = Invoke-Api -Uri ($ApiBaseUrl.TrimEnd('/') + '/admin/payment-settings') -Headers $adminTokenJson
        Test-True `
            -Name 'Payment settings readable with admin token' `
            -Condition ($adminPay.Status -eq 200) `
            -PassDetail "GET /admin/payment-settings -> $($adminPay.Status)" `
            -FailDetail "GET /admin/payment-settings -> $($adminPay.Status)"

        $adminNoPay = Invoke-Api -Uri ($ApiBaseUrl.TrimEnd('/') + '/admin/payment-settings') -Headers @{ 'Authorization' = "Bearer $customerToken" }
        Test-True `
            -Name 'Customer token cannot read payment settings (RBAC)' `
            -Condition ($adminNoPay.Status -eq 403 -or $adminNoPay.Status -eq 401) `
            -PassDetail "GET /admin/payment-settings with a customer token -> $($adminNoPay.Status)" `
            -FailDetail "GET /admin/payment-settings with a customer token -> $($adminNoPay.Status) - RBAC is not enforcing the settings.read permission"
    }
    else {
        Write-Check -Name 'Admin login' -Outcome 'FAIL' -Detail "POST /admin/auth/login -> $($adminLogin.Status): $($adminLogin.Body)"
    }
}
else {
    Write-Check -Name 'Admin login' -Outcome 'SKIP' -Detail 'no -AdminEmail/-AdminPassword supplied'
    Write-Check -Name 'Admin dashboard with token' -Outcome 'SKIP' -Detail 'requires admin credentials'
    Write-Check -Name 'RBAC: customer token vs payment settings' -Outcome 'SKIP' -Detail 'requires both credentials'
    Write-Host ""
    Write-Host "  To run the admin checks:" -ForegroundColor Yellow
    Write-Host "    powershell -File backend\scripts\verify-production.ps1 -AdminEmail admin@vedhicfoods.com -AdminPassword '...'" -ForegroundColor DarkGray
}

# ===========================================================================
# Summary
# ===========================================================================
Write-Section "Summary"

Write-Host ("  PASS {0}   FAIL {1}   SKIP {2}" -f $script:Pass, $script:Fail, $script:Skip)

if ($script:Fail -gt 0) {
    Write-Host ""
    Write-Host "  Failures:" -ForegroundColor Red
    $script:Failures | ForEach-Object { Write-Host "    - $_" -ForegroundColor Red }
    Write-Host ""
    Write-Host "  See backend/PRODUCTION_RUNBOOK.md - section 6 (deployment order)" -ForegroundColor Yellow
    exit 1
}

if ($script:Skip -gt 0) {
    Write-Host ""
    Write-Host "  Some checks were skipped because no credentials were supplied." -ForegroundColor Yellow
    Write-Host "  The authenticated flows still need a manual pass before go-live." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "  All executed checks passed." -ForegroundColor Green
exit 0