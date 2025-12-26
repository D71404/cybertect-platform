export async function mockAiValidate({ toolId, scanId, evidencePack, promptNotes }) {
  await new Promise((r) => setTimeout(r, 600)); // simulate latency
  const verdict = 'likely_inflation';
  const confidence = 0.72;
  const findings = (evidencePack?.findings || []).slice(0, 3);

  return {
    jobId: `mock-${Date.now()}`,
    status: 'done',
    result: {
      verdict,
      confidence,
      key_findings:
        findings.length > 0
          ? findings.map((f, idx) => ({
              title: f.type || `Finding ${idx + 1}`,
              detail: f.description || 'Flagged item from evidence pack',
              confidence: f.severity === 'high' ? 0.9 : f.severity === 'med' ? 0.6 : 0.4,
              evidence_refs: (f.evidence || []).map((_, i) => `finding:${idx}-${i}`),
            }))
          : [
              {
                title: 'Mock finding',
                detail: 'Simulated inflation signal for demo',
                confidence: confidence,
                evidence_refs: ['artifact:mock'],
              },
            ],
      duplicate_assessment: {
        has_duplicates: true,
        likely_tool_error: false,
        notes: 'Mock: duplicate endpoints detected',
      },
      inflation_signals: [
        { signal: 'Beacon > GPT renders', strength: 'strong', evidence_refs: ['log:mock'] },
      ],
      recommended_actions: ['Review flagged placements', 'Reconcile with ad server', 'Capture fresh run'],
      missing_data_requests: [],
      _mock: true,
      promptNotes,
      toolId,
      scanId,
    },
  };
}

