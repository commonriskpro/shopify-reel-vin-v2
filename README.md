# Reel VIN v2 – Shopify App

Shopify app (React Router) with **VIN decoding** (NHTSA VPIC), **product metafields**, **Admin Action** extension, and optional **Shoppable Instagram Reels** via a separate Vercel API. Session storage uses **PostgreSQL** (Supabase) with **Prisma**.

---

## Important: What the app needs to run

### One session table only

The app stores Shopify sessions in **one** PostgreSQL table: **`Session`** (PascalCase). It is defined in `prisma/schema.prisma` and used by `@shopify/shopify-app-session-storage-prisma`. There is no separate `session` (lowercase) table. If your database was created from an older migration that had both `session` and `Session`, run the Supabase migrations so that the duplicate `session` table is dropped (see [Database (Supabase)](#database-supabase) below).

### Main app (Shopify admin) – environment variables

Set these where the main app runs (e.g. Vercel or `.env` for local):

| Variable | Required | Description |
|----------|----------|-------------|
| `SHOPIFY_API_KEY` | Yes | Shopify app **Client ID** (e.g. from Partners dashboard or `shopify.app.toml` `client_id`). |
| `SHOPIFY_API_SECRET` | Yes | Shopify app **Client secret**. |
| `SCOPES` | Yes | Comma-separated scopes (e.g. `read_inventory,read_locations,write_inventory,write_products`). Must match `shopify.app.toml` `scopes`. |
| `SHOPIFY_APP_URL` | Yes | Full app URL (e.g. `https://your-app.vercel.app`). No trailing slash. |
| `DATABASE_URL` | Yes | PostgreSQL connection string. For Supabase: use **pooler** (port **6543**) with `?pgbouncer=true` for runtime. |
| `DIRECT_URL` | Yes | Direct Postgres URL (port **5432**) for migrations. Use same Supabase project; required for `prisma migrate deploy`. |
| `REELS_API_URL` | No | Base URL of the Reels API (e.g. `https://instagram-reels-api-xxx.vercel.app`) for Shoppable Reels. |
| `REELS_ADMIN_SECRET` | No | Secret for Reels API add/remove product calls; set same value in Reels API project. |
| `SHOP_CUSTOM_DOMAIN` | No | Custom shop domain if different from `*.myshopify.com`. |

### Instagram Reels API – environment variables

For the optional Reels API (`instagram-reels-api/`), see [instagram-reels-api/README.md](instagram-reels-api/README.md). Summary:

| Variable | Required | Description |
|----------|----------|-------------|
| `INSTAGRAM_ACCESS_TOKEN` | Yes | Long-lived Instagram token. |
| `INSTAGRAM_USER_ID` | Yes | Instagram user ID. |
| `SUPABASE_URL` | Yes | Supabase project URL. |
| `SUPABASE_ANON_KEY` | Yes | Supabase anon key. |
| `SUPABASE_SERVICE_KEY` | Yes | Supabase service_role key. |
| `CRON_SECRET` | Recommended | Secret for Vercel Cron (sync / token refresh). |
| `REELS_ADMIN_SECRET` | Optional | Same as main app for add/remove product links. |
| `SHOPIFY_STORE_DOMAIN` | Yes for media | e.g. `your-store.myshopify.com`. |
| `SHOPIFY_ADMIN_ACCESS_TOKEN` | Yes for media | Admin API token for uploading reel media to Shopify. |

### Shopify app configuration

- **App URLs**: `shopify.app.toml` must match your host. Example: `application_url = "https://speedy-motor-vin-cloud.vercel.app"`, `redirect_urls = [ "https://speedy-motor-vin-cloud.vercel.app/auth/callback" ]`.
- **Client ID**: Same as `SHOPIFY_API_KEY` (e.g. `254cac4fc6295b38a889f875fc8ee8e9` for reel-vin-v2).
- **Scopes**: Must match `SCOPES` env (e.g. `read_inventory,read_locations,write_inventory,write_products`).

### Database (Supabase)

**Current project:** `ztjxsssrbmftxshidcfq` — [Dashboard](https://supabase.com/dashboard/project/ztjxsssrbmftxshidcfq). Both the main app and the Reels API use this project. See [docs/SUPABASE-AND-VERCEL-ENV.md](docs/SUPABASE-AND-VERCEL-ENV.md) for connection strings and Vercel env.

The app expects:

1. **One session table**: **`Session`** (PascalCase), with columns matching `prisma/schema.prisma` (id, shop, state, isOnline, scope, expires, accessToken, userId, firstName, lastName, email, accountOwner, locale, collaborator, emailVerified, refreshToken, refreshTokenExpires). Create it either by:
   - Running **Prisma migrations** from the app repo: `npx prisma migrate deploy` (uses `DIRECT_URL`), or
   - Running the **Supabase migrations** in `supabase/migrations/` (they create `Session` and the Reels tables and drop any old duplicate `session` table).
2. **Reels API tables** (if using Shoppable Reels): `reels`, `reel_products`, `app_config` — created by the same Supabase migrations.

**Connection strings:**

- **Runtime** (`DATABASE_URL`): Use Supabase **Connection pooling** (Transaction mode), port **6543**, and add `?pgbouncer=true` to the URL.
- **Migrations** (`DIRECT_URL`): Use **Direct connection**, port **5432**, with `sslmode=require`.

### Vercel (main app)

- **Build**: `npx prisma generate && npm run build` (see `vercel.json`).
- **Framework**: Set to **React Router** (in `vercel.json`: `"framework": "react-router"`).
- Set all main-app env vars above in the Vercel project (Production/Preview as needed).

---

## Template overview (React Router)

This project is based on the [Shopify React Router app template](https://github.com/Shopify/shopify-app-template-react-router). It was forked from the Remix app template and converted to React Router.

Visit the [`shopify.dev` documentation](https://shopify.dev/docs/api/shopify-app-react-router) for more details on the React Router app package.

## Upgrading from Remix

If you have an existing Remix app that you want to upgrade to React Router, please follow the [upgrade guide](https://github.com/Shopify/shopify-app-template-react-router/wiki/Upgrading-from-Remix). Otherwise, please follow the quick start guide below.

## Quick start

### Prerequisites

Before you begin, you'll need to [download and install the Shopify CLI](https://shopify.dev/docs/apps/tools/cli/getting-started) if you haven't already.

### Setup

```shell
shopify app init --template=https://github.com/Shopify/shopify-app-template-react-router
```

### Local Development

```shell
shopify app dev
```

Press P to open the URL to your app. Once you click install, you can start development.

**If you see `prepared statement "s0" already exists` or `MissingSessionTableError`:** Your `DATABASE_URL` is using Supabase’s pooler (port 6543 with `?pgbouncer=true`). For local dev, use the direct Postgres URL so the app doesn’t go through PgBouncer. In `.env`, temporarily set:

```env
DATABASE_URL="postgresql://...same as DIRECT_URL..."
```

(i.e. use the same value as `DIRECT_URL`: host, port **5432**, no `?pgbouncer=true`). Keep `DIRECT_URL` unchanged. Then run `shopify app dev` again. Use the pooled `DATABASE_URL` (port 6543, `?pgbouncer=true`) in production (e.g. Vercel).

Local development is powered by [the Shopify CLI](https://shopify.dev/docs/apps/tools/cli). It logs into your account, connects to an app, provides environment variables, updates remote config, creates a tunnel and provides commands to generate extensions.

### Authenticating and querying data

To authenticate and query data you can use the `shopify` const that is exported from `/app/shopify.server.js`:

```js
export async function loader({ request }) {
  const { admin } = await shopify.authenticate.admin(request);

  const response = await admin.graphql(`
    {
      products(first: 25) {
        nodes {
          title
          description
        }
      }
    }`);

  const {
    data: {
      products: { nodes },
    },
  } = await response.json();

  return nodes;
}
```

This template comes pre-configured with examples of:

1. Setting up your Shopify app in [/app/shopify.server.ts](https://github.com/Shopify/shopify-app-template-react-router/blob/main/app/shopify.server.ts)
2. Querying data using Graphql. Please see: [/app/routes/app.\_index.tsx](https://github.com/Shopify/shopify-app-template-react-router/blob/main/app/routes/app._index.tsx).
3. Responding to webhooks. Please see [/app/routes/webhooks.tsx](https://github.com/Shopify/shopify-app-template-react-router/blob/main/app/routes/webhooks.app.uninstalled.tsx).

Please read the [documentation for @shopify/shopify-app-react-router](https://shopify.dev/docs/api/shopify-app-react-router) to see what other API's are available.

## Shopify Dev MCP

This template is configured with the Shopify Dev MCP. This instructs [Cursor](https://cursor.com/), [GitHub Copilot](https://github.com/features/copilot) and [Claude Code](https://claude.com/product/claude-code) and [Google Gemini CLI](https://github.com/google-gemini/gemini-cli) to use the Shopify Dev MCP.

For more information on the Shopify Dev MCP please read [the documentation](https://shopify.dev/docs/apps/build/devmcp).

## VIN Decoder – Product fields

The app creates a product metafield **Title** (vehicle title type) with options: **Salvage**, **Clean**, **Rebuilt**, **Junk**. The app tries to **pin** this definition so it appears on the Add product / Edit product page automatically. If you don’t see the **Title** dropdown:

1. In Shopify Admin go to **Settings** → **Custom data** (or **Metafields and metaobjects**).
2. Open **Products**.
3. Find the **Title** metafield (namespace: `vin_decoder`, key: `title_status`).
4. Click the **pin** icon (📌) so it’s pinned. Pinned metafields show on the product form; you can reorder them by drag-and-drop.

After pinning, the **Title** dropdown appears when you add or edit a product. The value is stored in `product.metafields.vin_decoder.title_status` for use in your theme or app (e.g. filters, badges).

## Vehicle hold ($1,000 / 3 days)

The theme includes a **Hold for $1,000 (3 days)** button on product pages. The customer pays $1,000 through normal Shopify checkout; the order includes line item properties **Vehicle** and **VIN** so you know which vehicle is held.

**Setup:**

1. In Shopify Admin, **Products** → **Add product**. Create a product e.g. **"Vehicle hold – $1,000 (3 days)"**, price **$1,000**. Save.
2. Open that product → click the (only) variant to edit it. In the browser URL you’ll see `.../variants/12345678901234` (a long number). That number is the **variant ID**. Copy it.
3. **Online Store** → **Themes** → **Customize** → open a **product** page. In the main product section, find the block **"Vehicle hold ($1,000 / 3 days)"** and paste the variant ID into **Hold product variant ID**. Save.

The button then adds that $1,000 product to the cart with the current vehicle’s title and VIN, and the customer checks out as usual. You enforce the 3-day hold in your process; the note under the button can say it’s applied to purchase.

## Inventory filters (collection page)

The collection (inventory) page uses a **vertical filter** sidebar styled as a "FILTERS" panel. **Year**, **Make**, and **Model** are **auto-filled by the VIN Decoder app**: when you decode a VIN and apply to a product (admin product page or app flow), the app writes `vin_decoder.year`, `vin_decoder.make`, and `vin_decoder.model` so storefront filters can use them.

**One-time setup:** In Shopify admin go to **Settings** → **Online store** → **Product filters** and add filters for the VIN Decoder metafields: **Vehicle year** (`vin_decoder.year`), **Vehicle make** (`vin_decoder.make`), **Vehicle model** (`vin_decoder.model`). Use labels like "YEAR", "MAKE", "MODEL". After that, any product updated by the VIN decoder will show in those filters. For products that were decoded before this change, open each product, run the VIN decoder action again, and apply to product to backfill year/make/model.

## Shoppable Reels (in-app UI)

The app includes a **Shoppable Reels** page (nav: **Shoppable Reels**) where you can link products to Instagram Reels. Reels are synced by the [Instagram Reels API](instagram-reels-api/README.md) (Vercel); the app calls that API to add/remove product links.

**App environment variables** (e.g. in `.env` or your host’s env):

| Variable | Description |
|----------|-------------|
| `REELS_API_URL` | Base URL of the Reels API (e.g. `https://instagram-reels-api-mu.vercel.app`). If unset, the Shoppable Reels page shows a setup warning. |
| `REELS_ADMIN_SECRET` | Secret used to authorize add/remove product requests to `/api/reel-products`. Set the **same value** in the Vercel project (see `instagram-reels-api` README). If unset, the page can list reels but add/remove will fail. |

After setting both, open **Shoppable Reels** in the app to manage which products appear under “Shop the reel” for each reel on the storefront.

## Deployment

### Application Storage

This template uses [Prisma](https://www.prisma.io/) to store session data, by default using an [SQLite](https://www.sqlite.org/index.html) database.
The database is defined as a Prisma schema in `prisma/schema.prisma`.

This use of SQLite works in production if your app runs as a single instance.
The database that works best for you depends on the data your app needs and how it is queried.
Here’s a short list of databases providers that provide a free tier to get started:

| Database   | Type             | Hosters                                                                                                                                                                                                                                    |
| ---------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| MySQL      | SQL              | [Digital Ocean](https://www.digitalocean.com/products/managed-databases-mysql), [Planet Scale](https://planetscale.com/), [Amazon Aurora](https://aws.amazon.com/rds/aurora/), [Google Cloud SQL](https://cloud.google.com/sql/docs/mysql) |
| PostgreSQL | SQL              | [Digital Ocean](https://www.digitalocean.com/products/managed-databases-postgresql), [Amazon Aurora](https://aws.amazon.com/rds/aurora/), [Google Cloud SQL](https://cloud.google.com/sql/docs/postgres)                                   |
| Redis      | Key-value        | [Digital Ocean](https://www.digitalocean.com/products/managed-databases-redis), [Amazon MemoryDB](https://aws.amazon.com/memorydb/)                                                                                                        |
| MongoDB    | NoSQL / Document | [Digital Ocean](https://www.digitalocean.com/products/managed-databases-mongodb), [MongoDB Atlas](https://www.mongodb.com/atlas/database)                                                                                                  |

To use one of these, you can use a different [datasource provider](https://www.prisma.io/docs/reference/api-reference/prisma-schema-reference#datasource) in your `schema.prisma` file, or a different [SessionStorage adapter package](https://github.com/Shopify/shopify-api-js/blob/main/packages/shopify-api/docs/guides/session-storage.md).

### Build

Build the app by running the command below with the package manager of your choice:

Using yarn:

```shell
yarn build
```

Using npm:

```shell
npm run build
```

Using pnpm:

```shell
pnpm run build
```

## Hosting

When you're ready to set up your app in production, you can follow [our deployment documentation](https://shopify.dev/docs/apps/launch/deployment) to host it externally. From there, you have a few options:

- [Google Cloud Run](https://shopify.dev/docs/apps/launch/deployment/deploy-to-google-cloud-run): This tutorial is written specifically for this example repo, and is compatible with the extended steps included in the subsequent [**Build your app**](tutorial) in the **Getting started** docs. It is the most detailed tutorial for taking a React Router-based Shopify app and deploying it to production. It includes configuring permissions and secrets, setting up a production database, and even hosting your apps behind a load balancer across multiple regions.
- [Fly.io](https://fly.io/docs/js/shopify/): Leverages the Fly.io CLI to quickly launch Shopify apps to a single machine.
- [Render](https://render.com/docs/deploy-shopify-app): This tutorial guides you through using Docker to deploy and install apps on a Dev store.
- [Manual deployment guide](https://shopify.dev/docs/apps/launch/deployment/deploy-to-hosting-service): This resource provides general guidance on the requirements of deployment including environment variables, secrets, and persistent data.

When you reach the step for [setting up environment variables](https://shopify.dev/docs/apps/deployment/web#set-env-vars), you also need to set the variable `NODE_ENV=production`.

## Gotchas / Troubleshooting

### Database tables don't exist / Session table

If you get an error like:

```
The table `main.Session` does not exist in the current database.
```
or **MissingSessionTableError** / **Unexpected Server Error** in Shopify admin:

1. The app uses **one** table only: **`Session`** (PascalCase), defined in `prisma/schema.prisma`. There is no `session` (lowercase) table.
2. Create the table by running **Prisma migrations**: `npx prisma migrate deploy` (ensure `DIRECT_URL` is set to your Postgres direct connection, port 5432).
3. If you use Supabase, you can instead run the SQL in `supabase/migrations/` (in order). The migration `20260227000000_drop_duplicate_session_table.sql` removes any old duplicate lowercase `session` table; only `Session` should remain.
4. In production (e.g. Vercel), use **pooled** `DATABASE_URL` (port 6543, `?pgbouncer=true`). For local dev, if you see prepared-statement errors, temporarily set `DATABASE_URL` to the same value as `DIRECT_URL` (direct connection, port 5432).

Alternatively, run the standalone SQL in `prisma/create-session-table.sql` in your database to create the `Session` table if you are not using Prisma migrations.

### Navigating/redirecting breaks an embedded app

Embedded apps must maintain the user session, which can be tricky inside an iFrame. To avoid issues:

1. Use `Link` from `react-router` or `@shopify/polaris`. Do not use `<a>`.
2. Use `redirect` returned from `authenticate.admin`. Do not use `redirect` from `react-router`
3. Use `useSubmit` from `react-router`.

This only applies if your app is embedded, which it will be by default.

### Webhooks: shop-specific webhook subscriptions aren't updated

If you are registering webhooks in the `afterAuth` hook, using `shopify.registerWebhooks`, you may find that your subscriptions aren't being updated.

Instead of using the `afterAuth` hook declare app-specific webhooks in the `shopify.app.toml` file. This approach is easier since Shopify will automatically sync changes every time you run `deploy` (e.g: `npm run deploy`). Please read these guides to understand more:

1. [app-specific vs shop-specific webhooks](https://shopify.dev/docs/apps/build/webhooks/subscribe#app-specific-subscriptions)
2. [Create a subscription tutorial](https://shopify.dev/docs/apps/build/webhooks/subscribe/get-started?deliveryMethod=https)

If you do need shop-specific webhooks, keep in mind that the package calls `afterAuth` in 2 scenarios:

- After installing the app
- When an access token expires

During normal development, the app won't need to re-authenticate most of the time, so shop-specific subscriptions aren't updated. To force your app to update the subscriptions, uninstall and reinstall the app. Revisiting the app will call the `afterAuth` hook.

### Webhooks: Admin created webhook failing HMAC validation

Webhooks subscriptions created in the [Shopify admin](https://help.shopify.com/en/manual/orders/notifications/webhooks) will fail HMAC validation. This is because the webhook payload is not signed with your app's secret key.

The recommended solution is to use [app-specific webhooks](https://shopify.dev/docs/apps/build/webhooks/subscribe#app-specific-subscriptions) defined in your toml file instead. Test your webhooks by triggering events manually in the Shopify admin(e.g. Updating the product title to trigger a `PRODUCTS_UPDATE`).

### Webhooks: Admin object undefined on webhook events triggered by the CLI

When you trigger a webhook event using the Shopify CLI, the `admin` object will be `undefined`. This is because the CLI triggers an event with a valid, but non-existent, shop. The `admin` object is only available when the webhook is triggered by a shop that has installed the app. This is expected.

Webhooks triggered by the CLI are intended for initial experimentation testing of your webhook configuration. For more information on how to test your webhooks, see the [Shopify CLI documentation](https://shopify.dev/docs/apps/tools/cli/commands#webhook-trigger).

### Incorrect GraphQL Hints

By default the [graphql.vscode-graphql](https://marketplace.visualstudio.com/items?itemName=GraphQL.vscode-graphql) extension for will assume that GraphQL queries or mutations are for the [Shopify Admin API](https://shopify.dev/docs/api/admin). This is a sensible default, but it may not be true if:

1. You use another Shopify API such as the storefront API.
2. You use a third party GraphQL API.

If so, please update [.graphqlrc.ts](https://github.com/Shopify/shopify-app-template-react-router/blob/main/.graphqlrc.ts).

### Using Defer & await for streaming responses

By default the CLI uses a cloudflare tunnel. Unfortunately cloudflare tunnels wait for the Response stream to finish, then sends one chunk. This will not affect production.

To test [streaming using await](https://reactrouter.com/api/components/Await#await) during local development we recommend [localhost based development](https://shopify.dev/docs/apps/build/cli-for-apps/networking-options#localhost-based-development).

### "nbf" claim timestamp check failed

This is because a JWT token is expired. If you are consistently getting this error, it could be that the clock on your machine is not in sync with the server. To fix this ensure you have enabled "Set time and date automatically" in the "Date and Time" settings on your computer.

### Using MongoDB and Prisma

If you choose to use MongoDB with Prisma, there are some gotchas in Prisma's MongoDB support to be aware of. Please see the [Prisma SessionStorage README](https://www.npmjs.com/package/@shopify/shopify-app-session-storage-prisma#mongodb).

### Unable to require(`C:\...\query_engine-windows.dll.node`).

Unable to require(`C:\...\query_engine-windows.dll.node`).
The Prisma engines do not seem to be compatible with your system.

query_engine-windows.dll.node is not a valid Win32 application.

**Fix:** Set the environment variable:

```shell
PRISMA_CLIENT_ENGINE_TYPE=binary
```

This forces Prisma to use the binary engine mode, which runs the query engine as a separate process and can work via emulation on Windows ARM64.

## Resources

React Router:

- [React Router docs](https://reactrouter.com/home)

Shopify:

- [Intro to Shopify apps](https://shopify.dev/docs/apps/getting-started)
- [Shopify App React Router docs](https://shopify.dev/docs/api/shopify-app-react-router)
- [Shopify CLI](https://shopify.dev/docs/apps/tools/cli)
- [Shopify App Bridge](https://shopify.dev/docs/api/app-bridge-library).
- [Polaris Web Components](https://shopify.dev/docs/api/app-home/polaris-web-components).
- [App extensions](https://shopify.dev/docs/apps/app-extensions/list)
- [Shopify Functions](https://shopify.dev/docs/api/functions)

### Instagram Shoppable Reels (optional)

The repo includes a **Vercel serverless API** (`instagram-reels-api/`) that syncs Instagram Reels to Supabase and a **theme section** (“Shoppable Reels”) that displays them with product links. See [`instagram-reels-api/README.md`](instagram-reels-api/README.md) for setup (Supabase, Instagram token, Vercel env). Add the section in the theme editor and set the Reels API URL to your deployed `/api/reels` endpoint.

Internationalization:

- [Internationalizing your app](https://shopify.dev/docs/apps/best-practices/internationalization/getting-started)
