import { z } from 'zod';

export const EvidenceRefSchema = z.object({
  type: z.enum(['network', 'dom', 'analytics', 'screenshot', 'log']),
  id: z.string(),
  pointer: z.string(),
});

export const ValidatorResultSchema = z.object({
  verdict: z.enum(['PASS', 'WARN', 'FAIL', 'INSUFFICIENT_EVIDENCE']),
  score: z.number(),
  confidence: z.number().min(0).max(100),
  target: z.object({
    domain: z.string(),
    url: z.string(),
    runId: z.string(),
    scannedAt: z.string(),
  }),
  classification: z.object({
    primary: z.enum(['INSTRUMENTATION_DUPLICATION', 'MONETIZED_INFLATION', 'MIXED_RISK', 'UNKNOWN']),
    rationale: z.string(),
    ruleTrace: z.array(
      z.object({
        ruleId: z.string(),
        passed: z.boolean(),
        notes: z.string().optional(),
      })
    ),
  }),
  topSignals: z.array(
    z.object({
      signalId: z.string(),
      severity: z.enum(['LOW', 'MEDIUM', 'HIGH']),
      summary: z.string(),
      count: z.number().optional(),
      evidence: z.array(EvidenceRefSchema).nonempty(),
    })
  ),
  findings: z.array(
    z.object({
      findingId: z.string(),
      title: z.string(),
      description: z.string(),
      impact: z.enum(['NONE', 'LOW', 'MEDIUM', 'HIGH']),
      evidence: z.array(EvidenceRefSchema).nonempty(),
      falsePositiveChecks: z.array(z.string()),
      recommendedActions: z.array(z.string()),
    })
  ),
  auditorSafeLanguage: z.object({
    executiveSummary: z.string(),
    methodologyNote: z.string(),
    limitationNote: z.string(),
  }),
});

export type ValidatorResult = z.infer<typeof ValidatorResultSchema>;

