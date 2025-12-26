import { AlertCircle, CheckCircle2, FileText, Loader2 } from 'lucide-react';

const verdictColors = {
  verified: 'bg-green-50 text-green-800 border-green-200',
  likely_inflation: 'bg-red-50 text-red-800 border-red-200',
  inconclusive: 'bg-yellow-50 text-yellow-800 border-yellow-200',
  needs_more_data: 'bg-gray-50 text-gray-700 border-gray-200',
};

export function ValidationReportPanel({ result, jobId, status, onExportPdf, exporting }) {
  if (!result) return null;
  const verdictClass = verdictColors[result.verdict] || verdictColors.needs_more_data;

  return (
    <div className="mt-4 border rounded-xl shadow-sm bg-white">
      <div className={`p-4 border-b ${verdictClass}`}>
        <div className="flex items-center gap-2">
          {result.verdict === 'verified' ? (
            <CheckCircle2 className="w-5 h-5" />
          ) : (
            <AlertCircle className="w-5 h-5" />
          )}
          <div>
            <p className="text-sm font-semibold">Verdict: {result.verdict}</p>
            <p className="text-xs opacity-80">
              Confidence: {(result.confidence * 100).toFixed(1)}%
            </p>
          </div>
        </div>
      </div>

      <div className="p-4 space-y-4">
        <section>
          <div className="flex items-center justify-between mb-1">
            <h4 className="text-sm font-semibold text-gray-900">Key Findings</h4>
            {jobId ? <span className="text-xs text-gray-500">Job {jobId}</span> : null}
          </div>
          <ul className="space-y-2">
            {(result.key_findings || []).map((finding, idx) => (
              <li key={idx} className="border rounded-lg p-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-gray-900">{finding.title}</p>
                  <span className="text-xs text-gray-500">
                    {(finding.confidence * 100).toFixed(0)}%
                  </span>
                </div>
                <p className="text-sm text-gray-700 mt-1">{finding.detail}</p>
                {finding.evidence_refs?.length ? (
                  <p className="text-xs text-gray-500 mt-2">
                    Evidence: {finding.evidence_refs.join(', ')}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </section>

        {result.inflation_signals?.length ? (
          <section>
            <h4 className="text-sm font-semibold text-gray-900 mb-1">Inflation Signals</h4>
            <ul className="space-y-1">
              {result.inflation_signals.map((s, idx) => (
                <li key={idx} className="text-sm text-gray-700">
                  <span className="font-semibold">{s.signal}</span> — {s.strength}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {result.recommended_actions?.length ? (
          <section>
            <h4 className="text-sm font-semibold text-gray-900 mb-1">Recommended Actions</h4>
            <ul className="list-disc pl-5 space-y-1 text-sm text-gray-700">
              {result.recommended_actions.map((a, idx) => (
                <li key={idx}>{a}</li>
              ))}
            </ul>
          </section>
        ) : null}

        {result.missing_data_requests?.length ? (
          <section>
            <h4 className="text-sm font-semibold text-gray-900 mb-1">Missing Data</h4>
            <ul className="list-disc pl-5 space-y-1 text-sm text-gray-700">
              {result.missing_data_requests.map((a, idx) => (
                <li key={idx}>{a}</li>
              ))}
            </ul>
          </section>
        ) : null}

        <div className="flex justify-end">
          <button
            onClick={onExportPdf}
            disabled={exporting || status !== 'done'}
            className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-semibold hover:bg-emerald-700 disabled:opacity-60"
          >
            {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
            {exporting ? 'Preparing PDF...' : 'Export Validation PDF'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ValidationReportPanel;

