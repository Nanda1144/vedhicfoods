# VedhicFoods Product Requirements Document

## 1. Document control

| Field | Value |
|---|---|
| Project | VedhicFoods |
| Document | Product Requirements Document (PRD) |
| Version | 1.0 |
| Preparation date | 17 October 2026 |
| Status | Draft for business review |
| Prepared for | VedhicFoods business owner and delivery stakeholders |
| Intended audience | Business owner, product, design, engineering, QA, operations, accountant |
| Approval | Pending; no client approval was found in the reviewed repository |

### Revision history

| Version | Date | Change |
|---|---|---|
| 1.0 | 17 October 2026 | Initial PRD based on supplied approved decisions and repository review |

## 2. Executive summary

VedhicFoods is a premium traditional and organic food e-commerce product intended to sell approved Indian food products through a responsive customer storefront and a secure administration portal. It brings product discovery, online checkout, payment, order handling, inventory, invoices, and customer communications into one business workflow.

The product addresses the general need to let customers browse and buy remotely while giving authorized staff a controlled way to manage catalogues and fulfilment. This is a product rationale, not a claim that any specific current business process is failing. The proposed solution is a storefront backed by persistent commerce services and an owner/staff dashboard. Guest checkout is required for the initial release; online payment through Razorpay is the only initial-release payment mode. Staff update delivery status manually and customers see a status timeline rather than live courier mapping.

The expected value is a direct online sales channel, clearer order and payment records, fewer manual handoffs, and a consistent premium brand experience. Product catalogue claims, tax policy, fulfilment promises, and measurable targets require business evidence or approval before publication.

## 3. Background and problem statement

Customers need a clear way to discover approved traditional foods, understand price and availability, and complete an order without being forced to create an account. The business needs controlled tools for catalog maintenance, payment reconciliation, stock, order processing, and customer communication.

The repository contains a working product implementation across separate `frontend/`, `admin/`, `backend/`, and `database/` modules. The application code demonstrates product, cart, checkout, payment, invoice, admin, and delivery capabilities. Repository presence does not prove production readiness, live service configuration, or actual operational outcomes. This PRD states the required customer and business outcomes; detailed technical architecture and API/database contracts belong in a TRD and backend specification.

## 4. Product vision and objectives

**Vision:** Build a trustworthy, premium online shopping experience for traditional Indian foods and make day-to-day commerce operations manageable for authorized staff.

| Objective | Verification measure | Target/status |
|---|---|---|
| Enable online sales | A guest can complete an eligible order and receive a confirmed outcome | P0 release criterion; baseline pending |
| Improve customer experience | Usability review and task completion for browse-to-order journey | Proposed target to be approved |
| Improve order accuracy | Compare order line items, prices, address and invoice against checkout record | Proposed target: zero unexplained mismatches; approval pending |
| Ensure payment correctness | Reconcile gateway records to order payment state | Proposed target: no false paid orders; baseline pending |
| Improve inventory control | Compare available, reserved and sold stock to physical count | Proposed target and tolerance pending |
| Reduce administrative effort | Measure median staff time from paid order to dispatch-ready | Baseline and target pending |
| Protect information | Authorization and privacy acceptance scenarios pass | P0; test evidence required |
| Maintain the product | Release build, defect trend and change traceability | Proposed measures; threshold pending |

Numerical service-level or business targets are not approved by this PRD.

## 5. Stakeholders and target users

| Role | Goals and needs | Permissions and restrictions |
|---|---|---|
| Customer/guest | Browse, compare, order, pay, receive status and invoice information | May access only own order data; guest access mechanism and lifetime require confirmation |
| Owner/super admin | Control catalog, prices, stock, promotions, orders, staff and business settings | Broad administrative control, protected by backend authorization and audit history |
| Authorized staff | Perform assigned catalog, support, inventory or fulfilment work | Least-privilege access only; final role matrix pending |
| Development team | Implement agreed outcomes and integrations | No product-policy authority; use approved content and decisions |
| QA/testing team | Verify requirements, failure paths, privacy and responsive behavior | Test against approved acceptance baseline; use non-production payment setup |
| Accountant/business adviser | Supply tax, invoice and financial policy inputs | Advises on statutory/business details; no assumed tax facts |
| Hosting/payment/email providers | Provide platform services | External dependencies; account configuration and production status require owner verification |

## 6. Scope

### Initial-release scope

- Responsive public storefront, brand content, catalogue, categories, search/filter/sort, product details, availability, cart and guest checkout.
- Delivery/contact capture, server-calculated order summary, Razorpay online payment, payment result handling and order confirmation.
- Customer-accessible order status timeline and invoice access under an approved secure guest access policy.
- Admin sign-in, dashboard, product/category/image/price/discount/promotion/inventory management, order processing, manual delivery updates, customer/order records, invoice operations, staff accounts, permission enforcement and important-action audit history.
- Supporting persistence, payment, email, image storage, hosting/domain configuration, access control, monitoring, backup and recovery requirements.

### Explicit exclusions for initial release

