import type {
  EvidencePackInput,
  GptEvent,
  IframeRecord,
  RunMetadata,
  TagRecord
} from '../evidence/pack-writer';

export type EvidencePack = Omit<EvidencePackInput, 'networkHar' | 'screenshots' | 'domSnapshots'> & {
  networkHar?: unknown;
  domSnapshots?: {
    initial?: string;
    t3?: string;
    t6?: string;
  };
  screenshots?: {
    full?: Buffer | string;
    crops?: Record<string, Buffer | string>;
  };
};

export interface ModuleResult {
  status: 'PASS' | 'PARTIAL' | 'FAIL';
  level?: 'Observed' | 'Supported' | 'Confirmed';
  reasons?: string[];
  metrics?: Record<string, number>;
}

export interface EvaluatedModules {
  tagInventory: ModuleResult;
  cmsDrift: ModuleResult;
  publisherForensics: ModuleResult;
  adImpression: ModuleResult;
  injectedTelemetry: ModuleResult;
  analyticsIntegrity: ModuleResult;
}

export type FeatureFlags = {
  tagInventory: boolean;
  cmsDrift: boolean;
  publisherForensics: boolean;
  adImpression: boolean;
  injectedTelemetry: boolean;
  analyticsIntegrity: boolean;
};

export type LoadedPack = {
  metadata: RunMetadata;
  networkHar?: unknown;
  domSnapshots?: EvidencePack['domSnapshots'];
  iframes?: IframeRecord[];
  tags?: TagRecord[];
  gptEvents?: GptEvent[];
};

