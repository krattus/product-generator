import { createObjectCsvWriter } from 'csv-writer';
import fs from 'fs/promises';
import path from 'path';

/**
 * WooCommerce CSV column definitions - matching exact export format (90 columns)
 * Headers are in Estonian as per WooCommerce Estonian locale
 */
const CSV_HEADERS = [
  // Core Product Fields (1-5)
  { id: 'id', title: 'ID' },
  { id: 'type', title: 'Tüüp' },
  { id: 'sku', title: 'Tootekood' },
  { id: 'gtin', title: 'GTIN, UPC, EAN, or ISBN' },
  { id: 'name', title: 'Nimi' },

  // Visibility (6-8)
  { id: 'published', title: 'Avaldatud' },
  { id: 'featured', title: 'Esiletõstetud?' },
  { id: 'visibility', title: 'Nähtavus kataloogis' },

  // Descriptions (9-10)
  { id: 'short_description', title: 'Lühikirjeldus' },
  { id: 'description', title: 'Kirjeldus' },

  // Pricing & Dates (11-14)
  { id: 'sale_price_start', title: 'Soodushinna alguskuupäev' },
  { id: 'sale_price_end', title: 'Soodushinna lõpukuupäev' },
  { id: 'tax_status', title: 'Maksustamine' },
  { id: 'tax_class', title: 'Maksuklass' },

  // Inventory (15-19)
  { id: 'in_stock', title: 'Laos?' },
  { id: 'stock', title: 'Ladu' },
  { id: 'low_stock', title: 'Madal laojääk' },
  { id: 'backorders', title: 'Järeltellimused lubatud?' },
  { id: 'sold_individually', title: 'Müüakse üksikuna?' },

  // Shipping dimensions (20-23)
  { id: 'weight', title: 'Kaal (g)' },
  { id: 'length', title: 'Pikkus (cm)' },
  { id: 'width', title: 'Laius (cm)' },
  { id: 'height', title: 'Kõrgus (cm)' },

  // Reviews & Notes (24-25)
  { id: 'allow_reviews', title: 'Luba klientide arvustusi?' },
  { id: 'purchase_note', title: 'Ostumärkus' },

  // Prices (26-27)
  { id: 'sale_price', title: 'Soodushind' },
  { id: 'regular_price', title: 'Tavahind' },

  // Taxonomy (28-30)
  { id: 'categories', title: 'Kategooriad' },
  { id: 'tags', title: 'Sildid' },
  { id: 'shipping_class', title: 'Tarneklass' },

  // Media (31-33)
  { id: 'images', title: 'Pildid' },
  { id: 'download_limit', title: 'Allalaadimiste limiit' },
  { id: 'download_expiry', title: 'Allalaadimise aegumise päevi' },

  // Product Relations (34-40)
  { id: 'parent', title: 'Ülem' },
  { id: 'grouped_products', title: 'Grupeeritud tooted' },
  { id: 'upsells', title: 'Ülesmüügid' },
  { id: 'cross_sells', title: 'Ristmüügid' },
  { id: 'external_url', title: 'Väline URL' },
  { id: 'button_text', title: 'Nupu tekst' },
  { id: 'position', title: 'Positsioon' },

  // Brand & Attributes (41-45)
  { id: 'brands', title: 'Brändid' },
  { id: 'attribute_1_name', title: 'Omaduse 1 nimi' },
  { id: 'attribute_1_values', title: 'Omaduse 1 väärtus(ed)' },
  { id: 'attribute_1_visible', title: 'Omaduse 1 nähtavus' },
  { id: 'attribute_1_global', title: 'Omaduse 1 globaalsus' },

  // Meta Fields (46-90)
  { id: 'meta_wpml_word_count', title: 'Meta: _wpml_word_count' },
  { id: 'meta_wpml_location_migration_done', title: 'Meta: _wpml_location_migration_done' },
  { id: 'meta_wcpbn_mirror_batches_stock', title: 'Meta: _wcpbn_mirror_batches_stock' },
  { id: 'meta_rank_math_seo_score', title: 'Meta: rank_math_seo_score' },
  { id: 'meta_rank_math_focus_keyword', title: 'Meta: rank_math_focus_keyword' },
  { id: 'meta_wc_facebook_sync_enabled', title: 'Meta: _wc_facebook_sync_enabled' },
  { id: 'meta_fb_visibility', title: 'Meta: fb_visibility' },
  { id: 'meta_fb_product_description', title: 'Meta: fb_product_description' },
  { id: 'meta_fb_rich_text_description', title: 'Meta: fb_rich_text_description' },
  { id: 'meta_wc_facebook_product_image_source', title: 'Meta: _wc_facebook_product_image_source' },
  { id: 'meta_fb_brand', title: 'Meta: fb_brand' },
  { id: 'meta_fb_mpn', title: 'Meta: fb_mpn' },
  { id: 'meta_fb_size', title: 'Meta: fb_size' },
  { id: 'meta_fb_color', title: 'Meta: fb_color' },
  { id: 'meta_fb_material', title: 'Meta: fb_material' },
  { id: 'meta_fb_pattern', title: 'Meta: fb_pattern' },
  { id: 'meta_fb_age_group', title: 'Meta: fb_age_group' },
  { id: 'meta_fb_gender', title: 'Meta: fb_gender' },
  { id: 'meta_fb_product_condition', title: 'Meta: fb_product_condition' },
  { id: 'meta_linked_variations', title: 'Meta: linked_variations' },
  { id: 'meta_linked_variations_underscore', title: 'Meta: _linked_variations' },
  { id: 'meta_sisaldus_ja_koostisosad', title: 'Meta: _sisaldus_ja_koostisosad' },
  { id: 'meta_kasutamine_ja_hoiustamine', title: 'Meta: _kasutamine_ja_hoiustamine' },
  { id: 'meta_woodmart_product_background', title: 'Meta: _woodmart_product-background' },
  { id: 'meta_rank_math_internal_links_processed', title: 'Meta: rank_math_internal_links_processed' },
  { id: 'meta_rank_math_primary_product_brand', title: 'Meta: rank_math_primary_product_brand' },
  { id: 'meta_rank_math_primary_product_cat', title: 'Meta: rank_math_primary_product_cat' },
  { id: 'meta_rank_math_primary_fb_product_set', title: 'Meta: rank_math_primary_fb_product_set' },
  { id: 'meta_wpml_media_duplicate', title: 'Meta: _wpml_media_duplicate' },
  { id: 'meta_wpml_media_featured', title: 'Meta: _wpml_media_featured' },
  { id: 'meta_rank_math_analytic_object_id', title: 'Meta: rank_math_analytic_object_id' },
  { id: 'meta_acowdp_sale_price', title: 'Meta: acowdp_sale_price' },
  { id: 'meta_last_change_time', title: 'Meta: _last_change_time' },
  { id: 'meta_wpml_media_has_media', title: 'Meta: _wpml_media_has_media' },
  { id: 'meta_wc_facebook_sync_enabled_v2', title: 'Meta: _wc_facebook_sync_enabled_v2' }
];

