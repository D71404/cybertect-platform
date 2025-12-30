import React from 'react';
import { ValidatorResult } from '../validator/schema';

const verdictColors: Record<string, string> = {
  PASS: 'bg-green-50 text-green-800 border-green-200',
  WARN: 'bg-yellow-50 text-yellow-800 border-yellow-200',
  FAIL: 'bg-red-50 text-red-800 border-red-200',
  INSUFFICIENT_EVIDENCE: 'bg-gray-50 text-gray-700 border-gray-200',
};

type Props = { result: ValidatorResult | null };

export const AiValidatorPanel: React.FC<Props> = ({ result }) => {
  if (!result) return null;
  const vc = verdictColors[result.verdict] || verdictColors.WARN;
  return (
    <div className="border rounded-xl p-4 shadow-sm bg-white space-y-4">
      <div className={`rounded-lg border p-3 ${vc}`}>
        <div className="flex items-center justify-between">
          <div className="font-semibold">Verdict: {result.verdict}</div>
          <div className="text-sm text-gray-600">
            Score: {result.score} | Confidence: {result.confidence}%
          </div>
        </div>
      </div>

      <div>
        <h4 className="font-semibold mb-2">Top Signals</h4>
        <ul className="space-y-2">
          {result.topSignals.map((s) => (
            <li key={s.signalId} className="border rounded-md p-2">
              <div className="flex justify-between">
                <span className="font-semibold">{s.signalId}</span>
                <span className="text-xs text-gray-500">Severity: {s.severity}</span>
              </div>
              <div className="text-sm text-gray-700">{s.summary}</div>
              <div className="text-xs text-gray-500 mt-1">
                Evidence: {s.evidence.map((e) => e.pointer).join(', ')}
              </div>
            </li>
          ))}
        </ul>
      </div>

      <div>
        <h4 className="font-semibold mb-2">Findings</h4>
        <ul className="space-y-3">
          {result.findings.map((f) => (
            <li key={f.findingId} className="border rounded-md p-3">
              <div className="flex justify-between">
                <span className="font-semibold">{f.title}</span>
                <span className="text-xs text-gray-500">Impact: {f.impact}</span>
              </div>
              <div className="text-sm text-gray-700 mt-1">{f.description}</div>
              <div className="text-xs text-gray-500 mt-1">
                Evidence: {f.evidence.map((e) => e.pointer).join(', ')}
              </div>
              <div className="text-xs text-gray-600 mt-2">
                False-positive checks: {f.falsePositiveChecks.join('; ')}
              </div>
              <div className="text-xs text-gray-600 mt-1">
                Recommended actions: {f.recommendedActions.join('; ')}
              </div>
            </li>
          ))}
        </ul>
      </div>

      <div className="text-xs text-gray-500 space-y-1">
        <div>
          <strong>Exec Summary:</strong> {result.auditorSafeLanguage.executiveSummary}
        </div>
        <div>
          <strong>Methodology:</strong> {result.auditorSafeLanguage.methodologyNote}
        </div>
        <div>
          <strong>Limitations:</strong> {result.auditorSafeLanguage.limitationNote}
        </div>
      </div>
    </div>
  );
};

export default AiValidatorPanel;

