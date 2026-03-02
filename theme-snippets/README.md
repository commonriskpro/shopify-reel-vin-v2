# Show vehicle specs on your product page

Follow these steps to show VIN Decoder vehicle details (year, make, model, engine, etc.) **inside** the product page. You only add a section—no need to edit theme code by hand.

**Product page not loading (404 or “Failed to load” in theme editor)?** Make sure at least one product is **published to the Online Store**: In Shopify admin go to **Products** → open a product → set **Status** to **Active** → under **Sales channels** ensure **Online Store** is checked and the product is **Published** (not Unpublished). The theme editor needs a valid product URL to preview the product template.

---

## Step 1: Add the section file to your theme

1. In Shopify admin, go to **Online Store** → **Themes**.
2. Click **Actions** (or the **⋯** button) on your current theme → **Edit code**.
3. In the left sidebar, under **Sections**, click **Add a new section**.
4. Name it exactly: `vehicle-specs-vin` (no spaces).
5. Click **Add section**. A new empty file opens.
6. Open the file from this app folder on your computer:
   - `theme-snippets/sections/vehicle-specs-vin.liquid`
7. **Select all** the contents of that file (Ctrl+A or Cmd+A), **copy** (Ctrl+C or Cmd+C).
8. In the theme editor, **select all** the placeholder content in the new section, **paste** (Ctrl+V or Cmd+V) to replace it.
9. Click **Save**.

---

## Step 2: Add the section to the product page

1. Go to **Online Store** → **Themes** → **Customize** (your live theme).
2. In the top dropdown, choose **Product pages** (so you’re editing the product template).
3. On the product page preview, scroll to where you want the vehicle specs (e.g. below the product description).
4. Click **Add section** (or **Add block** if you’re inside a section).
5. In the list, find **Vehicle specs (VIN)** and click it.
6. The block is added. You can:
   - Drag it up or down to change position.
   - Click it and change the **Heading** (e.g. “Vehicle details” or leave blank).
7. Click **Save** (top right).

---

## What you’ll see

- **Vehicle details** heading and **VIN** at the top.
- A **two-column grid** of specs, each with an **icon** on the left and the value on the right (like dealer listing pages):
  - **Column 1:** Year, Make, Model, Trim, Body style, Vehicle type.
  - **Column 2:** Engine, Fuel type, Drivetrain, Transmission, VIN, Manufacturer.
- In the theme customizer you can change **Icon color** (default red to match dealer-style listings).
- On products **without** VIN Decoder data, the section shows nothing (it hides automatically).

---

## Optional: snippet-only (no section)

If you prefer to use the smaller snippet file and add one line of code yourself:

- Copy `vehicle-specs-from-vin.liquid` into your theme under **Snippets**.
- In the section that outputs the product description (often `main-product.liquid` or similar), add:
  ```liquid
  {% render 'vehicle-specs-from-vin', product: product %}
  ```
- The snippet only renders when the product has VIN Decoder metafields.

---

## Vehicle title type ribbon on product cards

To show a **diagonal “Clean” ribbon** on collection/catalog product cards only when the vehicle title type is **Clean**:

1. Copy `theme-snippets/vehicle-title-ribbon.liquid` into your theme under **Snippets** (e.g. name it `vehicle-title-ribbon`).
2. In your theme, open the file that renders the **product card** (often `snippets/card-product.liquid`, `snippets/card.liquid`, or a section like `sections/main-collection-product-grid.liquid` that uses a card snippet).
3. Find the wrapper around the **product image** (the element that contains the `<img>` or the first image/link for the product). That wrapper needs `position: relative` so the ribbon can sit in the corner. If it doesn’t have it, add a class or inline style, e.g. `style="position: relative"`.
4. Inside that same wrapper (e.g. right after the opening tag or right before the image), add:
   ```liquid
   {% render 'vehicle-title-ribbon', product: product %}
   ```
   (Use the variable your theme uses for the product in the loop—often `product`, sometimes `card_product` or similar. Adjust the snippet call if needed, e.g. `product: card_product`.)
5. Save. The blue “Clean” ribbon appears in the **top-right** of the card image only when the product’s title type is set to **Clean**. Other title types (Salvage, Rebuilt, Junk) and products without a title type show no ribbon.
