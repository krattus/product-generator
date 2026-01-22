import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';
import dotenv from 'dotenv';

import { searchProduct } from './src/search.js';
import { initOpenAI, generateProductContent } from './src/openai.js';
import { generateCSV, generateReport } from './src/csv-generator.js';

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// In-memory job storage
const jobs = new Map();

// SSE clients per job
const sseClients = new Map();

// Initialize OpenAI on startup
let openaiInitialized = false;
try {
  const apiKey = process.env.OPENAI_API_KEY;
  if (apiKey) {
    initOpenAI(apiKey);
    openaiInitialized = true;
    console.log('OpenAI API initialized');
  } else {
    console.warn('Warning: OPENAI_API_KEY not set. Set it in .env file.');
  }
} catch (error) {
  console.error('Failed to initialize OpenAI:', error.message);
}

// Ensure output directory exists
const outputDir = path.join(__dirname, 'output');
fs.mkdir(outputDir, { recursive: true }).catch(() => {});

/**
 * Send SSE event to all clients watching a job
 */
function sendJobEvent(jobId, event, data) {
  const clients = sseClients.get(jobId) || [];
  const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  clients.forEach(res => {
    res.write(message);
  });
}

/**
 * Create a logger that sends events via SSE
 */
function createWebLogger(jobId) {
  return {
    info: (message) => sendJobEvent(jobId, 'log', { level: 'info', message }),
    success: (message) => sendJobEvent(jobId, 'log', { level: 'success', message }),
    warn: (message) => sendJobEvent(jobId, 'log', { level: 'warn', message }),
    error: (message) => sendJobEvent(jobId, 'log', { level: 'error', message }),
    debug: (message) => sendJobEvent(jobId, 'log', { level: 'debug', message }),
  };
}

/**
 * Process products in the background
 */
async function processJob(jobId) {
  const job = jobs.get(jobId);
  if (!job) return;

  const logger = createWebLogger(jobId);
  const results = [];

  try {
    job.status = 'processing';
    job.startedAt = new Date().toISOString();

    for (let i = 0; i < job.products.length; i++) {
      const product = job.products[i];

      // Update current product
      job.currentProduct = product;
      job.progress = { current: i + 1, total: job.products.length };

      sendJobEvent(jobId, 'progress', {
        current: i + 1,
        total: job.products.length,
        product,
        status: 'processing'
      });

      try {
        // Step 1: Search for product information
        logger.info(`Searching for: ${product}`);
        const searchResults = await searchProduct(product, logger);

        // Step 2: Generate content with OpenAI
        logger.info(`Generating content for: ${product}`);
        const content = await generateProductContent(searchResults, logger);

        // Merge results
        const result = {
          ...content,
          images: searchResults.images || [],
        };

        results.push(result);

        // Send product completion event
        sendJobEvent(jobId, 'product', {
          index: i,
          product,
          status: result.success === false ? 'error' : 'success',
          confidence: result.confidence,
          error: result.error
        });

        logger.success(`Completed: ${product} (${result.confidence} confidence)`);

      } catch (error) {
        logger.error(`Error processing ${product}: ${error.message}`);
        results.push({
          success: false,
          productName: product,
          error: error.message,
          confidence: 'low'
        });

        sendJobEvent(jobId, 'product', {
          index: i,
          product,
          status: 'error',
          error: error.message
        });
      }

      // Rate limiting between products
      if (i < job.products.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1500));
      }
    }

    // Generate output files
    const timestamp = Date.now();
    const csvPath = path.join(outputDir, `products-${jobId}.csv`);
    const reportPath = path.join(outputDir, `products-${jobId}-report.txt`);

    await generateCSV(results, csvPath, logger);
    await generateReport(results, csvPath, logger);

    // Update job status
    job.status = 'completed';
    job.completedAt = new Date().toISOString();
    job.results = results;
    job.outputFiles = {
      csv: `products-${jobId}.csv`,
      report: `products-${jobId}-report.txt`
    };

    // Calculate summary
    const successful = results.filter(r => r.success !== false);
    const failed = results.filter(r => r.success === false);
    job.summary = {
      total: results.length,
      successful: successful.length,
      failed: failed.length,
      highConfidence: successful.filter(r => r.confidence === 'high').length,
      mediumConfidence: successful.filter(r => r.confidence === 'medium').length,
      lowConfidence: successful.filter(r => r.confidence === 'low').length
    };

    sendJobEvent(jobId, 'complete', {
      status: 'completed',
      summary: job.summary,
      outputFiles: job.outputFiles
    });

    logger.success('Job completed!');

  } catch (error) {
    job.status = 'failed';
    job.error = error.message;
    job.completedAt = new Date().toISOString();

    sendJobEvent(jobId, 'error', {
      message: error.message
    });

    logger.error(`Job failed: ${error.message}`);
  }
}

