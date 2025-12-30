import { describe, it, expect } from 'vitest';
import { computeSignals, EvidencePack } from '../../src/validator/rules';
import { runValidator } from '../../src/validator/runner';
import atlantic from './__fixtures__/atlantic.json';
import lapatilla from './__fixtures__/lapatilla.json';

// Helper LLM echo that returns baseResult from prompt (runner default already does similar)
const echoLlm = async (prompt: string) => {
  const parsed = JSON.parse(prompt);
  return JSON.stringify(parsed.baseResult);
};

describe('Rule engine gates', () => {
  it('G1 blocks FAIL when no monetized inflation', () => {
    const pack = atlantic as EvidencePack;
    const rules = computeSignals(pack);
    expect(rules.verdict === 'FAIL').toBe(false);
  });

  it('monetized signals produce FAIL', () => {
    const pack = lapatilla as EvidencePack;
    const rules = computeSignals(pack);
    expect(rules.verdict).toBe('FAIL');
  });
});

describe('Runner evidence gate', () => {
  it('returns INSUFFICIENT_EVIDENCE when no evidence refs', async () => {
    const pack: EvidencePack = {
      runId: 'empty',
      targetUrl: 'https://example.com',
      scannedAt: '2025-01-01T00:00:00Z',
      summaryFlags: {}
    };
    const result = await runValidator(pack, echoLlm);
    expect(result.verdict).toBe('INSUFFICIENT_EVIDENCE');
  });
});

describe('Classifications', () => {
  it('Instrumentation duplication stays PASS/WARN not FAIL', async () => {
    const result = await runValidator(atlantic as EvidencePack, echoLlm);
    expect(['PASS', 'WARN', 'INSUFFICIENT_EVIDENCE']).toContain(result.verdict);
    expect(result.classification.primary).toBe('INSTRUMENTATION_DUPLICATION');
  });

  it('Lapatilla scenario => FAIL and monetized/mixed risk', async () => {
    const result = await runValidator(lapatilla as EvidencePack, echoLlm);
    expect(result.verdict).toBe('FAIL');
    expect(['MONETIZED_INFLATION', 'MIXED_RISK']).toContain(result.classification.primary);
  });
});