- Cash on delivery (COD): **OUT OF SCOPE**.
- Courier API integration and live courier map tracking: **OUT OF SCOPE**.
- Customer accounts as a purchase prerequisite: **OUT OF SCOPE**. The repository has account-related screens, but mandatory account checkout is prohibited.
- Unapproved catalogue claims, certifications, nutrition/ingredient statements, delivery promises, refund promises, tax rates or legal claims.

### Potential future enhancements

Optional customer accounts, saved addresses, loyalty/rewards, courier integrations, live tracking, richer analytics, and additional payment methods may be considered after separate approval. UPI availability is subject to the configured Razorpay merchant account.

### Dependencies and assumptions

- Business supplies final products, imagery, descriptions, prices, ingredient/allergen/nutrition facts and substantiation for any organic or quality claims.
- Business supplies approved policy and tax/invoice details listed in Section 18.
- Razorpay, email provider, image storage, AWS-hosted environment and BigRock domain access are available to the responsible owner; live readiness is **NOT VERIFIED** by source inspection.
- No baseline performance, sales, conversion, availability or operational metric was supplied.

## 7. Functional requirements

Priorities: **P0** mandatory for a safe and functional initial release; **P1** important for initial release; **P2** optional/future. Statuses use the evidence labels in Section 6 of the supplied brief. “VERIFIED EXISTING” means relevant code or configuration is present, not that production operation was proven. Every criterion below is a release acceptance condition even when implementation exists.

