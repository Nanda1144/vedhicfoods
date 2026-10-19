/**
 * DEV-ONLY catalog bootstrap.
 *
 * Inserts a SMALL, realistic storefront catalogue (categories, products,
 * product images and inventory) so the catalog / cart / checkout flow can be
 * exercised end-to-end against a local database that has no products yet.
 *
 * This is NOT the production seed (`seed.ts`) and is never wired into
 * `prisma:seed`. It is fully idempotent — every row is upserted by its unique
 * key (`slug` / `sku` / `productId`) and seeded product images are recreated,
 * so it is safe to run repeatedly.
 *
 * Run from the `database/` directory:  npx tsx dev-catalog-seed.ts
 */
import { PrismaClient, ProductStatus, InventoryStatus } from '@prisma/client'
import path from 'path'

import dotenv from 'dotenv'
dotenv.config({ path: path.resolve(__dirname, '.env') })

const prisma = new PrismaClient()

/**
 * Images physically copied into `frontend/public/catalog/` so they resolve at
 * the site root in the running frontend dev server (`/catalog/<file>.webp`).
 */
const CATALOG_IMAGES = {
  organicIngredients: '/catalog/organic-ingredients.webp',
  ingredients: '/catalog/ingredients.webp',
  cooking: '/catalog/cooking.webp',
  packing: '/catalog/packing.webp',
  customer: '/catalog/customer.webp',
  delivery: '/catalog/delivery.webp',
} as const

const NUTRITION_DEFAULT = [
  { label: 'Energy', value: '420 kcal', percent: 21 },
  { label: 'Protein', value: '8 g', percent: 16 },
  { label: 'Carbohydrates', value: '62 g', percent: 21 },
  { label: 'Total Fat', value: '15 g', percent: 23 },
  { label: 'Dietary Fibre', value: '6 g', percent: 24 },
  { label: 'Calcium', value: '120 mg', percent: 12 },
]

const CATEGORIES = [
  {
    slug: 'millet-laddus',
    name: 'Millet Laddus',
    tagline: 'Handcrafted energy bites',
    description:
      'Slow-roasted millet laddus sweetened with jaggery and bound with pure A2 ghee — a traditional Indian energy bite, made in small batches.',
    image: CATALOG_IMAGES.organicIngredients,
    accent: '#C9A24B',
    featured: true,
    sortOrder: 1,
    isActive: true,
  },
  {
    slug: 'ragi-cereals',
    name: 'Ragi & Cereals',
    tagline: 'Wholesome ancient grains',
    description:
      'Stone-ground ragi and heritage millet flours and malt mixes — rich in calcium and fibre, milled fresh from rain-fed Indian farms.',
    image: CATALOG_IMAGES.ingredients,
    accent: '#A85A32',
    featured: true,
    sortOrder: 2,
    isActive: true,
  },
  {
    slug: 'organic-ghee-oils',
    name: 'Organic Ghee & Oils',
    tagline: 'Pure farm-pressed goodness',
    description:
      'Bilona-method A2 cow ghee and cold-pressed cooking oils — unrefined, preservative-free and sourced directly from trusted dairies and oil mills.',
    image: CATALOG_IMAGES.cooking,
    accent: '#6B8E23',
    featured: true,
    sortOrder: 3,
    isActive: true,
  },
] as const

interface ProductSeed {
  slug: string
  name: string
  categorySlug: string
  shortDescription: string
  description: string
  price: number
  mrp: number
  unit: string
  netWeight: number
  stock: number
  sku: string
  rating: number
  reviewCount: number
  tags: string[]
  ingredients: string[]
  allergens: string[]
  imageUrl: string
  isBestSeller?: boolean
  isNew?: boolean
  isFeatured?: boolean
}

