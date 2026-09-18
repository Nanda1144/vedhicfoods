import { useNavigate } from 'react-router-dom'
import { useCart } from '@/context'
import { CartLineItem } from '@/components/cart'
import { CartSummary } from '@/components/cart'
import { PageHeader, ButtonLink, EmptyState } from '@/components/common'

export function CartPage() {
  const { items, totals, updateQuantity, remove, clear } = useCart()
  const navigate = useNavigate()

  return (
    <>
      <PageHeader
        eyebrow="Your basket"
        title="Shopping cart"
        crumbs={[{ label: 'Home', href: '/' }, { label: 'Cart', current: true }]}
      />

      <section className="section">
        <div className="container">
          {items.length === 0 ? (
            <div className="cart-empty">
              <EmptyState
                title="Your basket is empty"
                description="Fresh handmade laddus and heritage grains are waiting in the shop."
                icon="cart"
                action={<ButtonLink to="/shop" iconRight="arrow-right">Start shopping</ButtonLink>}
              />
            </div>
          ) : (
            <div className="cart-layout">
              <div className="cart-layout__lines">
                <ul className="cart-list">
                  {items.map((item) => (
                    <CartLineItem
                      key={item.id}
                      item={item}
                      onUpdateQuantity={updateQuantity}
                      onRemove={remove}
                    />
                  ))}
                </ul>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <ButtonLink to="/shop" variant="ghost" icon="arrow-left">
                    Continue shopping
                  </ButtonLink>
                  <button type="button" className="link-button link-button--danger" onClick={clear}>
                    Clear basket
                  </button>
                </div>
              </div>

              <div className="cart-layout__summary">
                <CartSummary totals={totals} onCheckout={() => navigate('/checkout')} checkoutLabel="Proceed to checkout" />
              </div>
            </div>
          )}
        </div>
      </section>
    </>
  )
}