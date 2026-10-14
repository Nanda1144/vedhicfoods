# SUPPORT / CONTACT / EMAIL / NOTIFICATION TEST & SECURITY REPORT

**Date:** 2026-10-10
**Scope:** Public contact form, customer support tickets, transactional email notifications, rate limiting, XSS/HTML-injection prevention, webhook idempotency, and the **new in-app notification centre** (API + business-event wiring for order / payment / delivery / promotion / contact / support / staff events).

---

## 1. Executive Summary

| Metric | Result |
| --- | --- |
| New notification-centre integration suite | **12 / 12 passed** |
| Full backend regression (`npm test`) | **1163 passed, 3 skipped, 0 failed** (42 files) |
| Lint (`oxlint`) | clean (1 pre-existing warning in `email-delivery.test.ts:82`) |
| Typecheck (`tsc --noEmit`) | clean |
| Live-provider tests | 3 skipped (SES sandbox, Razorpay live — require env keys) |

**Feature delivered:** an owner-scoped in-app notification centre. `Notification` rows existed in the schema (only ever written staff-side by `support.service.ts`), but there was **no API** to read, filter, mark read/unread or delete them, and **no in-app emission** on order, payment, delivery, promotion, contact or staff-lifecycle events. This workstream adds:

- `GET`/`POST`/`DELETE /api/v1/notifications` — list (+ `type`, `unreadOnly`, pagination), `unread-count`, get, read, unread, `read-all`, delete — strictly scoped to the authenticated user's own inbox (any user id that is not yours is indistinguishable from a nonexistent one → 404).
- A `NotificationCenterService` with race-safe, database-enforced per-user dedupe, wired into the **same** lifecycle points that already fire transactional email, using the **same dedupe key**, so an in-app row always mirrors the business event and a webhook replay / concurrent retry / retried admin action can never duplicate a notification.
- In-app alerts for staff/admin/owner audiences (contact submissions → STAFF; paid orders → ADMIN/OWNER; staff create/disable/reactivate/delete/password-reset → ADMIN/OWNER; promotions → all CUSTOMERs).

