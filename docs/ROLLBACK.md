# Rollback coordinates

Use these to restore the app to a known good state if something breaks after a deploy or change.

---

## Quick reference (save in memory)

| What | Value |
|------|--------|
| **Backup repo** | https://github.com/cdgc1215-pixel/shopify-reel-v2 |
| **Pre-polish tag** | `backup-pre-polish-20250220` |
| **Main app URL** | https://speedy-motor-vin-cloud.vercel.app |
| **Reels API URL** | https://speedy-motor-reels-api-cloud.vercel.app |
| **Restore remote** | `backup-origin` |

---

## Backup repo and tag (pre-polish)

- **Repo:** https://github.com/cdgc1215-pixel/shopify-reel-v2  
- **Tag:** `backup-pre-polish-20250220`  
- **Restore steps:**  
  ```bash
  git fetch backup-origin tag backup-pre-polish-20250220
  git checkout backup-pre-polish-20250220
  ```
  Or create a branch from that tag and redeploy to Vercel.

## Production URLs

- **Main app:** https://speedy-motor-vin-cloud.vercel.app  
- **Reels API:** https://speedy-motor-reels-api-cloud.vercel.app  

To rollback on Vercel: use the Vercel dashboard to redeploy a previous deployment, or push the commit you want (e.g. from the tag above) and trigger a new production deploy.

## Current main (post-polish)

- **Commit:** `1a629fc` — Full UX polish: admin design foundation, toasts, empty state, theme motion and reduced-motion  
- **Doc commit:** `d72ed83` — Add rollback coordinates doc  
- **Pushed to:** `origin` (shopify-reel-vin-v2) and `backup-origin` (shopify-reel-v2)

The backup tag `backup-pre-polish-20250220` points to the last commit **before** that polish.
