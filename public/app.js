// DOM Elements
const productsInput = document.getElementById('products-input');
const productCount = document.getElementById('product-count');
const languageSelect = document.getElementById('language-select');
const generateBtn = document.getElementById('generate-btn');
const progressSection = document.getElementById('progress-section');
const progressBar = document.getElementById('progress-bar');
const progressText = document.getElementById('progress-text');
const productList = document.getElementById('product-list');
const logOutput = document.getElementById('log-output');
const resultsSection = document.getElementById('results-section');
const summaryDiv = document.getElementById('summary');
const downloadCsv = document.getElementById('download-csv');
const downloadReport = document.getElementById('download-report');
const jobsList = document.getElementById('jobs-list');

// State
let currentJobId = null;
let eventSource = null;
let products = [];
let selectedLanguage = 'et';

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  loadRecentJobs();
  setupEventListeners();
});

// Setup event listeners
function setupEventListeners() {
  // Update product count on input
  productsInput.addEventListener('input', () => {
    const lines = productsInput.value.split('\n').filter(line => line.trim());
    productCount.textContent = `${lines.length} product${lines.length !== 1 ? 's' : ''}`;
  });

  // Generate button click
  generateBtn.addEventListener('click', startGeneration);

  // Download buttons
  downloadCsv.addEventListener('click', () => downloadFile('csv'));
  downloadReport.addEventListener('click', () => downloadFile('report'));
}

// Start product generation
async function startGeneration() {
  // Parse products from textarea
  products = productsInput.value
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0);

  if (products.length === 0) {
    alert('Please enter at least one product name');
    return;
  }

  // Get selected language
  selectedLanguage = languageSelect.value;

  // Disable button
  generateBtn.disabled = true;
  generateBtn.textContent = 'Starting...';

  try {
    // Call API to start generation
    const response = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ products, language: selectedLanguage })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Failed to start generation');
    }

    currentJobId = data.jobId;

    // Show progress section
    showProgressSection();

    // Connect to SSE for real-time updates
    connectToSSE(currentJobId);

    // Refresh jobs list
    loadRecentJobs();

  } catch (error) {
    alert(`Error: ${error.message}`);
    generateBtn.disabled = false;
    generateBtn.textContent = 'Generate Products';
  }
}

// Show progress section and initialize product list
function showProgressSection() {
  progressSection.classList.remove('hidden');
  resultsSection.classList.add('hidden');

  // Clear previous state
  productList.innerHTML = '';
  logOutput.innerHTML = '';
  progressBar.style.width = '0%';
  progressText.textContent = '0% (0/0)';

  // Create product items
  products.forEach((product, index) => {
    const item = document.createElement('div');
    item.className = 'product-item pending';
    item.id = `product-${index}`;
    item.innerHTML = `
      <span class="icon">&#9675;</span>
      <span class="name">${escapeHtml(product)}</span>
      <span class="status"></span>
    `;
    productList.appendChild(item);
  });

  // Scroll to progress section
  progressSection.scrollIntoView({ behavior: 'smooth' });
}

// Connect to SSE for real-time updates
function connectToSSE(jobId) {
  // Close existing connection
  if (eventSource) {
    eventSource.close();
  }

  eventSource = new EventSource(`/api/progress/${jobId}`);

  eventSource.addEventListener('init', (event) => {
    const data = JSON.parse(event.data);
    console.log('Job initialized:', data);

    if (data.status === 'completed') {
      handleComplete(data);
    }
  });

  eventSource.addEventListener('progress', (event) => {
    const data = JSON.parse(event.data);
    updateProgress(data);
  });

  eventSource.addEventListener('product', (event) => {
    const data = JSON.parse(event.data);
    updateProductStatus(data);
  });

  eventSource.addEventListener('log', (event) => {
    const data = JSON.parse(event.data);
    addLogEntry(data);
  });

  eventSource.addEventListener('complete', (event) => {
    const data = JSON.parse(event.data);
    handleComplete(data);
    eventSource.close();
    loadRecentJobs();
  });

  eventSource.addEventListener('error', (event) => {
    if (event.data) {
      const data = JSON.parse(event.data);
      addLogEntry({ level: 'error', message: data.message });
    }
  });

  eventSource.onerror = () => {
    console.log('SSE connection error or closed');
  };
}

// Update progress bar
function updateProgress(data) {
  const { current, total, product } = data;
  const percentage = Math.round((current / total) * 100);

  progressBar.style.width = `${percentage}%`;
  progressText.textContent = `${percentage}% (${current}/${total})`;

  // Update current product to processing state
  const productItem = document.getElementById(`product-${current - 1}`);
  if (productItem && productItem.classList.contains('pending')) {
    productItem.className = 'product-item processing';
    productItem.querySelector('.icon').innerHTML = '&#9684;';
  }
}

