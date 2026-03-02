import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { LRUCache } from 'lru-cache';

const NHTSA_BASE = 'https://vpic.nhtsa.dot.gov/api';
const VIN_LENGTH = 17;

// Cache configuration for extension
const vinCache = new LRUCache({
  max: 500, // Cache 500 most recent VINs in extension
  ttl: 1000 * 60 * 60 * 24, // 24 hour TTL
  allowStale: false,
  updateAgeOnGet: true,
});

async function decodeVin(vin) {
  const v = String(vin).trim().toUpperCase();
  if (v.length < 8) throw new Error('VIN must be at least 8 characters');
  
  // Check cache first
  const cached = vinCache.get(v);
  if (cached) {
    console.log('[Extension VIN Cache] Cache hit for VIN:', v);
    return cached;
  }
  
  console.log('[Extension VIN Cache] Cache miss for VIN:', v);
  
  // Add timeout and retry logic for API calls
  const fetchWithTimeout = async (url, options = {}, timeout = 10000) => {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    
    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal
      });
      clearTimeout(id);
      return response;
    } catch (error) {
      clearTimeout(id);
      throw error;
    }
  };
  
  // Try the API call with retries
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      console.log(`[Extension VIN Cache] API attempt ${attempt} for VIN:`, v);
      const res = await fetchWithTimeout(
        `${NHTSA_BASE}/vehicles/DecodeVinValues/${encodeURIComponent(v)}?format=json`,
        { headers: { Accept: 'application/json' } },
        10000 // 10 second timeout
      );
      
      if (!res.ok) throw new Error(`Decode failed: ${res.status}`);
      
      const data = await res.json();
      if (!data.Results?.[0]) throw new Error('No results for this VIN');
      
      const raw = data.Results[0];
      const result = {
        vin: raw.VIN || v,
        year: raw.ModelYear || '',
        make: raw.Make || '',
        manufacturer: raw.Manufacturer || '',
        model: raw.Model || '',
        series: raw.Series || '',
        trim: raw.Trim || raw.Trim2 || '',
        bodyClass: raw.BodyClass || '',
        vehicleType: raw.VehicleType || '',
        engineCylinders: raw.EngineCylinders || '',
        displacementL: raw.DisplacementL || '',
        fuelTypePrimary: raw.FuelTypePrimary || '',
        driveType: raw.DriveType || '',
        transmissionStyle: raw.TransmissionStyle || '',
        errorText: raw.ErrorText || '',
      };
      
      vinCache.set(v, result);
      return result;
      
    } catch (error) {
      lastError = error;
      if (attempt < 3) {
        // Wait before retrying (exponential backoff)
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
        console.log(`[Extension VIN Cache] Attempt ${attempt} failed, retrying in ${delay}ms:`, error.message);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  // If we get here, all attempts failed
  throw lastError || new Error('Failed to decode VIN after 3 attempts');
}

function buildTitle(d) {
  return [d.year, d.make, d.model, d.trim].filter(Boolean).join(' ').trim() || d.vehicleType || 'Vehicle';
}

function escapeHtml(s) {
  if (s == null || typeof s !== 'string') return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function shortVehicleType(bodyClass, vehicleType) {
  const raw = `${bodyClass || ''} ${vehicleType || ''}`.toLowerCase();
  if (raw.includes('suv') || raw.includes('sport utility') || raw.includes('multipurpose') || raw.includes('mpv')) return 'SUV';
  if (raw.includes('truck') || raw.includes('pickup')) return 'Truck';
  if (raw.includes('van')) return 'Van';
  if (raw.includes('coupe')) return 'Coupe';
  if (raw.includes('sedan') || raw.includes('saloon') || raw.includes('passenger car')) return 'Sedan';
  if (raw.includes('hatchback')) return 'Hatchback';
  if (raw.includes('convertible')) return 'Convertible';
  if (raw.includes('wagon')) return 'Wagon';
  return '';
}

/** Same Speedy Motor Group description template as app (vin-decode.server.js) */
function buildDescription(d, vinValue) {
  const v = (vinValue || d.vin || '').trim().toUpperCase();
  const y = escapeHtml(String(d.year || '').trim());
  const make = escapeHtml(String(d.make || '').trim());
  const model = escapeHtml(String(d.model || '').trim());
  const trim = escapeHtml(String(d.trim || '').trim());
  const driveType = escapeHtml(String(d.driveType || '').trim());
  const vinEsc = escapeHtml(v);
  const vehicleTypeShort = shortVehicleType(d.bodyClass, d.vehicleType);

  const line1Parts = [y, make, model].filter(Boolean).join(' ');
  const dashParts = [trim, vehicleTypeShort].filter(Boolean).join(' ');
  const line1 = [line1Parts, dashParts, driveType, vinEsc].filter(Boolean).join(' - ');

  const parts = [];
  if (line1) parts.push(`<p>${line1}</p>`);
  parts.push('<p>This vehicle is being sold - As Is, Cash Only, Salvage Title, Airbags Deployed</p>');
  parts.push('<p>Call, Text or WhatsApp available 24/7 - 7865782276</p>');
  parts.push('<p>Speedy Motor Group - We are the leader in Damaged &amp; Repairable Vehicles in the USA - We offer Shipping National &amp; Worldwide!</p>');
  parts.push('<p>7103 NW 61st ST, Miami, FL 33166</p>');
  parts.push('<p>📞 7️⃣8️⃣6️⃣5️⃣7️⃣8️⃣2️⃣2️⃣7️⃣6️⃣</p>');
  return parts.join('\n');
}

/** Normalized: same as app – always "Vehicles" */
function buildProductType() {
  return 'Vehicles';
}

function buildTags(d) {
  const tags = [];
  if (d.year) tags.push(String(d.year));
  if (d.make) tags.push(d.make);
  if (d.model) tags.push(d.model);
  if (d.trim) tags.push(d.trim);
  if (d.fuelTypePrimary) tags.push(d.fuelTypePrimary);
  if (d.driveType) tags.push(d.driveType);
  if (d.bodyClass) tags.push(d.bodyClass);
  if (d.vehicleType) tags.push(d.vehicleType);
  return [...new Set(tags)].filter(Boolean).slice(0, 20);
}

export default async () => {
  render(<Extension />, document.body);
};

function Extension() {
  const { i18n, close, data, extension: { target } } = shopify;
  const [vin, setVin] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [decoded, setDecoded] = useState(null);
  const [productTitle, setProductTitle] = useState('');
  const [productId, setProductId] = useState(null);

  useEffect(() => {
    (async function getProductInfo() {
      if (!data?.selected?.[0]?.id) return;
      const id = data.selected[0].id;
      setProductId(id);
      const q = {
        query: `query Product($id: ID!) { product(id: $id) { id title } }`,
        variables: { id },
      };
      const res = await fetch('shopify:admin/api/graphql.json', {
        method: 'POST',
        body: JSON.stringify(q),
      });
      if (!res.ok) return;
      const json = await res.json();
      if (json.data?.product) {
        setProductTitle(json.data.product.title);
      }
    })();
  }, [data?.selected]);

  const handleDecode = async () => {
    setError('');
    setDecoded(null);
    setLoading(true);
    try {
      const d = await decodeVin(vin);
      setDecoded(d);
    } catch (e) {
      setError(e.message || 'Failed to decode VIN');
    } finally {
      setLoading(false);
    }
  };

  const handleApplyToProduct = async () => {
    if (!decoded || !productId) return;
    setLoading(true);
    const title = buildTitle(decoded);
    const descriptionHtml = buildDescription(decoded, vin.trim().toUpperCase());
    const productType = buildProductType(decoded);
    const tags = buildTags(decoded);
    const vinValue = vin.trim().toUpperCase();
    const decodedWithVin = { ...decoded, vin: vinValue };
    const metafieldsPayload = [
      { namespace: 'vin_decoder', key: 'vin', type: 'single_line_text_field', value: vinValue },
      { namespace: 'vin_decoder', key: 'decoded', type: 'json', value: JSON.stringify(decodedWithVin) },
      { namespace: 'vin_decoder', key: 'year', type: 'single_line_text_field', value: decoded.year ? String(decoded.year) : '' },
      { namespace: 'vin_decoder', key: 'make', type: 'single_line_text_field', value: decoded.make || '' },
      { namespace: 'vin_decoder', key: 'model', type: 'single_line_text_field', value: decoded.model || '' },
      { namespace: 'vin_decoder', key: 'drivetrain', type: 'single_line_text_field', value: decoded.driveType || '' },
      { namespace: 'vin_decoder', key: 'fuel_type', type: 'single_line_text_field', value: decoded.fuelTypePrimary || '' },
      { namespace: 'vin_decoder', key: 'transmission', type: 'single_line_text_field', value: decoded.transmissionStyle || '' },
    ];
      // Simple cache for taxonomy query (lasts for the session)
  let vehiclesCategoryId = null;
  if (typeof window !== 'undefined' && window.__vehiclesCategoryCache) {
    vehiclesCategoryId = window.__vehiclesCategoryCache;
  } else {
    try {
      const taxRes = await fetch('shopify:admin/api/graphql.json', {
        method: 'POST',
        body: JSON.stringify({
          query: `query getVehiclesCategory {
            taxonomy {
              categories(first: 30, search: "Vehicles") {
                nodes { id name fullName }
              }
            }
          }`,
        }),
      });
      const taxJson = await taxRes.json();
      const nodes = taxJson?.data?.taxonomy?.categories?.nodes ?? [];
      const vehicles = nodes.find((n) => n?.name === 'Vehicles' || n?.fullName === 'Vehicles');
      if (vehicles?.id) {
        vehiclesCategoryId = vehicles.id;
        if (typeof window !== 'undefined') {
          window.__vehiclesCategoryCache = vehiclesCategoryId;
        }
      }
    } catch {
      /* ignore */
    }
  }
    const productUpdateInput = {
      id: productId,
      title,
      metafields: metafieldsPayload,
    };
    if (descriptionHtml) productUpdateInput.descriptionHtml = descriptionHtml;
    if (productType) productUpdateInput.productType = productType;
    if (tags.length) productUpdateInput.tags = tags;
    if (decoded.manufacturer) productUpdateInput.vendor = decoded.manufacturer;
    if (vehiclesCategoryId) productUpdateInput.category = vehiclesCategoryId;
    try {
      const res = await fetch('shopify:admin/api/graphql.json', {
        method: 'POST',
        body: JSON.stringify({
          query: `mutation productUpdate($product: ProductUpdateInput!) {
            productUpdate(product: $product) {
              product { id title }
              userErrors { field message }
            }
          }`,
          variables: { product: productUpdateInput },
        }),
      });
      const json = await res.json();
      const errs = json.data?.productUpdate?.userErrors || [];
      if (errs.length) {
        setError(errs.map((e) => e.message).join(', '));
      } else {
        const last6 = vinValue.slice(-6);
        const variantRes = await fetch('shopify:admin/api/graphql.json', {
          method: 'POST',
          body: JSON.stringify({
            query: `query getFirstVariant($id: ID!) {
              product(id: $id) {
                variants(first: 1) {
                  nodes { id inventoryItem { id } }
                }
              }
            }`,
            variables: { id: productId },
          }),
        });
        const variantJson = await variantRes.json();
        const variantNode = variantJson?.data?.product?.variants?.nodes?.[0];
        if (variantNode?.id) {
          await fetch('shopify:admin/api/graphql.json', {
            method: 'POST',
            body: JSON.stringify({
              query: `mutation productVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
                productVariantsBulkUpdate(productId: $productId, variants: $variants) {
                  userErrors { field message }
                }
              }`,
              variables: {
                productId,
                variants: [
                  {
                    id: variantNode.id,
                    inventoryItem: { sku: last6, tracked: true },
                  },
                ],
              },
            }),
          });
          const invItemId = variantNode.inventoryItem?.id;
          if (invItemId) {
            let locationId = null;
            const levelsRes = await fetch('shopify:admin/api/graphql.json', {
              method: 'POST',
              body: JSON.stringify({
                query: `query getVariantInventoryLevels($id: ID!) {
                  product(id: $id) {
                    variants(first: 1) {
                      nodes {
                        inventoryItem {
                          id
                          inventoryLevels(first: 3) {
                            nodes { location { id } }
                          }
                        }
                      }
                    }
                  }
                }`,
                variables: { id: productId },
              }),
            });
            const levelsJson = await levelsRes.json();
            const levelsNode = levelsJson?.data?.product?.variants?.nodes?.[0]?.inventoryItem?.inventoryLevels?.nodes?.[0];
            if (levelsNode?.location?.id) locationId = levelsNode.location.id;
            if (!locationId) {
              // Simple cache for locations query (lasts for the session)
              if (typeof window !== 'undefined' && window.__shopLocationCache) {
                locationId = window.__shopLocationCache;
              } else {
                const locRes = await fetch('shopify:admin/api/graphql.json', {
                  method: 'POST',
                  body: JSON.stringify({
                    query: `query getLocations {
                      locations(first: 5) {
                        nodes { id name }
                      }
                    }`,
                  }),
                });
                const locJson = await locRes.json();
                const nodes = locJson?.data?.locations?.nodes ?? [];
                const location = nodes.find((n) => /shop|main|primary|store/i.test(n?.name || '')) || nodes[0];
                locationId = location?.id;
                if (locationId && typeof window !== 'undefined') {
                  window.__shopLocationCache = locationId;
                }
              }
            }
            if (locationId) {
              const setQtyRes = await fetch('shopify:admin/api/graphql.json', {
                method: 'POST',
                body: JSON.stringify({
                  query: `mutation inventorySetQuantities($input: InventorySetQuantitiesInput!) {
                    inventorySetQuantities(input: $input) {
                      userErrors { code message }
                    }
                  }`,
                  variables: {
                    input: {
                      name: 'available',
                      reason: 'correction',
                      ignoreCompareQuantity: true,
                      quantities: [
                        { inventoryItemId: invItemId, locationId, quantity: 1 },
                      ],
                    },
                  },
                }),
              });
              const setQtyJson = await setQtyRes.json();
              const setQtyErrs = setQtyJson?.data?.inventorySetQuantities?.userErrors ?? [];
              const needsActivate = setQtyErrs.some((e) => e?.code === 'ITEM_NOT_STOCKED_AT_LOCATION');
              if (needsActivate) {
                await fetch('shopify:admin/api/graphql.json', {
                  method: 'POST',
                  body: JSON.stringify({
                    query: `mutation inventoryActivate($inventoryItemId: ID!, $locationId: ID!, $available: Int) {
                      inventoryActivate(inventoryItemId: $inventoryItemId, locationId: $locationId, available: $available) {
                        inventoryLevel { id }
                        userErrors { message }
                      }
                    }`,
                    variables: {
                      inventoryItemId: invItemId,
                      locationId,
                      available: 1,
                    },
                  }),
                });
                await fetch('shopify:admin/api/graphql.json', {
                  method: 'POST',
                  body: JSON.stringify({
                    query: `mutation inventorySetQuantities2($input: InventorySetQuantitiesInput!) {
                      inventorySetQuantities(input: $input) {
                        userErrors { code message }
                      }
                    }`,
                    variables: {
                      input: {
                        name: 'available',
                        reason: 'correction',
                        ignoreCompareQuantity: true,
                        quantities: [
                          { inventoryItemId: invItemId, locationId, quantity: 1 },
                        ],
                      },
                    },
                  }),
                });
              }
            }
          }
        }
        setProductTitle(title);
        close();
      }
    } catch (e) {
      setError(e.message || 'Failed to update product');
    } finally {
      setLoading(false);
    }
  };

  const suggestedTitle = decoded ? buildTitle(decoded) : '';

  return (
    <s-admin-action>
      <s-stack direction="block" gap="base">
        <s-text type="strong">{i18n.translate('heading', { target })}</s-text>
        <s-text>{i18n.translate('description', { target })}</s-text>
        {productId && (
          <s-text tone="subdued">
            {i18n.translate('currentProduct')}: {productTitle || '—'}
          </s-text>
        )}
        <s-stack direction="inline" gap="base">
          <s-text-field
            label={i18n.translate('vinLabel')}
            value={vin}
            onInput={(e) => setVin((e.target?.value ?? '').toUpperCase().slice(0, VIN_LENGTH))}
            placeholder="1HGBH41JXMN109186"
            maxLength={VIN_LENGTH}
          />
          <s-button
            variant="primary"
            onClick={handleDecode}
            disabled={vin.trim().length < 8 || loading}
            loading={loading}
          >
            {i18n.translate('decode')}
          </s-button>
        </s-stack>
        {error && (
          <s-banner tone="critical">{error}</s-banner>
        )}
        {decoded && (
          <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
            <s-stack direction="block" gap="base">
              <s-text type="strong">{suggestedTitle}</s-text>
              <s-stack direction="block" gap="tight">
                {decoded.year && <s-text>Year: {decoded.year}</s-text>}
                {decoded.make && <s-text>Make: {decoded.make}</s-text>}
                {decoded.model && <s-text>Model: {decoded.model}</s-text>}
                {decoded.trim && <s-text>Trim: {decoded.trim}</s-text>}
                {decoded.vehicleType && <s-text>Type: {decoded.vehicleType}</s-text>}
                {decoded.fuelTypePrimary && <s-text>Fuel: {decoded.fuelTypePrimary}</s-text>}
              </s-stack>
              <s-button variant="primary" onClick={handleApplyToProduct} loading={loading}>
                {i18n.translate('applyToProduct')}
              </s-button>
            </s-stack>
          </s-box>
        )}
      </s-stack>
      <s-button slot="secondary-actions" onClick={() => close()}>
        {i18n.translate('close')}
      </s-button>
    </s-admin-action>
  );
}
