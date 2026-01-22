import chalk from 'chalk';
import ora from 'ora';
import cliProgress from 'cli-progress';

/**
 * Create a logger instance
 */
export function createLogger(options = {}) {
  const { verbose = false, quiet = false } = options;

  return {
    info: (message) => {
      if (!quiet) {
        console.log(chalk.blue('ℹ'), message);
      }
    },

    success: (message) => {
      if (!quiet) {
        console.log(chalk.green('✓'), message);
      }
    },

    warn: (message) => {
      if (!quiet) {
        console.log(chalk.yellow('⚠'), message);
      }
    },

    error: (message) => {
      console.log(chalk.red('✗'), message);
    },

    debug: (message) => {
      if (verbose) {
        console.log(chalk.gray('⋯'), chalk.gray(message));
      }
    },

    blank: () => {
      if (!quiet) {
        console.log('');
      }
    },

    header: (message) => {
      if (!quiet) {
        console.log('');
        console.log(chalk.bold.cyan('═'.repeat(60)));
        console.log(chalk.bold.cyan(` ${message}`));
        console.log(chalk.bold.cyan('═'.repeat(60)));
        console.log('');
      }
    },

    subheader: (message) => {
      if (!quiet) {
        console.log('');
        console.log(chalk.bold.white(`▸ ${message}`));
        console.log(chalk.gray('-'.repeat(40)));
      }
    },

    product: (name, status, details = '') => {
      if (!quiet) {
        const statusIcon = status === 'success' ? chalk.green('✓') :
                          status === 'error' ? chalk.red('✗') :
                          status === 'processing' ? chalk.yellow('◐') :
                          chalk.blue('○');
        console.log(`  ${statusIcon} ${chalk.white(name)}${details ? chalk.gray(` - ${details}`) : ''}`);
      }
    },

    table: (data) => {
      if (!quiet) {
        console.table(data);
      }
    }
  };
}

/**
 * Create a spinner for async operations
 */
export function createSpinner(text) {
  return ora({
    text,
    color: 'cyan',
    spinner: 'dots'
  });
}

/**
 * Create a progress bar for batch processing
 */
export function createProgressBar(total) {
  const bar = new cliProgress.SingleBar({
    format: chalk.cyan('{bar}') + ' | {percentage}% | {value}/{total} | {product}',
    barCompleteChar: '█',
    barIncompleteChar: '░',
    hideCursor: true
  }, cliProgress.Presets.shades_classic);

  return {
    start: () => bar.start(total, 0, { product: 'Starting...' }),
    update: (value, productName) => bar.update(value, { product: productName.slice(0, 30) }),
    stop: () => bar.stop()
  };
}

/**
 * Format duration in human-readable format
 */
export function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;

  if (minutes > 0) {
    return `${minutes}m ${remainingSeconds}s`;
  }
  return `${seconds}s`;
}

/**
 * Print a summary table
 */
export function printSummary(results, logger) {
  const successful = results.filter(r => r.success !== false);
  const failed = results.filter(r => r.success === false);
  const highConf = successful.filter(r => r.confidence === 'high');
  const medConf = successful.filter(r => r.confidence === 'medium');
  const lowConf = successful.filter(r => r.confidence === 'low');

  logger.blank();
  logger.header('GENERATION SUMMARY');

  console.log(chalk.white('  Total Products:     ') + chalk.bold(results.length));
  console.log(chalk.green('  Successful:         ') + chalk.bold(successful.length));
  console.log(chalk.red('  Failed:             ') + chalk.bold(failed.length));
  console.log('');
  console.log(chalk.white('  Confidence Levels:'));
  console.log(chalk.green('    High:   ') + chalk.bold(highConf.length));
  console.log(chalk.yellow('    Medium: ') + chalk.bold(medConf.length));
  console.log(chalk.red('    Low:    ') + chalk.bold(lowConf.length));

  if (failed.length > 0) {
    logger.blank();
    logger.subheader('Failed Products');
    failed.forEach(p => {
      console.log(chalk.red(`  • ${p.productName}: ${p.error || 'Unknown error'}`));
    });
  }

  logger.blank();
}

export default {
  createLogger,
  createSpinner,
  createProgressBar,
  formatDuration,
  printSummary
};
