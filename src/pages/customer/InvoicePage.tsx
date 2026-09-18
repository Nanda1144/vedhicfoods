import { useParams } from 'react-router-dom'
import { SITE } from '@/config/site'
import { invoiceService } from '@/services/invoiceService'
import { useAsync } from '@/hooks'
import { useSettings } from '@/context'
import { formatCurrency, formatDateTime } from '@/utils/format'
import { PageHeader, LoadingState, ErrorState, Button, Badge } from '@/components/common'

export function InvoicePage() {
  const { id = '' } = useParams()
  const { settings } = useSettings()
  const invoice = useAsync(
    () => invoiceService.byId(id.startsWith('inv-') ? id : `inv-${id}`, { delay: 500 }),
    [id],
  )

  if (invoice.loading) {
    return (
      <section className="section">
        <div className="container">
          <LoadingState title="Loading invoice" description="Fetching your tax document…" />
        </div>
      </section>
    )
  }

  if (invoice.error || !invoice.data) {
    return <ErrorState title="Invoice not found" description={invoice.error?.message} />
  }

  const data = invoice.data
  const cgst = Math.round(data.tax / 2)

  return (
    <>
      <PageHeader
        eyebrow="Tax invoice"
        title={`Invoice ${data.invoiceNumber}`}
        crumbs={[{ label: 'Home', href: '/' }, { label: 'Invoice', current: true }]}
        meta={<Button variant="outline" icon="printer" onClick={() => invoiceService.print()}>Print / save as PDF</Button>}
      />

      <section className="section">
        <div className="container">
          <div className="invoice" id="invoice-print">
            <header className="invoice__head">
              <div>
                <p className="invoice__brand">{settings.brandName}</p>
                <p className="invoice__addr">
                  {settings.addressLine}
                  <br />
                  {settings.city}, {settings.state} {settings.pincode}
                  <br />
                  GSTIN: {settings.gstin}
                </p>
              </div>
              <div className="invoice__meta">
                <h1>Tax invoice</h1>
                <dl>
                  <div><dt>Invoice no.</dt><dd>{data.invoiceNumber}</dd></div>
                  <div><dt>Order no.</dt><dd>{data.orderNumber}</dd></div>
                  <div><dt>Date</dt><dd>{formatDateTime(data.issuedAt)}</dd></div>
                  <div><dt>Status</dt><dd><Badge tone={data.status === 'paid' ? 'success' : 'warning'}>{data.status}</Badge></dd></div>
                </dl>
              </div>
            </header>

            <section className="invoice__parties">
              <div>
                <p className="type-label">Billed to</p>
                <p>
                  {data.customerName}<br />
                  {data.customerEmail}<br />
                  {data.billingAddress.line1}, {data.billingAddress.city}, {data.billingAddress.state} {data.billingAddress.pincode}
                </p>
              </div>
              <div>
                <p className="type-label">Ship to</p>
                <p>
                  {data.shippingAddress.fullName}<br />
                  {data.shippingAddress.line1}, {data.shippingAddress.city}, {data.shippingAddress.state} {data.shippingAddress.pincode}
                </p>
              </div>
            </section>

            <table className="invoice__table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th className="is-right">Qty</th>
                  <th className="is-right">Unit price</th>
                  <th className="is-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((item) => (
                  <tr key={item.productId}>
                    <td>{item.name}<span className="invoice__sub">{item.unit} · {item.sku}</span></td>
                    <td className="is-right">{item.quantity}</td>
                    <td className="is-right">{formatCurrency(item.price)}</td>
                    <td className="is-right">{formatCurrency(item.price * item.quantity)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="invoice__totals">
              <dl>
                <div><dt>Subtotal</dt><dd>{formatCurrency(data.subtotal)}</dd></div>
                <div><dt>Shipping</dt><dd>{data.shipping === 0 ? 'Free' : formatCurrency(data.shipping)}</dd></div>
                <div><dt>CGST 2.5%</dt><dd>{formatCurrency(cgst)}</dd></div>
                <div><dt>SGST 2.5%</dt><dd>{formatCurrency(Math.max(0, data.tax - cgst))}</dd></div>
                {data.discount > 0 && <div><dt>Coupon discount</dt><dd>− {formatCurrency(data.discount)}</dd></div>}
                <div className="invoice__grand"><dt>Total</dt><dd>{formatCurrency(data.total)}</dd></div>
              </dl>
              <p className="invoice__note">
                Amount in {SITE.currency}. Thanks for supporting small farms and slow food.
              </p>
            </div>
          </div>
        </div>
      </section>
    </>
  )
}