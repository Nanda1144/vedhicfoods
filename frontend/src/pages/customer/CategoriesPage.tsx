import { productService } from '@/services/productService'
import { useAsync } from '@/hooks'
import { PageHeader, Reveal, Skeleton } from '@/components/common'
import { CategoryCard } from '@/components/product'

export function CategoriesPage() {
  const categories = useAsync(() => productService.categories(), [])

  return (
    <>
      <PageHeader
        eyebrow="Browse the shelves"
        title="All categories"
        description="Seven families of traditional food, every one of them certified organic and made in small batches."
      />
      <section className="section">
        <div className="container">
          {categories.loading ? (
            <div className="category-grid category-grid--3">
              {Array.from({ length: 6 }).map((_, index) => (
                <Skeleton key={index} style={{ width: '100%', aspectRatio: '4 / 5', borderRadius: 'var(--radius-lg)' }} />
              ))}
            </div>
          ) : categories.data?.length ? (
            <div className="category-grid category-grid--3">
              {categories.data.map((category, index) => (
                <Reveal key={category.id} delay={(index % 3) * 60}>
                  <CategoryCard category={category} />
                </Reveal>
              ))}
            </div>
          ) : null}
        </div>
      </section>
    </>
  )
}