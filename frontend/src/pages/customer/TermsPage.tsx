import { PageHeader, Reveal } from '@/components/common'

export function TermsPage() {
  return (
    <>
      <PageHeader
        eyebrow="Legal"
        title="Terms of service"
        description="The terms that govern your use of the Vedhic Foods website and your purchase of our products."
        align="center"
      />

      <section className="section section--narrow">
        <div className="container">
          <Reveal className="prose">
            <p className="type-caption">Last updated: October 2026</p>

            <p>
              These Terms of Service (&ldquo;Terms&rdquo;) apply to your access to and use of the Vedhic Foods website and to
              every order you place with us. Please read them carefully before shopping.
            </p>

            <h2>1. Acceptance of these terms</h2>
            <p>
              By accessing this website, creating an account or placing an order, you agree to be bound by these Terms and by
              our Privacy Policy and Refund Policy. If you do not agree, please do not use the site or place an order.
            </p>

            <h2>2. Your account</h2>
            <p>
              You are responsible for the accuracy of the details you provide and for keeping your account credentials secure.
              You agree not to share your login with others and to notify us immediately of any unauthorised use. We may
              suspend or close accounts involved in misuse, fraud or abuse.
            </p>

            <h2>3. Orders and pricing</h2>
            <p>
              All prices are listed in Indian Rupees (INR) and are inclusive of applicable GST unless stated otherwise. An
              order is confirmed only after payment is authorised and you receive an order confirmation. We reserve the right
              to refuse or cancel an order in case of pricing errors, stock unavailability or suspected fraud, with a full
              refund where payment has already been collected.
            </p>

            <h2>4. Shipping and delivery</h2>
            <p>
              We dispatch orders from our kitchen in Karnataka and deliver across serviceable pin codes in India through our
              courier partners. Delivery timelines shared at checkout are estimates and may vary due to weather, public
              holidays, regional restrictions or events beyond our control. Risk in the goods passes to you on delivery.
            </p>

            <h2>5. Intellectual property</h2>
            <p>
              All content on this website, including text, product descriptions, photographs, logos and design, is owned by or
              licensed to Vedhic Foods and is protected by applicable intellectual property laws. You may not copy, reproduce
              or use our content for commercial purposes without our prior written consent.
            </p>

            <h2>6. Limitation of liability</h2>
            <p>
              To the maximum extent permitted by law, Vedhic Foods shall not be liable for any indirect, incidental or
              consequential loss arising from your use of the website or the products. Our total liability for any claim
              relating to an order shall not exceed the amount you paid for that order.
            </p>

            <h2>7. Governing law and jurisdiction</h2>
            <p>
              These Terms are governed by the laws of India. Any dispute arising out of or in connection with these Terms or
              your orders shall be subject to the exclusive jurisdiction of the competent courts in Karnataka, India.
            </p>

            <h2>8. Changes to these terms</h2>
            <p>
              We may update these Terms from time to time to reflect changes in our services or the law. The revised Terms
              will be posted on this page with a new &ldquo;last updated&rdquo; date, and your continued use of the site after
              that constitutes acceptance of the changes.
            </p>

            <h2>9. Contact us</h2>
            <p>
              For any question about these Terms, write to us at legal@vedhifoods.in and our team will be glad to help.
            </p>
          </Reveal>
        </div>
      </section>
    </>
  )
}
