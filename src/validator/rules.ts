import { EvidenceRef } from './types';

export type Verdict = 'PASS' | 'WARN' | 'FAIL' | 'INSUFFICIENT_EVIDENCE';
type Classification = 'INSTRUMENTATION_DUPLICATION' | 'MONETIZED_INFLATION' | 'MIXED_RISK' | 'UNKNOWN';

export interface EvidencePack {
  runId: string;
  targetUrl: string;
  scannedAt: string;
  summaryFlags?: any;
  analytics?: any;
  ads?: any;
  dom?: any;
  network?: any;
  screenshots?: any;
}

export interface RuleResult {
  verdict: Verdict;
  score: number;
  confidence: number;
  classification: {
    primary: Classification;
    rationale: string;
    ruleTrace: Array<{ ruleId: string; passed: boolean; notes?: string }>;
  };
  topSignals: Array<{
    signalId: string;
    severity: 'LOW' | 'MEDIUM' | 'HIGH';
    summary: string;
    count?: number;
    evidence: EvidenceRef[];
  }>;
  gates: { g1Monetization: boolean; g2EvidenceOk: boolean; g3BenignVendor: boolean };
  features: {
    monetizedInflationSignals: boolean;
    structuralAbuseSignals: boolean;
    telemetryManipulationSignals: boolean;
    analyticsAmplifiers: boolean;
    counts: Record<string, number>;
  };
}

function anyEvidenceRefs(arr?: EvidenceRef[]) {
  return Array.isArray(arr) && arr.length > 0;
}