/**
 * Generate WooCommerce-compatible CSV file
 * @param {Array} products - Array of product objects
 * @param {string} outputPath - Path to output CSV file
 * @param {string|object} languageOrLogger - Language code or logger object (for backwards compatibility)
 * @param {object} logger - Logger object (optional if languageOrLogger is logger)
 */
export async function generateCSV(products, outputPath, languageOrLogger, logger) {
  // Handle backwards compatibility - if languageOrLogger is an object, it's the logger
  let language = 'et';
  if (typeof languageOrLogger === 'string') {
    language = languageOrLogger;
  } else if (languageOrLogger && typeof languageOrLogger === 'object') {
    logger = languageOrLogger;
  }
  // Ensure output directory exists
  const outputDir = path.dirname(outputPath);
  await fs.mkdir(outputDir, { recursive: true }).catch(() => {});

  // Add BOM for UTF-8 Excel compatibility
  const BOM = '\ufeff';

  const csvWriter = createObjectCsvWriter({
    path: outputPath,
    header: CSV_HEADERS,
    encoding: 'utf8'
  });

  const records = products
    .filter(p => p.success !== false)
    .map(product => formatProductForCSV(product, language));

  await csvWriter.writeRecords(records);

  // Prepend BOM to file for Excel UTF-8 compatibility
  const content = await fs.readFile(outputPath, 'utf8');
  await fs.writeFile(outputPath, BOM + content, 'utf8');

  logger?.info(`CSV file generated: ${outputPath}`);
  logger?.info(`Total products: ${records.length}`);

  return {
    outputPath,
    productCount: records.length,
    failedCount: products.filter(p => p.success === false).length
  };
}

/**
 * Format product data for WooCommerce CSV (all 90 fields)
 */
