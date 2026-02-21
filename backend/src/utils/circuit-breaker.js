'use strict';

function log(data) {
  process.stdout.write(JSON.stringify({ ts: new Date().toISOString(), service: 'circuit-breaker', ...data }) + '\n');
}

class CircuitBreaker {
  constructor({ name = 'default', failureThreshold = 3, resetTimeout = 120000, halfOpenMaxCalls = 1 } = {}) {
    this.name = name;
    this.failureThreshold = failureThreshold;
    this.resetTimeout = resetTimeout;
    this.halfOpenMaxCalls = halfOpenMaxCalls;
    this.state = 'CLOSED';   // CLOSED | OPEN | HALF_OPEN
    this.failures = 0;
    this.halfOpenCalls = 0;
    this.lastFailureTime = null;
  }

  async call(fn) {
    if (this.state === 'OPEN') {
      const elapsed = Date.now() - this.lastFailureTime;
      if (elapsed >= this.resetTimeout) {
        this.state = 'HALF_OPEN';
        this.halfOpenCalls = 0;
        log({ level: 'info', event: 'circuit_half_open', name: this.name });
      } else {
        const retryIn = Math.ceil((this.resetTimeout - elapsed) / 1000);
        const err = new Error(`Circuit OPEN [${this.name}] — retry in ${retryIn}s`);
        err.code = 'CIRCUIT_OPEN';
        err.retryAfter = retryIn;
        throw err;
      }
    }

    if (this.state === 'HALF_OPEN') {
      this.halfOpenCalls++;
      if (this.halfOpenCalls > this.halfOpenMaxCalls) {
        const err = new Error(`Circuit HALF_OPEN [${this.name}] — probe limit reached`);
        err.code = 'CIRCUIT_HALF_OPEN';
        throw err;
      }
    }

    try {
      const result = await fn();
      this._onSuccess();
      return result;
    } catch (err) {
      if (err.code === 'CIRCUIT_OPEN' || err.code === 'CIRCUIT_HALF_OPEN') throw err;
      this._onFailure(err);
      throw err;
    }
  }

  _onSuccess() {
    if (this.state !== 'CLOSED') log({ level: 'info', event: 'circuit_closed', name: this.name });
    this.state = 'CLOSED';
    this.failures = 0;
    this.halfOpenCalls = 0;
    this.lastFailureTime = null;
  }

  _onFailure(err) {
    this.failures++;
    this.lastFailureTime = Date.now();
    if (this.failures >= this.failureThreshold && this.state !== 'OPEN') {
      this.state = 'OPEN';
      log({ level: 'error', event: 'circuit_opened', name: this.name, failures: this.failures, lastError: err.message });
    }
  }

  getState() {
    return { name: this.name, state: this.state, failures: this.failures, lastFailureTime: this.lastFailureTime };
  }

  reset() {
    this.state = 'CLOSED';
    this.failures = 0;
    this.lastFailureTime = null;
    log({ level: 'info', event: 'circuit_reset_manual', name: this.name });
  }
}

module.exports = { CircuitBreaker };