export function runRules(pack: EvidencePack, evidenceOk = true): RuleResult {
  const c: Record<string, number> = {};
  const sf = pack.summaryFlags || {};

  // Counts
  c.duplicateAdImpression = sf.duplicateAdImpression?.count || 0;
  c.autoRefreshInflation = sf.autoRefreshInflation?.count || 0;
  c.phantomScroll = sf.phantomScroll?.count || 0;
  c.multipleGa4Ids = sf.multipleGa4Ids?.count || 0;
  c.multipleGtmContainers = sf.multipleGtmContainers?.count || 0;
  c.pixelStuffing1x1 = sf.pixelStuffing1x1?.count || 0;
  c.hiddenTinyFrames = sf.hiddenTinyFrames?.count || 0;
  c.adStacking = sf.adStacking?.count || 0;
  c.multipleGa4PageView = sf.multipleGa4PageView?.count || 0;
  c.sessionInflation = sf.sessionInflation?.count || 0;

  // monetizedInflationSignals
  const dupImpsFlag = c.duplicateAdImpression >= 2;
  const gamImps = pack.ads?.gam?.impressions || [];
  let gamDupImps = 0;
  const seenBySlot: Record<string, number[]> = {};
  gamImps.forEach((imp: any) => {
    if (!imp.slotId || !imp.ts) return;
    const ts = new Date(imp.ts).getTime();
    seenBySlot[imp.slotId] = seenBySlot[imp.slotId] || [];
    if (seenBySlot[imp.slotId].some((t) => Math.abs(t - ts) <= 2000)) {
      gamDupImps += 1;
    }
    seenBySlot[imp.slotId].push(ts);
  });
  const dupGamImpsFlag = gamDupImps >= 2;
  const refreshLoopFlag = c.autoRefreshInflation >= 1 && !!pack.ads?.gam?.requests?.length;
  const monetizedInflationSignals = dupImpsFlag || dupGamImpsFlag || refreshLoopFlag;

  // structuralAbuseSignals
  const structuralAbuseSignals =
    c.hiddenTinyFrames >= 5 ||
    c.pixelStuffing1x1 >= 3 ||
    c.adStacking >= 10 ||
    (pack.dom?.iframes || []).some((f: any) => (f.overlappedPct || 0) >= 0.6);

  // telemetryManipulationSignals
  const telemetryManipulationSignals = c.phantomScroll >= 1 || c.sessionInflation >= 1;

  // analyticsAmplifiers
  const analyticsAmplifiers =
    c.multipleGa4Ids >= 1 || c.multipleGtmContainers >= 1 || c.multipleGa4PageView >= 1;

  // Score
  let score = 0;
  if (monetizedInflationSignals) {
    score += 45;
    if (c.duplicateAdImpression >= 10) score += 10;
    if (c.autoRefreshInflation >= 2) score += 10;
  }
  if (structuralAbuseSignals) {
    score += 35;
    if (c.adStacking >= 25) score += 10;
    if (c.hiddenTinyFrames >= 20) score += 10;
  }
  if (telemetryManipulationSignals) score += 15;
  if (analyticsAmplifiers) score += 10;

  // G3 benign vendor guard
  const benignVendor =
    (pack.analytics?.ga4?.events || []).some(
      (e: any) =>
        e.name?.startsWith('zephr_') ||
        e.name?.startsWith('consent_') ||
        e.name?.startsWith('auth_') ||
        e.source?.includes('zephr')
    ) ||
    (pack.network?.requests || []).some((r: any) => r.initiator?.includes?.('zephr'));

  const g1AllowsFail = monetizedInflationSignals;
  const g3BlocksFail = benignVendor && !monetizedInflationSignals;

  // Evidence gate
  const anyRefs =
    anyEvidenceRefs(sf.duplicateAdImpression?.evidenceRefs) ||
    anyEvidenceRefs(sf.autoRefreshInflation?.evidenceRefs) ||
    anyEvidenceRefs(sf.pixelStuffing1x1?.evidenceRefs) ||
    anyEvidenceRefs(sf.hiddenTinyFrames?.evidenceRefs) ||
    anyEvidenceRefs(sf.adStacking?.evidenceRefs) ||
    anyEvidenceRefs(sf.phantomScroll?.evidenceRefs) ||
    anyEvidenceRefs(sf.sessionInflation?.evidenceRefs) ||
    anyEvidenceRefs(sf.multipleGa4Ids?.evidenceRefs) ||
    anyEvidenceRefs(sf.multipleGtmContainers?.evidenceRefs) ||
    anyEvidenceRefs(sf.multipleGa4PageView?.evidenceRefs);
  const evidenceGate = evidenceOk && anyRefs;

  // Verdict
  let verdict: Verdict = 'PASS';
  if (!evidenceGate) {
    verdict = 'INSUFFICIENT_EVIDENCE';
    score = Math.min(score, 10);
  } else if (score >= 70 && g1AllowsFail && !g3BlocksFail) {
    verdict = 'FAIL';
  } else if (score >= 35) {
    verdict = 'WARN';
  } else {
    verdict = 'PASS';
  }

  if (verdict === 'FAIL' && !g1AllowsFail) verdict = 'WARN';
  if (g3BlocksFail && verdict === 'FAIL') verdict = 'WARN';

  const distinctSignals =
    (monetizedInflationSignals ? 1 : 0) +
    (structuralAbuseSignals ? 1 : 0) +
    (telemetryManipulationSignals ? 1 : 0) +
    (analyticsAmplifiers ? 1 : 0);
  let confidence = Math.min(95, 50 + distinctSignals * 15);
  if (verdict === 'INSUFFICIENT_EVIDENCE') confidence = Math.min(confidence, 40);

  // Classification
  let primary: Classification = 'UNKNOWN';
  if (!monetizedInflationSignals && (analyticsAmplifiers || telemetryManipulationSignals)) {
    primary = 'INSTRUMENTATION_DUPLICATION';
  } else if (monetizedInflationSignals && structuralAbuseSignals) {
    primary = 'MONETIZED_INFLATION';
  } else if (monetizedInflationSignals || structuralAbuseSignals) {
    primary = 'MIXED_RISK';
  }

  const ruleTrace = [
    { ruleId: 'G1_Monetization', passed: g1AllowsFail, notes: g1AllowsFail ? 'monetizedInflationSignals present' : 'FAIL capped' },
    { ruleId: 'G2_EvidenceRefs', passed: evidenceGate, notes: evidenceGate ? 'refs present' : 'missing refs' },
    { ruleId: 'G3_BenignVendor', passed: !g3BlocksFail, notes: g3BlocksFail ? 'benign vendor caps severity' : 'not benign' },
  ];

  const topSignals: RuleResult['topSignals'] = [];
  if (monetizedInflationSignals)
    topSignals.push({
      signalId: 'monetizedInflationSignals',
      severity: 'HIGH',
      summary: 'Monetization-linked duplication/refresh',
      count: c.duplicateAdImpression,
      evidence: sf.duplicateAdImpression?.evidenceRefs || [],
    });
  if (structuralAbuseSignals)
    topSignals.push({
      signalId: 'structuralAbuseSignals',
      severity: 'HIGH',
      summary: 'Hidden/tiny frames or stacking',
      count: c.hiddenTinyFrames || c.adStacking,
      evidence: sf.hiddenTinyFrames?.evidenceRefs || sf.adStacking?.evidenceRefs || [],
    });
  if (telemetryManipulationSignals)
    topSignals.push({
      signalId: 'telemetryManipulationSignals',
      severity: 'MEDIUM',
      summary: 'Phantom scroll or session inflation',
      count: c.phantomScroll || c.sessionInflation,
      evidence: sf.phantomScroll?.evidenceRefs || sf.sessionInflation?.evidenceRefs || [],
    });
  if (analyticsAmplifiers)
    topSignals.push({
      signalId: 'analyticsAmplifiers',
      severity: 'LOW',
      summary: 'Multiple analytics IDs / pageviews',
      count: c.multipleGa4Ids + c.multipleGa4PageView,
      evidence: sf.multipleGa4Ids?.evidenceRefs || sf.multipleGa4PageView?.evidenceRefs || [],
    });

  return {
    verdict,
    score,
    confidence,
    classification: {
      primary,
      rationale: `Score ${score}; monetized=${monetizedInflationSignals}; structural=${structuralAbuseSignals}; telemetry=${telemetryManipulationSignals}; amplifiers=${analyticsAmplifiers}`,
      ruleTrace,
    },
    topSignals,
    gates: { g1Monetization: g1AllowsFail, g2EvidenceOk: evidenceGate, g3BenignVendor: !g3BlocksFail },
    features: {
      monetizedInflationSignals,
      structuralAbuseSignals,
      telemetryManipulationSignals,
      analyticsAmplifiers,
      counts: c,
    },
  };
}