function formatProductForCSV(product, language) {
  const hasIngredients = !!(product.meta_sisaldus_ja_koostisosad || product.ingredients);
  const hasUsage = !!(product.meta_kasutamine_ja_hoiustamine || product.usage_instructions);
  const currentTimestamp = Math.floor(Date.now() / 1000);

  // Extract focus keyword from product name (first meaningful word)
  const focusKeyword = extractFocusKeyword(product.name || product.productName);

  return {
    // Core Product Fields (1-5)
    id: '',  // Empty for new products
    type: 'simple',
    sku: product.sku || '',
    gtin: product.ean || '',
    name: cleanText(product.name) || product.productName,

    // Visibility (6-8)
    published: 0,  // Draft mode - not published
    featured: 0,
    visibility: 'visible',

    // Descriptions (9-10)
    short_description: formatShortDescription(product.short_description || ''),
    description: formatDescription(product.description || ''),

    // Pricing & Dates (11-14)
    sale_price_start: '',
    sale_price_end: '',
    tax_status: 'taxable',
    tax_class: '',

    // Inventory (15-19)
    in_stock: 1,
    stock: '',
    low_stock: '',
    backorders: 0,
    sold_individually: 0,

    // Shipping dimensions (20-23)
    weight: product.weight || '',
    length: '',
    width: '',
    height: '',

    // Reviews & Notes (24-25)
    allow_reviews: 1,
    purchase_note: '',

    // Prices (26-27)
    sale_price: '',
    regular_price: product.suggested_price_eur || '',

    // Taxonomy (28-30)
    categories: product.category_suggestion || '',
    tags: '',
    shipping_class: '',

    // Media (31-33)
    images: formatImages(product.images),
    download_limit: '',
    download_expiry: '',

    // Product Relations (34-40)
    parent: '',
    grouped_products: '',
    upsells: '',
    cross_sells: '',
    external_url: '',
    button_text: '',
    position: 0,

    // Brand & Attributes (41-45)
    brands: '',
    attribute_1_name: product.brand ? 'Kaubamärk' : '',
    attribute_1_values: product.brand || '',
    attribute_1_visible: product.brand ? 1 : '',
    attribute_1_global: product.brand ? 1 : '',

    // Meta Fields (46-90)
    meta_wpml_word_count: '',
    meta_wpml_location_migration_done: 1,
    meta_wcpbn_mirror_batches_stock: 'no',
    meta_rank_math_seo_score: '',
    meta_rank_math_focus_keyword: focusKeyword,
    meta_wc_facebook_sync_enabled: 'yes',
    meta_fb_visibility: 'yes',
    meta_fb_product_description: '',
    meta_fb_rich_text_description: '',
    meta_wc_facebook_product_image_source: 'product',
    meta_fb_brand: product.brand || '',
    meta_fb_mpn: '',
    meta_fb_size: '',
    meta_fb_color: '',
    meta_fb_material: '',
    meta_fb_pattern: '',
    meta_fb_age_group: '',
    meta_fb_gender: '',
    meta_fb_product_condition: '',
    meta_linked_variations: '',
    meta_linked_variations_underscore: '',
    meta_sisaldus_ja_koostisosad: hasIngredients
      ? formatIngredientsHtml(product.meta_sisaldus_ja_koostisosad || product.ingredients)
      : '',
    meta_kasutamine_ja_hoiustamine: hasUsage
      ? formatUsageHtml(product.meta_kasutamine_ja_hoiustamine || product.usage_instructions)
      : '',
    meta_woodmart_product_background: '',
    meta_rank_math_internal_links_processed: 1,
    meta_rank_math_primary_product_brand: 0,
    meta_rank_math_primary_product_cat: '',
    meta_rank_math_primary_fb_product_set: 0,
    meta_wpml_media_duplicate: 1,
    meta_wpml_media_featured: 1,
    meta_rank_math_analytic_object_id: '',
    meta_acowdp_sale_price: '',
    meta_last_change_time: currentTimestamp,
    meta_wpml_media_has_media: 1,
    meta_wc_facebook_sync_enabled_v2: 'yes'
  };
}

/**
 * Format short description (plain text with \n for newlines)
 */
function formatShortDescription(text) {
  if (!text) return '';
  return text
    .replace(/<[^>]*>/g, '')  // Strip HTML tags
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')  // Max 2 consecutive newlines
    .trim();
}

/**
 * Format main description (HTML with data attributes)
 */
