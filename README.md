# Palianytsia Bread

A Vue 3 + TypeScript bakery website, built with Vite and run with Bun. A Bun API reads and saves front page HTML in PostgreSQL.

## Start developing

Requires Bun 1.3.8 or newer.

```sh
bun install
bun run db:migrate
bun run dev
```

Configure PostgreSQL and `.env` as described below before running the migration. Open http://localhost:5173. This starts the Vue app and the API together. Stop both with Ctrl+C. The homepage requires the database; it displays a retry message if content cannot be loaded.

The API runs at http://127.0.0.1:3001; Vite forwards `/api` requests to it. `GET /api/health` checks the API process, not the database. Use `bun run dev:web` or `bun run dev:api` to start either process separately.

## PostgreSQL

For an existing project database, create `.env` from `.env.example` if it does not already exist, then set `DATABASE_URL` and a private `ADMIN_PASSWORD`. In PowerShell:

```powershell
if (!(Test-Path .env)) { Copy-Item .env.example .env }
```

To create a new database on an existing PostgreSQL server, set `POSTGRES_ADMIN_URL` in `.env` to an administrator connection URL, for example `postgres://postgres:<URL-encoded-password>@127.0.0.1:5432/postgres`, then run:

```sh
bun run db:create
bun run db:migrate
```

`db:create` creates the `palianytsia` database and a dedicated `palianytsia_app` login. It writes the generated application credentials and admin editor password to the ignored `.env` file, then removes the setup administrator URL. It refuses to replace an existing database or role. Use the `ADMIN_PASSWORD` value from `.env` to sign in at `/admin`. Restart the API after changing `.env`.

Alternatively, with Docker installed, use the included local database and the example connection URL:

```sh
docker compose up -d db
bun run db:migrate
bun run db:check
```

`db:migrate` applies every file in `server/migrations/` in order. `001` creates `front_page_content`, a single-row table containing `title`, `subtitle`, `story`, and `updated_at`, and seeds the original HTML only if the row does not exist. `002` creates `products` and `product_photos`, `003` adds the display order, and `004` adds product slugs (existing products get one from their title), `005` adds the price, and `006` adds the shipping flag. Migrations are idempotent, so rerunning preserves existing data. `server/db.ts` exposes a lazy Bun SQL connection. Keep database credentials in server environment variables, never `VITE_` variables. Docker data persists in a volume; `docker compose down` preserves it.

## Admin editor

Open `/admin` and sign in with `ADMIN_PASSWORD` before accessing either tab. Each tab has its own address, `/admin/front` and `/admin/products`, so you can bookmark them and use the browser's back button; `/admin` and unknown `/admin/...` addresses go to `/admin/front`. The **Front page** tab edits Title, Subtitle, and Story as HTML and saves all three together. The **Products page** tab manages products (see below). Use **Sign out** to end the session.

Sessions use an HttpOnly, SameSite=Strict cookie and last eight hours. They are held in API memory, so restarting the API signs everyone out. An expired session prompts for login again and preserves the current draft. Ten failed login attempts temporarily block login from that address for five minutes. Set `NODE_ENV=production` when deploying over HTTPS so the session cookie also has the Secure flag. The public content read endpoint remains available to the homepage; all content writes require a valid session.

The title and subtitle accept inline formatting; the story also accepts paragraphs, lists, blockquotes, and headings. The server removes scripts, event handlers, styles, and unsafe links, and rejects empty or oversized fields. The editor displays the cleaned HTML after saving. The homepage loads saved content from `GET /api/front-page`; authenticated edits use `PUT /api/front-page`. There is no hardcoded homepage text fallback.

## Products

The **Products page** tab in `/admin` lists products and lets you add and edit them. Each product has a SKU (letters, numbers, dots, dashes, underscores; unique ignoring case), a title, a plain-text description, photos, and an enabled flag.

