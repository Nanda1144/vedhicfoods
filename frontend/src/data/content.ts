import type { FaqItem, Review, Testimonial } from '@/types'

export const TESTIMONIALS: Testimonial[] = [
  {
    id: 't1',
    name: 'Ananya Rao',
    location: 'Bengaluru, KA',
    quote:
      'The foxtail millet laddu tastes exactly like the one my grandmother made. Not overly sweet, and you can actually taste the ghee.',
    rating: 5,
    avatarInitials: 'AR',
  },
  {
    id: 't2',
    name: 'Vikram Menon',
    location: 'Pune, MH',
    quote:
      'We switched our family to their ragi rotis six months ago. Forty seconds on the tawa and dinner is sorted — no preservative aftertaste at all.',
    rating: 5,
    avatarInitials: 'VM',
  },
  {
    id: 't3',
    name: 'Priya Nair',
    location: 'Kochi, KL',
    quote:
      'The packaging tells you the farm and the harvest lot. That level of traceability is rare for organic food in India.',
    rating: 5,
    avatarInitials: 'PN',
  },
  {
    id: 't4',
    name: 'Rahul Deshpande',
    location: 'Hyderabad, TS',
    quote:
      'Ordered for Diwali gifting. Every single recipient asked where I got them. The dry fruit laddu is genuinely premium.',
    rating: 5,
    avatarInitials: 'RD',
  },
  {
    id: 't5',
    name: 'Meera Iyer',
    location: 'Chennai, TN',
    quote:
      'My son drinks the sprouted ragi malt every morning. It mixes smoothly and is far less sweet than supermarket brands.',
    rating: 4,
    avatarInitials: 'MI',
  },
  {
    id: 't6',
    name: 'Karan Bhatt',
    location: 'Ahmedabad, GJ',
    quote:
      'Delivery was quick, the invoice was GST-compliant, and the products were still cold on arrival. Very professionally run.',
    rating: 5,
    avatarInitials: 'KB',
  },
]

export const FAQS: FaqItem[] = [
  {
    id: 'faq-1',
    category: 'Products',
    question: 'Are your products certified organic?',
    answer:
      'Every grain lot we source is certified under India Organic and Jaivik Bharat. The farm and harvest lot number is printed on the back of each pack, and certificates are available on request.',
  },
  {
    id: 'faq-2',
    category: 'Products',
    question: 'Do you use refined sugar or preservatives?',
    answer:
      'Never. Our sweets are sweetened with organic jaggery or dates, and we use no artificial preservatives, colours or flavours. This is why our shelf life is shorter than mass-market alternatives.',
  },
  {
    id: 'faq-3',
    category: 'Products',
    question: 'How should I store the laddus and rotis?',
    answer:
      'Laddus keep well for 45 days in a cool dry place inside an airtight container. Our rotis are flash-frozen and should stay refrigerated until you reheat them on a tawa.',
  },
  {
    id: 'faq-4',
    category: 'Shipping',
    question: 'How long does delivery take?',
    answer:
      'Metro cities receive orders in 2–3 working days. Other serviceable PIN codes take 4–6 working days. Fresh-batch items are dispatched within 48 hours of production.',
  },
  {
    id: 'faq-5',
    category: 'Shipping',
    question: 'Is shipping free?',
    answer:
      'Shipping is free on all orders above ₹999. Below that, a flat ₹79 is charged at checkout. Cold-chain roti orders may carry a small handling fee in select cities.',
  },
  {
    id: 'faq-6',
    category: 'Orders',
    question: 'Can I cancel or modify my order?',
    answer:
      'Yes — orders can be cancelled free of charge until they are marked “Packed”. After that, please contact support and we will do our best to help.',
  },
  {
    id: 'faq-7',
    category: 'Orders',
    question: 'What payment methods do you accept?',
    answer:
      'We accept UPI, all major credit and debit cards, net banking and wallets via Razorpay, plus Cash on Delivery on eligible orders up to ₹5,000.',
  },
  {
    id: 'faq-8',
    category: 'Orders',
    question: 'Do you provide GST invoices?',
    answer:
      'Yes. A GST-compliant tax invoice is generated automatically for every order and emailed to you. It is also downloadable from your order confirmation page.',
  },
  {
    id: 'faq-9',
    category: 'Returns',
    question: 'What is your returns policy?',
    answer:
      'Because these are perishable food products, we accept returns only for damaged, spoiled or incorrect items. Report the issue within 48 hours with a photo and we will replace or refund in full.',
  },
  {
    id: 'faq-10',
    category: 'Returns',
    question: 'When will I receive my refund?',
    answer:
      'Refunds are initiated within 24 hours of approval and reflect in your original payment method in 5–7 working days. COD refunds are processed via bank transfer.',
  },
  {
    id: 'faq-11',
    category: 'Wholesale',
    question: 'Do you supply to cafés, hotels and stores?',
    answer:
      'Yes. We offer wholesale pricing from 10 kg per SKU with dedicated account management. Write to us through the contact page with your requirement.',
  },
  {
    id: 'faq-12',
    category: 'Wholesale',
    question: 'Can I order custom corporate gifting boxes?',
    answer:
      'Absolutely. We build curated millet and laddu hampers with custom branding for festivals, onboarding kits and employee gifting. Minimum order is 25 boxes.',
  },
  {
    id: 'faq-13',
    category: 'Ingredients',
    question: 'What exactly goes into the laddus and what is left out?',
    answer:
      'Only whole ingredients — certified organic grains, cold-pressed ghee, jaggery or dates, nuts and natural seeds. No vanaspati, no refined sugar, no palm oil, no preservatives.',
  },
  {
    id: 'faq-14',
    category: 'Ingredients',
    question: 'Are your products suitable for diabetics?',
    answer:
      'Our millet and ragi ranges are naturally low-glycaemic and jaggery-sweetened. We still recommend portion control and suggest you consult your physician for daily values.',
  },
  {
    id: 'faq-15',
    category: 'Payments',
    question: 'Which payment methods are available on the website?',
    answer:
      'Razorpay handles UPI, credit/debit cards, net banking and mobile wallets — all processed securely without us ever seeing your card details. Cash on Delivery is available on orders up to ₹5,000.',
  },
  {
    id: 'faq-16',
    category: 'Payments',
    question: 'Is my payment information safe?',
    answer:
      'Yes. We never store card numbers or bank details on our servers — payments are tokenised and processed by PCI-DSS compliant gateways like Razorpay over TLS encryption.',
  },
  {
    id: 'faq-17',
    category: 'Delivery',
    question: 'Do you deliver nationwide and does anything need cold chain?',
    answer:
      'We deliver across India via insulated, FSSAI-compliant couriers. Flash-frozen products like rotis travel in cold-chain packaging; shelf-stable laddus need no special handling.',
  },
  {
    id: 'faq-18',
    category: 'Delivery',
    question: 'How is the freshness of a food order tracked?',
    answer:
      'Each pack carries its production date and batch lot number. Your order confirmation and invoice include the dispatch date, so freshness is verifiable from farm to doorstep.',
  },
  {
    id: 'faq-19',
    category: 'Storage',
    question: 'Why does the shelf life vary between products?',
    answer:
      'Because we add no preservatives, shelf life is a natural property of the food — laddus with milk solids are shorter-lived than pure millet rotis. The printed date always tells the truth.',
  },
  {
    id: 'faq-20',
    category: 'Shelf life',
    question: 'How long does a sealed vs open pack last?',
    answer:
      'A sealed pack stays good until the printed date. Once opened, keep it airtight and finish laddus within 30 days and rotis within 7 days of opening to enjoy peak texture and aroma.',
  },
  {
    id: 'faq-21',
    category: 'Discounts',
    question: 'How do promo codes and the loyalty discount work?',
    answer:
      'Valid codes apply at checkout before payment. Bulk and festival bundles carry automatic cart-level discounts, and registered families receive early-bird offers during festive seasons.',
  },
]