function formatDescription(html) {
  if (!html) return '';

  // If it already has data attributes, return as-is
  if (html.includes('data-start=')) {
    return html.replace(/\r\n/g, '\n').trim();
  }

  // Add data attributes to HTML elements for consistency with export format
  let position = 0;
  const result = html.replace(/<(p|ul|li|strong|br)([^>]*)>/g, (match, tag, attrs) => {
    const start = position;
    position += 50;  // Approximate position increment
    const end = position;

    if (tag === 'br') {
      return `<br data-start="${start}" data-end="${end}" />`;
    }
    return `<${tag} data-start="${start}" data-end="${end}"${attrs}>`;
  });

  return result.replace(/\r\n/g, '\n').trim();
}

/**
 * Format ingredients/composition HTML with table structure matching WooCommerce export
 */
function formatIngredientsHtml(content) {
  if (!content) return '';

  // If already properly formatted, return as-is
  if (content.includes('_tableContainer_')) {
    return content.replace(/\r\n/g, '\n');
  }

  // Parse the content to extract nutrition table and ingredients
  // Expected structure from AI: table data + ingredients text

  // Wrap in the container divs matching WooCommerce export format
  const wrappedHtml = `<div class="_tableContainer_80l1q_1">
<div class="_tableWrapper_80l1q_14 group flex w-fit flex-col-reverse" tabindex="-1">
<div class="_tableContainer_80l1q_1">
<div class="_tableWrapper_80l1q_14 group flex w-fit flex-col-reverse" tabindex="-1">
${formatNutritionTable(content)}
</div>
</div>
</div>
</div>`;

  return wrappedHtml;
}

/**
 * Format nutrition table with proper structure
 */
function formatNutritionTable(content) {
  // If content already contains a table, try to reformat it
  if (content.includes('<table')) {
    // Add required classes and data attributes
    let result = content
      .replace(/<table[^>]*>/g, '<table class="w-fit min-w-(--thread-content-width)" data-start="28" data-end="158">')
      .replace(/<thead[^>]*>/g, '<thead data-start="28" data-end="70">')
      .replace(/<tbody[^>]*>/g, '<tbody data-start="115" data-end="158">')
      .replace(/<tr[^>]*>/g, (match, offset) => `<tr data-start="${28 + offset}" data-end="${70 + offset}">`)
      .replace(/<th[^>]*>/g, '<th data-col-size="sm">')
      .replace(/<td[^>]*>/g, '<td data-col-size="sm">');

    return result;
  }

  // Return content as-is if no table structure
  return content;
}

/**
 * Format usage/storage HTML with paragraph structure matching WooCommerce export
 */
function formatUsageHtml(content) {
  if (!content) return '';

  // If already has the span classes, return as-is
  if (content.includes('relative -mx-px')) {
    return content.replace(/\r\n/g, '\n');
  }

  // Parse and reformat to match export structure
  let position = 1845;
  const sections = [];

  // Try to identify sections: Kasutamine, Hoiustamine, Hoiatused
  const usageMatch = content.match(/(?:kasutamine|usage)[:\s]*([^<]*?)(?=<|hoiustamine|storage|hoiatused|warnings|$)/i);
  const storageMatch = content.match(/(?:hoiustamine|storage)[:\s]*([^<]*?)(?=<|hoiatused|warnings|$)/i);
  const warningsMatch = content.match(/(?:hoiatused|warnings)[:\s]*(.+?)$/is);

  if (usageMatch || content.includes('<strong>Kasutamine')) {
    // Already has structure, just add data attributes
    let result = content;

    // Add data attributes to p tags
    result = result.replace(/<p>/g, () => {
      const start = position;
      position += 50;
      return `<p data-start="${start}" data-end="${position}">`;
    });

    // Add data attributes to strong tags
    result = result.replace(/<strong>/g, () => {
      const start = position;
      position += 15;
      return `<strong data-start="${start}" data-end="${position}">`;
    });

    // Wrap text content in spans with Tailwind classes
    result = result.replace(/<\/strong>([^<]+)/g, (match, text) => {
      if (text.trim()) {
        return `</strong><span class="relative -mx-px my-[-0.2rem] rounded px-px py-[0.2rem] transition-colors duration-100 ease-in-out">${text.trim()}</span>`;
      }
      return match;
    });

    return result;
  }

  // Return content wrapped in basic structure
  return `<p data-start="${position}" data-end="${position + 50}"><strong data-start="${position}" data-end="${position + 15}">Kasutamine
</strong><span class="relative -mx-px my-[-0.2rem] rounded px-px py-[0.2rem] transition-colors duration-100 ease-in-out">${content}</span></p>`;
}

