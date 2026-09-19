# Vedhi Foods — Premium Customer-Experience Redesign

> Living task list for the creative redesign of the customer-facing storefront.
> Status: `[x]` done · `[~]` partial · `[ ]` todo

---

## 0. Foundation & housekeeping

- [x] Audit existing codebase (build ✅, type-check ✅, structure, tokens, pages)
- [x] Fix corrupted `README.md` (was Vite template + UTF-16 appendix) → brand README
- [x] Update `package.json` description (was default Vite template copy)
- [ ] Add CI (lint + type-check + build on push) — *(infra, out of customer-facing scope)*
- [ ] Reduce 21 oxlint warnings (`set-state-in-effect`, `only-export-components`)

## 1. Core experience — brand clarity in the first screen

- [x] Rebuild hero as an **immersive editorial opener** ("From the soil. To your table.")
- [x] First screen communicates: WHAT (organic traditional foods) · WHY (small-batch, slow-made) · TRUST (organic, traceable) · HOW (explore collection / story)
- [x] Layered composition: warm cream backdrop, large food composition, floating ingredient elements, editorial statement (not navbar-hero-button)

## 2. Hero interaction

- [x] Subtle mouse parallax on hero layers (ingredients / typography / organic shapes) — rAF-throttled, disabled for touch + reduced motion
- [x] Scroll-out transition: hero gently fades/scales/rises into the next section (opacity + transform only)
- [x] Motion kept luxurious, never excessive

## 3. Navigation experience

- [x] Header background = footer background (`--color-surface-inverse`, deep forest green) in **every** state — the earlier glass/cream hero overlay was removed per feedback
- [x] Logo & links stay light-toned against the dark header at all times
- [x] Account menu trimmed to a single **Admin** entry (invoices are emailed per receipt; FAQs now live on home/contact/about)
- [~] Keep minimal: logo · Shop · Our Story · Collections · Contact · Search · Cart (existing nav retained; consider trimming items later)
- [x] Elegant transition (border + box-shadow + text colour)

## 4. Brand statement section

- [x] Oversized editorial statement directly after the hero ("Food with a story.")
- [x] Supporting line in generous whitespace — not a conventional paragraph
- [x] Slow reveal-on-scroll

## 5. Interactive product discovery (categories)

- [x] "Discover your kind of goodness" — asymmetric editorial category grid (large feature card + varied tiles)
- [x] Hover: image moves, title shifts, description + CTA appear, card grows subtly
- [x] Mobile horizontal swipe/stack treatment for the discovery grid (scroll-snap swipe at ≤640px; feature card leads)

## 6. Product philosophy before product grid

- [x] "What makes it different" — 4 numbered editorial principles (Pure ingredients · Traditional knowledge · Careful preparation · Premium quality)
- [x] Typography + imagery driven, not generic icon cards

## 7. Ingredient journey

- [x] Scroll-driven transformation: Soil → Grain → Preparation → Your table
- [x] Visual progress line that fills as the user scrolls through the stages
- [x] Communicates authenticity + transformation, not a static photo strip

## 8. Premium product showcase

- [x] Large split showcase BEFORE the dense grid: image left, story/ingredients/price/weight/qty/add-to-table right
- [x] Prev/next product with subtle crossfade image transitions
- [x] Strong CTA language ("Add to your table")

## 9. Horizontal product journey (bestsellers)

- [x] Horizontal scroll-snap rail with large product cards
- [x] Visible prev/next controls, arrow-key + scroll usable, snap alignment
- [x] Accessible labels & focus states

## 10. "Made for modern life"

- [x] "Traditional roots. Modern convenience." split section — ready-to-eat, easy ordering, premium packaging, home delivery
- [x] Answers "why should a modern customer buy this?"

## 11. Food visualisation

- [~] Consistent image treatment via existing `SmartImage` + placeholder system (real photography is a production swap — out of prototype scope)
- [x] Close-up-feeling compositions via layered hero media + showcase stages