// Update product status
function updateProductStatus(data) {
  const { index, status, confidence, error } = data;
  const productItem = document.getElementById(`product-${index}`);

  if (!productItem) return;

  productItem.className = `product-item ${status}`;

  const icon = productItem.querySelector('.icon');
  const statusSpan = productItem.querySelector('.status');

  if (status === 'success') {
    icon.innerHTML = '&#10003;';
    statusSpan.textContent = confidence;
    statusSpan.className = `status ${confidence}`;
  } else if (status === 'error') {
    icon.innerHTML = '&#10007;';
    statusSpan.textContent = 'Failed';
    statusSpan.className = 'status low';
  }
}

// Add log entry
function addLogEntry(data) {
  const { level, message } = data;
  const entry = document.createElement('div');
  entry.className = `log-entry ${level}`;
  entry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
  logOutput.appendChild(entry);
  logOutput.scrollTop = logOutput.scrollHeight;
}

// Handle job completion
function handleComplete(data) {
  generateBtn.disabled = false;
  generateBtn.textContent = 'Generate Products';

  // Show results section
  resultsSection.classList.remove('hidden');

  const { summary, outputFiles } = data;

  // Render summary
  summaryDiv.innerHTML = `
    <div class="summary-item">
      <div class="value">${summary.total}</div>
      <div class="label">Total</div>
    </div>
    <div class="summary-item success">
      <div class="value">${summary.successful}</div>
      <div class="label">Successful</div>
    </div>
    <div class="summary-item failed">
      <div class="value">${summary.failed}</div>
      <div class="label">Failed</div>
    </div>
    <div class="summary-item">
      <div class="value">${summary.highConfidence}</div>
      <div class="label">High Conf.</div>
    </div>
    <div class="summary-item">
      <div class="value">${summary.mediumConfidence}</div>
      <div class="label">Medium Conf.</div>
    </div>
    <div class="summary-item">
      <div class="value">${summary.lowConfidence}</div>
      <div class="label">Low Conf.</div>
    </div>
  `;

  // Store output files for download
  downloadCsv.dataset.file = outputFiles.csv;
  downloadReport.dataset.file = outputFiles.report;

  // Scroll to results
  resultsSection.scrollIntoView({ behavior: 'smooth' });

  addLogEntry({ level: 'success', message: 'Job completed! You can now download the files.' });
}

// Download file
function downloadFile(type) {
  if (!currentJobId) return;
  window.location.href = `/api/download/${currentJobId}/${type}`;
}

// Load recent jobs
async function loadRecentJobs() {
  try {
    const response = await fetch('/api/jobs');
    const jobs = await response.json();

    if (jobs.length === 0) {
      jobsList.innerHTML = '<p class="no-jobs">No recent jobs</p>';
      return;
    }

    jobsList.innerHTML = jobs.map(job => {
      const statusIcon = {
        completed: '&#10003;',
        processing: '&#9684;',
        pending: '&#9675;',
        failed: '&#10007;'
      }[job.status] || '&#9675;';

      const date = new Date(job.createdAt);
      const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

      return `
        <div class="job-item ${job.status}" data-job-id="${job.id}">
          <span class="job-icon">${statusIcon}</span>
          <div class="job-info">
            <div class="job-id">${job.productCount} products</div>
            <div class="job-meta">${timeStr} - ${job.status}</div>
          </div>
        </div>
      `;
    }).join('');

    // Add click handlers
    document.querySelectorAll('.job-item').forEach(item => {
      item.addEventListener('click', () => {
        const jobId = item.dataset.jobId;
        viewJob(jobId);
      });
    });

  } catch (error) {
    console.error('Failed to load jobs:', error);
  }
}

// View a specific job
async function viewJob(jobId) {
  try {
    const response = await fetch(`/api/job/${jobId}`);
    const job = await response.json();

    currentJobId = jobId;
    products = job.products;

    if (job.status === 'completed') {
      // Show completed state
      showProgressSection();

      // Update product list with results
      products.forEach((product, index) => {
        const item = document.getElementById(`product-${index}`);
        if (item) {
          item.className = 'product-item success';
          item.querySelector('.icon').innerHTML = '&#10003;';
        }
      });

      // Update progress
      progressBar.style.width = '100%';
      progressText.textContent = '100% (Complete)';

      // Show results
      handleComplete({
        summary: job.summary,
        outputFiles: job.outputFiles
      });

    } else if (job.status === 'processing') {
      // Reconnect to SSE
      showProgressSection();
      connectToSSE(jobId);
    }

  } catch (error) {
    console.error('Failed to load job:', error);
  }
}

// Escape HTML to prevent XSS
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
