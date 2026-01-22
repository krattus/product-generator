# WooCommerce Product Generator

A Node.js CLI tool that automates product listing creation for WordPress/WooCommerce e-shops using AI.

## Features

- **Web Research**: Automatically searches for product information, specifications, and images
- **AI-Powered Content**: Uses OpenAI GPT-4 to generate compelling product descriptions
- **Multilingual**: Generates content in Estonian, English, and Russian (WPML compatible)
- **SEO Optimized**: Creates Yoast SEO meta titles and descriptions
- **WooCommerce Ready**: Outputs CSV files ready for WooCommerce import
- **Draft Status**: All products are saved as drafts for manual review
- **Progress Tracking**: Visual progress indicators and detailed logging
- **Resume Support**: Save and resume interrupted processing

## Installation

```bash
cd product-generator
npm install
```

## Configuration

1. Copy the example environment file:
```bash
cp .env.example .env
```

2. Add your OpenAI API key to `.env`:
```
OPENAI_API_KEY=sk-your-api-key-here
```

## Usage

### Using an input file

```bash
node product-generator.js --input products.txt --output import.csv
```

### Using command line arguments

```bash
node product-generator.js --products "iPhone 15 Pro" "Samsung Galaxy S24" --output import.csv
```

### Interactive mode

```bash
node product-generator.js --interactive
```

### Resume interrupted processing

```bash
node product-generator.js --resume import-intermediate.json --output import.csv
```

## Command Line Options

| Option | Description | Default |
|--------|-------------|---------|
| `-i, --input <file>` | Input file with product names (one per line) | - |
| `-o, --output <file>` | Output CSV file path | `import.csv` |
| `-p, --products <names...>` | Product names as arguments | - |
| `--interactive` | Interactive mode | - |
| `--resume <file>` | Resume from intermediate file | - |
| `-v, --verbose` | Verbose output | false |
| `-q, --quiet` | Minimal output | false |
| `--concurrency <n>` | Concurrent API calls | 2 |
| `--delay <ms>` | Delay between batches | 1500 |

## Input File Format

Create a text file with one product name per line:

```
# This is a comment
iPhone 15 Pro Max
Samsung Galaxy S24 Ultra
Sony WH-1000XM5 Headphones
```

Lines starting with `#` are treated as comments.

## Output Files

The tool generates three files:

1. **`import.csv`** - WooCommerce-compatible CSV file for import
2. **`import-report.txt`** - Summary report with processing details
3. **`import-intermediate.json`** - Raw data for resume functionality

## CSV Columns

| Column | Description |
|--------|-------------|
| SKU | Auto-generated SKU |
| Name [et/en/ru] | Product name in each language |
| Description [et/en/ru] | Full description in each language |
| Short description [et/en/ru] | Short description in each language |
| Regular price | Suggested price (if available) |
| Categories | Suggested category |
| Images | Comma-separated image URLs |
| Status | Always "draft" |
| Meta: _yoast_wpseo_title [et/en/ru] | SEO title |
| Meta: _yoast_wpseo_metadesc [et/en/ru] | SEO description |
| Info Confidence | high/medium/low |
| Original Research (EN) | Raw research data |

## Importing to WooCommerce

1. Install the "WooCommerce Product CSV Import Suite" or use the built-in WooCommerce importer
2. Go to WooCommerce > Products > Import
3. Upload the generated CSV file
4. Map the columns to WooCommerce fields
5. Review products (they're in draft status)
6. Publish after review

## Confidence Levels

- **High**: Found multiple descriptions, images, and specifications
- **Medium**: Found some information, may need manual enhancement
- **Low**: Limited information found, requires manual review

## Rate Limiting

The tool includes built-in rate limiting to avoid API throttling:
- Default: 2 concurrent requests
- Default delay: 1500ms between batches

Adjust with `--concurrency` and `--delay` options.

## License

MIT
