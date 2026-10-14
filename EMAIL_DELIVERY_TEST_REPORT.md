# Transactional Email (Amazon SES) Delivery — Test Report

**Status: COMPLETE for all offline coverage. Live SES send is BLOCKED pending
owner-supplied AWS credentials (suite auto-skips, never fakes).**

## 1. Scope

Prove the transactional email system end-to-end for all eleven notification
types — registration/welcome, email verification, password reset, order
confirmation, payment confirmation, invoice (PDF attachment), delivery updates
(shipped / out for delivery / delivered), cancellation, refund, admin
notification, and staff/support notification — covering:

- correct **recipient, subject, rendered body, order details and attachments**;
- **failure modes** (invalid address, provider unavailable, timeout, rejection,
  throttling) and the **retry** policy;
- **security** (provider secrets never leave the server, no duplicate sends, no
  order/payment-state corruption when mail fails);
- **SES sandbox vs production** configuration selection.

## 2. Result

| Suite | Type | Tests | Result |
|---|---|---|---|
| `tests/unit/ses-transport.test.ts` | unit | 12 | ✅ pass |
| `tests/unit/email-queue.test.ts` | unit | 6 | ✅ pass |
| `tests/unit/email-provider.test.ts` | unit | 6 | ✅ pass |
| `tests/integration/email-delivery.test.ts` | integration | 12 | ✅ pass |
| `tests/integration/email-suppression.test.ts` | integration | 7 | ✅ pass |
| `tests/integration/email-ses-live.test.ts` | live (gated) | 1 report + 2 skipped | ✅ pass / ⏸ BLOCKED |

**Full backend regression: 40 files, 1075 passed, 3 skipped, 0 failed**
(baseline before this work: 34 files, 1031 passed, 1 skipped).
`tsc --noEmit` clean.

## 3. Defects found and fixed

The email stack was largely **dead code**: every caller imported
`BrevoEmailService` directly, so `EMAIL_PROVIDER=ses` had no effect and the
provider abstraction was never exercised. Fixing that surfaced real defects.

1. **BUG-EMAIL-0 (critical) — provider setting ignored.** All senders reached
   Brevo directly. Every path (`auth`, `checkout`, `invoice`, `support`,
   lifecycle) now routes through `emailTransport`, honoring `EMAIL_PROVIDER`.
2. **BUG-EMAIL-1 — invoice attachments silently dropped on SES.** SES's simple
   `SendEmail` API has no attachment field, so the PDF invoice was never
   attached. `SesEmailService.sendAttachmentEmail` now builds a
   `multipart/mixed` MIME message and uses `SendRawEmail`. Verified by decoding
   the transmitted raw message.
3. **BUG-EMAIL-2 — sender display name placed on every recipient.** Recipients
   were formatted as `Vedhic Foods <customer@…>`, so the customer's inbox showed
   the brand as the *addressee's* name. Recipients are now bare addresses;
   `Source` carries the display name.
4. **BUG-EMAIL-3 — `ReplyToAddresses` nested inside `Destination`.** SES expects
   it at the top level, so reply-to was silently discarded. Moved to the correct
   position (caught by `ses-transport.test.ts`).
5. **BUG-EMAIL-4 — double retry loop.** Retry existed both in the queue and in
   `sendWithRetry`, so one transient outage produced up to `maxAttempts²` sends.
   Retry now lives only in the queue; `sendImmediate` performs a single attempt
   per pass.
6. **BUG-EMAIL-5 — idempotency key never used.** The `duplicate` status was
   declared but never set, so the same logical event (verify + webhook both
   fire for one capture; a retried delivery transition) could be mailed twice. A
   dedupe ledger now claims a key per logical event; `EmailService.handleEvent`
   keys on `${type}:${eventId}:${recipient}`.
7. **Missing notifications wired.** Payment confirmation + admin alert
   (`razorpay.service.ts`), delivery shipped/out-for-delivery/delivered and
   cancellation (`delivery.service.ts`), order cancellation and payment failure
   (`order.controller.ts`), and a new admin refund flow
   (`RazorpayService.refundPayment`, `POST /admin/orders/:id/refund`) did not
   send any email before. New templates `orderCancelled` and `refundProcessed`
   were added.
8. **Mail failure could affect state transitions.** Lifecycle sends are wrapped
   in a non-fatal guard (`OrderEmailService.safely`), proven by
   `email-delivery.test.ts` case 11: an SES outage during a refund leaves the
   payment `REFUNDED` and the call resolves successfully.

## 4. What was verified

**Addressing / rendering** — each of the eleven types asserts the recipient
address, exact subject, and key body content (order number, line item, total,
tracking/reason/refund reference, verification & reset links with the real
token). The invoice path asserts the PDF is attached, named
`Invoice-<orderNumber>.pdf`, and begins with the `%PDF` magic bytes; the admin
copy goes to the ops inbox.

