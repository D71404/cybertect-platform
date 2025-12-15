import type { Policy } from './policy.js';
import type { VendorMatch } from './classify.js';

export type Severity = 'info' | 'low' | 'medium' | 'high' | 'critical';

export interface Finding {
  type:
    | 'cloned_tag'
    | 'duplicate_container'
    | 'beacon_burst'
    | 'unauthorized_partner'
    | 'id_mismatch'
    | 'obfuscation';
  severity: Severity;
  detail: string;
  evidence?: string;
}

export interface RuleInputs {
  vendorMatches: VendorMatch[];
  beaconCounts: Record<string, number>;
  partnerDomains: Record<string, number>;
  inlineScriptPreviews: string[];
  policy: Policy;
  beaconThreshold: number;
}

export function runRules(input: RuleInputs): Finding[] {
  const findings: Finding[] = [];

  for (const match of input.vendorMatches) {
    const counts = input.beaconCounts[match.vendor] || 0;
    if (match.ids.length > 1) {
      findings.push({
        type: 'duplicate_container',
        severity: 'medium',
        detail: `Multiple configurations detected for ${match.vendor}: ${match.ids.join(', ')}`,
      });
    }
    if (counts > input.beaconThreshold) {
      findings.push({
        type: 'beacon_burst',
        severity: 'high',
        detail: `${counts} telemetry requests for ${match.vendor} exceeds threshold ${input.beaconThreshold}`,
      });
    }
    if (input.policy.allowedVendors.length && !input.policy.allowedVendors.includes(match.vendor)) {
      findings.push({
        type: 'unauthorized_partner',
        severity: 'high',
        detail: `Vendor ${match.vendor} not allowed by policy`,
      });
    }
    const allowedIds = input.policy.allowedIds[match.vendor];
    if (allowedIds?.length) {
      const unexpected = match.ids.filter((id) => !allowedIds.includes(id));
      if (unexpected.length) {
        findings.push({
          type: 'id_mismatch',
          severity: 'high',
          detail: `Vendor ${match.vendor} uses unapproved IDs: ${unexpected.join(', ')}`,
        });
      }
    }
  }

  Object.entries(input.partnerDomains).forEach(([domain, count]) => {
    if (input.policy.allowedDomains.length && !input.policy.allowedDomains.includes(domain)) {
      findings.push({
        type: 'unauthorized_partner',
        severity: 'medium',
        detail: `Domain ${domain} observed (${count} requests) is not in policy allowlist`,
      });
    }
  });

  input.inlineScriptPreviews.forEach((preview) => {
    const text = preview.toLowerCase();
    if (text.includes('eval(') || text.includes('atob(') || /[A-Za-z0-9+/]{80,}={0,2}/.test(preview)) {
      findings.push({
        type: 'obfuscation',
        severity: 'critical',
        detail: 'Inline script appears to contain obfuscation (eval/atob/base64 chunk).',
        evidence: preview.slice(0, 120),
      });
    }
  });

  return findings;
}