| ID | Area and observable requirement | Priority | Acceptance criteria | Dependency | Evidence/status |
|---|---|---:|---|---|---|
| FR-001 | Public home presents approved brand and product content. | P1 | Home loads on supported viewport; links and calls to action work; only approved claims appear. | Approved brand content | `frontend/src/pages/customer/HomePage.tsx`; **VERIFIED EXISTING**, content approval pending |
| FR-002 | Public navigation exposes Shop, categories, About, Contact, FAQ and policy links as approved. | P1 | Each visible link reaches the intended page; unavailable policy pages are not represented as approved content. | Content/policy approval | `frontend/src/routes/index.tsx`; **VERIFIED EXISTING** pages; policy coverage **NOT VERIFIED** |
| FR-003 | Catalogue shows active products and categories with availability and price. | P0 | Product data comes from service; inactive/unavailable items cannot be ordered; empty/error/loading states are clear. | Catalog data | `productService`, `categoryService`; **VERIFIED EXISTING** |
| FR-004 | Search, filtering and sorting help customers find catalogue items. | P1 | Search and selected filters/sort visibly affect results and can be cleared. | Searchable content | `ShopPage.tsx`, product service; **VERIFIED EXISTING** |
| FR-005 | Product detail shows approved name, description, images, price, options and stock state. | P0 | Detail matches current catalog data; unavailable item cannot be added for purchase. | Approved product content | `ProductDetailPage.tsx`; **VERIFIED EXISTING**, content accuracy pending |
| FR-006 | Cart supports quantity changes, removal and current totals. | P0 | Changes recalculate display; checkout rejects stale or invalid quantities. | FR-003, pricing rules | `CartPage.tsx`, `cartService`; **VERIFIED EXISTING** |
| FR-007 | Customer can submit checkout without registering or signing in. | P0 | Signed-out guest can place a valid checkout; no account creation gate appears. | FR-008, FR-009 | `CheckoutPage.tsx`, `order.routes.ts`; **VERIFIED EXISTING** |
| FR-008 | Checkout collects necessary customer contact and delivery address details. | P0 | Required fields are validated; data is bound to the order; errors identify fields. | Address policy | `AddressForm.tsx`, `checkout.types.ts`; **VERIFIED EXISTING** |
| FR-009 | Checkout displays item, discount, delivery, tax (when defined) and total summary. | P0 | Displayed amount matches authoritative server response; any unresolved charges are not guessed. | Pricing, tax and delivery decisions | `checkout.service.ts`; **VERIFIED EXISTING** calculation; commercial rules pending |
| FR-010 | Create one order per checkout intent and preserve an order snapshot. | P0 | Repeating the same idempotency key does not create another order/reservation; order contents and totals remain auditable. | FR-009 | `checkout.service.ts`, checkout client; **VERIFIED EXISTING** |
| FR-011 | Initial release accepts online payment through Razorpay, including UPI when merchant configuration supports it. | P0 | Gateway starts with server-derived amount; COD is unavailable in customer checkout. | Razorpay merchant account | `paymentService.ts`, Razorpay integration; **VERIFIED EXISTING** integration code; live mode **NOT VERIFIED** |
| FR-012 | Backend verifies payment before marking an order paid. | P0 | Invalid signature or mismatched order/amount cannot produce paid state; verified success is recorded once. | FR-011 | `payment.controller.ts`, Razorpay service; **VERIFIED EXISTING** |
| FR-013 | Failed, abandoned, pending and delayed payment outcomes are recoverable and intelligible. | P0 | Customer sees outcome and next step; order/payment state is not falsely shown as paid; reservation release follows approved rule. | Payment/order policy | payment and checkout services; **VERIFIED EXISTING** paths, end-to-end live behavior **NOT VERIFIED** |
| FR-014 | Guest receives a secure means to access their order and status. | P0 | Unauthorized user cannot fetch order by guessing an ID/number; token is bound to order and access expires/rotates per approved policy. | Guest lookup decision | `orderTokenStore.ts`, `order-auth.middleware.ts`; token mechanism **VERIFIED EXISTING**; policy **PENDING CONFIRMATION** |
| FR-015 | Authorized staff can manage stock and customers see current purchasability. | P0 | Concurrent checkout cannot oversell available stock; out-of-stock item cannot be purchased; stock changes are recorded. | Inventory policy | `inventory.service.ts`; **VERIFIED EXISTING** |
| FR-016 | Authorized staff review and process orders through defined states. | P0 | Invalid state transitions are rejected; changes appear in order detail and history. | Final order workflow | `AdminOrdersPage.tsx`, checkout/delivery services; **VERIFIED EXISTING** |
| FR-017 | Authorized staff manually update fulfilment and delivery states. | P0 | Staff update is attributable; customer sees status timeline; courier APIs are not required. | Status definitions | `AdminDeliveryPage.tsx`, `delivery.service.ts`; **VERIFIED EXISTING** |
| FR-018 | Customer can view an authorized order-status timeline. | P0 | Timeline is associated with only the authorized order; no live map is represented as a feature. | FR-014, FR-017 | `orderService.delivery`; **VERIFIED EXISTING** endpoint/client; page experience **NOT VERIFIED** end-to-end |
| FR-019 | Generate, access and deliver an invoice consistent with order totals. | P0 | Line items, discount, shipping, tax and total reconcile exactly to order snapshot; access is authorized; invoice reflects approved tax policy. | Tax and invoice decisions | `invoice.service.ts`, PDF generator and invoice pages; **VERIFIED EXISTING** generation/access code; legal correctness pending |
| FR-020 | Send transactional order/payment/invoice messages and expose delivery outcome to operators. | P1 | Templates use approved facts; transient failure can retry without duplicate business event; failure is observable. | Email provider/sender approval | email queue, SES/Brevo adapters; **VERIFIED EXISTING** code; live delivery **NOT VERIFIED** |
| FR-021 | Admin dashboard summarizes operational information. | P1 | Values reconcile to underlying records and filters/date boundaries are clear. | Reporting definitions | `AdminDashboardPage.tsx`, report service; **VERIFIED EXISTING** |
| FR-022 | Admin manages product, category and product images. | P0 | Authorized create/read/update/archive succeeds; invalid or oversized image gets actionable error; storefront reflects approved change. | Image storage | Admin product pages, product routes, S3 integration; **VERIFIED EXISTING** code; production storage **NOT VERIFIED** |
| FR-023 | Admin manages prices, discounts and timed promotions. | P0 | Only eligible, active promotion applies within configured validity; customer total and order snapshot agree. | Promotion policy | discount/promotion pages and service; **VERIFIED EXISTING** |
| FR-024 | Admin views and manages customer/order information for operational purpose. | P0 | Access is role-limited, sensitive data is not exposed to unauthorized staff, and changes are auditable. | Permission matrix, privacy rules | customer/order pages and RBAC; **VERIFIED EXISTING** code; final policy pending |
| FR-025 | Owner creates, disables and assigns restricted staff accounts. | P0 | Backend rejects unauthorized action even if UI controls are bypassed; role assignment is recorded. | Final role matrix | staff routes, permissions; **VERIFIED EXISTING** |
| FR-026 | Important administrative actions have audit history. | P1 | Actor, action, target and timestamp are retrievable for defined critical events; access to logs is restricted. | Audit retention policy | audit service/pages; **VERIFIED EXISTING** |
| FR-027 | Provide operational reports where included in approved scope. | P2 | Report definitions and totals are documented and reconcile to source records. | Reporting scope | report routes/pages; **VERIFIED EXISTING** implementation; inclusion/definitions pending |
| FR-028 | Business policy and content are maintainable and published only after approval. | P1 | Authorized content change is previewable/reviewable; customer-facing version is current and identifiable. | Approved policy copy | Content admin/service exists; coverage/workflow **NOT VERIFIED** |
| FR-029 | Admin can access and generate invoice copies for authorized operations. | P1 | Access is permission checked and invoice totals agree with order snapshot. | FR-019 | `AdminInvoicesPage.tsx`, invoice service; **VERIFIED EXISTING** |

## 8. Business rules