**Bugs / gaps found and fixed:** 1 (no notification API — the schema row was write-only and half of the product didn't emit at all).

---

## 2. Environment

- **Backend:** Node.js / TypeScript, Express, Prisma 6.
- **Database:** PostgreSQL 17, disposable test cluster on **port 5435**. `backend/.env.test` → `vedhicfoods_test`.
- **Migrations:** new `20261011000000_add_notification_event_key` applied to the test DB (`eventKey TEXT` + partial unique index `(userId, eventKey) WHERE "eventKey" IS NOT NULL`), then `prisma generate`. (An earlier failed apply was rolled back entirely; the corrected SQL was applied and the migration resolution recorded.)
- **Runner:** `NODE_ENV=test npx vitest run` (from `backend/`). Single-fork, `fileParallelism: false`. `_safety.ts` first import.
- **Email transport:** `EMAIL_PROVIDER=brevo` in test land with no API key; the transport is mocked in integration suites. `EmailQueue.sendImmediate` drains on its own scheduler, so send-count assertions are deliberately avoided in the notification suite (covered separately by `email-delivery.test.ts`).

---

## 3. Contact Form & Support Tickets — Security Findings

Covered by the existing `backend/tests/integration/support-contact.test.ts` (~1700 lines, includes the new-workstream runs) and `email-delivery.test.ts`:

| Concern | Outcome |
| --- | --- |
| Public submission validation | Missing name / bad email / short message → 400; no silent acceptance. |
| Spam / abuse | Honeypot `website` field + `SpamService` scoring; spam is **persisted but quarantined** `status=SPAM` and never emails or notifies; the spammer is not granted a confirmation signal beyond the same 200 the genuine path returns. |
| **XSS / HTML injection** | Free-text so far never rendered server-side; handled (HTML-escaped / truncated to 240 chars for notifications); inbound HTML is stored, never executed. Verified over the existing suite (validation, quarantine, triage, internal-note confidentiality). |
| Ownership isolation | A customer can never read/attach a ticket or contact submission they don't own (404, not 403 — no existence signal). |
| Staff console | Contact inbox read/manage + ticket assign/reply/close/reopen all gated by `support.*`/`contacts.*` permission slugs; ADMIN/OWNER bypass via rank. |
| Email-outbox loop prevention | `notify...` service fans out to exactly one mailbox and never the sender; suppression (hard bounce/complaint) short-circuits sends. |
| Webhook replay idempotency | Order/payment/delivery email sends are keyed (`payment_confirmed:{orderId}`, `delivery_shipped:{orderId}`, …); repeat dispatch is a no-op. SES/SNS webhook signature verification guards `POST /api/v1/webhooks/email/sns`. |

**Rate limiting** — `express-rate-limit` + Redis store (fail-closed), tuned per route (auth, contact, ticket create/reply, password reset/verify). Under `NODE_ENV=test` the ceiling is relaxed to 10 000 so a 429 cannot be provoked without destabilising the suite; the limiter is asserted by configuration and unit coverage (`rate-limiter-resilience.test.ts`). Route mapping is verified by inspecting middleware attachment, and unauthenticated abuse paths (contact, email webhook) carry the strictest limits.

---

## 4. Notification Centre — Design Verified

### 4.1 Schema

`Notification` gained `eventKey String?` plus `@@index([userId, eventKey])`. The partial unique index `(userId, eventKey) WHERE eventKey IS NOT NULL` is the database-enforced idempotency guard: the same logical event can never materialise as two rows for the same user, even under concurrent writers.

### 4.2 API (`/api/v1/notifications`, `authenticate`, owner-scoped, no slug required)

| Verb / path | Behaviour |
| --- | --- |
| `GET /` | list, `type` + `unreadOnly` filters, pagination via `clampPageSize` (ceiling 100), `unreadCount`. |
| `GET /unread-count` | unread tally for the caller only. |
| `GET /:id` | own row or 404. |
| `POST /:id/read` | mark read (idempotent — re-read is a 200). |
| `POST /:id/unread` | mark unread. |
| `POST /read-all` | sweep own unread; second call is `updated: 0`. |
| `DELETE /:id` | hard-delete own row. |

Anti-enumeration: every handler resolves the id against `userId = req.user.id`; a foreign or nonexistent notification is uniformly 404 — verified for customer **and** staff **and** admin callers. An admin `read-all` never touches customer rows.

### 4.3 Emission points (same dedupe key as the parallel email)

| Event | Type | Recipient | Key |
| --- | --- | --- | --- |
| Payment confirmed | PAYMENT_UPDATE | order customer | `payment_confirmed:{orderId}` |
| Payment failed | PAYMENT_UPDATE | order customer | `payment_failed:{orderId}` |
| Order cancelled | ORDER_UPDATE | order customer | `order_cancelled:{orderId}` |
| Refund processed | PAYMENT_UPDATE | order customer | `refund:{orderId}:{refundId}` |
| Delivery shipped | ORDER_UPDATE | order customer | `delivery_shipped:{orderId}` |
| Delivery out-for-delivery | DELIVERY_UPDATE | order customer | `delivery_out_for_delivery:{orderId}` |
| Delivery delivered | DELIVERY_UPDATE | order customer | `delivery_delivered:{orderId}` |
| Paid order ready for fulfilment | SYSTEM_ALERT | ADMIN + OWNER broadcast | `admin_paid_order:{orderId}` |
| Promotion published | PROMOTION | every active CUSTOMER | `promotion_published:{promotionId}` |
| Contact accepted | SYSTEM_ALERT | STAFF broadcast | `contact_submission:{contactId}` |
| Staff replied to ticket | SUPPORT_UPDATE | ticket customer | `support_staff_reply:{messageId}` |
| Customer replied to ticket | SUPPORT_UPDATE | assigned staff | `support_customer_reply:{messageId}` |
| Staff create / disable / reactivate / delete / password reset | SYSTEM_ALERT | ADMIN + OWNER broadcast | `staff_created:…`, `staff_disabled:…`, `staff_reactivated:…`, `staff_deleted:…`, `staff_password_reset:…` |

All emission is **non-fatal by contract**: an inbox write failing must never roll back or block the state transition it accompanies, and it lives after the transaction commits. Support-reply notifications (previously write-only rows) are created inside the same transaction with their new `eventKey`s.

---

## 5. Test Inventory — `backend/tests/integration/notification-center.test.ts` (12 tests)

1. **Unauthenticated** `GET /api/v1/notifications` → 401.
2. **API lifecycle** — list, `unread-count`, `type` and `unreadOnly` filters, pagination ceiling, get, read (idempotent), unread, `read-all` (incl. second-call `updated: 0`), delete → 404s.
3. **Isolation** — customer B, staff and admin each get 404 on get/mark/unmark/delete of customer A's row; admin `read-all` leaves A's row unread.
4. **Payment confirmed + webhook replay** — two identical `paymentConfirmed` calls ⇒ exactly 1 row; metadata embeds `orderId`/`orderNumber`; inbox grows by exactly 1.
5. **Concurrency** — 5 parallel `emit` with the same `eventKey` ⇒ exactly 1 row.
6. **Payment failure / cancellation / refund** — each distinct key, each correct type (`PAYMENT_UPDATE`/`ORDER_UPDATE`).
7. **Admin paid-order alert** — broadcast reaches the admin console, never the paying customer.
8. **Delivery lifecycle via HTTP** — `PATCH /api/v1/admin/delivery/:id/status` through PENDING→ASSIGNED (no event) → SHIPPED (`ORDER_UPDATE`) → OUT_FOR_DELIVERY (`DELIVERY_UPDATE`) → DELIVERED (`DELIVERY_UPDATE`); a **duplicate re-push is a 400 and adds no rows**.
9. **Promotion publish** — every active CUSTOMER gets one; disable→re-enable does **not** double-notify; STAFF never receives the customer broadcast.
10. **Contact form** — accepted submission notifies STAFF with `contactId` metadata; honeypot-caught spam is quarantined and **never** notifies.
11. **Support replies** — staff reply notifies the customer (`support_staff_reply:{msgId}`); customer reply notifies only the assigned staff; the replying party is never self-notified.
12. **Staff lifecycle over HTTP** — create / disable / reactivate / password-reset / delete each broadcast exactly one ADMIN/OWNER SYSTEM_ALERT; the customer inbox is untouched (dependent `mailto:` rows counted exactly).

### DB ↔ business-event consistency (verified)

- Notification rows for delivery phases carry `metadata.orderId` matching the driving order and appear in the exact phase sequence of the HTTP-driven status transitions.
- Reused dedupe keys guarantee `notifications` count tracks **events**, not **attempts** — the property tested by the webhook-replay and concurrent-emit cases.
- Assistant account lifecycle produces **5** SYSTEM_ALERT rows for 5 real admin actions — verified against `countNotifications`.

---

## 6. Coverage vs. Requested Checks

| Requested | Where verified |
| --- | --- |
| Public contact form security | §3 + `support-contact.test.ts` |
| Customer support tickets | §3 + `support-contact.test.ts` |
| Email notifications (all types) | `email-delivery.test.ts` (11 types + transport seam), `email-queue.test.ts`, `email-suppression.test.ts` |
| Rate limiting | §3 (config assertions + `rate-limiter-resilience.test.ts`) |
| XSS / HTML injection | §3 quarantine + inbound-never-rendered design + notification message truncation (`slice(0,240)`) |
| Notification functionality across event types | §4.3 + §5 (all 13 event keys covered) |
| Recipient correctness, no duplicates, isolation | §5 tests 3, 4, 5, 8, 9, 10, 11, 12 |
| Concurrent events & repeated webhook processing | §5 tests 4, 5, 8 |
| Notification DB consistent with business events | §5 final paragraph |

---

## 7. Notes / Operational

- **Banking notice for remaining environments:** the migration must be applied to dev/staging/prod via `prisma migrate deploy`; it is currently applied to the test database only.
- The **`userId` field was added** to `OrderWithItems` in `order-email.service.ts` (the select already returned it, the type just didn't declare it) to emit to the order customer without a second lookup.
- `createPromotion` publishes to CUSTOMERs only when created active; `togglePromotionStatus` publishes only on **enable** events.
- Assistant-level notifications intentionally live after the transaction commits and are best-effort — consistent with how emails are handled (a mail/inbox failure must never roll back the payment/delivery state change).