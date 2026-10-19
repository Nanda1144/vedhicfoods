import { PrismaClient, RoleName, SettingCategory } from '@prisma/client'
import bcrypt from 'bcryptjs'
import path from 'path'
import { encrypt32 } from './encryption'

import dotenv from 'dotenv'
dotenv.config({ path: path.resolve(__dirname, '.env') })

const prisma = new PrismaClient()

/**
 * Returns the desired phone number for a seeded test account only when it is
 * free (or already belongs to that same email). `User.phone` is unique and
 * optional, so on a live database these hardcoded fixture numbers routinely
 * collide with real customers/owners — creating the test user without a phone
 * is far safer than overwriting a real record or aborting the whole seed.
 */
async function safeSeedPhone(desired: string, email: string): Promise<string | undefined> {
  const owner = await prisma.user.findUnique({ where: { phone: desired }, select: { email: true } })
  if (owner && owner.email !== email) {
    console.warn(`    ⚠ Phone ${desired} already belongs to ${owner.email}; creating ${email} without a phone.`)
    return undefined
  }
  return desired
}

/**
 * OPTIONAL one-time purge of mock/demo rows.
 *
 * Earlier seed versions injected a full demo catalogue (categories, products,
 * inventories, product images), CMS fixtures (testimonials, FAQs, product
 * reviews, newsletter subscribers), discount fixtures (coupons, promotions)
 * and a test customer account. This variant seeds none of those, and when
 * explicitly requested it deletes the rows the old seed left behind so a
 * client-facing install starts clean — the storefront catalogue is then empty
 * until real products are added through the admin console.
 *
 * Deliberately gated behind `SEED_PURGE_MOCK_DATA=true`: re-running the seed
 * against a database that now holds real orders must never destroy them
 * implicitly. When the flag is set, every storefront-facing table is emptied
 * regardless of content, so only run it once on a database you know contains
 * nothing but the demo fixtures.
 */
async function purgeMockData() {
  if (process.env.SEED_PURGE_MOCK_DATA !== 'true') {
    console.log('     · SEED_PURGE_MOCK_DATA is not "true" — leaving any existing mock/demo rows in place.')
    return
  }
  console.log('     · Purging legacy mock/demo data (SEED_PURGE_MOCK_DATA=true)…')

  await prisma.newsletterSubscriber.deleteMany({})
  await prisma.productReview.deleteMany({})
  await prisma.faq.deleteMany({})
  await prisma.testimonial.deleteMany({})
  await prisma.coupon.deleteMany({})
  await prisma.promotion.deleteMany({})
  await prisma.productImage.deleteMany({})
  await prisma.inventory.deleteMany({})
  await prisma.product.deleteMany({})
  await prisma.category.deleteMany({})

  const demoUserEmails = ['customer@vedhicfoods.com']
  await prisma.loginAttempt.deleteMany({ where: { email: { in: demoUserEmails } } })
  const demoUsers = await prisma.user.findMany({
    where: { email: { in: demoUserEmails } },
    select: { id: true },
  })
  for (const user of demoUsers) {
    await prisma.refreshToken.deleteMany({ where: { userId: user.id } })
    await prisma.passwordResetToken.deleteMany({ where: { userId: user.id } })
    await prisma.emailVerificationToken.deleteMany({ where: { userId: user.id } })
    await prisma.notification.deleteMany({ where: { userId: user.id } })

    // Never destroy an order history while purging the demo account.
    const orderCount = await prisma.order.count({ where: { userId: user.id } })
    if (orderCount > 0) {
      console.warn(
        `    ⚠ ${user.id} still has ${orderCount} order(s) — skipping account deletion; ` +
          'delete the account manually after the orders are migrated.'
      )
      continue
    }

    await prisma.address.deleteMany({ where: { userId: user.id } })
    await prisma.customerProfile.deleteMany({ where: { userId: user.id } })
    await prisma.userRole.deleteMany({ where: { userId: user.id } })
    await prisma.user.delete({ where: { id: user.id } })
  }

  console.log('    ✓ Mock/demo data purged (catalog, CMS content, discounts, test customer).')
}