| ID | Rule | Status |
|---|---|---|
| BR-001 | Server-calculated catalog prices, eligible discounts, delivery charges and totals are authoritative; client-submitted totals are informational only. | **PROPOSED** rule for approval; server-side calculation is present in `checkout.service.ts` (**VERIFIED EXISTING**) |
| BR-002 | Discounts apply only when active, within validity, and eligible for the basket/customer under defined rules. | **PROPOSED**; stacking, minimums and precedence **PENDING CONFIRMATION** |
| BR-003 | Stock must be revalidated at checkout and reserved/committed/released consistently; do not accept overselling. | **PROPOSED** policy; reservation workflow **VERIFIED EXISTING** |
| BR-004 | Checkout idempotency prevents duplicate orders for retried submissions. | **VERIFIED EXISTING** implementation; retention/key semantics require technical specification |
| BR-005 | An order is paid only after trusted backend verification of the gateway result/webhook. A browser redirect is not proof of payment. | **CONFIRMED**; verification code **VERIFIED EXISTING** |
| BR-006 | Repeated payment events must be idempotent and must not double-confirm, double-email, or double-consume stock. | **PROPOSED** release rule; webhook/idempotency code exists, release evidence **NOT VERIFIED** |
| BR-007 | Order status and payment status are separate but consistent; unpaid orders cannot be represented as paid/fulfilled. | **PROPOSED**; state model **VERIFIED EXISTING** |
| BR-008 | Delivery updates are manual by authorized owner/staff; no courier API or live map is needed in initial release. | **CONFIRMED** |
| BR-009 | Guest can access only their own order via an approved secure lookup mechanism. | Privacy objective **CONFIRMED**; lookup policy **PENDING CONFIRMATION** |
| BR-010 | Staff permissions must be checked server-side for every protected operation. | **CONFIRMED**; role matrix **PENDING CONFIRMATION** |
| BR-011 | Invoice amounts and detail must match the immutable order/pricing snapshot and approved tax treatment. | Consistency **CONFIRMED**; tax treatment and legal fields **PENDING CONFIRMATION** |
| BR-012 | Cancellation eligibility, stock restoration, refund eligibility and refund timing follow approved policy. | **PENDING CONFIRMATION** |
| BR-013 | Notification retries must be bounded/observable and must not issue duplicate business notifications. | **PROPOSED**; queue/deduplication implementation **VERIFIED EXISTING** |
| BR-014 | Initial release accepts online payments only; COD is excluded. | **CONFIRMED**; repository has COD paths, which must not be treated as approved scope |
| BR-015 | Shipping, tax and discount amounts must not be fabricated when the related policy or data is missing. | **CONFIRMED** documentation constraint; operational policy pending |

## 9. User journeys and workflows

1. **Guest browses and purchases:** Open storefront → browse category/search → inspect product and availability → add items/change quantity → proceed without account → enter contact/address → review server-priced summary → submit checkout → receive order reference and secure access credential → continue to payment.
2. **Successful payment:** Start Razorpay checkout for the server-created amount → complete payment → backend verifies signature/event → order/payment state updates once → confirmation appears → approved email/invoice is issued → customer sees order timeline. If verification is delayed, show pending state and provide a safe retry/status check.
3. **Failed or pending payment:** Gateway reports failure, customer closes checkout, or response is lost → show that payment is not confirmed → allow status recheck or retry where policy allows → prevent duplicate order/charge → release inventory reservation only under the defined timeout/failure rule. Refund and retry policy needs approval.
4. **Guest checks order status:** Customer presents the approved order access mechanism → server verifies ownership/expiry → display only permitted order and timeline data → reject guessed or expired credentials with a recovery path approved by the business.
5. **Owner manages products:** Sign in → open products/categories → create/update/disable product and approved content → set price and inventory → upload image → save → verify storefront publication and audit event.
6. **Owner manages promotion and stock:** Create discount/promotion with eligibility and active window → preview effect → publish → verify eligible basket total → adjust inventory or mark unavailable → verify storefront reflects stock.
7. **Staff processes order:** Sign in → access permitted orders → review payment and address → update processing/packing/delivery state manually → each change is validated, attributable, and visible in customer timeline.
8. **Owner grants restricted access:** Create staff identity → assign approved role/permissions → staff signs in → verify permitted operations work and forbidden backend requests fail → review audit entry.
9. **Authorized invoice access:** Customer with valid order access or authorized staff opens invoice → invoice is generated/downloaded/emailed as policy allows → totals reconcile to order snapshot and approved seller/tax fields.

## 10. Non-functional requirements

All thresholds below are **proposed acceptance targets**, not measured results or approved SLAs. They require owner approval and validation in a representative environment.

