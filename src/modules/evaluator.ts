import { loadEvidencePack } from './load-pack';
import { resolveFeatureFlags } from './featureFlags';
import {
  evaluateAdImpression,
  evaluateAnalyticsIntegrity,
  evaluateCmsDrift,
  evaluateInjectedTelemetry,
  evaluatePublisherForensics,
  evaluateTagInventory
} from './evaluators';
import type { EvaluatedModules, FeatureFlags, LoadedPack, ModuleResult } from './types';

export { loadEvidencePack };

export function evaluateModules(pack: LoadedPack, featureOverrides?: Record<string, boolean>): EvaluatedModules {
  const flags: FeatureFlags = resolveFeatureFlags(featureOverrides ?? pack.metadata.featureFlags);

  const noop: ModuleResult = { status: 'PARTIAL', reasons: ['Module disabled'], level: 'Observed' };

  return {
    tagInventory: flags.tagInventory ? evaluateTagInventory(pack) : noop,
    cmsDrift: flags.cmsDrift ? evaluateCmsDrift(pack) : noop,
    publisherForensics: flags.publisherForensics ? evaluatePublisherForensics(pack) : noop,
    adImpression: flags.adImpression ? evaluateAdImpression(pack) : noop,
    injectedTelemetry: flags.injectedTelemetry ? evaluateInjectedTelemetry(pack) : noop,
    analyticsIntegrity: flags.analyticsIntegrity ? evaluateAnalyticsIntegrity(pack) : noop
  };
}

