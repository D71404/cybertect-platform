import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

export interface Policy {
  env: string;
  allowedVendors: string[];
  allowedIds: Record<string, string[]>;
  allowedDomains: string[];
}

const DEFAULT_POLICY: Policy = {
  env: 'live',
  allowedVendors: [],
  allowedIds: {},
  allowedDomains: [],
};

export function loadPolicy(policyPath?: string): Policy {
  if (!policyPath) {
    return DEFAULT_POLICY;
  }

  const full = path.resolve(policyPath);
  if (!fs.existsSync(full)) {
    throw new Error(`Policy file not found: ${full}`);
  }
  const content = fs.readFileSync(full, 'utf-8');
  const raw = yaml.load(content) as Partial<Policy>;
  return {
    env: raw?.env ?? DEFAULT_POLICY.env,
    allowedVendors: raw?.allowedVendors ?? DEFAULT_POLICY.allowedVendors,
    allowedIds: raw?.allowedIds ?? DEFAULT_POLICY.allowedIds,
    allowedDomains: raw?.allowedDomains ?? DEFAULT_POLICY.allowedDomains,
  };
}
