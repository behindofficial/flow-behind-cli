import { EventEmitter } from 'node:events';
import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { STATE_DIR } from '../brand.js';
import { siteForMode } from '../shared/job.js';

const FILE = join(STATE_DIR, 'jobs.json');
const KEEP = 200;
const STALE_WAIT_MS = 30 * 60_000;
const TERMINAL = new Set(['done', 'failed', 'cancelled']);
const IN_FLIGHT = new Set(['running', 'queued', 'waiting_for_extension', 'downloading']);
export const jobEvents = new EventEmitter();
jobEvents.setMaxListeners(100);
let jobs = [];

export function loadJobs() {
  try {
    const saved = JSON.parse(readFileSync(FILE, 'utf8'));
    jobs = Array.isArray(saved) ? saved : [];
    for (const job of jobs) {
      if (!IN_FLIGHT.has(job.status)) continue;
      job.status = 'failed';
      job.error = 'bridge restarted while job was in flight';
    }
  } catch { jobs = []; }
}

function persist() {
  try {
    mkdirSync(STATE_DIR, { recursive: true });
    const temporary = `${FILE}.${process.pid}.tmp`;
    writeFileSync(temporary, JSON.stringify(jobs.slice(-KEEP), null, 2));
    renameSync(temporary, FILE);
  } catch (error) {
    console.error(`[Flow Behind] Could not save job history: ${error.message}`);
  }
}

export function addJob(job) {
  jobs.push(job);
  persist();
  jobEvents.emit('change', job);
}
export function getJob(id) { return jobs.find(job => job.id === id); }
export function listJobs() { return [...jobs].reverse(); }
export function pendingJobs() { return jobs.filter(job => job.status === 'waiting_for_extension'); }
export function updateJob(id, patch) {
  const job = getJob(id);
  if (!job) return undefined;
  Object.assign(job, patch, { updatedAt: Date.now() });
  persist();
  jobEvents.emit('change', job);
  return job;
}
export function clearFinished(site) {
  const before = jobs.length;
  jobs = jobs.filter(job => siteForMode(job.mode) !== site || !TERMINAL.has(job.status));
  const removed = before - jobs.length;
  if (removed) persist();
  return removed;
}
export function markStale(all, now) {
  let count = 0;
  for (const job of all) {
    const idle = now - (job.updatedAt ?? job.createdAt ?? now);
    if (job.status !== 'waiting_for_extension' || idle < STALE_WAIT_MS) continue;
    Object.assign(job, {
      status: 'failed', stage: undefined, updatedAt: now,
      error: `abandoned — no extension picked this up for ${Math.round(idle / 60_000)} min (stale queue entry from an earlier run)`,
    });
    count++;
    jobEvents.emit('change', job);
  }
  return count;
}
export function expireStale() {
  const count = markStale(jobs, Date.now());
  if (count) persist();
  return count;
}
export function pickOrphans(all, site, claimed) {
  if (!claimed) return [];
  const live = new Set(claimed);
  return all.filter(job => siteForMode(job.mode) === site
    && (job.status === 'running' || job.status === 'downloading') && !live.has(job.id));
}
export function orphanedJobs(site, claimed) { return pickOrphans(jobs, site, claimed); }
export function waitForJob(id, timeoutMs) {
  const job = getJob(id);
  if (!job || TERMINAL.has(job.status)) return Promise.resolve(job);
  return new Promise(resolve => {
    const finish = value => {
      clearTimeout(timer);
      jobEvents.off('change', onChange);
      resolve(value);
    };
    const onChange = changed => {
      if (changed.id === id && TERMINAL.has(changed.status)) finish(changed);
    };
    const timer = setTimeout(() => finish(getJob(id)), timeoutMs);
    jobEvents.on('change', onChange);
  });
}
