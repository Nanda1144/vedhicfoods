# Vedhi Foods

> **From the soil. To your table.** — a premium organic & traditional Indian ready-to-eat food experience.

Vedhi Foods is a React + TypeScript + Vite e-commerce prototype for a premium organic and traditional Indian food brand — laddus, ragi rotis, millets, organic grains, and ready-to-eat meals. The customer storefront is designed as an immersive, editorial *digital food experience* rather than a conventional product-grid store.

## ✨ The Experience

The storefront leads the visitor through a narrative journey:

1. **Immersive hero** — mouse-reactive parallax food composition with floating ingredient chips
2. **Marquee band** — brand words in slow motion
3. **Brand statement** — oversized editorial typography
4. **What makes it different** — philosophy principles as editorial rows
5. **Category discovery** — large visual category cards; horizontally swipeable with scroll-snap on mobile
6. **Ingredient journey** — ingredient → preparation → product → your table
7. **Premium product showcase** — crossfading featured product with ingredients & add-to-cart
8. **Made for modern life** — tradition × convenience
9. **Bestseller rail** — horizontal scroll-snap product journey
10. **Story teaser** — brand milestones
11. **Editorial testimonials** — magazine-style social proof: featured pull-quote, product-purchased bylines
12. **Festive band** — seasonal promotion (admin toggle + live coupon)
13. **Final call** — memorable closing CTA + newsletter
14. **Order success** — "Goodness is on its way." celebration screen with order seal, total & actions

**Interaction details:** ADD → ADDING… → ADDED ✓ button states, cart-count pop, free-shipping progress in the cart drawer, a mobile-only sticky purchase bar on product pages, swipeable category discovery on mobile, square product cards with images sized at 80% plus a weight/caption line, FAQ blocks on the home/contact/about pages, and `prefers-reduced-motion` support throughout. All animation is transform/opacity only — no heavy 3D libraries.

## 🧱 Stack

- **React 19** + **React Router 7**
- **TypeScript** (strict — `noUnusedLocals`/`noUnusedParameters`)
- **Vite 8**
- **Oxlint**
- Mock/localStorage service layer (products, cart, auth, settings, coupons, content)

## 🚀 Getting Started

```bash
npm install
npm run dev      # start the dev server
npm run build    # type-check (tsc -b) + production build
npm run lint     # oxlint
npm run preview  # preview the production build
```

## 🗂 Project Structure

```
src/
├── components/     # layout, product, home (hero, showcase, rail, testimonials)
├── pages/
│   ├── customer/   # HomePage, ProductDetailPage, cart, checkout, order success…
│   └── admin/      # admin dashboard (settings, catalogue, orders, coupons)
├── services/       # mock/localStorage services (product, cart, auth, content…)
├── config/         # site config & default settings
├── data/           # seed/catalogue data
├── styles/         # tokens → reset → base → utilities → animations →
│                   # components → layout → pages → admin → experience
└── types/          # shared TypeScript types
```

> The storefront redesign is tracked section-by-section in **`EXPERIENCE.md`** — a living roadmap with per-feature status and a verification log.

> Admin can flip seasonal promotions on/off via **WebsiteSettings → promotionActive**; the festive homepage section appears/disappears dynamically.
>
> **Navigation notes:** the header uses the same deep-green background as the footer in every state (no transparent hero overlay), and the account menu keeps a single **Admin** entry — invoices are emailed, and FAQs now live on the home, contact and about pages.

## 🎨 Design System

- **Palette:** deep forest green, olive, warm cream, earth brown, subtle gold (gold is an accent, never dominant)
- **Type:** Cormorant Garamond (display) + a modern sans (body)
- **Motion:** transform/opacity only; honour `prefers-reduced-motion`
- **Tokens:** all colors, spacing, radii, shadows, easing & durations live in `src/styles/tokens.css`

## 📄 License

ISC