const PRODUCTS: ProductSeed[] = [
  {
    slug: 'foxtail-millet-laddu',
    name: 'Foxtail Millet Laddu',
    categorySlug: 'millet-laddus',
    shortDescription: 'Jaggery-sweetened foxtail millet laddus bound with pure A2 ghee.',
    description:
      'Our signature foxtail millet laddu is hand-rolled in small batches from slow-roasted millets, organic jaggery and A2 cow ghee. Naturally gluten-free with no refined sugar or preservatives.',
    price: 349,
    mrp: 420,
    unit: '250 g',
    netWeight: 250,
    stock: 60,
    sku: 'VF-ML-001',
    rating: 4.8,
    reviewCount: 128,
    tags: ['millet', 'laddu', 'jaggery', 'gluten-free', 'bestseller'],
    ingredients: ['Foxtail Millet', 'Organic Jaggery', 'A2 Cow Ghee', 'Cardamom', 'Dry Ginger'],
    allergens: ['Milk'],
    imageUrl: CATALOG_IMAGES.organicIngredients,
    isBestSeller: true,
    isFeatured: true,
  },
  {
    slug: 'kodo-millet-laddu',
    name: 'Kodo Millet Laddu',
    categorySlug: 'millet-laddus',
    shortDescription: 'Protein-rich kodo millet laddus with roasted peanuts and jaggery.',
    description:
      'Kodo millet is roasted until nutty, then blended with organic jaggery, roasted peanuts and a touch of ghee. A naturally sweet, high-fibre snack for any time of day.',
    price: 329,
    mrp: 399,
    unit: '250 g',
    netWeight: 250,
    stock: 48,
    sku: 'VF-ML-002',
    rating: 4.7,
    reviewCount: 86,
    tags: ['millet', 'laddu', 'peanut', 'high-protein', 'new'],
    ingredients: ['Kodo Millet', 'Organic Jaggery', 'Roasted Peanuts', 'A2 Cow Ghee', 'Cardamom'],
    allergens: ['Milk', 'Peanuts'],
    imageUrl: CATALOG_IMAGES.ingredients,
    isNew: true,
  },
  {
    slug: 'ragi-malt-mix',
    name: 'Ragi Malt Mix',
    categorySlug: 'ragi-cereals',
    shortDescription: 'Sprouted ragi malt for a warm, calcium-rich morning drink.',
    description:
      'Sprouted finger millet (ragi) is slow-roasted and stone-ground into a smooth malt. Whisk into warm milk or water for a calcium-rich, fibre-packed health drink.',
    price: 249,
    mrp: 299,
    unit: '500 g',
    netWeight: 500,
    stock: 80,
    sku: 'VF-RC-001',
    rating: 4.6,
    reviewCount: 73,
    tags: ['ragi', 'malt', 'calcium', 'breakfast', 'bestseller'],
    ingredients: ['Sprouted Ragi (Finger Millet)', 'Barley', 'Almonds', 'Cardamom'],
    allergens: ['Tree Nuts'],
    imageUrl: CATALOG_IMAGES.cooking,
    isBestSeller: true,
  },
  {
    slug: 'multi-millet-dosa-mix',
    name: 'Multi-Millet Dosa Mix',
    categorySlug: 'ragi-cereals',
    shortDescription: 'Instant batter mix with five ancient millets and lentils.',
    description:
      'A ready-to-cook dosa batter blend of foxtail, kodo, barnyard, little and proso millets with urad dal and fenugreek. Just add water, ferment briefly and cook crisp.',
    price: 279,
    mrp: 340,
    unit: '500 g',
    netWeight: 500,
    stock: 55,
    sku: 'VF-RC-002',
    rating: 4.5,
    reviewCount: 41,
    tags: ['dosa', 'millet', 'breakfast', 'instant-mix', 'new'],
    ingredients: ['Foxtail Millet', 'Kodo Millet', 'Barnyard Millet', 'Little Millet', 'Urad Dal', 'Fenugreek'],
    allergens: [],
    imageUrl: CATALOG_IMAGES.packing,
    isNew: true,
  },
  {
    slug: 'a2-cow-ghee',
    name: 'A2 Cow Ghee',
    categorySlug: 'organic-ghee-oils',
    shortDescription: 'Bilona-method A2 ghee, hand-churned from indigenous cow milk.',
    description:
      'Made the traditional bilona way — curd is hand-churned and the butter slowly simmered to a golden, aromatic ghee. Rich, nutty and free from any additives.',
    price: 899,
    mrp: 1099,
    unit: '500 ml',
    netWeight: 500,
    stock: 30,
    sku: 'VF-GO-001',
    rating: 4.9,
    reviewCount: 210,
    tags: ['ghee', 'a2', 'bilona', 'dairy', 'bestseller'],
    ingredients: ['A2 Cow Milk Butter'],
    allergens: ['Milk'],
    imageUrl: CATALOG_IMAGES.customer,
    isBestSeller: true,
    isFeatured: true,
  },
  {
    slug: 'cold-pressed-groundnut-oil',
    name: 'Cold-Pressed Groundnut Oil',
    categorySlug: 'organic-ghee-oils',
    shortDescription: 'Wood-pressed groundnut oil, unrefined and preservative-free.',
    description:
      'Slow wood-pressed from sun-dried groundnuts, this unrefined oil retains its natural aroma and nutrients. Ideal for everyday Indian cooking and deep frying.',
    price: 449,
    mrp: 529,
    unit: '1 L',
    netWeight: 1000,
    stock: 40,
    sku: 'VF-GO-002',
    rating: 4.6,
    reviewCount: 64,
    tags: ['oil', 'groundnut', 'cold-pressed', 'cooking'],
    ingredients: ['Cold-Pressed Groundnut Oil'],
    allergens: ['Peanuts'],
    imageUrl: CATALOG_IMAGES.delivery,
    isFeatured: true,
  },
]

