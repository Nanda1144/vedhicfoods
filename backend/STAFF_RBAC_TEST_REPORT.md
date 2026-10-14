# STAFF & RBAC TEST REPORT — Account Management, Roles, Permissions & Per-User Grants

**Date:** 2026-10-10
**Scope:** Staff account lifecycle (create / update / disable / reactivate / delete), role assignment, permission assignment/removal, password reset, last-login tracking, privilege-escalation boundaries, self-permission rules, audit logging, duplicate/invalid accounts, and the RBAC matrix.

---

## 1. Executive Summary

| Metric | Result |
| --- | --- |
| New staff-management integration suite | **76 / 76 passed** |
| RBAC matrix suite | **270 / 270 passed** |
| Auth/RBAC suite | **25 / 25 passed** |
| Security unit suite (`security-second-pass`) | **51 / 51 passed** |
| Full backend regression (`npm test`) | **1151 passed, 3 skipped, 0 failed** (41 files) |
| Lint (`oxlint`) | clean (1 pre-existing warning in `email-delivery.test.ts`) |
| Typecheck (`tsc --noEmit`) | clean |

**Feature delivered:** per-user permission grants. The admin console exposes a by-person permission matrix, but the backend endpoint `PATCH /api/v1/admin/staff/:id/permissions` previously **failed closed** (`assertNoDirectPermissionGrant` → 403) and `POST /admin/staff` silently stripped `permissionSlugs`. The matrix was therefore a dead UI. This workstream implements per-user permission assignment end-to-end (schema, resolution, guards, audit) and aligns the tests with the new contract.

**Bugs / gaps found and fixed:** 2 (dead `updateStaffPermissions` endpoint; silent-strip of `permissionSlugs` on create), plus 3 stale RBAC assertions that encoded the old fail-closed behaviour.

---

## 2. Environment

- **Backend:** Node.js / TypeScript, Express, Prisma 6.
- **Database:** PostgreSQL 17, disposable test cluster on **port 5435**. `backend/.env.test` → `vedhicfoods_test`.
- **Migrations:** new `20261010000000_add_user_permissions` applied to the test DB via `prisma migrate deploy`, then `prisma generate`.
- **Seed:** `admin@vedhicfoods.com` / `Admin@Vedhic2026`, plus role/permission matrix (OWNER 39, ADMIN 39, STAFF 21, CUSTOMER 0 slugs).
- **Runner:** `NODE_ENV=test npx vitest run` (from `backend/`). Single-fork, `fileParallelism: false`.

---

## 3. Authorization Model (as verified)

| Role | Rank | Notes |
| --- | --- | --- |
| OWNER | 3 | Bypasses permission checks. Only role that may create/promote to OWNER. |
| ADMIN | 2 | Bypasses slug checks but is **rank-bounded**: cannot create/promote to ADMIN/OWNER (403). |
| STAFF | 1 | Permission-checked via role + (now) per-user grants. |
| CUSTOMER | 0 | Zero permissions. |

Guards verified server-side (supertest hits the Express app directly — no frontend in the loop):

- `unauthenticated` → 401 on **every** protected endpoint (also serves as a route-existence check).
- `requirePermission(slug)` denies with 403; ADMIN/OWNER bypass.
- Staff management targets must rank **strictly below** the actor (`assertCanManageStaffAccount`); ADMIN cannot edit/disable another ADMIN.
- Disabled accounts cannot authenticate and in-flight access tokens die immediately (401), as do their refresh tokens.
- Last active OWNER cannot be disabled/deleted/demoted.

---

## 4. Test Inventory — `backend/tests/integration/staff-management.test.ts` (76 tests)

1. **Create staff** — happy path, duplicate email → 409, invalid/missing fields → 400, invalid role → 400.
2. **Update staff** — fullName/phone/isActive, unknown id → 404, validation → 400, `permissionSlugs` on this verb → explicit 400.
3. **Role assignment** — valid transitions, rank forbidden transitions (403), self-role-change blocked (403).
4. **List / read** — pagination, filters, sorted list, shape includes resolved per-user permissions, unknown id → 404.
5. **Disable / reactivate / delete** — access token invalidation and restoration, last-OWNER safeguard, soft-delete semantics.
6. **Permissions (per-user grants)** — grant/revoke, override semantics, empty-set rules, invalid slug → 400, self-grant → 403, grant-what-you-lack → 403, OWNER/ADMIN target → 400.
7. **Password reset** — rotation works, old password rejected, existing tokens invalidated, delivery suppressed in test.
8. **Last-login tracking** — `lastLoginAt` set on successful login, not on failed login.
9. **Security boundaries** — unauth/customer lockout, cross-rank IDOR (body `id`/`userId` cannot retarget the `:id` path param).
10. **Duplicate / invalid accounts** — case-insensitive email collision, malformed ids.
11. **Audit logging** — `STAFF_CREATED`, `STAFF_UPDATED`, `STAFF_DISABLED`, `STAFF_PASSWORD_RESET`, `STAFF_DELETED`, and new **`STAFF_PERMISSIONS_UPDATED`** (`{ staffEmail, added, removed, updatedBy }`); secrets sanitized.

