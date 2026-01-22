#!/usr/bin/env node

import { Command } from 'commander';
import inquirer from 'inquirer';
import dotenv from 'dotenv';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

import { searchProduct } from './src/search.js';
import { initOpenAI, generateProductContent } from './src/openai.js';
import {
  generateCSV,
  saveIntermediateResults,
  loadIntermediateResults,
  generateReport
} from './src/csv-generator.js';
import {
  createLogger,
  createSpinner,
  createProgressBar,
  formatDuration,
  printSummary
} from './src/logger.js';

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// CLI setup
const program = new Command();

program
  .name('product-generator')
  .description('CLI tool to automate WooCommerce product listing creation with AI')
  .version('1.0.0');

program
  .option('-i, --input <file>', 'Input file with product names (one per line)')
  .option('-o, --output <file>', 'Output CSV file path', 'import.csv')
  .option('-p, --products <names...>', 'Product names as command line arguments')
  .option('--interactive', 'Interactive mode - prompt for product names')
  .option('--resume <file>', 'Resume from intermediate results file')
  .option('-v, --verbose', 'Verbose output')
  .option('-q, --quiet', 'Quiet mode - minimal output')
  .option('--concurrency <number>', 'Number of concurrent API calls', '2')
  .option('--delay <ms>', 'Delay between API batches in milliseconds', '1500');

program.parse();

const options = program.opts();

/**
 * Main function
 */
async function main() {
  const startTime = Date.now();
  const logger = createLogger({ verbose: options.verbose, quiet: options.quiet });

  logger.header('WooCommerce Product Generator');

  // Check for OpenAI API key
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    logger.error('OPENAI_API_KEY environment variable is not set.');
    logger.info('Set it with: export OPENAI_API_KEY=your-api-key');
    process.exit(1);
  }

  // Initialize OpenAI
  try {
    initOpenAI(apiKey);
    logger.success('OpenAI API initialized');
  } catch (error) {
    logger.error(`Failed to initialize OpenAI: ${error.message}`);
    process.exit(1);
  }

  // Get product names
  let products = [];

  // Check for resume option
  if (options.resume) {
    const resumeData = await loadIntermediateResults(options.resume, logger);
    if (resumeData) {
      const pendingProducts = resumeData.products
        .filter(p => p.success === false || !p.success)
        .map(p => p.productName);

      if (pendingProducts.length > 0) {
        logger.info(`Resuming with ${pendingProducts.length} pending products`);
        products = pendingProducts;
      } else {
        logger.success('All products already processed. Generating CSV...');
        await finalizeOutput(resumeData.products, options, logger);
        return;
      }
    }
  }

  // Get products from various sources
  if (products.length === 0) {
    if (options.input) {
      products = await loadProductsFromFile(options.input, logger);
    } else if (options.products && options.products.length > 0) {
      products = options.products;
    } else if (options.interactive) {
      products = await promptForProducts(logger);
    } else {
      // Default: check for products.txt in current directory
      const defaultFile = path.join(process.cwd(), 'products.txt');
      try {
        await fs.access(defaultFile);
        products = await loadProductsFromFile(defaultFile, logger);
      } catch {
        // No default file, go interactive
        products = await promptForProducts(logger);
      }
    }
  }

  if (products.length === 0) {
    logger.error('No products to process. Exiting.');
    process.exit(1);
  }

  logger.info(`Processing ${products.length} product(s)`);
  logger.blank();

  // Process products
  const results = await processProducts(products, options, logger);

  // Save intermediate results
  const intermediateFile = options.output.replace('.csv', '-intermediate.json');
  await saveIntermediateResults(results, intermediateFile, logger);

  // Generate final output
  await finalizeOutput(results, options, logger);

  // Print summary
  printSummary(results, logger);

  const duration = Date.now() - startTime;
  logger.success(`Completed in ${formatDuration(duration)}`);
}

/**
 * Load products from a text file
 */
async function loadProductsFromFile(filePath, logger) {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    const products = content
      .split('\n')
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#')); // Ignore empty lines and comments

    logger.success(`Loaded ${products.length} products from ${filePath}`);
    return products;
  } catch (error) {
    logger.error(`Failed to read input file: ${error.message}`);
    process.exit(1);
  }
}

/**
 * Interactive prompt for product names
 */
async function promptForProducts(logger) {
  logger.info('Interactive mode - enter product names (one per line)');
  logger.info('Enter an empty line when done');
  logger.blank();

  const products = [];
  let continuePrompt = true;

  while (continuePrompt) {
    const { productName } = await inquirer.prompt([
      {
        type: 'input',
        name: 'productName',
        message: `Product ${products.length + 1}:`,
      }
    ]);

    if (productName.trim()) {
      products.push(productName.trim());
    } else {
      continuePrompt = false;
    }
  }

  return products;
}

/**
 * Process all products with progress tracking
 */
async function processProducts(products, options, logger) {
  const results = [];
  const concurrency = parseInt(options.concurrency, 10) || 2;
  const delayMs = parseInt(options.delay, 10) || 1500;

  logger.subheader('Processing Products');

  const progressBar = createProgressBar(products.length);
  progressBar.start();

  for (let i = 0; i < products.length; i++) {
    const product = products[i];
    progressBar.update(i, product);

    try {
      // Step 1: Search for product information
      logger.debug(`Searching for: ${product}`);
      const searchResults = await searchProduct(product, logger);

      // Step 2: Generate content with OpenAI
      logger.debug(`Generating content for: ${product}`);
      const content = await generateProductContent(searchResults, logger);

      // Merge results
      const result = {
        ...content,
        images: searchResults.images || [],
        searchResults: {
          descriptionsFound: searchResults.descriptions.length,
          imagesFound: searchResults.images.length,
          sources: searchResults.sources
        }
      };

      results.push(result);

      // Log individual result
      if (!options.quiet) {
        const confidence = result.confidence || 'unknown';
        const confColor = confidence === 'high' ? 'success' :
                         confidence === 'medium' ? 'processing' : 'error';
        logger.debug(`Completed: ${product} (${confidence} confidence)`);
      }

    } catch (error) {
      logger.debug(`Error processing ${product}: ${error.message}`);
      results.push({
        success: false,
        productName: product,
        error: error.message,
        confidence: 'low'
      });
    }

    // Rate limiting between products
    if (i < products.length - 1) {
      await sleep(delayMs);
    }
  }

  progressBar.update(products.length, 'Complete!');
  progressBar.stop();

  return results;
}

/**
 * Finalize output - generate CSV and report
 */
async function finalizeOutput(results, options, logger) {
  logger.subheader('Generating Output Files');

  // Generate CSV
  const csvResult = await generateCSV(results, options.output, logger);
  logger.success(`CSV file: ${csvResult.outputPath}`);

  // Generate report
  const reportPath = await generateReport(results, options.output, logger);
  logger.success(`Report file: ${reportPath}`);

  // List output files
  logger.blank();
  logger.info('Output files:');
  console.log(`  • ${options.output} (WooCommerce import file)`);
  console.log(`  • ${reportPath} (Summary report)`);
  console.log(`  • ${options.output.replace('.csv', '-intermediate.json')} (Intermediate data)`);
}

/**
 * Sleep helper
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Run main function
main().catch(error => {
  console.error('Fatal error:', error.message);
  process.exit(1);
});