## 12. Micro-interactions

- [x] Add-to-cart button state machine: `ADD → ADDING… → ADDED ✓` (product card + showcase)
- [x] Cart count "pop" when an item is added; free-shipping progress in drawer
- [x] Product hover image movement (cards + categories)
- [~] Quantity smooth transitions (native stepper retained)
- [ ] Wishlist/favourite interaction — *(not in current scope; no wishlist service)*

## 13. Scroll journey & visual rhythm

- [x] Sequence: HERO → STATEMENT → PHILOSOPHY → CATEGORIES → JOURNEY → SHOWCASE → MODERN LIFE → BESTSELLERS → SOCIAL PROOF → FESTIVE → FINAL CTA → FOOTER
- [x] Every major section has a distinct composition (no heading/paragraph/3-card repetition)
- [x] Controlled asymmetry: split layouts, overlapping text, large type, horizontal rail

## 14. Organic shapes & colour

- [x] Curved/blob masks, organic dividers, leaf motif, warm textures
- [x] Maintained palette: cream = breathing space, forest/olive used strategically, gold as accent only
- [x] No childish illustrations

## 15. Typography as a visual element

- [x] Oversized serif statements (hero, statement, final CTA), short paragraphs, generous line spacing

## 16. Trust "why it matters"

- [x] Replaced duplicated trust cards with editorial proof points inside philosophy + journey + modern-life sections
- [x] No unsupported health claims

## 17. Social proof

- [x] Editorial testimonial section (magazine layout: featured pull-quote + product-purchased bylines)
- [x] Magazine/editorial layout upgrade (12-col asymmetric grid, quote glyph, reduced-motion safe)

## 18. Festive / seasonal experience

- [x] "Festive goodness" section — large imagery, limited-time message, `FESTIVE15` code chip, CTA
- [x] Dynamically appears/disappears via `settings.promotionActive` + live coupon validity (admin-toggle ready)

## 19. Shopping must stay easy

- [x] Every product keeps: view · quantity · add · buy now (existing flows untouched)
- [x] Price, availability, name, purchase action never hidden

## 20. Sticky shopping action (product detail)

- [x] Sticky bottom purchase bar on product pages (mobile-first, appears after the main buy block scrolls out)
- [x] Shows product, price, quantity, Add to basket, Buy now — unobtrusive

## 21. Cart experience

- [x] Mini-cart drawer retained (image, qty, price, subtotal, VIEW CART / CHECKOUT)
- [x] Added free-shipping progress bar — encourages adding one more item
- [x] Cart icon animates (pop) when items are added

## 22. Checkout experience

- [x] 4-step progress (Details → Address → Review → Payment) with `checkout-steps` indicator, brand-styled
- [x] Payment UI communicates SECURE · Razorpay · UPI/cards/netbanking/COD (prototype, clearly simulated)

## 23. Order success

- [x] "Goodness is on its way." celebration screen — order seal with spinning rings + sparkles, big serif headline, order total chip, VIEW ORDER / INVOICE / SHOP actions
- [x] Subtle transform-only celebration animation (disabled under reduced motion)

## 24. Mobile experience

- [x] Mobile hero: visual-first, short statement, one CTA — then straight into the story
- [x] Sticky mobile nav + easy cart access (existing)
- [x] Large touch targets, simplified stacking, scroll-rail bestsellers with snap
- [~] Sticky purchase CTA applied (done) — verify on device

## 25. Accessibility

- [x] All interactions keyboard-reachable; focus-visible retained
- [x] `prefers-reduced-motion` honoured by every new animation
- [x] ARIA labels on all new controls (arrows, rail, sticky bar)
- [x] Alt/aria on imagery; contrast follows existing tokens

## 26. Performance