| ID | Requirement | Proposed acceptance/test condition |
|---|---|---|
| NFR-001 Performance | Storefront and admin interactions should remain responsive. | Approve numeric p75/p95 budgets; measure cold/warm page and API timings on representative mobile and desktop network profiles. Target pending. |
| NFR-002 Security | Protect personal, order, staff and payment data; enforce authentication, authorization, validation, rate controls and secret handling. | Run authorization-negative tests, payment tamper tests, dependency/security review and secret scan; no unapproved critical/high finding at release. |
| NFR-003 Reliability | Payment, order and inventory state transitions must be recoverable and idempotent. | Exercise timeout, duplicate callback, retry, process restart and gateway-unavailable scenarios without duplicate paid order or unreconciled stock. |
| NFR-004 Availability | Meet an agreed service availability objective. | Business/operations to approve target and measurement window; monitor storefront, API and database synthetic health. |
| NFR-005 Data integrity | Order, payment, stock, invoice and audit records remain consistent. | Reconcile representative lifecycle records and invoice arithmetic; prove transaction/compensation paths. |
| NFR-006 Accessibility | Support keyboard operation, visible focus, semantic labels, readable contrast and reduced-motion preferences. | Manual keyboard/screen-reader spot checks plus automated accessibility scan on key journeys; resolve critical blockers. |
| NFR-007 Responsive design | Core shopping/admin tasks work on phone, tablet and desktop without loss of content or controls. | Validate agreed viewport matrix and touch operation; include checkout and admin order updates. |
| NFR-008 Browser compatibility | Support current agreed browser/device combinations. | Owner/QA approve matrix; run critical journeys on each supported browser. Matrix pending. |
| NFR-009 Maintainability | Requirements, business rules, change history and service ownership remain understandable. | Code review and release docs identify owner, monitoring, rollback and traceability for changed P0 requirements. |
| NFR-010 Scalability | Handle expected catalogue and peak order load without violating correctness. | Expected volumes and growth are pending; load-test agreed profile and monitor queue/database saturation. |
| NFR-011 Logging/monitoring | Operational failures and privileged changes are diagnosable without logging secrets or unnecessary personal data. | Confirm event coverage, alert ownership and retention; test payment/email/database alerts. |
| NFR-012 Backup/recovery | Business data can be restored to an agreed recovery point/time. | Approve RPO/RTO; perform documented restore drill and verify orders, invoices, staff and audit records. Automated daily backup pipeline status requires verification. |
| NFR-013 Privacy/retention | Collect only necessary customer data, limit access, explain use, and delete/retain per approved legal policy. | Privacy notice, retention schedule, deletion process and jurisdictional obligations approved before release. |
| NFR-014 Motion | Homepage motion does not block purchase, reading or accessibility. | Reduced-motion preference is honored; animation can be skipped and does not delay key controls. |

## 11. UI/UX and brand requirements

- Position VedhicFoods as a premium Indian traditional-food brand using natural green, earthy and warm-neutral colors, strong typography hierarchy and clear product photography. The exact brand/content approval remains with the business.
- Avoid generic grocery-template presentation. Product origin, ingredients, nutrition, certification and quality claims must be substantiated and approved.
- Keep navigation and purchase controls consistent across storefront pages. Provide clear loading, empty, error and success states.
- Provide mobile bottom navigation for Home, Categories, Shop, Contact Us and About, as specified. The existing mobile navigation component is **VERIFIED EXISTING**; exact label/path fit requires visual acceptance.
- Keep page headings and content left-aligned where appropriate, especially beside admin navigation. The dashboard should prioritize operational clarity, status, search and actionable errors.
- Use accessible focus indication, sufficient contrast, semantic controls and reduced-motion behavior.
- Proposed homepage cinematic sequence: (1) ingredients and grains, (2) traditional cooking, (3) hygienic preparation and arrangement, (4) finished products, (5) packaging, (6) delivery-ready orders. These are proposed content beats; imagery and food-safety claims require approval. Animation may not obstruct browsing, reading, accessibility or checkout.

## 12. Data and information requirements

The product needs business information for: product identity, approved description, category, images, unit/variants, ingredients/allergens/nutrition where supplied, approved claims, list/sale price, discount eligibility and validity, on-hand/reserved stock; order lines and price snapshots; guest name/contact and delivery address; payment provider references, amount/currency and status; invoice number/date/seller/tax fields and totals; staff identity, role and permissions; audit actor/action/target/time; and notification event, recipient, delivery attempt/result. This is a business information inventory, not a final database schema. The repository has a Prisma schema and migrations; their technical structure is specified separately.

## 13. Integration requirements

| Integration | Business requirement | Repository evidence / open verification |
|---|---|---|
| Razorpay | Create/verify online payments; enable UPI only when merchant/gateway configuration supports it; reconcile result securely. | Razorpay service, controllers and client flow exist. Production credentials, merchant methods, webhook registration and live transaction readiness are **NOT VERIFIED**. |
| Email delivery | Send approved transactional order, status and invoice messages; expose failures/retries to operations. | SES/Brevo provider and queue code exist. Sender/domain verification, live deliverability and provider account readiness are **NOT VERIFIED**. |
| Product image storage | Authorized staff upload images; storefront can retrieve stable images. | S3 integration and admin upload code exist. Bucket/CDN access, lifecycle, image privacy and production delivery are **NOT VERIFIED**. |
| AWS-hosted production | Host application/supporting services with monitoring, access control and recovery. | AWS templates, Docker and deployment/runbook files exist. Actual deployed resources, region, topology and operational readiness are **NOT VERIFIED**. Do not infer exact production service configuration from examples. |
| BigRock domain | Use existing domain for customer-facing production identity and route securely to hosted application. | Domain is named in approved brief; ownership, DNS records, TLS and current routing are **NOT VERIFIED**. |
| Database/persistence | Retain authoritative catalog, order, payment, inventory, invoice, staff and audit records. | PostgreSQL/Prisma schema and migrations exist; production database target and backup posture require verification. |

## 14. Acceptance criteria

Release acceptance requires evidence for each item below:

- **AC-001 Browsing:** Approved products/categories load; search/filter/detail and stock state agree with admin data.
- **AC-002 Guest checkout:** Signed-out customer submits contact/address and order without account creation; invalid fields and unavailable stock are rejected.
- **AC-003 Payment success:** Razorpay success is backend-verified; only then is order marked paid/confirmed; amount and currency reconcile.
- **AC-004 Payment failure:** Failure, dismissal and network interruption are not shown as paid; customer receives a clear next action.
- **AC-005 Pending payment:** Delayed gateway result can be reconciled without duplicate order or false success.
- **AC-006 Duplicate events:** Repeated checkout submission and repeated payment webhook/verification do not create duplicate order, capture, stock deduction or notification.
- **AC-007 Inventory:** Concurrent attempts for limited stock cannot oversell; failure/cancellation restoration follows approved policy and is auditable.
- **AC-008 Status updates:** Authorized staff manually updates valid order/delivery states; timeline displays current and prior status appropriately; no live map dependency exists.
- **AC-009 Guest order access:** Unauthorized/guessed/expired access is rejected; a valid guest can view only the permitted order and invoice data.
- **AC-010 Invoice:** Invoice subtotal, discounts, shipping, tax and grand total reconcile to order; seller/tax/numbering fields match approved accountant instructions.
- **AC-011 Email:** Success/failure/retry and duplicate event paths are verified in a non-production provider setup; actual live delivery requires provider confirmation.
- **AC-012 Staff authorization:** Role permissions are enforced by backend for allowed and denied routes/actions; final role matrix is approved.
- **AC-013 Responsive layouts:** Browse, checkout and critical admin tasks pass the approved viewport/browser matrix, keyboard and reduced-motion checks.
- **AC-014 Deployment/recovery:** Production configuration contains no placeholders/secrets in client assets; health monitoring works; restore drill meets approved RPO/RTO.

## 15. Success metrics

No measured baseline was supplied. All targets are **PROPOSED** and require approval.

| Metric | Definition | Baseline | Proposed target |
|---|---|---|---|
| Checkout completion | Valid checkout attempts reaching confirmed paid order / valid checkout attempts | Pending | Approve after baseline period |
| Payment correctness | Reconciled gateway transactions with matching order state and amount | Pending | 100% reconciled; investigate every variance |
| Order accuracy | Orders with no corrected item/address/amount error / orders fulfilled | Pending | Target pending |
| Stock discrepancy | Difference between recorded and counted stock by SKU | Pending | Tolerance pending |
| Page performance | Agreed page/API percentile timings on defined device/network | Pending | Numeric budgets pending |
| Error rate | Failed eligible storefront/API requests / total eligible requests | Pending | Numeric threshold pending |
| Email delivery | Accepted/delivered transactional messages / attempted messages | Pending | Provider-specific target pending |
| Admin processing efficiency | Median paid-order-to-processing/dispatch-ready elapsed time | Pending | Baseline then target pending |

## 16. Risks and mitigations

Likelihood is qualitative and provisional; risk owners are suggested roles, not assigned people.

| Risk | Impact | Likelihood | Mitigation | Owner |
|---|---|---|---|---|
| Payment verification failure or gateway outage | Incorrect order state, lost conversion | Medium | Backend verification, reconciliation, clear pending/failure states, monitored alerts and retry policy | Engineering/operations |
| Duplicate checkout/payment processing | Duplicate orders, charges or stock changes | Medium | Idempotency keys, event deduplication, reconciliation and duplicate-event acceptance tests | Engineering |
| Inventory overselling | Unfulfillable orders and customer impact | Medium | Atomic stock validation/reservation, concurrent checkout tests, stock audit | Engineering/operations |
| Unauthorized data access | Privacy and business harm | Medium | Backend RBAC, least privilege, negative authorization testing, audit review | Security/owner |
| Guest order disclosure | Exposure of address/contact/order | Medium | Approve secure lookup method, bind/expire credential, rate-limit and minimize displayed data | Product/security |
| Email delivery failure | Missed updates/invoices | Medium | Queue/retry, provider monitoring, admin visibility and alternate support route | Operations |
| Incorrect tax/invoice data | Financial/legal exposure | Medium | Obtain accountant-approved fields/rules; validate samples before production | Owner/accountant |
| Poor mobile performance/usability | Checkout abandonment | Medium | Image optimization, mobile performance testing and critical journey review | Design/engineering |
| Image storage or delivery failure | Missing product content | Medium | Verify storage/CDN configuration, test upload/read, monitor errors and retain source assets | Engineering/operations |
| Production configuration error | Outage or data exposure | Medium | Environment review, deployment checklist, secret handling, health checks and rollback plan | Operations |
| Database loss or corruption | Loss of orders and records | Low/Medium | Approved backup retention, recovery objectives, restore drills and reconciliation | Operations |
| Scope expansion | Delayed release and incomplete validation | Medium | Baseline this PRD, record changes, re-estimate and re-approve scope | Product/owner |

## 17. Dependencies and assumptions

- Owner approval of this requirements baseline, brand, product content and policies.
- Accountant/business adviser supplies correct tax treatment, seller identity, registration details if applicable, invoice fields/numbering and credit-note rules.
- Razorpay account, enabled payment modes, webhook/return configuration and production approval.
- Email sender/provider verification and suppression/notification operational ownership.
- AWS hosting/storage/monitoring account access, production topology, backup arrangement and recovery ownership.
- BigRock domain ownership and DNS/TLS control.
- Staff identities, role definitions, contact/support process and fulfilment capacity.
- Delivery coverage, charges, estimates, cancellation/refund rules and notification content.
- Current source code can be reviewed, but environment files and secret values are intentionally excluded from this analysis. No credential values are documented.

