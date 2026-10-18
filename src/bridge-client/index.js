import { spawn } from 'node:child_process';
import { basename } from 'node:path';
import { BRIDGE_DEFAULT_PORT } from '../shared/protocol.js';
import { siteForMode } from '../shared/job.js';

const terminal = new Set(['done', 'failed', 'cancelled']);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

export class BridgeClient {
  constructor(options = {}) {
    this.opts = options;
    this.base = `http://127.0.0.1:${options.port ?? BRIDGE_DEFAULT_PORT}`;
  }
  async fetchJson(path, options) {
    const response = await fetch(this.base + path, options);
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
    return body;
  }
  async status(site) {
    try {
      return await this.fetchJson(site ? `/status?site=${encodeURIComponent(site)}` : '/status');
    } catch { return null; }
  }
  async ensureBridge(site) {
    const existing = await this.status(site);
    if (existing) return existing;
    if (!this.opts.spawnArgs?.length) throw new Error('bridge not running and no spawnArgs given');
    const child = spawn(process.execPath, this.opts.spawnArgs, {
      detached: true, stdio: 'ignore', windowsHide: true,
    });
    let spawnError;
    child.once('error', error => { spawnError = error; });
    child.unref();
    for (let attempt = 0; attempt < 20; attempt++) {
      await delay(250);
      if (spawnError) throw new Error(`bridge failed to start: ${spawnError.message}`);
      const status = await this.status(site);
      if (status) return status;
    }
    throw new Error('bridge failed to start within 5s');
  }
  post(path, body) {
    return this.fetchJson(path, {
      method: 'POST',
      ...(body === undefined ? {} : {
        headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      }),
    });
  }
  submitJob(job, imagePaths = []) {
    const client = (process.env.FLOW_BEHIND_CLIENT || process.env.GROK_AUTO_CLIENT || basename(process.cwd())).slice(0, 64);
    return this.post('/jobs', { job, imagePaths, client });
  }
  getJob(id) { return this.fetchJson(`/jobs/${encodeURIComponent(id)}`); }
  async listJobs() { return (await this.fetchJson('/jobs')).jobs; }
  cancelJob(id) { return this.post(`/jobs/${encodeURIComponent(id)}/cancel`); }
  stop(site) { return this.post(`/stop?site=${encodeURIComponent(site)}`); }
  clearQueue(site) { return this.post(`/queue/clear?site=${encodeURIComponent(site)}`); }
  reloadExtension(site) { return this.post(`/reload-extension?site=${encodeURIComponent(site)}`); }
  async waitJob(id, timeoutMs = 600_000, onHold) {
    const deadline = Date.now() + timeoutMs;
    let previousHold = '';
    for (;;) {
      const slice = Math.min(60_000, Math.max(1_000, deadline - Date.now()));
      const job = await this.fetchJson(`/jobs/${encodeURIComponent(id)}/wait?timeoutMs=${slice}`);
      if (terminal.has(job.status) || Date.now() >= deadline) return job;
      if (!onHold) continue;
      const status = await this.status(siteForMode(job.mode));
      const hold = status?.pausedReason || (status?.cooldownUntil > Date.now()
        ? `cooling down until ${new Date(status.cooldownUntil).toLocaleTimeString()}` : '');
      if (hold && hold !== previousHold) onHold(hold);
      previousHold = hold;
    }
  }
}
