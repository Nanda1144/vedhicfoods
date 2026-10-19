import { PageHeader, Reveal } from '@/components/common'

export function PrivacyPolicyPage() {
  return (
    <>
      <PageHeader
        eyebrow="Legal"
        title="Privacy policy"
        description="How Vedhic Foods collects, uses and protects the information you share when you shop with us."
        align="center"
      />

      <section className="section section--narrow">
        <div className="container">
          <Reveal className="prose">
            <p className="type-caption">Last updated: October 2026</p>

            <p>
              Vedhic Foods (&ldquo;we&rdquo;, &ldquo;us&rdquo; or &ldquo;our&rdquo;) respects your privacy. This policy explains what
              personal information we collect when you visit our website, place an order for our organic food products, or
              contact our team, and how we use and safeguard that information.
            </p>

            <h2>1. Information we collect</h2>
            <p>We collect only the information we need to process your order and serve you well. This includes:</p>
            <ul>
              <li>Contact details such as your name, email address, mobile number and delivery address.</li>
              <li>Order details including the products purchased, quantities, order value and GST billing information.</li>
              <li>Payment information, which is processed by our payment partners. We do not store full card or UPI credentials on our servers.</li>
              <li>Communications you send us, such as support requests, reviews and feedback.</li>
              <li>Technical data such as your device type, browser, IP address and pages viewed, collected through cookies and similar tools.</li>
            </ul>

            <h2>2. How we use your information</h2>
            <p>Your information is used to:</p>
            <ul>
              <li>Process, pack, ship and deliver your orders, and send order and delivery updates.</li>
              <li>Provide customer support and respond to your queries, returns and refund requests.</li>
              <li>Issue invoices and comply with Indian tax and accounting requirements.</li>
              <li>Improve our products, website and service quality, and personalise your shopping experience.</li>
              <li>Send offers and updates where you have opted in. You can unsubscribe at any time.</li>
            </ul>

            <h2>3. Cookies and similar technologies</h2>
            <p>
              We use cookies and similar technologies to keep items in your cart, remember your preferences and understand how
              the site is used. Essential cookies are required for the store to function. You can disable non-essential cookies
              through your browser settings, though some parts of the site may then work less smoothly.
            </p>

            <h2>4. Sharing with third parties</h2>
            <p>
              We never sell your personal information. We share it only with trusted partners who help us run the store, and
              only to the extent required:
            </p>
            <ul>
              <li>Payment gateways and banks to authorise and settle your payments securely.</li>
              <li>Logistics and courier partners to deliver your order to the address you provide.</li>
              <li>Cloud hosting, email and analytics providers that support our operations.</li>
              <li>Government or regulatory authorities where we are legally required to disclose information.</li>
            </ul>

            <h2>5. Data retention and security</h2>
            <p>
              We retain your personal information only for as long as needed to fulfil the purposes described here, to comply
              with tax and legal obligations, and to resolve disputes. We use appropriate technical and organisational measures,
              including encryption in transit and access controls, to protect your data against unauthorised access, loss or
              misuse.
            </p>

            <h2>6. Your rights</h2>
            <p>Subject to applicable law, you may:</p>
            <ul>
              <li>Request access to the personal information we hold about you.</li>
              <li>Ask us to correct or update inaccurate details.</li>
              <li>Request deletion of your information where we are not required to keep it.</li>
              <li>Withdraw consent for marketing communications at any time.</li>
            </ul>

            <h2>7. Contact us</h2>
            <p>
              For any privacy question or request, write to us at privacy@vedhifoods.in. Our team will respond within a
              reasonable time, and in any case within the timelines required under applicable Indian law.
            </p>
          </Reveal>
        </div>
      </section>
    </>
  )
}
