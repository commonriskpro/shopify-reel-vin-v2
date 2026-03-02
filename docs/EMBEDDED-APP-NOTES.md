# Embedded app in Shopify Admin – notes

## WebSocket `wss://...trycloudflare.com/extensions`

If you see the browser or DevTools trying to connect to a URL like `wss://useful-robot-colin-stocks.trycloudflare.com/extensions` (or similar `*.trycloudflare.com`):

- **This does not come from the vin-decoder app.** There is no reference to that URL in this repo.
- It is opened by **Shopify Admin** (the parent frame), in code such as ExtensionServer / render-common, to load **UI extensions** for apps (e.g. admin product actions).
- The URL may come from:
  - Another app on the same store that uses a Cloudflare tunnel for development, or
  - Shopify’s dev tooling when using a tunnel for extensions.
- A failed WebSocket there can cause extension UIs to not load; it does not change the fact that the **main app iframe** (this app) is served by `vin-decoder-gold.vercel.app` and does not use that WebSocket.

To fix extension/WebSocket issues: check other installed apps’ dev URLs and any Shopify/CLI tunnel config; ensure the vin-decoder app URL in Partner Dashboard is `https://vin-decoder-gold.vercel.app` (production).
