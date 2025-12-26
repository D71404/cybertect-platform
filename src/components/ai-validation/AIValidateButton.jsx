import { useCallback, useEffect, useMemo, useState } from 'react';
import { Brain, ShieldCheck, Loader2 } from 'lucide-react';
import AIValidateModal from './AIValidateModal';
import ValidationReportPanel from './ValidationReportPanel';
import { mockAiValidate } from './mockAiValidate';

const pollIntervalMs = 2500;

export function AIValidateButton({ toolId, scanId, evidencePackGetter, className = '' }) {
  const [open, setOpen] = useState(false);
  const [provider, setProvider] = useState('chatgpt');
  const [model, setModel] = useState('gpt-4o');
  const [notes, setNotes] = useState('');
  const [status, setStatus] = useState('idle'); // idle | uploading | running | done | failed
  const [jobId, setJobId] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [exporting, setExporting] = useState(false);

  const reset = useCallback(() => {
    setStatus('idle');
    setJobId(null);
    setResult(null);
    setError(null);
    setExporting(false);
  }, []);

  const startPolling = useCallback(
    (job) => {
      const interval = setInterval(async () => {
        try {
          const res = await fetch(`/api/ai/validate/${job}`);
          const data = await res.json();
          if (data.status === 'done') {
            setStatus('done');
            setResult(data.result || null);
            setJobId(data.jobId);
            clearInterval(interval);
            console.log('[analytics] ai_validate_completed', { toolId, scanId, jobId: data.jobId });
          } else if (data.status === 'failed') {
            setStatus('failed');
            setError(data.error || 'Validation failed');
            clearInterval(interval);
          }
        } catch (e) {
          console.error('Polling error', e);
        }
      }, pollIntervalMs);
      return interval;
    },
    [toolId, scanId]
  );

  useEffect(() => {
    let interval;
    if (jobId && (status === 'running' || status === 'uploading')) {
      interval = startPolling(jobId);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [jobId, status, startPolling]);

  const handleSend = useCallback(async () => {
    setStatus('uploading');
    setError(null);
    try {
      const evidencePack = await evidencePackGetter();
      // Use backend endpoint; it will fall back to mock if no API key
      const payload = { toolId, scanId, provider, model, promptNotes: notes, evidencePack };
      const res = await fetch('/api/ai/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const msg = await res.json().catch(() => ({}));
        throw new Error(msg.error || 'Failed to start validation');
      }
      const data = await res.json();
      setJobId(data.jobId);
      setStatus('running');
      setOpen(false);
    } catch (e) {
      setStatus('failed');
      setError(e.message);
    }
  }, [evidencePackGetter, model, notes, provider, scanId, toolId]);

  const handleExportPdf = useCallback(async () => {
    if (!jobId) return;
    setExporting(true);
    try {
      const res = await fetch(`/api/ai/validate/${jobId}/pdf`, { method: 'POST' });
      if (!res.ok) {
        const msg = await res.json().catch(() => ({}));
        throw new Error(msg.error || 'PDF not ready');
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `validation-${jobId}.pdf`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (e) {
      setError(e.message);
    } finally {
      setExporting(false);
    }
  }, [jobId]);

  const ctaLabel = useMemo(() => {
    if (status === 'running') return 'Validation running...';
    if (status === 'uploading') return 'Uploading evidence...';
    if (status === 'done') return 'View Validation';
    if (status === 'failed') return 'Retry AI Validation';
    return 'AI Validate';
  }, [status]);

  return (
    <div className={`space-y-3 ${className}`}>
      <button
        onClick={() => {
          reset();
          setOpen(true);
        }}
        className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-semibold hover:bg-indigo-700 disabled:opacity-60"
        disabled={status === 'uploading' || status === 'running'}
      >
        {status === 'uploading' || status === 'running' ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <Brain className="w-4 h-4" />
        )}
        {ctaLabel}
      </button>

      {error ? (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {error}
        </div>
      ) : null}

      <AIValidateModal
        open={open}
        provider={provider}
        model={model}
        notes={notes}
        onProviderChange={setProvider}
        onModelChange={setModel}
        onNotesChange={setNotes}
        onSubmit={handleSend}
        onClose={() => setOpen(false)}
        loading={status === 'uploading' || status === 'running'}
      />

      <ValidationReportPanel
        result={result}
        jobId={jobId}
        status={status}
        onExportPdf={handleExportPdf}
        exporting={exporting}
      />

      {status !== 'idle' && !result ? (
        <p className="text-xs text-gray-500">Status: {status}{jobId ? ` (job ${jobId})` : ''}</p>
      ) : null}
    </div>
  );
}

export default AIValidateButton;