/**
 * Format images array to comma-separated string
 */
function formatImages(images) {
  if (!images) return '';
  if (Array.isArray(images)) {
    return images.join(', ');
  }
  return String(images);
}

/**
 * Extract focus keyword from product name
 */
function extractFocusKeyword(name) {
  if (!name) return '';

  // Remove brand prefixes and common words
  const cleaned = name
    .toLowerCase()
    .replace(/^(swanson|now foods|solgar|nature's way|vitaking|nordic naturals|jarrow formulas|life extension|doctor's best|natural factors)\s+/i, '')
    .replace(/\d+\s*(mg|g|ml|mcg|iu|kapslit|tabletti|капсул)/gi, '')
    .trim();

  // Get first meaningful word (at least 4 chars)
  const words = cleaned.split(/\s+/).filter(w => w.length >= 4);
  return words[0] || cleaned.split(/\s+/)[0] || '';
}

/**
 * Clean text for CSV (preserve HTML but normalize whitespace)
 */
function cleanText(text) {
  if (!text) return '';
  return text
    .replace(/\r\n/g, '\n')  // Normalize line endings
    .replace(/\t/g, ' ')     // Replace tabs with spaces
    .trim();
}

/**
 * Generate a summary report
 */
export async function generateReport(products, outputPath, logger) {
  const reportPath = outputPath.replace('.csv', '-report.txt');

  const successProducts = products.filter(p => p.success !== false);
  const failedProducts = products.filter(p => p.success === false);

  const lines = [
    '='.repeat(60),
    'WOOCOMMERCE PRODUCT GENERATION REPORT',
    '='.repeat(60),
    '',
    `Generated: ${new Date().toLocaleString()}`,
    `Total Products: ${products.length}`,
    `Successful: ${successProducts.length}`,
    `Failed: ${failedProducts.length}`,
    '',
    '-'.repeat(60),
    'CONFIDENCE BREAKDOWN',
    '-'.repeat(60),
    `High Confidence: ${successProducts.filter(p => p.confidence === 'high').length}`,
    `Medium Confidence: ${successProducts.filter(p => p.confidence === 'medium').length}`,
    `Low Confidence: ${successProducts.filter(p => p.confidence === 'low').length}`,
    '',
  ];

  if (successProducts.length > 0) {
    lines.push('-'.repeat(60));
    lines.push('SUCCESSFUL PRODUCTS');
    lines.push('-'.repeat(60));
    successProducts.forEach((p, i) => {
      lines.push(`${i + 1}. ${p.productName}`);
      lines.push(`   SKU: ${p.sku}`);
      lines.push(`   Confidence: ${p.confidence}`);
      lines.push(`   Images: ${p.images?.length || 0}`);
      lines.push('');
    });
  }

  if (failedProducts.length > 0) {
    lines.push('-'.repeat(60));
    lines.push('FAILED PRODUCTS');
    lines.push('-'.repeat(60));
    failedProducts.forEach((p, i) => {
      lines.push(`${i + 1}. ${p.productName}`);
      lines.push(`   Error: ${p.error || 'Unknown error'}`);
      lines.push('');
    });
  }

  lines.push('='.repeat(60));
  lines.push('END OF REPORT');
  lines.push('='.repeat(60));

  await fs.writeFile(reportPath, lines.join('\n'), 'utf8');
  logger?.info(`Report generated: ${reportPath}`);

  return reportPath;
}

/**
 * Save intermediate results for resume functionality
 */
export async function saveIntermediateResults(products, outputPath, logger) {
  const intermediatePath = outputPath.replace('.csv', '-intermediate.json');
  await fs.writeFile(intermediatePath, JSON.stringify({ products, timestamp: new Date().toISOString() }, null, 2), 'utf8');
  logger?.info(`Intermediate results saved: ${intermediatePath}`);
  return intermediatePath;
}

/**
 * Load intermediate results for resume functionality
 */
export async function loadIntermediateResults(filePath, logger) {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    const data = JSON.parse(content);
    logger?.info(`Loaded intermediate results from: ${filePath}`);
    return data;
  } catch (error) {
    logger?.error(`Failed to load intermediate results: ${error.message}`);
    return null;
  }
}

export default {
  generateCSV,
  generateReport,
  saveIntermediateResults,
  loadIntermediateResults
};
