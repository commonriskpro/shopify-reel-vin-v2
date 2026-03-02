# Set up collection filters (one-time)

Collection filters need the **Shopify Search & Discovery** app and filters that use the VIN Decoder metafields (and standard Price). Do this once; the VIN decoder app fills year, make, model, drivetrain, fuel type, and transmission from VIN decode. Mileage and Title brand can be set manually on products.

**Quick path:** [Search & Discovery → Filters](https://admin.shopify.com/store/speedy-motor-group-dev/apps/search-and-discovery/filters) → **Add filter** for each row below → Product metafield (or **Price** for price).

### Optional: run script to add filters

From the repo, with Chrome installed:

```bash
cd ide-browser-mcp && node scripts/add-search-discovery-filters.mjs
```

- First run: the browser may show the Shopify login page → log in, then run the same command again.
- Second run (or if already logged in): the script adds the three filters automatically.
- Session is stored in `ide-browser-mcp/.playwright-shopify-profile` so you usually only log in once.

**If you see “This browser or app may not be secure” from Google:** Google often blocks sign-in in automated browsers. In that case, add the three filters manually (takes about a minute) using the steps in “Step 3” below.

## Step 1: Install Search & Discovery

1. Open: **https://admin.shopify.com/store/speedy-motor-group-dev/apps/search-and-discovery**
2. Click **Install** on the Search & Discovery card.
3. Complete the install if prompted.

## Step 2: Open Filters

1. In the left sidebar, click **Filters** (or open **https://admin.shopify.com/store/speedy-motor-group-dev/apps/search-and-discovery/filters**).

## Step 3: Add filters

Add a filter for each row below. For each one:

- Click **Add filter**.
- Click **Select source** → choose **Product metafield** and pick the metafield in the table (or **Price** for the price filter).
- Set the **Filter label** (e.g. **YEAR**, **MAKE**, **PRICE**).
- Click **Save**.

| Label        | Source            | Metafield to select |
|-------------|-------------------|----------------------|
| **YEAR**    | Product metafield | Vehicle year         |
| **MAKE**    | Product metafield | Vehicle make         |
| **MODEL**   | Product metafield | Vehicle model        |
| **MILEAGE** | Product metafield | Mileage              |
| **DRIVETRAIN** | Product metafield | Drivetrain        |
| **FUEL TYPE**  | Product metafield | Fuel type         |
| **TITLE BRAND** | Product metafield | Title brand       |
| **PRICE**   | Price             | (standard – no metafield) |
| **TRANSMISSION** | Product metafield | Transmission     |

**If the metafields don’t show in the Product metafield list:**  
The VIN Decoder app creates these metafield definitions when it loads. Do this first:

1. In Shopify admin go to **Apps → vin-decoder** and open the app (any page, e.g. the main VIN Decoder screen).
2. Wait a few seconds for the app to load (it registers Vehicle year, Vehicle make, Vehicle model, Mileage, Drivetrain, Fuel type, Title brand, Transmission in the background).
3. Go back to **Search & Discovery → Filters** and click **Add filter** → **Select source**. You should now see those metafields under Product metafield. If not, refresh the Filters page and try again.

## Step 4: Existing products

Products that were decoded **before** the app wrote year/make/model need to be updated once: open each product, run **Decode VIN** (action or app), and **Apply to product**. New decodes will fill the filters automatically.

## Direct links (after you’re logged in)

- Search & Discovery app: https://admin.shopify.com/store/speedy-motor-group-dev/apps/search-and-discovery  
- Content → Menus (sometimes filters live here): https://admin.shopify.com/store/speedy-motor-group-dev/menus  
