import { PageHeader, Reveal } from '@/components/common'

export function RefundPolicyPage() {
  return (
    <>
      <PageHeader
        eyebrow="Legal"
        title="Refund policy"
        description="Cancellations, returns and refunds for Vedhic Foods orders — explained simply and fairly."
        align="center"
      />

      <section className="section section--narrow">
        <div className="container">
          <Reveal className="prose">
            <p className="type-caption">Last updated: October 2026</p>

            <p>
              We want you to be happy with every pack you receive. Because most of our products are freshly prepared
              food items, please review the guidelines below before requesting a cancellation, return or refund.
            </p>

            <h2>1. Order cancellations</h2>
            <p>
              You may cancel an order free of charge at any time before it is packed. Once an order has been packed or handed
              to our courier partner, it can no longer be cancelled. To cancel, contact us as early as possible with your order
              number and our team will confirm the status.
            </p>

            <h2>2. Shipping timelines</h2>
            <p>
              Orders are usually dispatched within 1–2 business days of confirmation. Standard delivery takes 3–7 business days
              depending on your pin code, with remote locations taking a little longer. Tracking details are shared by email
              and SMS once your parcel leaves our kitchen.
            </p>

            <h2>3. Return window and eligibility</h2>
            <p>
              Returns are accepted only for eligible, unopened and unused items reported within 48 hours of delivery. To be
              eligible, the item must be in its original packaging with seals, labels and the invoice intact. Approval of a
              return is subject to inspection once the item reaches us.
            </p>

            <h2>4. Non-returnable perishable items</h2>
            <p>
              For health and safety reasons, the following cannot be returned or exchanged once delivered:
            </p>
            <ul>
              <li>Opened or partially consumed food items.</li>
              <li>Fresh, perishable or temperature-sensitive products.</li>
              <li>Items purchased during clearance or final-sale promotions.</li>
              <li>Gift cards and personal care items that have been used.</li>
            </ul>

            <h2>5. Damaged or incorrect items</h2>
            <p>
              If your order arrives damaged, tampered with or different from what you ordered, please notify us within 48 hours
              of delivery with photos of the item and the packaging. Verified cases are replaced or refunded at no extra cost,
              and we will arrange a pickup where required.
            </p>

            <h2>6. Refund method and timeline</h2>
            <p>
              Approved refunds are issued to the original payment method. Once the return or cancellation is confirmed, refunds
              are typically processed within 5–7 business days. For prepaid orders, the amount is credited back to your payment
              instrument, and your bank may take additional time to reflect it. For cash-on-delivery orders, refunds are made
              via bank transfer or UPI using the details you provide.
            </p>

            <h2>7. How to request a refund</h2>
            <p>
              To request a refund or return, contact our support team with your order number, the item concerned, the reason for
              the request and photographs where applicable. We will review your request and confirm the next steps within 1–2
              business days.
            </p>

            <h2>8. Contact us</h2>
            <p>
              For any refund-related question, write to support@vedhifoods.in or reach us through the Contact page and our team
              will assist you.
            </p>
          </Reveal>
        </div>
      </section>
    </>
  )
}
