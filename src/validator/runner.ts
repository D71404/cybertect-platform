import { ValidatorResultSchema } from './schema';
import { runRules } from './rules';
import { VALIDATOR_PROMPT } from './prompt';
import { callModel } from './llm'; // assume existing or mock provider

const MAX_EVIDENCE = 10;

function trim(arr: any[] = [], max = MAX_EVIDENCE) {
  return arr.slice(0, max);
}

function buildFacts(pack: any, rules: ReturnType<typeof runRules>) {
  return {
    runId: pack.runId,
    targetUrl: pack.targetUrl,
    scannedAt: pack.scannedAt,
    summaryCounts: rules.features.counts,
    monetizedInflationSignals: rules.features.monetizedInflationSignals,
    structuralAbuseSignals: rules.features.structuralAbuseSignals,
    telemetryManipulationSignals: rules.features.telemetryManipulationSignals,
    analyticsAmplifiers: rules.features.analyticsAmplifiers,
  };
}

export async function runValidator(pack: any, { provider = 'chatgpt', model = 'gpt-4o' } = {}) {
  const rules = runRules(pack, true);

  const target = {
    domain: (() => {
      try {
        return new URL(pack.targetUrl).hostname;
      } catch {
        return '';
      }
    })(),
    url: pack.targetUrl || '',
    runId: pack.runId || '',
    scannedAt: pack.scannedAt || '',
  };

  const baseResult = {
    verdict: rules.verdict,
    score: rules.score,
    confidence: rules.confidence,
    classification: rules.classification,
    topSignals: rules.topSignals,
    findings: [] as any[],
    auditorSafeLanguage: {
      executiveSummary: '',
      methodologyNote: '',
      limitationNote: '',
    },
    target,
  };

  const facts = buildFacts(pack, rules);
  const trimmedEvidence = {
    ...pack,
    dom: {
      iframes: trim(pack.dom?.iframes || []),
      scripts: trim(pack.dom?.scripts || []),
    },
    network: {
      requests: trim(pack.network?.requests || []),
    },
    screenshots: trim(pack.screenshots || []),
  };

  const decision = {
    verdict: rules.verdict,
    score: rules.score,
    confidence: rules.confidence,
    gates: rules.gates,
    classification: rules.classification,
  };

  const prompt = VALIDATOR_PROMPT
    .replace('<FACTS_JSON>', JSON.stringify(facts, null, 2))
    .replace('<DECISION_JSON>', JSON.stringify(decision, null, 2))
    .replace('<EVIDENCE_JSON>', JSON.stringify(trimmedEvidence, null, 2));

  async function tryOnce(p: string) {
    const raw = await callModel({ provider, model, prompt: p });
    const parsed = JSON.parse(raw);
    const res = ValidatorResultSchema.parse(parsed);
    return res;
  }

  try {
    return await tryOnce(prompt);
  } catch {
    const retryPrompt = prompt + '\nYou must output valid JSON only. Do not add text.';
    try {
      return await tryOnce(retryPrompt);
    } catch {
      return {
        ...baseResult,
        verdict: 'INSUFFICIENT_EVIDENCE',
        confidence: Math.min(rules.confidence, 40),
        findings: [],
        auditorSafeLanguage: {
          executiveSummary: 'Insufficient evidence to reach a conclusive verdict.',
          methodologyNote: 'Rules executed; model output invalid; returned fallback.',
          limitationNote: 'EvidenceRefs missing or model failed schema validation.',
        },
      };
    }
  }
}

