import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { productService } from '@/services/productService'
import { contentService } from '@/services/contentService'
import { useAsync } from '@/hooks'
import { useCart } from '@/context'
import { stockStatus, stockLabel, badgesFor } from '@/utils/product'
import { formatCurrency } from '@/utils/format'
import type { Product } from '@/types'
import type { Crumb } from '@/components/common'
import {
  PageHeader, Rating, PriceDisplay, QuantitySelector, Badge, Tabs, ProductGridSkeleton,
  Icon, Button, LoadingState, ErrorState, Breadcrumb, EmptyState,
} from '@/components/common'
import { ProductGrid } from '@/components/product'

export function ProductDetailPage() {
  const { slug = '' } = useParams()
  const navigate = useNavigate()
  const { add, close, open } = useCart()
  const [quantity, setQuantity] = useState(1)
  const [activeImage, setActiveImage] = useState(0)

  const product = useAsync(() => productService.bySlug(slug), [slug])
  const related = useAsync(() => productService.related(slug, 4), [slug])
  const reviews = useAsync(() => contentService.reviewsFor(product.data?.id ?? ''), [product.data?.id])

  const data = product.data
  const category = data ? productService.category(data.categorySlug) : undefined

  const crumbs = useMemo<Crumb[]>(() => {
    if (!data) return [{ label: 'Home', href: '/' }]
    return [
      { label: 'Home', href: '/' },
      { label: 'Shop', href: '/shop' },
      ...(category ? [{ label: category.name, href: `/shop?category=${category.slug}` }] : []),
      ...(data ? [{ label: data.name, current: true }] : []),
    ]
  }, [data, category])

  if (product.loading) {
    return <PageLoader />
  }

  if (product.error || !data) {
    return (
      <>
        <PageHeader eyebrow="Product" title="Not available" />
        <section className="section">
          <div className="container">
            <ErrorState
              title={product.error?.message ?? 'This product is not available.'}
              description="It may have been discontinued. The rest of our shelves are still open."
            />
          </div>
        </section>
      </>
    )
  }

  const status = stockStatus(data.stock)
  const badges = badgesFor(data)
  const out = status === 'out'

  const handleAdd = () => {
    if (out) return
    add(data, quantity, true)
    open()
  }

  const handleBuyNow = () => {
    if (out) return
    add(data, quantity, true)
    close()
    navigate('/checkout')
  }

  const tabs = [
    {
      id: 'description',
      label: 'Description',
      content: (
        <div className="prose">
          <p>{data.description}</p>
          <h3>How it's made</h3>
          <p>
            {data.specifications.find((spec) => spec.label.toLowerCase().includes('process'))?.value ??
              'Stone-ground in small batches, slow-roasted and finished by hand using only certified organic ingredients.'}
          </p>
        </div>
      ),
    },
    {
      id: 'ingredients',
      label: 'Ingredients & Nutrition',
      content: (
        <div className="product-specs">
          <div>
            <h3>Ingredients</h3>
            <p>{data.ingredients.join(', ')}</p>
          </div>
          <div>
            <h3>Allergens</h3>
            <p>{data.allergens.length ? data.allergens.join(', ') : 'No major allergens declared.'}</p>
          </div>
          <ul className="nutrition-list">
            {data.nutrition.map((fact) => (
              <li key={fact.label}>
                <span className="nutrition-list__label">{fact.label}</span>
                <span className="nutrition-list__bar">
                  {fact.percent !== undefined && <span style={{ width: `${Math.min(100, fact.percent)}%` }} />}
                </span>
                <span className="nutrition-list__value">{fact.value}</span>
              </li>
            ))}
          </ul>
        </div>
      ),
    },
    {
      id: 'benefits',
      label: 'Benefits & Preparation',
      content: (
        <div className="product-specs">
          <div>
            <h3>Goodness in every serving</h3>
            <ul className="benefits-list">
              {(data.tags.length ? data.tags : ['100% organic', 'No preservatives', 'Small-batch']).map(
                (tag) => (
                  <li key={tag}>
                    <Icon name="check-circle" size={16} />
                    {tag}
                  </li>
                ),
              )}
            </ul>
          </div>
          <div>
            <h3>How to prepare</h3>
            <p>
              {data.nutrition.length > 0
                ? `Serving per pack is ${data.nutrition[0].label ?? 'as mentioned on pack'}. ${data.shelfLife} in a cool, dry place. Consume ${data.unit.toLowerCase()} at room temperature — heat gently before serving if preferred.`
                : `While the batch is farm-fresh, store at room temperature in an airtight jar and use by the date printed on pack (${data.shelfLife}).`}
            </p>
          </div>
          <div>
            <h3>Storage & preservation</h3>
            <p>
              {data.storage}. Stored correctly, this product keeps its aroma and texture right up to its
              shelf life.
            </p>
          </div>
        </div>
      ),
    },
    {
      id: 'specs',
      label: 'Specifications',
      content: (
        <dl className="spec-grid">
          {buildSpecRows(data).map(([label, value]) => (
            <div key={label} className="spec-grid__row">
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      ),
    },
    {
      id: 'reviews',
      label: `Reviews (${data.reviewCount})`,
      content: (
        <div className="reviews">
          {reviews.loading ? (
            <EmptyState title="Loading reviews…" />
          ) : (reviews.data ?? []).length === 0 ? (
            <EmptyState title="No reviews yet" description="Be the first to review this product after your order arrives." />
          ) : (
            <ul className="review-list">
              {(reviews.data ?? []).map((review) => (
                <li key={review.id} className="review-card">
                  <div className="row row--between">
                    <strong>{review.customerName}</strong>
                    <Rating value={review.rating} showValue={false} size="sm" />
                  </div>
                  {review.verified && (
                    <p className="review-card__verified">
                      <Icon name="check-circle" size={13} /> Verified purchase
                    </p>
                  )}
                  <h4>{review.title}</h4>
                  <p>{review.body}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      ),
    },
  ]

  return (
    <>
      <section className="section section--product">
        <div className="container">
          <Breadcrumb items={crumbs} className="product-detail__crumbs" />

          <div className="product-detail">
            <div className="product-gallery">
              <div className="product-gallery__main">
                {badges.length > 0 && (
                  <div className="product-gallery__badges">
                    {badges.map((badge) => (
                      <Badge key={badge.label} tone={badge.tone} dot>
                        {badge.label}
                      </Badge>
                    ))}
                  </div>
                )}
                <img src={data.images[activeImage] ?? data.images[0] ?? ''} alt={data.name} className="product-gallery__image" />
              </div>
              {data.images.length > 1 && (
                <div className="product-gallery__thumbs" role="tablist" aria-label="Product images">
                  {data.images.map((image, index) => (
                    <button
                      key={image}
                      type="button"
                      role="tab"
                      aria-selected={index === activeImage}
                      aria-label={`View image ${index + 1} of ${data.images.length}`}
                      className={index === activeImage ? 'is-active' : undefined}
                      onClick={() => setActiveImage(index)}
                    >
                      <img src={image} alt="" />
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="product-info">
              {category && (
                <a href={`/shop?category=${category.slug}`} className="product-info__category">
                  {category.name}
                </a>
              )}
              <h1 className="product-info__name">{data.name}</h1>
              <p className="product-info__unit">{data.unit} · {data.sku}</p>
              <Rating value={data.rating} count={data.reviewCount} />

              <PriceDisplay price={data.price} mrp={data.mrp} size="lg" className="product-info__price" />

              <p className={`product-info__stock is-${status}`}>
                <span className="product-info__dot" aria-hidden="true" />
                {stockLabel(data.stock)}
              </p>

              <p className="product-info__desc">{data.shortDescription}</p>

              <div className="product-info__buy">
                <QuantitySelector value={quantity} max={Math.min(99, data.stock)} onChange={setQuantity} disabled={out} />
                <Button size="lg" fullWidth disabled={out} onClick={handleAdd} icon={out ? 'ban' : 'cart'}>
                  {out ? 'Out of stock' : `Add to basket · ${formatCurrency(data.price * quantity)}`}
                </Button>
              </div>
              <Button size="lg" variant="accent" fullWidth disabled={out} onClick={handleBuyNow} icon="lock">
                {out ? 'Notify me when back' : 'Buy now'}
              </Button>

              <ul className="product-info__perks">
                {[
                  'Free shipping over ₹999',
                  'Fresh batch ships within 48 hours',
                  'Farm & harvest lot traced on every pack',
                ].map((perk) => (
                  <li key={perk}>
                    <Icon name="check-circle" size={15} /> {perk}
                  </li>
                ))}
              </ul>

              <dl className="product-info__details">
                <div>
                  <dt>
                    <Icon name="box" size={16} /> Net weight
                  </dt>
                  <dd>{data.unit}</dd>
                </div>
                <div>
                  <dt>
                    <Icon name="clock" size={16} /> Shelf life
                  </dt>
                  <dd>{data.shelfLife}</dd>
                </div>
                <div>
                  <dt>
                    <Icon name="shield" size={16} /> Storage
                  </dt>
                  <dd>{data.storage}</dd>
                </div>
                <div>
                  <dt>
                    <Icon name="truck" size={16} /> Delivery
                  </dt>
                  <dd>Dispatched in 48h · Delivered all over India</dd>
                </div>
              </dl>
            </div>
          </div>

          <div className="product-tabs">
            <Tabs items={tabs} />
          </div>
        </div>
      </section>

      {related.data && related.data.length > 0 && (
        <section className="section section--alt">
          <div className="container">
            <h2 className="section-title">You might also like</h2>
            {related.loading ? <ProductGridSkeleton count={4} /> : <ProductGrid products={related.data} />}
          </div>
        </section>
      )}
    </>
  )
}

function PageLoader() {
  return (
    <>
      <PageHeader eyebrow="Product" title="Loading product…" />
      <section className="section">
        <div className="container">
          <LoadingState title="Loading product" description="Fetching the freshest details…" />
        </div>
      </section>
    </>
  )
}

function buildSpecRows(product: Product): Array<[string, string]> {
  return [
    ['Pack size', product.unit],
    ['Net weight', `${product.netWeight} g`],
    ['Shelf life', product.shelfLife],
    ['Storage', product.storage],
    ['SKU', product.sku],
    ['Batch traceability', 'Farm · harvest lot on pack'],
    ...product.specifications.map((spec): [string, string] => [spec.label, spec.value]),
  ]
}