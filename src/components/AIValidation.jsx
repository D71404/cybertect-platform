import { useState, useEffect } from 'react';
import { Upload, FileCheck, Brain, Download, AlertCircle, CheckCircle, AlertTriangle } from 'lucide-react';

function AIValidation() {
  const [evidencePack, setEvidencePack] = useState(null);
  const [findingsJson, setFindingsJson] = useState(null);
  const [template, setTemplate] = useState('ad-impression-inflation');
  const [provider, setProvider] = useState('openai');
  const [redactionMode, setRedactionMode] = useState(false);
  const [loading, setLoading] = useState(false);
  const [uploadId, setUploadId] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [templates, setTemplates] = useState([]);
  const [providers, setProviders] = useState([]);
  const [polling, setPolling] = useState(false);

  // Load templates and providers on mount
  useEffect(() => {
    loadTemplates();
    loadProviders();
  }, []);

  // Poll for results when validation is running
  useEffect(() => {
    if (polling && uploadId) {
      const interval = setInterval(() => {
        checkResult();
      }, 3000); // Poll every 3 seconds

      return () => clearInterval(interval);
    }
  }, [polling, uploadId]);

  const loadTemplates = async () => {
    try {
      const response = await fetch('/api/ai-validation/templates');
      const data = await response.json();
      if (data.success) {
        setTemplates(data.templates);
      }
    } catch (error) {
      console.error('Failed to load templates:', error);
    }
  };

  const loadProviders = async () => {
    try {
      const response = await fetch('/api/ai-validation/providers');
      const data = await response.json();
      if (data.success) {
        setProviders(data.providers);
      }
    } catch (error) {
      console.error('Failed to load providers:', error);
    }
  };

  const handleEvidencePackChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      if (!file.name.endsWith('.zip')) {
        setError('Please upload a ZIP file');
        return;
      }
      setEvidencePack(file);
      setError(null);
    }
  };

  const handleFindingsJsonChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      if (!file.name.endsWith('.json')) {
        setError('Please upload a JSON file');
        return;
      }
      setFindingsJson(file);
      setError(null);
    }
  };

  const handleUpload = async () => {
    if (!evidencePack) {
      setError('Please upload an evidence pack');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Upload evidence pack
      const formData = new FormData();
      formData.append('evidencePack', evidencePack);

      const uploadResponse = await fetch('/api/ai-validation/upload', {
        method: 'POST',
        body: formData
      });

      const uploadData = await uploadResponse.json();

      if (!uploadData.success) {
        throw new Error(uploadData.error || 'Upload failed');
      }

      setUploadId(uploadData.uploadId);

      // Run validation
      const runPayload = {
        uploadId: uploadData.uploadId,
        provider,
        template,
        redaction: redactionMode
      };

      // If findings JSON is provided, read and include it
      if (findingsJson) {
        const findingsText = await findingsJson.text();
        runPayload.findingsJson = findingsText;
      }

      const runResponse = await fetch('/api/ai-validation/run', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(runPayload)
      });

      const runData = await runResponse.json();

      if (!runData.success) {
        throw new Error(runData.error || 'Validation failed to start');
      }

      // Start polling for results
      setPolling(true);

    } catch (error) {
      setError(error.message);
      setLoading(false);
    }
  };

  const checkResult = async () => {
    if (!uploadId) return;

    try {
      const response = await fetch(`/api/ai-validation/result/${uploadId}`);
      const data = await response.json();

      if (response.ok && data.success) {
        // Result is ready
        setResult(data);
        setPolling(false);
        setLoading(false);
      } else if (response.status === 404) {
        // Still processing
        console.log('Still processing...');
      } else {
        // Error occurred
        throw new Error(data.error || 'Failed to get result');
      }
    } catch (error) {
      console.error('Error checking result:', error);
      // Don't stop polling on transient errors
    }
  };

  const resetForm = () => {
    setEvidencePack(null);
    setFindingsJson(null);
    setUploadId(null);
    setResult(null);
    setError(null);
    setLoading(false);
    setPolling(false);
  };

  const getVerdictIcon = (label) => {
    switch (label) {
      case 'PASS':
        return <CheckCircle className="w-12 h-12 text-green-500" />;
      case 'WARN':
        return <AlertTriangle className="w-12 h-12 text-yellow-500" />;
      case 'FAIL':
        return <AlertCircle className="w-12 h-12 text-red-500" />;
      default:
        return null;
    }
  };

  const getVerdictColor = (label) => {
    switch (label) {
      case 'PASS':
        return 'bg-green-50 border-green-200 text-green-800';
      case 'WARN':
        return 'bg-yellow-50 border-yellow-200 text-yellow-800';
      case 'FAIL':
        return 'bg-red-50 border-red-200 text-red-800';
      default:
        return 'bg-gray-50 border-gray-200 text-gray-800';
    }
  };

  const getRiskBadgeColor = (risk) => {
    switch (risk) {
      case 'HIGH':
        return 'bg-red-100 text-red-800';
      case 'MEDIUM':
        return 'bg-yellow-100 text-yellow-800';
      case 'LOW':
        return 'bg-green-100 text-green-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-white to-blue-50 p-8">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="flex items-center justify-center mb-4">
            <Brain className="w-12 h-12 text-purple-600 mr-3" />
            <h1 className="text-4xl font-bold text-gray-900">AI Validation</h1>
          </div>
          <p className="text-gray-600 text-lg">
            Upload an evidence pack and let AI validate your findings with schema-verified results
          </p>
        </div>

        {/* Main Content */}
        {!result ? (
          <div className="bg-white rounded-lg shadow-lg p-8">
            {/* Upload Section */}
            <div className="space-y-6">
              {/* Evidence Pack Upload */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Evidence Pack (ZIP) *
                </label>
                <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center hover:border-purple-400 transition-colors">
                  <Upload className="w-8 h-8 text-gray-400 mx-auto mb-2" />
                  <input
                    type="file"
                    accept=".zip"
                    onChange={handleEvidencePackChange}
                    className="hidden"
                    id="evidence-pack-upload"
                    disabled={loading}
                  />
                  <label
                    htmlFor="evidence-pack-upload"
                    className="cursor-pointer text-purple-600 hover:text-purple-700 font-medium"
                  >
                    {evidencePack ? evidencePack.name : 'Click to upload evidence pack'}
                  </label>
                  <p className="text-xs text-gray-500 mt-1">ZIP file containing network logs, sequences, etc.</p>
                </div>
              </div>

              {/* Findings JSON Upload (Optional) */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Findings JSON (Optional)
                </label>
                <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center hover:border-purple-400 transition-colors">
                  <FileCheck className="w-8 h-8 text-gray-400 mx-auto mb-2" />
                  <input
                    type="file"
                    accept=".json"
                    onChange={handleFindingsJsonChange}
                    className="hidden"
                    id="findings-json-upload"
                    disabled={loading}
                  />
                  <label
                    htmlFor="findings-json-upload"
                    className="cursor-pointer text-purple-600 hover:text-purple-700 font-medium"
                  >
                    {findingsJson ? findingsJson.name : 'Click to upload findings JSON'}
                  </label>
                  <p className="text-xs text-gray-500 mt-1">Additional findings or CMS monitor data</p>
                </div>
              </div>

              {/* Template Selection */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Validation Template *
                </label>
                <select
                  value={template}
                  onChange={(e) => setTemplate(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                  disabled={loading}
                >
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
                {templates.find(t => t.id === template) && (
                  <p className="text-xs text-gray-500 mt-1">
                    {templates.find(t => t.id === template).description}
                  </p>
                )}
              </div>

              {/* Provider Selection */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  AI Provider *
                </label>
                <select
                  value={provider}
                  onChange={(e) => setProvider(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                  disabled={loading}
                >
                  {providers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.defaultModel})
                    </option>
                  ))}
                </select>
              </div>

              {/* Redaction Mode Toggle */}
              <div className="flex items-center">
                <input
                  type="checkbox"
                  id="redaction-mode"
                  checked={redactionMode}
                  onChange={(e) => setRedactionMode(e.target.checked)}
                  className="w-4 h-4 text-purple-600 border-gray-300 rounded focus:ring-purple-500"
                  disabled={loading}
                />
                <label htmlFor="redaction-mode" className="ml-2 text-sm text-gray-700">
                  Enable Redaction Mode (remove tokens/IDs from URLs)
                </label>
              </div>

              {/* Error Message */}
              {error && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                  <div className="flex items-center">
                    <AlertCircle className="w-5 h-5 text-red-500 mr-2" />
                    <p className="text-red-800 text-sm">{error}</p>
                  </div>
                </div>
              )}

              {/* Submit Button */}
              <button
                onClick={handleUpload}
                disabled={loading || !evidencePack}
                className="w-full bg-purple-600 text-white py-3 px-6 rounded-lg font-medium hover:bg-purple-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors flex items-center justify-center"
              >
                {loading ? (
                  <>
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white mr-2"></div>
                    {polling ? 'Processing...' : 'Uploading...'}
                  </>
                ) : (
                  <>
                    <Brain className="w-5 h-5 mr-2" />
                    Send for AI Validation
                  </>
                )}
              </button>
            </div>
          </div>
        ) : (
          /* Results View */
          <div className="space-y-6">
            {/* Verdict Card */}
            <div className={`rounded-lg border-2 p-8 ${getVerdictColor(result.metadata.verdict)}`}>
              <div className="flex items-center justify-center mb-4">
                {getVerdictIcon(result.metadata.verdict)}
              </div>
              <h2 className="text-3xl font-bold text-center mb-2">
                {result.metadata.verdict}
              </h2>
              <p className="text-center text-lg font-medium mb-4">
                Confidence: {result.metadata.confidence}%
              </p>
              <div className="bg-white bg-opacity-50 rounded-lg p-4 mt-4">
                <p className="text-sm text-center">
                  {result.metadata.findingsCount} finding{result.metadata.findingsCount !== 1 ? 's' : ''} detected
                </p>
              </div>
            </div>

            {/* Download Links */}
            <div className="bg-white rounded-lg shadow-lg p-6">
              <h3 className="text-xl font-bold text-gray-900 mb-4">Download Results</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <a
                  href={result.files.aiValidation}
                  download
                  className="flex items-center justify-center px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                >
                  <Download className="w-5 h-5 mr-2" />
                  AI Validation JSON
                </a>
                <a
                  href={result.files.pdf}
                  download
                  className="flex items-center justify-center px-4 py-3 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
                >
                  <Download className="w-5 h-5 mr-2" />
                  Evidence Summary PDF
                </a>
                <a
                  href={result.files.caseBrief}
                  download
                  className="flex items-center justify-center px-4 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
                >
                  <Download className="w-5 h-5 mr-2" />
                  Case Brief JSON
                </a>
              </div>
            </div>

            {/* Metadata */}
            <div className="bg-white rounded-lg shadow-lg p-6">
              <h3 className="text-xl font-bold text-gray-900 mb-4">Validation Metadata</h3>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="font-medium text-gray-700">Provider:</span>
                  <span className="ml-2 text-gray-600">{result.metadata.provider}</span>
                </div>
                <div>
                  <span className="font-medium text-gray-700">Template:</span>
                  <span className="ml-2 text-gray-600">{result.metadata.template}</span>
                </div>
                <div>
                  <span className="font-medium text-gray-700">Redaction:</span>
                  <span className="ml-2 text-gray-600">{result.metadata.redactionMode ? 'Enabled' : 'Disabled'}</span>
                </div>
                <div>
                  <span className="font-medium text-gray-700">Timestamp:</span>
                  <span className="ml-2 text-gray-600">{new Date(result.metadata.timestamp).toLocaleString()}</span>
                </div>
                <div className="col-span-2">
                  <span className="font-medium text-gray-700">Input Fingerprint:</span>
                  <span className="ml-2 text-gray-600 font-mono text-xs">{result.metadata.inputFingerprint}</span>
                </div>
                <div className="col-span-2">
                  <span className="font-medium text-gray-700">Output Fingerprint:</span>
                  <span className="ml-2 text-gray-600 font-mono text-xs">{result.metadata.outputFingerprint}</span>
                </div>
              </div>
            </div>

            {/* New Validation Button */}
            <button
              onClick={resetForm}
              className="w-full bg-gray-600 text-white py-3 px-6 rounded-lg font-medium hover:bg-gray-700 transition-colors"
            >
              Run New Validation
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default AIValidation;