- **Photos** are uploaded one file at a time (JPEG, PNG, WebP, GIF, or AVIF, up to 10 MB, up to 10 per product). The server applies EXIF rotation, resizes to at most 800px wide (smaller images are not enlarged), and stores the result as WebP in PostgreSQL. Original files and metadata are discarded. Create the product first, then add photos.
- The **main photo** is the one marked as main; until one is marked, it is the first photo uploaded. Removing the main photo falls back to the first remaining one.
- **Order:** drag products in the list or use the up and down buttons. The order is saved immediately and is also the order on `/buy`. New products are added at the end. Existing products started in alphabetical order when migration `003` ran.
- **Price:** entered in the editor as an amount such as `12.50` (required, above zero, up to 100,000.00) and stored as whole cents. It is shown on `/buy` and on each product page; a product with no price shows none. Products created before prices existed have no price until you edit them, and can still be enabled or disabled meanwhile. The currency is the `currency` constant in `shared/products.ts` (`USD`).
- **Shipping available:** a checkbox in the editor, off by default (existing products were set to off). When on, `/buy` and the product page show "Shipping available".
- **Slug and page:** each product has its own page at `/buy/<slug>`, listing all its photos. The slug is generated from the title when the product is created (Ukrainian is transliterated to Latin, e.g. `Паляниця` becomes `palianytsia`; duplicates get `-2`, `-3`). It does not change when the title is edited, so shared links keep working. The editor shows the product's page link.
- **Disabled** products are never deleted. They are hidden from `/buy`, their own page (which shows "couldn’t find that bread"), `GET /api/products`, `GET /api/products/:slug`, and the photo endpoint for visitors, but stay visible in the admin and can be enabled again.

Public endpoints: `GET /api/products` and `GET /api/products/:slug` (enabled products only) and `GET /api/product-photos/:id`. All other product endpoints are under `/api/admin/products` and require a session.

## Build and check

```sh
bun run typecheck
bun run build
bun run test
bun run test:e2e
bun run preview
```

The browser tests use mocked API responses to check editing, tab navigation, HTML rendering, and error handling; they do not require or modify a database. If Chromium is not installed, run `bunx playwright install chromium` first.

The production frontend is generated in `dist/`, or in the folder named by `BUILD_OUT_DIR` if set. On a server, set `BUILD_OUT_DIR=/var/www/palianytsia/dist` in `.env` (and make that folder writable by the deploying user, for example `sudo chown <user> /var/www/palianytsia`) so `bun run build` publishes directly to the folder nginx serves. The folder is emptied on every build, and the build refuses a folder that is or contains the project. `preview` serves that build locally; run the API separately with `bun run start:api`. Configure the production frontend host to serve `index.html` for page routes such as `/buy`, `/buy/<slug>`, and `/admin`, forward `/api` to the Bun server, and use HTTPS for admin editing.

## Images and page content

- The header logo uses `public/uploads/paliantsia_horiz.svg`. Its responsive size is set by `.brand-logo` in `src/style.css`.
- The hero photo uses `public/uploads/hero_1600px.webp` and scales proportionally for desktop and mobile. Update the `.hero-image` element in `src/HomePage.vue` to change the photo and its alt text.
- Edit homepage copy at `/admin`; the initial content lives in `server/migrations/001_front_page_content.sql`. The homepage layout is in `src/HomePage.vue`, and the `/buy` page, which lists enabled products, is in `src/BuyPage.vue`. Routes are defined in `src/router.ts`. Colors, spacing, and responsive layout are in `src/style.css`.

The page uses Google Fonts for body text, with system fallbacks when offline. The headline uses the local Georgia serif font.

## Production nginx

`nginx/prod/palianytsia.conf` is a ready-to-install nginx site that serves the built frontend from `/home/pal/pal_website/dist` and forwards `/api/` to the API on `127.0.0.1:38417`, over plain HTTP on port 80. The installation steps are at the top of the file. It does not use HTTPS yet, so run the API without `NODE_ENV=production` until HTTPS is set up (the Secure session cookie is not stored over HTTP, which breaks admin login).
