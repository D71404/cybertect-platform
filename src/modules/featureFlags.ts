import type { FeatureFlags } from './types';

export const defaultFeatureFlags: FeatureFlags = {
  tagInventory: true,
  cmsDrift: true,
  publisherForensics: true,
  adImpression: false,
  injectedTelemetry: false,
  analyticsIntegrity: false
};

export function resolveFeatureFlags(overrides?: Record<string, boolean>): FeatureFlags {
  return {
    tagInventory: overrides?.tagInventory ?? defaultFeatureFlags.tagInventory,
    cmsDrift: overrides?.cmsDrift ?? defaultFeatureFlags.cmsDrift,
    publisherForensics: overrides?.publisherForensics ?? defaultFeatureFlags.publisherForensics,
    adImpression: overrides?.adImpression ?? defaultFeatureFlags.adImpression,
    injectedTelemetry: overrides?.injectedTelemetry ?? defaultFeatureFlags.injectedTelemetry,
    analyticsIntegrity: overrides?.analyticsIntegrity ?? defaultFeatureFlags.analyticsIntegrity
  };
}

