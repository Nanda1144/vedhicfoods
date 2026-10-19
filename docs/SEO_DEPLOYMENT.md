# Storefront sitemap

`frontend/public/sitemap.xml` contains the public static pages and is refreshed
after every storefront build. Product slugs come from the public catalog, so
include them in a release build with:

```sh
GENERATE_PRODUCT_SITEMAP=true VITE_API_URL=https://api.vedhicfoods.com/api/v1 npm run build --workspace vedhicfoods-frontend
```

The generator reads only the public product listing endpoint, follows
pagination, and writes the updated XML into the storefront public directory. It
does not read authentication credentials or product administration endpoints.
For builds that do not opt into a live catalog fetch, the generated sitemap
contains the public static pages. Route metadata is updated client-side; initial
HTML metadata for product routes still requires prerendering or server rendering
at the storefront host.
