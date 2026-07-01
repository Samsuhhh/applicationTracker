import test from 'node:test';
import assert from 'node:assert/strict';

import { createJob, getStats, moveJobStatus, sortJobs } from '../src/jobTracker.js';

test('createJob normalizes a new application', () => {
  const job = createJob({
    company: 'Contoso',
    role: 'Product Designer',
    status: 'applied',
    appliedDate: '2026-07-01',
    notes: 'Follow up next week',
  });

  assert.equal(job.company, 'Contoso');
  assert.equal(job.role, 'Product Designer');
  assert.equal(job.status, 'applied');
  assert.equal(job.appliedDate, '2026-07-01');
});

test('createJob preserves pay information', () => {
  const job = createJob({
    company: 'Contoso',
    role: 'Product Designer',
    pay: '$140,000',
  });

  assert.equal(job.pay, '$140,000');
});

test('moveJobStatus advances and retreats through stages', () => {
  const job = createJob({ company: 'Northwind', role: 'Software Engineer', status: 'applied' });

  const advanced = moveJobStatus(job, 'forward');
  assert.equal(advanced.status, 'interview');

  const reverted = moveJobStatus(advanced, 'back');
  assert.equal(reverted.status, 'applied');
});

test('getStats counts applications by stage', () => {
  const jobs = [
    createJob({ company: 'A', role: 'Dev', status: 'applied' }),
    createJob({ company: 'B', role: 'Dev', status: 'interview' }),
    createJob({ company: 'C', role: 'Dev', status: 'rejected' }),
  ];

  const stats = getStats(jobs);

  assert.equal(stats.total, 3);
  assert.equal(stats.applied, 1);
  assert.equal(stats.interview, 1);
  assert.equal(stats.rejected, 1);
});

test('sortJobs orders cards by status and recency', () => {
  const jobs = [
    createJob({ company: 'A', role: 'R1', status: 'rejected' }),
    createJob({ company: 'B', role: 'R2', status: 'applied' }),
  ];

  const sorted = sortJobs(jobs);

  assert.equal(sorted[0].status, 'applied');
  assert.equal(sorted[1].status, 'rejected');
});