export const REVIEWS: Review[] = [
  {
    id: 'rev-1',
    productId: 'prd-001',
    customerName: 'Ananya R.',
    rating: 5,
    title: 'Tastes homemade',
    body: 'Perfectly balanced sweetness and you can smell the cardamom the moment you open the pack.',
    createdAt: new Date(2026, 7, 20).toISOString(),
    verified: true,
  },
  {
    id: 'rev-2',
    productId: 'prd-001',
    customerName: 'Deepak S.',
    rating: 5,
    title: 'Repeat order',
    body: 'Third order this year. Consistent texture every single time, which is impressive for a hand-made product.',
    createdAt: new Date(2026, 7, 4).toISOString(),
    verified: true,
  },
  {
    id: 'rev-3',
    productId: 'prd-001',
    customerName: 'Lakshmi V.',
    rating: 4,
    title: 'Great, slightly sweet',
    body: 'Loved it. I would personally prefer a touch less jaggery, but the family finished the box in two days.',
    createdAt: new Date(2026, 6, 28).toISOString(),
    verified: true,
  },
  {
    id: 'rev-4',
    productId: 'prd-005',
    customerName: 'Meera I.',
    rating: 5,
    title: 'Best ragi laddu',
    body: 'You can taste the ragi properly — not masked by sugar like most brands. Will order again for my mother.',
    createdAt: new Date(2026, 7, 11).toISOString(),
    verified: true,
  },
  {
    id: 'rev-5',
    productId: 'prd-009',
    customerName: 'Vikram M.',
    rating: 5,
    title: 'Weeknight saver',
    body: 'Soft, pliable and no maida aftertaste. We now keep a pack permanently in the freezer.',
    createdAt: new Date(2026, 6, 19).toISOString(),
    verified: true,
  },
]

export const CONTACT_TOPICS = [
  'Order support',
  'Product enquiry',
  'Wholesale / bulk',
  'Corporate gifting',
  'Partnership',
  'Something else',
] as const

export const SUPPORT_CATEGORIES = [
  { id: 'order', title: 'Order & delivery', copy: 'Track, modify or cancel an order' },
  { id: 'payment', title: 'Payments & refunds', copy: 'Failed payments, refunds and invoices' },
  { id: 'product', title: 'Product help', copy: 'Ingredients, storage and usage' },
  { id: 'wholesale', title: 'Wholesale & gifting', copy: 'Bulk pricing and custom hampers' },
] as const