## 18. Pending confirmation register

| Decision ID | Question or unresolved requirement | Why it matters | Responsible stakeholder | Impact if unresolved | Required-by | Status |
|---|---|---|---|---|---|---|
| DEC-001 | What secure mechanism may a guest use to look up an order, how long does access last, and what recovery is offered? | Protects contact, address, payment and invoice information | Owner/product/security | Guest tracking/invoice release cannot be finalized | Before guest order access release | **PENDING CONFIRMATION** |
| DEC-002 | Are displayed prices tax-inclusive or is tax added at checkout? | Determines customer price communication and totals | Owner/accountant | Checkout and invoice amounts may be wrong | Before pricing/invoice sign-off | **PENDING CONFIRMATION** |
| DEC-003 | Which tax rules/rates apply, and what seller legal/tax details and invoice fields are required? | Financial/legal correctness | Accountant/owner | Invoice release blocked | Before invoice approval | **PENDING CONFIRMATION** |
| DEC-004 | What invoice numbering sequence, date rules, and credit-note/void process apply? | Traceability and accounting | Accountant/owner | Cannot approve invoice lifecycle | Before invoice approval | **PENDING CONFIRMATION** |
| DEC-005 | What are cancellation eligibility, refund methods/timing, and refund status communications? | Customer and payment operations | Owner/accountant | Cancellation/refund support unclear | Before accepting production orders | **PENDING CONFIRMATION** |
| DEC-006 | What delivery areas are served and what fees apply? | Checkout eligibility and total | Owner/operations | Checkout may accept unsupported addresses or misprice | Before production checkout | **PENDING CONFIRMATION** |
| DEC-007 | What estimated delivery times may be shown and how are delays handled? | Customer expectations and claims | Owner/operations | Avoid unsupported delivery promises | Before publishing delivery content | **PENDING CONFIRMATION** |
| DEC-008 | Which staff roles, permissions, and customer-data restrictions are approved? | Secure administration | Owner/security | Cannot finalize authorization acceptance | Before staff rollout | **PENDING CONFIRMATION** |
| DEC-009 | Are customer accounts supported in a future release, and what capabilities may they provide? | Roadmap and account data handling | Owner/product | Future scope remains undefined | Roadmap planning | **PENDING CONFIRMATION** |
| DEC-010 | What performance and availability objectives are acceptable? | Enables measurable service acceptance | Owner/operations | No service-level release target | Before production readiness | **PENDING CONFIRMATION** |
| DEC-011 | Which privacy laws/jurisdictions, privacy notice, data retention, deletion and consent rules apply? | Personal-data handling and legal compliance | Owner/legal adviser | Privacy acceptance cannot be finalized | Before production release | **PENDING CONFIRMATION** |
| DEC-012 | Which payment retry/reservation timeout and late-payment reconciliation rules apply? | Stock and payment consistency | Owner/engineering | Failure recovery behavior unresolved | Before payment sign-off | **PENDING CONFIRMATION** |
| DEC-013 | What promotions may stack, and what eligibility, minimum basket and usage limits apply? | Consistent prices and discounts | Owner | Discounts may be misapplied | Before promotion launch | **PENDING CONFIRMATION** |
| DEC-014 | Which reporting definitions, exports and roles are in initial scope? | Prevents misleading reports and scope ambiguity | Owner/accountant | Reporting scope remains uncertain | Before admin sign-off | **PENDING CONFIRMATION** |
| DEC-015 | Which browsers/devices and accessibility conformance level are release requirements? | Defines QA matrix | Owner/product/QA | Compatibility acceptance incomplete | Before release QA | **PENDING CONFIRMATION** |

## 19. Traceability matrix

AT references point to the acceptance criteria in Section 14. Detailed test case IDs and results are to be maintained by QA. All P0 items below must have a passing test record before release; no test execution is claimed here.

