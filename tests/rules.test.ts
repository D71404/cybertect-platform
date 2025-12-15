import { describe, it, expect } from 'vitest';
import { runRules } from '../src/rules.js';

describe('runRules', () => {
  it('flags obfuscation when eval present', () => {
    const findings = runRules({
      vendorMatches: [],
      beaconCounts: {},
      partnerDomains: {},
      inlineScriptPreviews: ['function test(){ eval("alert(1)") }'],
      policy: { env: 'live', allowedVendors: [], allowedIds: {}, allowedDomains: [] },
      beaconThreshold: 5,
    });
    expect(findings.some((f) => f.type === 'obfuscation')).toBe(true);
  });

  it('flags unauthorized partner when not in policy', () => {
    const findings = runRules({
      vendorMatches: [],
      beaconCounts: {},
      partnerDomains: { 'rogue.example': 3 },
      inlineScriptPreviews: [],
      policy: { env: 'live', allowedVendors: [], allowedIds: {}, allowedDomains: ['allowed.example'] },
      beaconThreshold: 5,
    });
    expect(findings.find((f) => f.type === 'unauthorized_partner')).toBeTruthy();
  });
});
