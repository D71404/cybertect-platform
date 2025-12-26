const { describe, it, expect, beforeEach } = require('vitest');
const Ajv = require('ajv');
const addFormats = require('ajv-formats');
const schema = require('../ai-validation/schemas/ai_validation_v2.schema.json');

describe('AI Validation v2 schema', () => {
  let validate;

  beforeEach(() => {
    const ajv = new Ajv({ allErrors: true, strict: false });
    addFormats(ajv);
    validate = ajv.compile(schema);
  });

  it('accepts a valid result', () => {
    const result = {
      verdict: 'likely_inflation',
      confidence: 0.72,
      key_findings: [
        {
          title: 'Stacked iframes',
          detail: 'Multiple offscreen/tiny iframes detected with impression beacons',
          confidence: 0.83,
          evidence_refs: ['finding:0-0', 'artifact:screenshot-1']
        }
      ],
      duplicate_assessment: {
        has_duplicates: true,
        likely_tool_error: false,
        notes: 'Duplicate endpoints detected across beacon calls'
      },
      inflation_signals: [
        { signal: 'Beacon > GPT renders', strength: 'strong', evidence_refs: ['log:beacons'] }
      ],
      recommended_actions: ['Block offending placements', 'Reconcile with ad server'],
      missing_data_requests: []
    };

    expect(validate(result)).toBe(true);
    expect(validate.errors).toBeNull();
  });

  it('rejects invalid verdict or missing fields', () => {
    const result = {
      verdict: 'INVALID',
      confidence: 1.2,
      key_findings: [],
      duplicate_assessment: { has_duplicates: true, likely_tool_error: false, notes: 'x' },
      inflation_signals: [],
      recommended_actions: [],
      missing_data_requests: []
    };
    expect(validate(result)).toBe(false);
  });

  it('requires duplicate_assessment and key findings structure', () => {
    const result = {
      verdict: 'verified',
      confidence: 0.9,
      key_findings: [
        { title: 'x', detail: 'y', confidence: 0.3, evidence_refs: ['artifact:x'] }
      ],
      // missing duplicate_assessment
      inflation_signals: [],
      recommended_actions: [],
      missing_data_requests: []
    };
    expect(validate(result)).toBe(false);
  });
});

