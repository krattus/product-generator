import { createObjectCsvWriter } from 'csv-writer';
import fs from 'fs/promises';
import path from 'path';

/**
 * WooCommerce CSV column definitions - matching exact export format
 * Headers are in Estonian as per WooCommerce Estonian locale
 */
const CSV_HEADERS = [
  { id: 'id', title: 'ID' },
  { id: 'type', title: 'Tüüp' },
  { id: 'sku', title: 'Tootekood' },
  { id: 'gtin', title: 'GTIN, UPC, EAN, or ISBN' },
  { id: 'name', title: 'Nimi' },
  { id: 'published', title: 'Avaldatud' },
  { id: 'featured', title: 'Esiletõstetud?' },
  { id: 'visibility', title: 'Nähtavus kataloogis' },
  { id: 'short_description', title: 'Lühikirjeldus' },
  { id: 'description', title: 'Kirjeldus' },
  { id: 'sale_price_start', title: 'Soodushinna alguskuupäev' },
  { id: 'sale_price_end', title: 'Soodushinna lõpukuupäev' },
  { id: 'tax_status', title: 'Maksustamine' },
  { id: 'tax_class', title: 'Maksuklass' },
  { id: 'in_stock', title: 'Laos?' },
  { id: 'stock', title: 'Ladu' },
  { id: 'low_stock', title: 'Madal laojääk' },
  { id: 'backorders', title: 'Järeltellimused lubatud?' },
  { id: 'sold_individually', title: 'Müüakse üksikuna?' },
  { id: 'weight', title: 'Kaal (g)' },
  { id: 'length', title: 'Pikkus (cm)' },
  { id: 'width', title: 'Laius (cm)' },
  { id: 'height', title: 'Kõrgus (cm)' },
  { id: 'allow_reviews', title: 'Luba klientide arvustusi?' },
  { id: 'purchase_note', title: 'Ostumärkus' },
  { id: 'sale_price', title: 'Soodushind' },
  { id: 'regular_price', title: 'Tavahind' },
  { id: 'categories', title: 'Kategooriad' },
  { id: 'tags', title: 'Sildid' },
  { id: 'shipping_class', title: 'Tarneklass' },
  { id: 'images', title: 'Pildid' },
  { id: 'download_limit', title: 'Allalaadimiste limiit' },
  { id: 'download_expiry', title: 'Allalaadimise aegumise päevi' },
  { id: 'parent', title: 'Ülem' },
  { id: 'grouped_products', title: 'Grupeeritud tooted' },
  { id: 'upsells', title: 'Ülesmüügid' },
  { id: 'cross_sells', title: 'Ristmüügid' },
  { id: 'external_url', title: 'Väline URL' },
  { id: 'button_text', title: 'Nupu tekst' },
  { id: 'position', title: 'Positsioon' },
  { id: 'brands', title: 'Brändid' },
  { id: 'attribute_1_name', title: 'Omaduse 1 nimi' },
  { id: 'attribute_1_values', title: 'Omaduse 1 väärtus(ed)' },
  { id: 'attribute_1_visible', title: 'Omaduse 1 nähtavus' },
  { id: 'attribute_1_global', title: 'Omaduse 1 globaalsus' },
  { id: 'meta_ingredients', title: 'Meta: sisaldus_ja_koostisosad' },
  { id: 'meta_ingredients_field', title: 'Meta: _sisaldus_ja_koostisosad' },
  { id: 'meta_usage', title: 'Meta: kasutamine_ja_hoiustamine' },
  { id: 'meta_usage_field', title: 'Meta: _kasutamine_ja_hoiustamine' }
];

/**
 * Generate WooCommerce-compatible CSV file
 */
export async function generateCSV(products, outputPath, language = 'et', logger) {
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
 * Format product data for WooCommerce CSV
 */
function formatProductForCSV(product, language) {
  return {
    id: '',  // Empty for new products
    type: 'simple',
    sku: product.sku || '',
    gtin: '',
    name: cleanText(product.name) || product.productName,
    published: 0,  // Draft mode - not published
    featured: 0,
    visibility: 'visible',
    short_description: product.short_description || '',
    description: product.description || '',
    sale_price_start: '',
    sale_price_end: '',
    tax_status: 'taxable',
    tax_class: '',
    in_stock: 1,
    stock: '',
    low_stock: '',
    backorders: 0,
    sold_individually: 0,
    weight: '',
    length: '',
    width: '',
    height: '',
    allow_reviews: 1,
    purchase_note: '',
    sale_price: '',
    regular_price: product.suggested_price_eur || '',
    categories: product.category_suggestion || '',
    tags: '',
    shipping_class: '',
    images: (product.images || []).join(', '),
    download_limit: '',
    download_expiry: '',
    parent: '',
    grouped_products: '',
    upsells: '',
    cross_sells: '',
    external_url: '',
    button_text: '',
    position: 0,
    brands: product.brand || '',
    attribute_1_name: product.brand ? 'Kaubamärk' : '',
    attribute_1_values: product.brand || '',
    attribute_1_visible: product.brand ? 1 : '',
    attribute_1_global: product.brand ? 1 : '',
    meta_ingredients: product.ingredients || '',
    meta_ingredients_field: product.ingredients ? 'field_67ddb9e61221c' : '',
    meta_usage: product.usage_instructions || '',
    meta_usage_field: product.usage_instructions ? 'field_6183e47bbcb05' : ''
  };
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

export default {
  generateCSV,
  generateReport
};