// API Routes

/**
 * GET / - Serve web interface
 */
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

/**
 * POST /api/generate - Start product generation job
 */
app.post('/api/generate', (req, res) => {
  if (!openaiInitialized) {
    return res.status(500).json({
      error: 'OpenAI API not initialized. Please set OPENAI_API_KEY in .env file.'
    });
  }

  const { products } = req.body;

  if (!products || !Array.isArray(products) || products.length === 0) {
    return res.status(400).json({
      error: 'Products array is required'
    });
  }

  // Filter empty strings
  const cleanProducts = products
    .map(p => p.trim())
    .filter(p => p.length > 0);

  if (cleanProducts.length === 0) {
    return res.status(400).json({
      error: 'At least one valid product name is required'
    });
  }

  // Create job
  const jobId = Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
  const job = {
    id: jobId,
    products: cleanProducts,
    status: 'pending',
    createdAt: new Date().toISOString(),
    progress: { current: 0, total: cleanProducts.length }
  };

  jobs.set(jobId, job);

  // Start processing in background
  processJob(jobId);

  res.json({
    jobId,
    message: 'Job started',
    productCount: cleanProducts.length
  });
});

/**
 * GET /api/progress/:jobId - SSE endpoint for real-time progress
 */
app.get('/api/progress/:jobId', (req, res) => {
  const { jobId } = req.params;
  const job = jobs.get(jobId);

  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  // Set up SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Add client to SSE list
  if (!sseClients.has(jobId)) {
    sseClients.set(jobId, []);
  }
  sseClients.get(jobId).push(res);

  // Send initial state
  res.write(`event: init\ndata: ${JSON.stringify({
    status: job.status,
    products: job.products,
    progress: job.progress,
    summary: job.summary,
    outputFiles: job.outputFiles
  })}\n\n`);

  // Handle client disconnect
  req.on('close', () => {
    const clients = sseClients.get(jobId);
    if (clients) {
      const index = clients.indexOf(res);
      if (index > -1) {
        clients.splice(index, 1);
      }
    }
  });
});

/**
 * GET /api/download/:jobId/:type - Download generated file
 */
app.get('/api/download/:jobId/:type', async (req, res) => {
  const { jobId, type } = req.params;
  const job = jobs.get(jobId);

  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  if (job.status !== 'completed') {
    return res.status(400).json({ error: 'Job not completed' });
  }

  let filename;
  if (type === 'csv') {
    filename = job.outputFiles.csv;
  } else if (type === 'report') {
    filename = job.outputFiles.report;
  } else {
    return res.status(400).json({ error: 'Invalid file type' });
  }

  const filePath = path.join(outputDir, filename);

  try {
    await fs.access(filePath);
    res.download(filePath, filename);
  } catch {
    res.status(404).json({ error: 'File not found' });
  }
});

/**
 * GET /api/jobs - List recent jobs
 */
app.get('/api/jobs', (req, res) => {
  const jobList = Array.from(jobs.values())
    .map(job => ({
      id: job.id,
      status: job.status,
      productCount: job.products.length,
      createdAt: job.createdAt,
      completedAt: job.completedAt,
      summary: job.summary
    }))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 20); // Last 20 jobs

  res.json(jobList);
});

/**
 * GET /api/job/:jobId - Get job details
 */
app.get('/api/job/:jobId', (req, res) => {
  const { jobId } = req.params;
  const job = jobs.get(jobId);

  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  res.json({
    id: job.id,
    status: job.status,
    products: job.products,
    progress: job.progress,
    createdAt: job.createdAt,
    completedAt: job.completedAt,
    summary: job.summary,
    outputFiles: job.outputFiles,
    error: job.error
  });
});

/**
 * GET /api/health - Health check
 */
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    openaiInitialized,
    activeJobs: Array.from(jobs.values()).filter(j => j.status === 'processing').length
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  if (!openaiInitialized) {
    console.log('Warning: Set OPENAI_API_KEY in .env to enable product generation');
  }
});
