import { Brain, Loader2 } from 'lucide-react';

export function AIValidateModal({
  open,
  provider,
  model,
  notes,
  onProviderChange,
  onModelChange,
  onNotesChange,
  onSubmit,
  onClose,
  loading,
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center px-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Brain className="w-5 h-5 text-indigo-600" />
            <h3 className="text-lg font-semibold text-gray-900">Send to AI Validator</h3>
          </div>
          <button
            onClick={onClose}
            className="text-sm text-gray-500 hover:text-gray-700"
            disabled={loading}
          >
            Close
          </button>
        </div>

        <div className="px-6 py-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Provider</label>
            <select
              value={provider}
              onChange={(e) => onProviderChange(e.target.value)}
              className="w-full rounded-lg border-gray-300 focus:ring-indigo-500 focus:border-indigo-500 text-sm"
              disabled={loading}
            >
              <option value="chatgpt">ChatGPT</option>
              <option value="gemini" disabled>Gemini (coming soon)</option>
              <option value="perplexity" disabled>Perplexity (coming soon)</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Model</label>
            <input
              type="text"
              value={model}
              onChange={(e) => onModelChange(e.target.value)}
              className="w-full rounded-lg border-gray-300 focus:ring-indigo-500 focus:border-indigo-500 text-sm"
              placeholder="gpt-4o"
              disabled={loading}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Optional notes (what should the AI focus on?)
            </label>
            <textarea
              value={notes}
              onChange={(e) => onNotesChange(e.target.value)}
              rows={3}
              className="w-full rounded-lg border-gray-300 focus:ring-indigo-500 focus:border-indigo-500 text-sm"
              placeholder="Call out stacked iframes, GPT slot/render alignment, ID sync storm..."
              disabled={loading}
            />
          </div>
        </div>

        <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-700 hover:text-gray-900"
            disabled={loading}
          >
            Cancel
          </button>
          <button
            onClick={onSubmit}
            disabled={loading}
            className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-semibold hover:bg-indigo-700 disabled:opacity-60"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Brain className="w-4 h-4" />}
            {loading ? 'Sending...' : 'Send for Validation'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default AIValidateModal;