### 4.1 RBAC matrix — `backend/tests/integration/rbac-matrix.test.ts`

Exhaustive per-endpoint × per-principal matrix. Three assertions encoded the **old** fail-closed per-user behaviour and were updated to the new contract:

- `direct per-user permission grants are refused` → now **`per-user permissions can be granted to a lower-ranked target and supersede role grants`** (200 + verification). Rewritten to target a throwaway account; the old test used the shared `staff` principal, and once the endpoint started working its "expected-403" call actually wrote an override, which cascaded into a later role-revoke assertion.
- `permissionSlugs embedded in a create request are refused` → now **`permissionSlugs on create seed the account with exactly that grant set`** (201 + verification).
- `revoking a permission from the STAFF role takes effect on the very next request` → passes again once the leak above was removed.

---

## 5. Feature: Per-User Permission Grants

### 5.1 Data model

`database/prisma/schema.prisma` — new `UserPermission` model, `@@map("user_permissions")`, `@@unique([userId, permissionId])`:

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid | PK |
| `userId` | uuid | FK → User (cascade delete) |
| `permissionId` | uuid | FK → Permission |
| `assignedAt` | timestamp | default now |
| `assignedBy` | text? | actor id / system label |
| `revokedAt` | timestamp? | soft-delete tombstone |

Migration: `database/prisma/migrations/20261010000000_add_user_permissions/migration.sql`.

### 5.2 Resolution semantics (override, not merge)

`AuthService.resolveUserPermissions(userId)`:

- If the user has **any** `user_permissions` row → the active (non-revoked) set **replaces** the role-derived set entirely. All-revoked → empty set (does **not** fall back to role grants).
- No rows at all → role-derived permissions (unchanged behaviour).
- OWNER/ADMIN always resolve to the full slug set (per-user rows are ignored for them).

The tombstone (`revokedAt`) is what makes "all revoked = zero" durable: the row is retained so resolution knows an override exists.

### 5.3 API contract

| Endpoint | Behaviour |
| --- | --- |
| `PATCH /api/v1/admin/staff/:id/permissions` | Body `{ permissionSlugs: string[] }`. Replaces the account's per-user set (delta add/revoke, tombstones, one audit row). Returns the resolved set. |
| `POST /api/v1/admin/staff` | Now **honours** `permissionSlugs` (previously silently stripped). Role must not be OWNER/ADMIN (else 400). |
| `PATCH /api/v1/admin/staff/:id` | **Rejects** `permissionSlugs` with 400 pointing to `/permissions` (previously silently ignored). |

### 5.4 Guards (`backend/src/utils/privilege.ts` → `assertCanAssignPermissions`)

- **Self-grant** blocked for everyone → 403.
- **OWNER/ADMIN target** cannot receive a per-user set → 400 (they already inherit everything; a stored set would silently no-op).
- **STAFF grantor** may only grant slugs it already holds → 403; OWNER/ADMIN bypass the holds-check.
- **Target reach** via `assertCanManageStaffAccount` (strictly below actor rank).
- **Empty set** on an account with **no existing override** → 400 (ambiguous). Once an override exists, `[]` unambiguously strips to zero.

All mutations are audited (`STAFF_PERMISSIONS_UPDATED`) with `added` / `removed` deltas.

---

## 6. Findings

1. **Dead admin permission matrix (fixed).** `updateStaffPermissions` unconditionally 403'd via `assertNoDirectPermissionGrant`, while `AdminPermissionsPage.tsx` shipped a working by-person matrix calling it. Created-staff `permissionSlugs` were silently dropped. Now implemented end-to-end.
2. **Silent no-op on update (fixed).** `PATCH /admin/staff/:id` accepted-and-dropped `permissionSlugs`; now returns an explicit 400 directing callers to the dedicated endpoint.
3. **Override vs merge (design decision).** A per-user grant **replaces** role grants rather than adding to them — required so the matrix can both add and remove permission for one person. Documented in the API contract and enforced by the empty-set rules.

### Residual notes / risks

- Per-user override ignores role-of-record for resolution; revoking a role later will not affect an overridden account until the override is cleared. This is intended, but worth surfacing in admin UX.
- `updateStaffPermissions` is not transactional across validation + writes; concurrent edits can interleave. Acceptable for current admin traffic; revisit if bulk tooling is added.
- The migration must be applied per environment (`prisma migrate deploy`) — prod/dev DBs will pick it up on the next deploy.

---

## 7. How to Reproduce

```powershell
# from backend/
$env:NODE_ENV='test'
npx vitest run tests/integration/staff-management.test.ts   # 76 passed
npx vitest run tests/integration/rbac-matrix.test.ts        # 270 passed
npm run lint                                                # clean
npx tsc --noEmit                                            # clean
npm test                                                    # 1151 passed, 3 skipped
```

The 3 skipped tests require live AWS SES / Razorpay credentials (`LIVE_SES`, gateway keys) and are skipped by design in this environment.