- [x] New motion uses transform/opacity only; IntersectionObserver for reveals; lazy images via existing `SmartImage`
- [x] No new heavy libraries; no WebGL
- [x] rAF-throttled parallax

## 27. Content strategy & final quality test

- [x] Homepage answers: what / special / products / provenance / trust / modern fit / how to buy / price / delivery — progressively revealed
- [x] Final CTA: "Bring something good to your table." (collection + story)
- [x] Footer retained as the final chapter (logo, statement, shop, categories, about, contact, support, legal, socials, FSSAI)
- [ ] Final creative-director pass across every customer page *(continuous; see notes)*

## Notes / non-goals
- Real food photography, real payments, real backend, customer accounts & wishlist are **production swaps** — the mock layer is designed for them (see `services/http.ts`).
- `og:image`, real social URLs, `.example` contact details → production config.

## Verification log (2026-09-19)
- `npx tsc -b` — 0 errors ✅
- `npx vite build` — 0 errors, 180 modules, CSS bundle 158 kB (25 kB gzip) ✅
- `npx oxlint` — 0 errors / 22 warnings (same pre-existing categories: `set-state-in-effect`, `only-export-components`) ✅
- `npm run dev` booted cleanly on `:5174` (moved from in-use `:5173`) ✅
- Class ↔ component coupling verified for: hero layers, marquee (2-group loop), philosophy, journey (Reveal `is-visible` on `.journey`), showcase, story teaser, modern, rail, festive, finale, navbar `is-over`/`is-pop`, `is-busy`/`is-done` add states, `purchase-sticky`, `ship-progress`, `category-card--story` — all tokens confirmed against `tokens.css` (one fix: `--olive-400` → `--olive-500`, olive scale has no 400 step).

## Update pass 2 (2026-09-19)
- **Mobile discovery grid** → horizontal scroll-snap swipe (≤640px), feature card leads — CSS-only in `experience.css`
- **Testimonials** → magazine/editorial layout (12-col grid, featured pull-quote + decorative glyph, product-purchased byline pill); added optional `product` to `Testimonial` + seed data
- **Order success** → "Goodness is on its way." celebration hero (ringed seal, sparkles, total chip, VIEW ORDER anchor) — markup in `OrderSuccessPage`, CSS in `experience.css`, all motion transform-only + reduced-motion overridden
- **README.md** refreshed: new experience steps, mobile swipe, editorial testimonials, order-success celebration, `EXPERIENCE.md` pointer
- `npx tsc -b` ✅ · `npx vite build` ✅ · `npx oxlint` 0 errors / 22 warnings ✅ (after this pass)

## Update pass 3 (2026-09-19) — feedback round
- **Header = footer colour** → removed the glass `is-over` hero state (CSS + markup); navbar now sits on `--color-surface-inverse` (same as footer) at all times; logo always light; dropped unused `useLocation`/`overHero`
- **Account menu** → now only **Admin** (`ACCOUNT_MENU` in `src/data/navigation.ts`); removed Track-order / Invoices / FAQs (invoices are emailed, FAQ moved to pages)
- **FAQ on Home / Contact / About** → new reusable `FaqSection` component (picks the most useful categories, accordion, "View all FAQs" link) added to all three pages; removed the FAQ entry from the account menu
- **Square cards + 20% smaller images** → product cards now square (`1 / 1`, was `4 / 5`); media-link padding 10% on each side shrinks the photo to 80% of the card; hover zoom stays clipped inside the frame
- **Empty space filled with text** → weight/unit caption ("Pack of 6 · 500 g" + leaf icon) inside the card's freed band; homepage brand-statement section gained a facts strip (40+ farms · 3 generations · 48h dispatch)
- **README.md** refreshed for the above (nav colour, account menu, FAQ placement, square cards)
- `npx tsc -b` ✅ · `npx vite build` ✅ (CSS 162 kB / 25.8 kB gzip) · `npx oxlint` 0 errors / 22 warnings ✅ (after this pass)