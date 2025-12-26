const { describe, it, expect, beforeEach } = require('vitest');
const fs = require('fs');
const path = require('path');

process.env.AI_VALIDATION_MOCK_MODE = 'true';

const { queueJob, getJob } = require('../ai-validation/v2/runner.cjs');

const RUNS_DIR = path.join(process.cwd(), 'runs', 'ai-validation-v2');

function waitForStatus(jobId, expected, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const timer = setInterval(() => {
      const job = getJob(jobId);
      if (job && job.status === expected) {
        clearInterval(timer);
        resolve(job);
      } else if (Date.now() - start > timeoutMs) {
        clearInterval(timer);
        reject(new Error(`Timeout waiting for status ${expected}`));
      }
    }, 150);
  });
}

describe('AI Validation v2 runner', () => {
  beforeEach(() => {
    if (fs.existsSync(RUNS_DIR)) {
      fs.rmSync(RUNS_DIR, { recursive: true, force: true });
    }
  });

  it('processes a mock job end-to-end', async () => {
    const evidencePack = {
      version: '1.0',
      createdAt: new Date().toISOString(),
      target: { url: 'https://example.com', domain: 'example.com' },
      findings: [
        {
          type: 'stacked_iframe',
          severity: 'high',
          description: 'Multiple tiny iframes',
          evidence: [{ kind: 'screenshot', uri: 'artifact:1' }]
        }
      ],
      telemetry: { duplicates: 2 },
      artifacts: [{ kind: 'screenshot', name: 'frame.png', uri: 'artifact:frame.png', sha256: 'abc' }]
    };

    const job = queueJob({
      toolId: 'reverse_analytics',
      scanId: 'scan-123',
      provider: 'chatgpt',
      model: 'gpt-4o',
      promptNotes: 'focus on stacked iframes',
      evidencePack
    });

    expect(job.status).toBe('running');

    const doneJob = await waitForStatus(job.id, 'done', 6000);
    expect(doneJob.status).toBe('done');
    expect(doneJob.resultJson).toBeTruthy();

    const parsed = JSON.parse(doneJob.resultJson);
    expect(parsed.result).toBeDefined();
    expect(parsed.result.verdict).toBeTruthy();

    if (parsed.pdfPath) {
      expect(fs.existsSync(parsed.pdfPath)).toBe(true);
    }
  });
});