| Requirement | Feature/objective | Acceptance test reference | Dependent decision | Status |
|---|---|---|---|---|
| FR-003 | Catalogue and availability | AC-001 | Product data | **VERIFIED EXISTING** code |
| FR-005 | Product detail | AC-001 | Approved product content | **VERIFIED EXISTING** code |
| FR-006 | Cart accuracy | AC-002 | Pricing rules | **VERIFIED EXISTING** code |
| FR-007 | Guest purchase | AC-002 | Guest policy | **VERIFIED EXISTING** code |
| FR-008 | Contact/address capture | AC-002 | Address requirements | **VERIFIED EXISTING** code |
| FR-009 | Order total | AC-002, AC-003, AC-010 | DEC-002, DEC-003, DEC-006, DEC-013 | Calculation **VERIFIED EXISTING**; policy pending |
| FR-010 | Unique order creation | AC-006 | Technical idempotency policy | **VERIFIED EXISTING** code |
| FR-011 | Razorpay online payment | AC-003, AC-004 | Merchant account, UPI enablement | Integration **VERIFIED EXISTING**; live setup unverified |
| FR-012 | Trusted payment verification | AC-003, AC-005 | Gateway configuration | **VERIFIED EXISTING** code |
| FR-013 | Failure/pending recovery | AC-004, AC-005, AC-007 | DEC-005, DEC-012 | Paths present; validation needed |
| FR-014 | Secure guest access | AC-009 | DEC-001, DEC-011 | Token mechanism **VERIFIED EXISTING**; policy pending |
| FR-015 | Inventory integrity | AC-007 | DEC-012 | **VERIFIED EXISTING** code |
| FR-016 | Order processing | AC-008 | Status workflow | **VERIFIED EXISTING** code |
| FR-017 | Manual delivery updates | AC-008 | Delivery policy | **VERIFIED EXISTING** code; **CONFIRMED** manual operation |
| FR-018 | Customer timeline | AC-008, AC-009 | DEC-001 | API/client evidence; end-to-end **NOT VERIFIED** |
| FR-019 | Invoice correctness/access | AC-009, AC-010 | DEC-002, DEC-003, DEC-004, DEC-005 | Generator **VERIFIED EXISTING**; legal data pending |
| FR-022 | Product/category/image admin | AC-001, AC-013 | Image storage config | **VERIFIED EXISTING** code |
| FR-023 | Pricing/promotions | AC-002, AC-006 | DEC-013 | **VERIFIED EXISTING** code |
| FR-024 | Customer data privacy | AC-009, AC-012 | DEC-008, DEC-011 | Pages/RBAC exist; policies pending |
| FR-025 | Staff access | AC-012 | DEC-008 | **VERIFIED EXISTING** code |
| FR-026 | Audit history | AC-012, AC-014 | Retention policy | **VERIFIED EXISTING** code |
| FR-020 | Email notifications | AC-011 | Sender/provider setup | Queue/provider code **VERIFIED EXISTING**; live delivery unverified |
| NFR-002 | Security | AC-009, AC-012, AC-014 | DEC-001, DEC-008, DEC-011 | Test evidence required |
| NFR-006–008 | Accessibility/responsive/browser | AC-013 | DEC-015 | Validation required |
| NFR-012 | Backup/recovery | AC-014 | DEC-010, RPO/RTO | Production posture **NOT VERIFIED** |

## 20. Definition of done and approval

### Requirements documented

- Required sections, unique IDs, status labels, observable criteria, dependencies and pending decisions are recorded.
- Confirmed decisions are consistent across scope, rules, journeys and acceptance criteria.
- Existing repository evidence is not represented as a production guarantee or test result.

### Client review complete

- Business owner and relevant accountant/operations/security stakeholders review the requirements and pending-decision register.
- Review comments are resolved or recorded with owner and due point; product content and legal/tax facts are substantiated.

### PRD approved

- Authorized business approver accepts scope, priorities, policies, measurable objectives and residual risks in a recorded approval.
- Tax/invoice, delivery, refund/cancellation, guest access, permission and privacy decisions are approved or explicitly deferred with release impact.

### Development may proceed against baseline

- Approved PRD version and linked technical specifications are available to engineering and QA.
- Each P0 requirement has agreed acceptance tests and owners; external service access and operational responsibilities are confirmed.
- Any requirement change follows documented change control and updates traceability.

**Approval status: PENDING.** No approval evidence was present in the reviewed repository or supplied brief.

## Repository findings and evidence limits

The following files/components were reviewed at a product-evidence level: root and backend README documentation; `frontend/src` customer routes/pages/services and mobile navigation; `admin/src` routes, service clients, admin pages, authentication and permission UI; `backend/src` route/controller/service and Razorpay, email, PDF and S3 integrations; `database/prisma/schema.prisma` and migration inventory; deployment/runbook/configuration templates by filename and non-secret documentation. Environment secret values were not inspected or copied.

Key verified code areas include:

- Storefront pages and services for catalog, cart, checkout, customer accounts, orders and invoice access (`frontend/src/pages/customer/`, `frontend/src/services/`).
- Guest checkout and order access token support (`backend/src/routes/order.routes.ts`, `frontend/src/services/orderTokenStore.ts`, backend order-auth middleware).
- Server-side Razorpay create/verify/webhook paths (`backend/src/controllers/payment.controller.ts`, `backend/src/integrations/razorpay/`).
- Product, inventory, order, delivery, invoice, reporting, notification and audit services (`backend/src/services/`).
- Admin products, promotions, inventory, orders, delivery, customers, staff, permissions, invoices and audit pages (`admin/src/pages/admin/`).
- Persistent Prisma schema/migrations (`database/prisma/`).

The root README contains stale/conflicting statements describing COD as enabled, a particular tax rate and GST-compliant invoices, as well as implementation/test-count claims. They are not accepted as business decisions or independently validated test evidence. COD is excluded by the confirmed initial-release decision. The code calculates tax and contains tax-invoice terminology, but applicability, rate, inclusivity, seller details, numbering and statutory correctness remain pending accountant/business confirmation. Repository source inspection does not verify live AWS, database, Razorpay, email, DNS/domain, backups, production security posture, or end-to-end behavior. No tests were run for this documentation task.

