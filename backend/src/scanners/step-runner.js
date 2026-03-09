/**
 * Step Runner
 *
 * Iterates through a step registry, calling each step with a shared context object.
 * Errors in any step are caught per-step, logged, and stored as partial results.
 * Steps marked as critical abort the pipeline on failure.
 *
 * Step array accepts two entry types:
 *   Sequential: { name, stepNumber, execute: async (context) => void, critical: boolean }
 *   Parallel:   { parallel: true, name: string, steps: [sequential_step, ...] }
 *
 * Parallel groups execute via Promise.allSettled(). A critical failure in any
 * parallel step aborts the pipeline AFTER the entire group finishes (not mid-execution).
 */

const { createLogger } = require('../utils/logger');

const logger = createLogger('step-runner');

/**
 * Run a sequence of steps against a shared context
 * @param {Array} steps - Ordered array of step objects
 * @param {Object} context - Shared scan context
 * @param {Function} updateProgressFn - Callback: (stepInfo) => void
 * @returns {Promise<Object>} { completed, stepsRun, errors }
 */
async function runSteps(steps, context, updateProgressFn) {
  let stepsRun = 0;
  let aborted = false;

  for (const entry of steps) {
    if (aborted) break;

    // Handle parallel step groups
    if (entry.parallel && Array.isArray(entry.steps)) {
      const groupName = entry.name || 'parallel-group';
      logger.info('step-group-start', { group: groupName, stepCount: entry.steps.length });

      if (updateProgressFn) {
        updateProgressFn({ stepNumber: entry.steps[0]?.stepNumber || '?', name: groupName });
      }

      const groupStartTime = Date.now();
      const results = await Promise.allSettled(
        entry.steps.map(step => executeStep(step, context))
      );

      // Process results
      let groupHasCriticalFailure = false;
      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        const step = entry.steps[i];
        stepsRun++;

        if (result.status === 'rejected') {
          const errorInfo = {
            stepName: step.name,
            stepNumber: step.stepNumber,
            error: result.reason?.message || String(result.reason),
            stack: result.reason?.stack
          };
          context.errors.push(errorInfo);
          logger.error('step-failed', errorInfo);

          if (step.critical) {
            groupHasCriticalFailure = true;
          }
        }
      }

      const groupDuration = Date.now() - groupStartTime;
      logger.info('step-group-complete', { group: groupName, durationMs: groupDuration });

      if (groupHasCriticalFailure) {
        logger.error('step-group-critical-failure', { group: groupName });
        aborted = true;
      }

      continue;
    }

    // Sequential step
    const stepStartTime = Date.now();
    logger.info('step-start', { name: entry.name, stepNumber: entry.stepNumber });

    if (updateProgressFn) {
      updateProgressFn({ stepNumber: entry.stepNumber, name: entry.name });
    }

    try {
      await entry.execute(context);
      stepsRun++;
      const duration = Date.now() - stepStartTime;
      logger.info('step-complete', { name: entry.name, stepNumber: entry.stepNumber, durationMs: duration });
    } catch (error) {
      stepsRun++;
      const errorInfo = {
        stepName: entry.name,
        stepNumber: entry.stepNumber,
        error: error.message,
        stack: error.stack
      };
      context.errors.push(errorInfo);

      if (entry.critical) {
        logger.error('step-critical-failure', errorInfo);
        aborted = true;
      } else {
        logger.warn('step-non-critical-failure', errorInfo);
      }
    }
  }

  return {
    completed: !aborted,
    stepsRun,
    errors: context.errors
  };
}

/**
 * Execute a single step (helper for parallel groups)
 */
async function executeStep(step, context) {
  const startTime = Date.now();
  logger.info('step-start', { name: step.name, stepNumber: step.stepNumber });

  await step.execute(context);

  const duration = Date.now() - startTime;
  logger.info('step-complete', { name: step.name, stepNumber: step.stepNumber, durationMs: duration });
}

module.exports = {
  runSteps
};