function buildSpecifications(product: ProductSeed) {
  return [
    { label: 'Net Weight', value: product.unit },
    { label: 'Packaging', value: 'Food-grade resealable pouch' },
    { label: 'Shelf Life', value: '6 Months' },
    { label: 'Storage', value: 'Store in a cool, dry place' },
    { label: 'Country of Origin', value: 'India' },
    { label: 'FSSAI Licence', value: '10012011000123' },
  ]
}

async function main() {
  console.log('[*] Seeding DEV catalog (idempotent)...')

  const categoryIdBySlug: Record<string, string> = {}
  for (const category of CATEGORIES) {
    const record = await prisma.category.upsert({
      where: { slug: category.slug },
      update: {
        name: category.name,
        tagline: category.tagline,
        description: category.description,
        image: category.image,
        accent: category.accent,
        featured: category.featured,
        sortOrder: category.sortOrder,
        isActive: category.isActive,
      },
      create: category,
    })
    categoryIdBySlug[category.slug] = record.id
  }
  console.log(`    ✓ Categories upserted: ${CATEGORIES.map((c) => c.slug).join(', ')}`)

  for (const product of PRODUCTS) {
    const categoryId = categoryIdBySlug[product.categorySlug]
    if (!categoryId) {
      throw new Error(`Unknown category slug '${product.categorySlug}' for product '${product.slug}'`)
    }

    const data = {
      name: product.name,
      categoryId,
      shortDescription: product.shortDescription,
      description: product.description,
      price: product.price,
      mrp: product.mrp,
      currency: 'INR',
      unit: product.unit,
      netWeight: product.netWeight,
      stock: product.stock,
      sku: product.sku,
      rating: product.rating,
      reviewCount: product.reviewCount,
      tags: product.tags,
      ingredients: product.ingredients,
      allergens: product.allergens,
      shelfLife: '6 Months',
      storage: 'Store in a cool, dry place',
      nutrition: NUTRITION_DEFAULT,
      specifications: buildSpecifications(product),
      isOrganic: true,
      isBestSeller: product.isBestSeller ?? false,
      isNew: product.isNew ?? false,
      isFeatured: product.isFeatured ?? false,
      isActive: true,
      status: ProductStatus.PUBLISHED,
      isDeleted: false,
    }

    const record = await prisma.product.upsert({
      where: { slug: product.slug },
      update: data,
      create: { slug: product.slug, ...data },
    })

    // Recreate only the images this script owns (tagged by the /catalog/ path),
    // so any image an operator added manually is left untouched.
    await prisma.productImage.deleteMany({
      where: { productId: record.id, imageUrl: { startsWith: '/catalog/' } },
    })
    await prisma.productImage.create({
      data: {
        productId: record.id,
        imageUrl: product.imageUrl,
        altText: product.name,
        isPrimary: true,
        displayOrder: 0,
      },
    })

    await prisma.inventory.upsert({
      where: { productId: record.id },
      update: {
        availableQuantity: product.stock,
        status: InventoryStatus.IN_STOCK,
      },
      create: {
        productId: record.id,
        availableQuantity: product.stock,
        reservedQuantity: 0,
        soldQuantity: 0,
        reorderThreshold: 10,
        status: InventoryStatus.IN_STOCK,
      },
    })
  }
  console.log(`    ✓ Products upserted: ${PRODUCTS.length}`)
  console.log(`    ✓ Images ensured: ${PRODUCTS.length} (primary)`)
  console.log(`    ✓ Inventory ensured: ${PRODUCTS.length} (IN_STOCK)`)

  console.log('\n[SUCCESS] DEV catalog seed completed.')
}

main()
  .catch((e) => {
    console.error('[-] DEV catalog seed error:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
