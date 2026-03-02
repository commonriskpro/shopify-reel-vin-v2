# Backup – Latest Working Version

**Date:** 2026-02-19  
**Status:** READ-ONLY reference. Do not delete.

This commit is the **latest working version**: Shoppable Reels, Reserve, ON HOLD badge, cart conversion UI, 4:5 thumbnails, "Actions" column, thumbnail fallback.

## What's included

- **Shoppable Reels:** Modal arrows outside modal, reel flush left, Reserve button (add hold to cart with Vehicle/VIN).
- **Theme:** Reserve on collection cards; Vehicle hold product hidden from collection/search/recommendations; Reserve variant ID 48137403236504 default.
- **Cart:** One reserve per vehicle; ON HOLD label when product has tag `on-hold`; hold quantity hidden (no selector), max 1 enforced; conversion UI (order summary panel, Your total, Secure checkout, Complete purchase); 4:5 thumbnail aspect ratio; product thumbnail fallback (featured image); "Actions" column label.

## How to restore or reference

- **Tag (latest):** `v1.3-cart-ui-2026-02-19`  
  ```bash
  git checkout v1.3-cart-ui-2026-02-19
  ```
- **Zip (latest):** `backups/theme-backup-2026-02-19_1423.zip`
- **Tag (pre–cart UI conversion backup):** `v1.2-pre-cart-conversion-2026-02-17`  
  ```bash
  git checkout v1.2-pre-cart-conversion-2026-02-17
  ```
- **Zip (pre–cart UI conversion):** `backups/theme-backup-2026-02-17_pre-cart-conversion.zip` (before psychology/conversion cart changes).
- **Tag (earlier):** `v1.1-reserve-and-hold-2026-02-17`  
  ```bash
  git checkout v1.1-reserve-and-hold-2026-02-17
  ```
- **Zip (earlier):** `backups/theme-backup-2026-02-19_1304.zip` (theme folder snapshot).
- **Previous tag:** `v1.0-working-reels-2026-02-17`  
  ```bash
  git checkout v1.0-working-reels-2026-02-17
  ```

Do not force-push or overwrite these tags.