**Failure classification** (`email-errors.ts`) — `MessageRejected`,
`MailFromDomainNotVerified`, `EmailAddressNotVerified`, `InvalidParameterValue`,
`AccountSendingPaused`, `AccessDenied` etc. are **permanent** (no retry);
`Throttling`, `TooManyRequests`, `ServiceUnavailable`, `RequestTimeout`,
`InternalFailure`, network errors and HTTP ≥ 500 are **retryable**. Unknown
errors default to retryable. Attachment sends are best-effort: a failure returns
`false` instead of throwing.

**Retry policy** — a transient failure retries and succeeds (3 attempts); a
permanent rejection stops after one attempt; exhausted retryable failures stop
at `maxAttempts`. A test seam (`__setEmailRetryDelayForTests`) keeps these fast.

**Idempotency** — a repeated dispatch with the same key produces exactly one
send (both the immediate path and the queued `handleEvent` path).

**Sandbox vs production** — `EMAIL_PROVIDER=ses|brevo|auto` selection:
`auto` prefers SES when `SES_SENDER_EMAIL` is set and falls back to Brevo
otherwise; the decision is resolved once and cached. Under `NODE_ENV=test` every
transport simulates, so a populated `.env` cannot send real mail or exhaust the
SES quota.

**Security** — rendered bodies never contain provider credentials
(`BREVO_API_KEY`, `AWS_SECRET_ACCESS_KEY`, `RAZORPAY_KEY_SECRET`, `SES_SENDER_EMAIL`
or the `xkeysib` Brevo key prefix).

## 5. AWS SES production setup (ready to activate)

The code is ready; only real credentials/identities are needed.

**Required environment**
| Variable | Purpose |
|---|---|
| `EMAIL_PROVIDER=ses` | force SES (or `auto` to prefer SES when configured) |
| `SES_REGION` | SES region, e.g. `ap-south-1` (falls back to `AWS_REGION`) |
| `SES_SENDER_EMAIL` | verified sender identity/address (required for SES) |
| `SES_SENDER_NAME` | display name (default `Vedhic Foods`) |
| `SES_CONFIGURATION_SET` | ties sends to the bounce/complaint event destination below |
| `ADMIN_NOTIFICATION_EMAIL` | ops inbox for paid-order alerts (falls back to the SES/Brevo sender) |
| `SNS_EMAIL_TOPIC_ARN` | the SNS topic that delivers bounce/complaint events; the webhook rejects any other topic |
| `SNS_VERIFY_SIGNATURE` | default `true`; verifies the SNS message signature on the webhook |

**AWS side**
1. Verify the sending domain (or at least the sender address) in SES.
2. Create an IAM policy scoped to `ses:SendEmail` + `ses:SendRawEmail` on the
   verified identity; attach to the task/instance role (no static keys needed).
3. Move the account out of the sandbox: request production access and set the
   daily quota + sending rate. In the sandbox every recipient must also be a
   verified identity — which is why live tests send to the configured sender.
4. **Deploy `backend/infra/cloudformation/vedhicfoods-ses.yaml`** — it creates the
   verified domain identity with DKIM records, a configuration set with
   reputation metrics, the SNS topic (SES-only publish policy) and the
   `BOUNCE, COMPLAINT` event destination. Then set `SES_CONFIGURATION_SET` and
   `SNS_EMAIL_TOPIC_ARN` from the stack outputs, and subscribe the topic to
   `POST /api/v1/webhooks/email/sns`.

**Bounce/complaint handling (wired).** A signed SNS notification is verified
(`sns-verifier.ts`: RSA-SHA256/1 over the canonical string, `SigningCertURL`
restricted to `sns.<region>.amazonaws.com`), then `EmailWebhookController` feeds
it to `EmailSuppressionService`. Permanent bounces and complaints add the address
to a `system_settings`-backed suppression list; the send path
(`EmailService`/`EmailQueue`) skips suppressed recipients. Transient bounces are
ignored, a tampered signature (403) suppresses nothing, and the suppression load
fails **open** (delivery proceeds) if the store is unreachable.

## 6. Remaining / blocked

- **BLOCKED — live SES:** the gated suite `email-ses-live.test.ts` makes real
  calls only when `LIVE_SES=true` **and** `SES_SENDER_EMAIL` **and** AWS
  credentials are present; otherwise it reports the exact blockers and skips.
  Enable with the env vars listed above once the sandbox identity exists.
- In-process queue is **per-instance and non-durable** (documented in
  `email.service.ts`); a rolling deploy drops queued mail. Use BullMQ/SQS + a
  persisted outbox if delivery must be guaranteed.
- Reputation **alarms** (`BounceRate`/`ComplaintRate`) are not yet added to
  `vedhicfoods-monitoring.yaml`; the configuration set enables the metrics, so
  the alarms only need the topic host.
- `vedhicfoods-ses.yaml` is syntax-validated locally (YAML parses); it has not
  been run through `aws cloudformation validate-template` (AWS CLI absent here).
