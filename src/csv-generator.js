import { createObjectCsvWriter } from 'csv-writer';
import fs from 'fs/promises';
import path from 'path';

/**
 * WooCommerce CSV column definitions for WPML compatibility
 */
const CSV_HEADERS = [
  { id: 'sku', title: 'SKU' },
  { id: 'name_et', title: 'Name [et]' },
  { id: 'name_en', title: 'Name [en]' },
  { id: 'name_ru', title: 'Name [ru]' },
  { id: 'description_et', title: 'Description [et]' },
  { id: 'description_en', title: 'Description [en]' },
  { id: 'description_ru', title: 'Description [ru]' },
  { id: 'short_description_et', title: 'Short description [et]' },
  { id: 'short_description_en', title: 'Short description [en]' },
  { id: 'short_description_ru', title: 'Short description [ru]' },
  { id: 'regular_price', title: 'Regular price' },
  { id: 'categories', title: 'Categories' },
  { id: 'images', title: 'Images' },
  { id: 'status', title: 'Status' },
  { id: 'seo_title_et', title: 'Meta: _yoast_wpseo_title [et]' },
  { id: 'seo_title_en', title: 'Meta: _yoast_wpseo_title [en]' },
  { id: 'seo_title_ru', title: 'Meta: _yoast_wpseo_title [ru]' },
  { id: 'seo_description_et', title: 'Meta: _yoast_wpseo_metadesc [et]' },
  { id: 'seo_description_en', title: 'Meta: _yoast_wpseo_metadesc [en]' },
  { id: 'seo_description_ru', title: 'Meta: _yoast_wpseo_metadesc [ru]' },
  { id: 'confidence', title: 'Info Confidence' },
  { id: 'original_research', title: 'Original Research (EN)' }
];

/**
 * Generate WooCommerce-compatible CSV file
 */
export async function generateCSV(products, outputPath, logger) {
  // Ensure output directory exists
  const outputDir = path.dirname(outputPath);
  await fs.mkdir(outputDir, { recursive: true }).catch(() => {});

  const csvWriter = createObjectCsvWriter({
    path: outputPath,
    header: CSV_HEADERS,
    encoding: 'utf8'
  });

  const records = products
    .filter(p => p.success !== false)
    .map(product => formatProductForCSV(product));

  await csvWriter.writeRecords(records);

  logger?.info(`CSV file generated: ${outputPath}`);
  logger?.info(`Total products: ${records.length}`);

  return {
    outputPath,
    productCount: records.length,
    failedCount: products.filter(p => p.success === false).length
  };
}

/**
 * Format product data for CSV
 */
function formatProductForCSV(product) {
  return {
    sku: product.sku || '',
    name_et: cleanText(product.name_et) || product.productName,
    name_en: cleanText(product.name_en) || product.productName,
    name_ru: cleanText(product.name_ru) || product.productName,
    description_et: cleanText(product.description_et) || '',
    description_en: cleanText(product.description_en) || '',
    description_ru: cleanText(product.description_ru) || '',
    short_description_et: cleanText(product.short_description_et) || '',
    short_description_en: cleanText(product.short_description_en) || '',
    short_description_ru: cleanText(product.short_description_ru) || '',
    regular_price: product.suggested_price_eur || '',
    categories: product.category_suggestion || 'Uncategorized',
    images: (product.images || []).join(', '),
    status: 'draft', // Always draft for review
    seo_title_et: cleanText(product.seo_title_et) || '',
    seo_title_en: cleanText(product.seo_title_en) || '',
    seo_title_ru: cleanText(product.seo_title_ru) || '',
    seo_description_et: cleanText(product.seo_description_et) || '',
    seo_description_en: cleanText(product.seo_description_en) || '',
    seo_description_ru: cleanText(product.seo_description_ru) || '',
    confidence: product.confidence || 'low',
    original_research: cleanText(product.originalResearch) || ''
  };
}

/**
 * Clean text for CSV (remove problematic characters)
 */
function cleanText(text) {
  if (!text) return '';
  return text
    .replace(/[\r\n]+/g, ' ')  // Replace newlines with spaces
    .replace(/\s+/g, ' ')       // Normalize whitespace
    .replace(/"/g, '""')        // Escape quotes for CSV
    .trim();
}

/**
 * Save intermediate results to JSON file
 */
export async function saveIntermediateResults(products, filePath, logger) {
  const data = {
    timestamp: new Date().toISOString(),
    totalProducts: products.length,
    successCount: products.filter(p => p.success !== false).length,
    failedCount: products.filter(p => p.success === false).length,
    products
  };

  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
  logger?.info(`Intermediate results saved: ${filePath}`);
}

/**
 * Load intermediate results from JSON file
 */
export async function loadIntermediateResults(filePath, logger) {
  try {
    const data = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(data);
    logger?.info(`Loaded ${parsed.products?.length || 0} products from intermediate file`);
    return parsed;
  } catch (error) {
    return null;
  }
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
  saveIntermediateResults,
  loadIntermediateResults,
  generateReport
};