async function main() {
  console.log('[*] Seeding live PostgreSQL database for VEDHIC FOODS...')

  await purgeMockData()

  // ==========================================
  // 1. SEED SYSTEM ROLES
  // ==========================================
  console.log('  1. Seeding RBAC Roles...')
  const rolesData: { name: RoleName; description: string; isSystem: boolean }[] = [
    { name: RoleName.OWNER, description: 'Platform Owner with full superadmin privileges', isSystem: true },
    { name: RoleName.ADMIN, description: 'Platform Administrator with storewide management access', isSystem: true },
    { name: RoleName.STAFF, description: 'Operational staff with fulfillment and catalog permissions', isSystem: true },
    { name: RoleName.CUSTOMER, description: 'End-user customer purchasing organic products', isSystem: true },
  ]

  const roleMap: Record<string, string> = {}
  for (const r of rolesData) {
    const roleRecord = await prisma.role.upsert({
      where: { name: r.name },
      update: { description: r.description },
      create: r,
    })
    roleMap[r.name] = roleRecord.id
  }
  console.log('    ✓ Roles created: OWNER, ADMIN, STAFF, CUSTOMER')

  // ==========================================
  // 2. SEED GRANULAR PERMISSIONS
  // ==========================================
  console.log('  2. Seeding Granular Permissions...')
  const permissionsData = [
    // Products
    { slug: 'products.read', name: 'View Products', module: 'products', description: 'Can browse catalog and view product details' },
    { slug: 'products.create', name: 'Create Product', module: 'products', description: 'Can add new organic products to catalog' },
    { slug: 'products.update', name: 'Update Product', module: 'products', description: 'Can edit product details, pricing, and metadata' },
    { slug: 'products.delete', name: 'Delete Product', module: 'products', description: 'Can soft-delete or remove products' },
    // Categories
    { slug: 'categories.read', name: 'View Categories', module: 'categories', description: 'Can view product categories' },
    { slug: 'categories.create', name: 'Create Category', module: 'categories', description: 'Can add new product categories' },
    { slug: 'categories.update', name: 'Update Category', module: 'categories', description: 'Can modify category details and sorting' },
    { slug: 'categories.delete', name: 'Delete Category', module: 'categories', description: 'Can remove product categories' },
    // Inventory
    { slug: 'inventory.read', name: 'View Inventory', module: 'inventory', description: 'Can monitor warehouse stock levels' },
    { slug: 'inventory.update', name: 'Update Inventory', module: 'inventory', description: 'Can adjust available, reserved, and threshold stock' },
    // Orders
    { slug: 'orders.read', name: 'View Orders', module: 'orders', description: 'Can view customer orders and statuses' },
    { slug: 'orders.update', name: 'Update Order', module: 'orders', description: 'Can pack, ship, and update order status' },
    { slug: 'orders.cancel', name: 'Cancel Order', module: 'orders', description: 'Can cancel orders and initiate inventory restock' },
    // Customers
    { slug: 'customers.read', name: 'View Customers', module: 'customers', description: 'Can view customer profiles and order histories' },
    { slug: 'customers.update', name: 'Update Customer', module: 'customers', description: 'Can update customer status and preferences' },
    // Discounts & Promotions
    { slug: 'discounts.read', name: 'View Discounts', module: 'discounts', description: 'Can view coupons and promotional campaigns' },
    { slug: 'discounts.create', name: 'Create Discount', module: 'discounts', description: 'Can create promotional coupons and festive sales' },
    { slug: 'discounts.update', name: 'Update Discount', module: 'discounts', description: 'Can adjust coupon parameters and validity' },
    { slug: 'discounts.delete', name: 'Delete Discount', module: 'discounts', description: 'Can deactivate or remove promo codes' },
    // Invoices
    { slug: 'invoices.read', name: 'View Invoices', module: 'invoices', description: 'Can view and download tax invoices' },
    { slug: 'invoices.create', name: 'Generate Invoice', module: 'invoices', description: 'Can generate formal tax invoices for orders' },
    // Staff Management
    { slug: 'staff.read', name: 'View Staff', module: 'staff', description: 'Can view staff members and assigned roles' },
    { slug: 'staff.create', name: 'Create Staff', module: 'staff', description: 'Can onboard new operational staff users' },
    { slug: 'staff.update', name: 'Update Staff', module: 'staff', description: 'Can edit staff role assignments' },
    { slug: 'staff.delete', name: 'Delete Staff', module: 'staff', description: 'Can deactivate staff accounts' },
    // Settings
    { slug: 'settings.read', name: 'View Settings', module: 'settings', description: 'Can view business and gateway configurations' },
    { slug: 'settings.update', name: 'Update Settings', module: 'settings', description: 'Can update tax rates, shipping, and branding' },
    // Delivery Management
    { slug: 'delivery.read', name: 'View Delivery', module: 'delivery', description: 'Can view deliveries, status, and tracking information' },
    { slug: 'delivery.update', name: 'Update Delivery', module: 'delivery', description: 'Can update delivery status, tracking number, and notes' },
    { slug: 'delivery.assign', name: 'Assign Delivery', module: 'delivery', description: 'Can assign delivery personnel and staff to orders' },
    // Reports & Audit Logs
    { slug: 'reports.read', name: 'View Reports', module: 'reports', description: 'Can view sales, inventory, and revenue analytics' },
    { slug: 'audit_logs.read', name: 'View Audit Logs', module: 'audit_logs', description: 'Can inspect security and administrative audit trails' },
    // Customer Support
    { slug: 'support.read', name: 'View Support Tickets', module: 'support', description: 'Can view all customer support tickets and conversations' },
    { slug: 'support.reply', name: 'Reply To Support Tickets', module: 'support', description: 'Can post staff replies on customer support tickets' },
    { slug: 'support.update', name: 'Update Support Tickets', module: 'support', description: 'Can change ticket status, priority and resolution' },
    { slug: 'support.assign', name: 'Assign Support Tickets', module: 'support', description: 'Can assign support tickets to staff members' },
    { slug: 'support.close', name: 'Close Support Tickets', module: 'support', description: 'Can close and reopen customer support tickets' },
    // Contact Form Submissions
    { slug: 'contacts.read', name: 'View Contact Submissions', module: 'contacts', description: 'Can view public contact form submissions' },
    { slug: 'contacts.manage', name: 'Manage Contact Submissions', module: 'contacts', description: 'Can triage, archive and annotate contact submissions' },
    // Website Content (CMS)
    { slug: 'content.read', name: 'View Website Content', module: 'content', description: 'Can view testimonials, FAQs, product reviews and newsletter subscribers' },
    { slug: 'content.update', name: 'Manage Website Content', module: 'content', description: 'Can create/edit/delete testimonials and FAQs, moderate reviews, and manage subscribers' },
  ]

  const permMap: Record<string, string> = {}
  for (const p of permissionsData) {
    const perm = await prisma.permission.upsert({
      where: { slug: p.slug },
      update: { name: p.name, module: p.module, description: p.description },
      create: p,
    })
    permMap[p.slug] = perm.id
  }
  console.log(`    ✓ Permissions created: ${permissionsData.length} granular permissions`)

  // ==========================================
  // 3. MAP ROLE-PERMISSIONS
  // ==========================================
  console.log('  3. Mapping Role Permissions...')
  const ownerPerms = Object.values(permMap)
  const adminPerms = Object.values(permMap)
  const staffPermSlugs = [
    'products.read', 'products.update',
    'categories.read',
    'inventory.read', 'inventory.update',
    'orders.read', 'orders.update',
    'customers.read',
    'discounts.read',
    'invoices.read', 'invoices.create',
    'delivery.read', 'delivery.update', 'delivery.assign',
    'support.read', 'support.reply', 'support.update', 'support.assign', 'support.close',
    'contacts.read', 'contacts.manage',
    'content.read', 'content.update',
  ]
  const staffPerms = staffPermSlugs.map(slug => permMap[slug]).filter(Boolean)
  // SECURITY: the CUSTOMER role previously received `products.read` and
  // `categories.read`. Those two slugs are also the *only* gate on the
  // admin-catalog reads (`GET /admin/products`, `/admin/categories`), so any
  // registered storefront customer could list the admin catalog — including
  // soft-deleted and unpublished rows and the internal fields the public
  // storefront endpoints never return. The storefront reads are public routes
  // and check nothing, so the grant bought the customer role nothing while
  // handing it an admin read. Customers now hold no permissions at all; the
  // router-wide role gate in `admin.routes.ts` is the second, independent
  // control that keeps this class of bug closed even if a slug is re-granted.
  const customerPermSlugs: string[] = []
  const customerPerms = customerPermSlugs.map(slug => permMap[slug]).filter(Boolean)

  const rolePermMappings: { roleId: string; permIds: string[] }[] = [
    { roleId: roleMap[RoleName.OWNER], permIds: ownerPerms },
    { roleId: roleMap[RoleName.ADMIN], permIds: adminPerms },
    { roleId: roleMap[RoleName.STAFF], permIds: staffPerms },
    { roleId: roleMap[RoleName.CUSTOMER], permIds: customerPerms },
  ]

  const rolePermRecords: { roleId: string; permissionId: string }[] = []
  for (const mapping of rolePermMappings) {
    for (const permId of mapping.permIds) {
      rolePermRecords.push({ roleId: mapping.roleId, permissionId: permId })
    }
  }
  await prisma.rolePermission.createMany({
    data: rolePermRecords,
    skipDuplicates: true,
  })
  console.log('    ✓ Role-Permission matrices established successfully')

  // SECURITY: `createMany({ skipDuplicates: true })` can only ever ADD grants.
  // A permission seeded onto a role in an earlier release — such as
  // `products.read` on CUSTOMER — therefore survives every later seed run, so
  // editing the lists above would repair nothing on an existing database.
  // Reconcile in both directions: the lists above are the single source of
  // truth, and any RolePermission row outside them is deleted. This is the only
  // step that actually revokes a grant that is no longer intended.
  for (const mapping of rolePermMappings) {
    // Written as two branches on purpose: relying on `notIn: []` meaning "every
    // row" is a Prisma-semantics footnote, and this loop is what revokes
    // grants — it must not depend on one.
    if (mapping.permIds.length === 0) {
      await prisma.rolePermission.deleteMany({ where: { roleId: mapping.roleId } })
    } else {
      await prisma.rolePermission.deleteMany({
        where: {
          roleId: mapping.roleId,
          permissionId: { notIn: mapping.permIds },
        },
      })
    }
  }

  // ==========================================
  // 4. SEED OPERATOR ACCOUNTS
  //
  // SECURITY: passwords are NEVER hardcoded in the repository. The previous
  // version shipped `Admin@Vedhic2026` / `Staff@Vedhic2026` /
  // `Customer@Vedhic2026` in source control, and because the seed uses
  // `upsert` with `update: { passwordHash }` those credentials were *reset* on
  // every re-seed. Anyone with repo read access — including every CI job and
  // former contributor — held production-grade admin credentials.
  //
  // Passwords must now be supplied through the environment:
  //   SEED_ADMIN_PASSWORD, SEED_STAFF_PASSWORD
  // Generate one with:  openssl rand -base64 24
  //
  // In production these variables are absent, so no account is created at all.
  // Bootstrap the first real admin through a one-off script or an invitation
  // flow instead.
  // ==========================================
  const isProductionSeed = process.env.NODE_ENV === 'production'

  const seedPassword = (envVar: string, label: string): string | null => {
    const value = process.env[envVar]
    if (!value) {
      if (isProductionSeed) {
        return null
      }
      console.warn(
        `    ⚠ ${envVar} not set — skipping the ${label} account. ` +
          `Set ${envVar} to create it.`
      )
      return null
    }
    if (value.length < 12) {
      throw new Error(`${envVar} must be at least 12 characters long.`)
    }
    return value
  }

  // Admin
  const adminEmail = 'admin@vedhicfoods.com'
  const adminPassword = seedPassword('SEED_ADMIN_PASSWORD', 'admin')
  const adminPasswordHash = adminPassword ? await bcrypt.hash(adminPassword, 12) : null
  const adminUser = adminPasswordHash
    ? await prisma.user.upsert({
        where: { email: adminEmail },
        update: {
          passwordHash: adminPasswordHash,
          role: RoleName.ADMIN,
          isActive: true,
          isVerified: true,
          isDeleted: false,
        },
        create: {
          email: adminEmail,
          fullName: 'Vedhic Platform Administrator',
          phone: await safeSeedPhone('+919876543210', adminEmail),
          passwordHash: adminPasswordHash,
          role: RoleName.ADMIN,
          isActive: true,
          isVerified: true,
        },
      })
    : null

  if (adminUser) {
    await prisma.userRole.upsert({
      where: {
        userId_roleId: { userId: adminUser.id, roleId: roleMap[RoleName.ADMIN] },
      },
      update: {},
      create: { userId: adminUser.id, roleId: roleMap[RoleName.ADMIN], assignedBy: 'SYSTEM' },
    })
  }

  // Staff
  const staffEmail = 'staff@vedhicfoods.com'
  const staffPassword = seedPassword('SEED_STAFF_PASSWORD', 'staff')
  const staffPasswordHash = staffPassword ? await bcrypt.hash(staffPassword, 12) : null
  if (staffPasswordHash) {
    const staffUser = await prisma.user.upsert({
      where: { email: staffEmail },
      update: {
        passwordHash: staffPasswordHash,
        role: RoleName.STAFF,
        isActive: true,
        isVerified: true,
        isDeleted: false,
      },
        create: {
          email: staffEmail,
          fullName: 'Vedhic Warehouse Fulfillment Staff',
          phone: await safeSeedPhone('+919876543211', staffEmail),
          passwordHash: staffPasswordHash,
          role: RoleName.STAFF,
          isActive: true,
          isVerified: true,
        },
    })

    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: staffUser.id, roleId: roleMap[RoleName.STAFF] } },
      update: {},
      create: { userId: staffUser.id, roleId: roleMap[RoleName.STAFF], assignedBy: 'SYSTEM' },
    })
  }

  const seededAccounts = [
    adminUser && 'admin',
    staffPasswordHash && 'staff',
  ].filter(Boolean)
  console.log(
    seededAccounts.length > 0
      ? `    ✓ Operator accounts ready (${seededAccounts.length}/2): ${seededAccounts.join(', ')}`
      : '    ⚠ No operator accounts created — set SEED_ADMIN_PASSWORD / SEED_STAFF_PASSWORD'
  )

  // ==========================================
  // 5. SEED ENCRYPTED PAYMENT SETTINGS
  //
  // SECURITY: the previous version seeded the published placeholder values
  // `rzp_test_placeholder_key` / `rzp_test_placeholder_secret` into an
  // AES-GCM-encrypted column and left `testMode: true`. If such a row ever
  // reached production, either (a) live payments would fail while appearing
  // enabled, or (b) an operator who saw `testMode: true` would reasonably
  // believe the gateway was in a safe sandbox.
  //
  // The row is only created when real credentials are supplied, and the
  // provider is enabled solely from explicit environment values.
  // ==========================================
  console.log('  5. Seeding Payment Settings (AES-256-GCM)...')
  const seedRazorpayKeyId = process.env.SEED_RAZORPAY_KEY_ID
  const seedRazorpayKeySecret = process.env.SEED_RAZORPAY_KEY_SECRET
  const seedRazorpayWebhookSecret = process.env.SEED_RAZORPAY_WEBHOOK_SECRET

  if (seedRazorpayKeyId && seedRazorpayKeySecret && seedRazorpayWebhookSecret && adminUser) {
    const seedTestMode = process.env.SEED_RAZORPAY_TEST_MODE === 'true'
    await prisma.paymentSettings.upsert({
      where: { id: 'default' },
      update: {},
      create: {
        id: 'default',
        provider: 'razorpay',
        razorpayKeyId: seedRazorpayKeyId,
        encryptedKeySecret: encrypt32(seedRazorpayKeySecret),
        encryptedWebhookSecret: encrypt32(seedRazorpayWebhookSecret),
        enabledMethods: ['razorpay', 'upi', 'card', 'netbanking'],
        testMode: seedTestMode,
        codEnabled: true,
        codLimit: 5000,
        updatedBy: adminUser.id,
      },
    })
    console.log(
      `    ✓ Encrypted payment settings created (testMode: ${seedTestMode ? 'ON' : 'OFF'})`
    )
  } else {
    console.warn(
      '    ⚠ Payment settings NOT seeded. Set SEED_RAZORPAY_KEY_ID, SEED_RAZORPAY_KEY_SECRET ' +
        'and SEED_RAZORPAY_WEBHOOK_SECRET, and ensure an admin account was created. ' +
        'Configure the gateway through the admin panel otherwise.'
    )
  }

  // ==========================================
  // 6. SEED SYSTEM & BUSINESS SETTINGS
  // ==========================================
  console.log('  6. Seeding Business & System Configuration Settings...')
  const settingsData = [
    { key: 'business_name', category: SettingCategory.BUSINESS, value: 'Vedhic Foods India Pvt Ltd', description: 'Registered business legal entity', isPublic: true },
    { key: 'business_email', category: SettingCategory.BUSINESS, value: 'care@vedhicfoods.com', description: 'Customer support inquiries email', isPublic: true },
    { key: 'business_phone', category: SettingCategory.BUSINESS, value: '+91 98765 43210', description: 'Customer care telephone helpline', isPublic: true },
    { key: 'business_address', category: SettingCategory.BUSINESS, value: 'Road No 36, Jubilee Hills, Hyderabad, Telangana 500033', description: 'Corporate headquarters address', isPublic: true },
    { key: 'gst_number', category: SettingCategory.TAX, value: '36AAACV1234F1Z9', description: 'GST Identification Number for Tax Invoices', isPublic: true },
    { key: 'gst_rate_percent', category: SettingCategory.TAX, value: '5', description: 'Standard GST tax rate on packaged organic foods', isPublic: false },
    { key: 'free_shipping_threshold', category: SettingCategory.SHIPPING, value: '499', description: 'Order value qualifying for complimentary shipping', isPublic: true },
    { key: 'standard_shipping_charge', category: SettingCategory.SHIPPING, value: '49', description: 'Base shipping rate for orders below threshold', isPublic: true },
    { key: 'default_currency', category: SettingCategory.GENERAL, value: 'INR', description: 'Storefront base currency', isPublic: true },
    { key: 'invoice_prefix', category: SettingCategory.INVOICE, value: 'VED-INV-', description: 'Sequential invoice numbering prefix', isPublic: false },
    // --- Branding / logo reference (S3 object reference, never a secret) ---
    { key: 'brand_logo_url', category: SettingCategory.WEBSITE, value: '', description: 'Public CDN/S3 URL of the primary storefront logo', isPublic: true },
    { key: 'brand_logo_s3_key', category: SettingCategory.WEBSITE, value: '', description: 'S3 object key for the primary logo (resolved to a signed URL on demand)', isPublic: false },
    { key: 'brand_name', category: SettingCategory.WEBSITE, value: 'Vedhic Foods', description: 'Customer-facing brand name shown in header, footer and invoices', isPublic: true },
    { key: 'brand_tagline', category: SettingCategory.WEBSITE, value: 'Traditional. Organic. Premium.', description: 'Short brand tagline rendered under the logo', isPublic: true },
    { key: 'brand_description', category: SettingCategory.SEO, value: 'Handcrafted millet laddus, ragi roti and heritage organic grains sourced directly from trusted Indian farms.', description: 'Default meta description for search engines and social shares', isPublic: true },
    { key: 'site_url', category: SettingCategory.SEO, value: 'https://vedhifoods.example', description: 'Canonical storefront origin used for SEO and invoice links', isPublic: true },
    // --- Support information ---
    { key: 'support_email', category: SettingCategory.GENERAL, value: 'care@vedhicfoods.com', description: 'Public support mailbox shown in the storefront footer', isPublic: true },
    { key: 'support_phone', category: SettingCategory.GENERAL, value: '+91 98765 43210', description: 'Public support telephone shown in the storefront footer', isPublic: true },
    { key: 'support_whatsapp', category: SettingCategory.GENERAL, value: '+91 98765 43210', description: 'WhatsApp business number for order support', isPublic: true },
    { key: 'support_hours', category: SettingCategory.GENERAL, value: 'Mon - Sat, 9:00 AM to 7:00 PM IST', description: 'Customer support operating hours', isPublic: true },
    // --- Shipping configuration ---
    { key: 'shipping_free_threshold', category: SettingCategory.SHIPPING, value: '499', description: 'Cart value (INR) qualifying for free shipping', isPublic: true },
    { key: 'shipping_standard_fee', category: SettingCategory.SHIPPING, value: '49', description: 'Flat shipping fee applied below the free-shipping threshold', isPublic: true },
    { key: 'shipping_cod_enabled', category: SettingCategory.SHIPPING, value: 'true', description: 'Whether Cash on Delivery is offered at checkout', isPublic: true },
    { key: 'shipping_cod_max_order_value', category: SettingCategory.SHIPPING, value: '5000', description: 'Maximum order value (INR) allowed for Cash on Delivery', isPublic: true },
    { key: 'shipping_estimated_days', category: SettingCategory.SHIPPING, value: '4-6', description: 'Typical transit window quoted at checkout (business days)', isPublic: true },
    { key: 'shipping_codable_pincode_prefixes', category: SettingCategory.SHIPPING, value: '["56","50","40","41"]', description: 'JSON array of PIN code prefixes where COD is unavailable', isPublic: false },
    // --- Invoice configuration ---
    { key: 'invoice_terms', category: SettingCategory.INVOICE, value: 'Goods once sold will not be taken back. Interest @18% p.a. will be charged on outstanding dues.', description: 'Legal terms printed on every tax invoice footer', isPublic: false },
    { key: 'invoice_seller_notes', category: SettingCategory.INVOICE, value: 'Authorised Signatory - Vedhic Foods India Pvt Ltd', description: 'Seller note / authorised signatory line on invoices', isPublic: false },
    { key: 'invoice_show_bank_details', category: SettingCategory.INVOICE, value: 'true', description: 'Print bank account details on invoices', isPublic: false },
    { key: 'invoice_acknowledgement_days', category: SettingCategory.INVOICE, value: '7', description: 'Days within which a buyer must acknowledge invoice receipt', isPublic: false },
    { key: 'invoice_place_of_supply', category: SettingCategory.INVOICE, value: 'Karnataka', description: 'Default place of supply used for GST computation', isPublic: false },
    // --- Tax configuration ---
    { key: 'tax_prices_include_gst', category: SettingCategory.TAX, value: 'false', description: 'Whether displayed product prices already include GST', isPublic: true },
    { key: 'tax_shipping_charged', category: SettingCategory.TAX, value: 'true', description: 'Whether GST is applied to shipping charges', isPublic: false },
    { key: 'tax_eway_bill_required', category: SettingCategory.TAX, value: 'false', description: 'Flag e-way bills when consignment value exceeds threshold', isPublic: false },
    // --- Store & maintenance status ---
    { key: 'store_status', category: SettingCategory.GENERAL, value: 'OPEN', description: 'Storefront trading status: OPEN, CLOSED or PRE_ORDER', isPublic: true },
    { key: 'store_closed_message', category: SettingCategory.GENERAL, value: 'We are temporarily closed for a short break. Please check back shortly.', description: 'Message shown to customers when store_status is not OPEN', isPublic: true },
    { key: 'maintenance_mode', category: SettingCategory.GENERAL, value: 'false', description: 'When true the storefront is blocked for all non-admin traffic', isPublic: true },
    { key: 'maintenance_message', category: SettingCategory.GENERAL, value: 'We are upgrading our kitchen and will be back shortly. Thank you for your patience.', description: 'Message displayed while maintenance_mode is enabled', isPublic: true },
    // --- Website content settings ---
    { key: 'website_announcement', category: SettingCategory.WEBSITE, value: 'Free shipping on orders above Rs 499 - Freshly made every week', description: 'Storefront announcement bar text', isPublic: true },
    { key: 'website_announcement_active', category: SettingCategory.WEBSITE, value: 'true', description: 'Whether the announcement bar is visible', isPublic: true },
    { key: 'website_hero_title', category: SettingCategory.WEBSITE, value: 'Traditional Indian goodness', description: 'Storefront hero headline', isPublic: true },
    { key: 'website_hero_title_accent', category: SettingCategory.WEBSITE, value: 'grown the slow way', description: 'Hero headline accent phrase appended after the main headline', isPublic: true },
    { key: 'website_hero_subtitle', category: SettingCategory.WEBSITE, value: 'Handcrafted millet laddus, ragi roti and heritage organic grains — sourced directly from trusted Indian farms and made in small batches.', description: 'Storefront hero supporting copy', isPublic: true },
    { key: 'website_hero_cta_label', category: SettingCategory.WEBSITE, value: 'Shop now', description: 'Hero call-to-action button label', isPublic: true },
    { key: 'website_hero_images', category: SettingCategory.WEBSITE, value: '[]', description: 'JSON array of hero background image URLs (admin managed; the storefront auto-discovers frontend/src/assets/hero as the fallback)', isPublic: true },
    { key: 'website_story_enabled', category: SettingCategory.WEBSITE, value: 'false', description: 'Whether the homepage "Our Story" milestones section is shown (admin toggled, disabled by default)', isPublic: true },
    { key: 'website_social_links', category: SettingCategory.SEO, value: '[{"platform":"instagram","label":"Instagram","href":"https://instagram.com"},{"platform":"facebook","label":"Facebook","href":"https://facebook.com"}]', description: 'JSON array of social profile links rendered in the footer', isPublic: true },
  ]

  for (const s of settingsData) {
    await prisma.systemSetting.upsert({
      where: { key: s.key },
      update: {
        category: s.category,
        value: s.value,
        description: s.description,
        isPublic: s.isPublic,
      },
      create: {
        key: s.key,
        category: s.category,
        value: s.value,
        description: s.description,
        isPublic: s.isPublic,
      },
    })
  }
  console.log('    ✓ Business and system settings populated')

  // ==========================================
  // 7. RECORD BASELINE AUDIT LOG
  // ==========================================
  if (adminUser) {
    await prisma.auditLog.create({
      data: {
        actorId: adminUser.id,
        actorEmail: adminUser.email,
        action: 'SYSTEM_DATABASE_INITIALIZED',
        entity: 'PostgreSQL_Database',
        metadata: {
          event: 'Production database baseline seeded with RBAC, configuration, and system settings',
          timestamp: new Date().toISOString(),
        },
      },
    })
    console.log('    ✓ Baseline audit log recorded')
  }

  console.log('\n[SUCCESS] VEDHIC FOODS PostgreSQL database seeding completed successfully!')
}

main()
  .catch((e) => {
    console.error('[-] Seeding error:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })