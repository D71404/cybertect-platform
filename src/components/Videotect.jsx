import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Upload, FileText, AlertTriangle, CheckCircle2, XCircle, Download, Copy, Loader2 } from 'lucide-react';
import Footer from './Footer';
import AIValidateButton from './ai-validation/AIValidateButton';
import { API_BASE } from '../config';

const Videotect = () => {
  const [uploading, setUploading] = useState(false);
  const [pasting, setPasting] = useState(false);
  const [urls, setUrls] = useState('');
  const [items, setItems] = useState([]);
  const [importSummary, setImportSummary] = useState(null);
  const [filters, setFilters] = useState({
    minScore: '',
    type: '',
    status: '',
    search: ''
  });
  const fileInputRef = useRef(null);

  const loadItems = async () => {
    try {
      const params = new URLSearchParams();
      if (filters.minScore) params.append('minScore', filters.minScore);
      if (filters.type) params.append('type', filters.type);
      if (filters.status) params.append('status', filters.status);
      if (filters.search) params.append('q', filters.search);
      params.append('sort', 'score_desc');

      const response = await fetch(`${API_BASE}/api/videotect/items?${params}`);
      const data = await response.json();
      if (data.success) {
        setItems(data.items);
      }
    } catch (error) {
      console.error('Error loading items:', error);
    }
  };

  const handleFileUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.name.endsWith('.csv')) {
      alert('Please upload a CSV file');
      return;
    }

    setUploading(true);
    const formData = new FormData();
    formData.append('file', file);

    try {
      const response = await fetch(`${API_BASE}/api/videotect/import`, {
        method: 'POST',
        body: formData
      });

      const data = await response.json();
      if (data.success) {
        setImportSummary(data.summary);
        await loadItems();
      } else {
        alert(`Error: ${data.error}`);
      }
    } catch (error) {
      alert(`Upload failed: ${error.message}`);
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handlePasteUrls = async () => {
    if (!urls.trim()) {
      alert('Please paste at least one URL');
      return;
    }

    setPasting(true);
    const urlList = urls.split('\n').map(u => u.trim()).filter(u => u.length > 0);

    try {
      const response = await fetch(`${API_BASE}/api/videotect/manual`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls: urlList })
      });

      const data = await response.json();
      if (data.success) {
        setUrls('');
        await loadItems();
        alert(`Analyzed ${data.itemsCreated} URL(s)`);
      } else {
        alert(`Error: ${data.error}`);
      }
    } catch (error) {
      alert(`Analysis failed: ${error.message}`);
    } finally {
      setPasting(false);
    }
  };

  const updateItemStatus = async (id, status) => {
    try {
      const response = await fetch(`${API_BASE}/api/videotect/items/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status })
      });

      const data = await response.json();
      if (data.success) {
        await loadItems();
      }
    } catch (error) {
      alert(`Update failed: ${error.message}`);
    }
  };

  const exportExclusions = async (type, minScore = 70) => {
    try {
      const response = await fetch(`${API_BASE}/api/videotect/export?type=${type}&minScore=${minScore}`);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `videotect-${type}-exclusions-${minScore}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      alert(`Export failed: ${error.message}`);
    }
  };

  const copyExclusions = async (type, minScore = 70) => {
    try {
      const response = await fetch(`${API_BASE}/api/videotect/export?type=${type}&minScore=${minScore}`);
      const text = await response.text();
      const urls = text.split('\n').slice(1).filter(u => u.trim());
      await navigator.clipboard.writeText(urls.join('\n'));
      alert(`Copied ${urls.length} ${type} exclusion(s) to clipboard`);
    } catch (error) {
      alert(`Copy failed: ${error.message}`);
    }
  };

  const getScoreBadge = (score) => {
    if (score >= 70) {
      return <span className="px-2 py-1 rounded-lg text-xs font-medium bg-red-100 text-red-700">Flagged ({score})</span>;
    } else if (score >= 50) {
      return <span className="px-2 py-1 rounded-lg text-xs font-medium bg-yellow-100 text-yellow-700">Suspicious ({score})</span>;
    } else {
      return <span className="px-2 py-1 rounded-lg text-xs font-medium bg-green-100 text-green-700">Clean ({score})</span>;
    }
  };

  const getStatusBadge = (status) => {
    if (status === 'excluded') {
      return <span className="px-2 py-1 rounded text-xs font-medium bg-red-100 text-red-700">Excluded</span>;
    } else if (status === 'reviewed') {
      return <span className="px-2 py-1 rounded text-xs font-medium bg-blue-100 text-blue-700">Reviewed</span>;
    } else {
      return <span className="px-2 py-1 rounded text-xs font-medium bg-gray-100 text-gray-700">New</span>;
    }
  };

  // Load items on mount and when filters change
  useEffect(() => {
    const fetchItems = async () => {
      try {
        const params = new URLSearchParams();
        if (filters.minScore) params.append('minScore', filters.minScore);
        if (filters.type) params.append('type', filters.type);
        if (filters.status) params.append('status', filters.status);
        if (filters.search) params.append('q', filters.search);
        params.append('sort', 'score_desc');

        const response = await fetch(`${API_BASE}/api/videotect/items?${params}`);
        const data = await response.json();
        if (data.success) {
          setItems(data.items);
        }
      } catch (error) {
        console.error('Error loading items:', error);
      }
    };
    fetchItems();
  }, [filters.minScore, filters.type, filters.status, filters.search]);

  const filteredItems = items.filter(item => {
    if (filters.minScore && item.score < parseInt(filters.minScore)) return false;
    if (filters.type && item.type !== filters.type) return false;
    if (filters.status && item.status !== filters.status) return false;
    if (filters.search) {
      const searchLower = filters.search.toLowerCase();
      if (!item.canonical_url.toLowerCase().includes(searchLower) && 
          !item.original_url.toLowerCase().includes(searchLower)) {
        return false;
      }
    }
    return true;
  });

  const scanIdentifier = useMemo(() => {
    if (importSummary?.id) return `import-${importSummary.id}`;
    if (items[0]?.id) return `videotect-${items[0].id}`;
    return `videotect-${Date.now()}`;
  }, [importSummary?.id, items]);

  const evidencePackGetter = useCallback(() => {
    const createdAt = new Date().toISOString();
    const flagged = items.filter((i) => i.score >= 70).length;
    const findings = filteredItems.map((item) => ({
      type: item.type || 'placement',
      severity: item.score >= 70 ? 'high' : item.score >= 50 ? 'med' : 'low',
      description: Array.isArray(item.reasons) && item.reasons.length
        ? item.reasons.join(', ')
        : 'Flagged placement from Videotect scan',
      evidence: [
        {
          kind: 'link',
          uri: item.canonical_url,
          meta: {
            score: item.score,
            spend: item.metrics?.cost,
            impressions: item.metrics?.impressions,
            views: item.metrics?.views
          }
        }
      ]
    }));

    return Promise.resolve({
      version: '1.0',
      createdAt,
      target: { url: 'videotect', domain: 'youtube.com' },
      findings,
      telemetry: {
        totalItems: items.length,
        flagged,
        scannedAt: createdAt
      },
      artifacts: []
    });
  }, [filteredItems, items]);

  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <nav className="sticky top-0 z-50 bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center">
              <div className="cybertect-logo">
                <span className="cyber-text">cyber</span>
                <span className="tect-text">tect</span>
                <span className="com-text">.com</span>
              </div>
            </div>
            <a href="/" className="text-gray-700 hover:text-gray-900 text-sm font-medium">
              Back to Home
            </a>
          </div>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <h1 className="text-4xl font-light text-gray-900 mb-2">Videotect</h1>
        <p className="text-lg text-gray-600 mb-8">
          Detect YouTube spam channels and videos from placement performance data
        </p>

        {/* Upload Card */}
        <div className="bg-white border border-gray-200 rounded-xl p-6 mb-6 shadow-sm">
          <h2 className="text-xl font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <Upload className="w-5 h-5" />
            Upload CSV
          </h2>
          <div className="flex items-center gap-4">
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              onChange={handleFileUpload}
              className="hidden"
              id="csv-upload"
            />
            <label
              htmlFor="csv-upload"
              className="bg-[#2563EB] text-white px-6 py-2 rounded-full text-sm font-medium hover:bg-[#1d4ed8] transition-colors cursor-pointer inline-flex items-center gap-2"
            >
              {uploading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Uploading...
                </>
              ) : (
                <>
                  <Upload className="w-4 h-4" />
                  Choose CSV File
                </>
              )}
            </label>
            <a
              href="/sample-videotect-import.csv"
              download="sample-videotect-import.csv"
              className="text-[#2563EB] hover:text-[#1d4ed8] text-sm font-medium flex items-center gap-2"
            >
              <FileText className="w-4 h-4" />
              Download Sample CSV
            </a>
          </div>
          {importSummary && (
            <div className="mt-4 p-4 bg-blue-50 rounded-lg">
              <p className="text-sm text-gray-700">
                <strong>Import Summary:</strong> {importSummary.rowsProcessed} rows processed,{' '}
                {importSummary.channelsFound} channels, {importSummary.videosFound} videos,{' '}
                {importSummary.flaggedCount} flagged (score ≥70)
                {importSummary.totalCostFlagged > 0 && (
                  <span>, ${importSummary.totalCostFlagged} flagged spend</span>
                )}
              </p>
            </div>
          )}
        </div>

        {/* Paste URLs Card */}
        <div className="bg-white border border-gray-200 rounded-xl p-6 mb-6 shadow-sm">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">Paste URLs</h2>
          <textarea
            value={urls}
            onChange={(e) => setUrls(e.target.value)}
            placeholder="Paste YouTube URLs (one per line)&#10;Example:&#10;https://www.youtube.com/channel/UCxxxx&#10;https://www.youtube.com/watch?v=xxxx"
            className="w-full h-32 p-4 border border-gray-300 rounded-lg font-mono text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB] focus:border-transparent"
          />
          <button
            onClick={handlePasteUrls}
            disabled={pasting || !urls.trim()}
            className="mt-4 bg-[#2563EB] text-white px-6 py-2 rounded-full text-sm font-medium hover:bg-[#1d4ed8] transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {pasting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Analyzing...
              </>
            ) : (
              <>
                <AlertTriangle className="w-4 h-4" />
                Analyze URLs
              </>
            )}
          </button>
        </div>

        {/* Filters */}
        <div className="bg-white border border-gray-200 rounded-xl p-6 mb-6 shadow-sm">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">Filters</h2>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Min Score</label>
              <select
                value={filters.minScore}
                onChange={(e) => setFilters({ ...filters, minScore: e.target.value })}
                className="w-full p-2 border border-gray-300 rounded-lg text-sm"
              >
                <option value="">All</option>
                <option value="70">Flagged (≥70)</option>
                <option value="50">Suspicious (≥50)</option>
                <option value="0">Clean (&lt;50)</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
              <select
                value={filters.type}
                onChange={(e) => setFilters({ ...filters, type: e.target.value })}
                className="w-full p-2 border border-gray-300 rounded-lg text-sm"
              >
                <option value="">All</option>
                <option value="channel">Channel</option>
                <option value="video">Video</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
              <select
                value={filters.status}
                onChange={(e) => setFilters({ ...filters, status: e.target.value })}
                className="w-full p-2 border border-gray-300 rounded-lg text-sm"
              >
                <option value="">All</option>
                <option value="new">New</option>
                <option value="reviewed">Reviewed</option>
                <option value="excluded">Excluded</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Search</label>
              <input
                type="text"
                value={filters.search}
                onChange={(e) => setFilters({ ...filters, search: e.target.value })}
                placeholder="Search URLs..."
                className="w-full p-2 border border-gray-300 rounded-lg text-sm"
              />
            </div>
          </div>
        </div>

        {/* Export Bar */}
        <div className="bg-white border border-gray-200 rounded-xl p-6 mb-6 shadow-sm">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">Export Exclusions</h2>
          <div className="flex flex-wrap gap-4">
            <button
              onClick={() => exportExclusions('channel', 70)}
              className="bg-green-600 text-white px-6 py-2 rounded-full text-sm font-medium hover:bg-green-700 transition-colors flex items-center gap-2"
            >
              <Download className="w-4 h-4" />
              Export Channel Exclusions (≥70)
            </button>
            <button
              onClick={() => exportExclusions('video', 70)}
              className="bg-green-600 text-white px-6 py-2 rounded-full text-sm font-medium hover:bg-green-700 transition-colors flex items-center gap-2"
            >
              <Download className="w-4 h-4" />
              Export Video Exclusions (≥70)
            </button>
            <button
              onClick={() => copyExclusions('channel', 70)}
              className="bg-gray-600 text-white px-6 py-2 rounded-full text-sm font-medium hover:bg-gray-700 transition-colors flex items-center gap-2"
            >
              <Copy className="w-4 h-4" />
              Copy Channel List
            </button>
            <button
              onClick={() => copyExclusions('video', 70)}
              className="bg-gray-600 text-white px-6 py-2 rounded-full text-sm font-medium hover:bg-gray-700 transition-colors flex items-center gap-2"
            >
              <Copy className="w-4 h-4" />
              Copy Video List
            </button>
          </div>
          <div className="mt-4">
            <AIValidateButton
              toolId="videotect"
              scanId={scanIdentifier}
              evidencePackGetter={evidencePackGetter}
            />
          </div>
        </div>

        {/* Findings Table */}
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-xl font-semibold text-gray-900">
              Findings ({filteredItems.length})
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Type</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">URL</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Score</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Reasons</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Spend</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Impr</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Views</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">View Rate</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Watch Time</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {filteredItems.length === 0 ? (
                  <tr>
                    <td colSpan="11" className="px-6 py-8 text-center text-gray-500">
                      No items found. Upload a CSV or paste URLs to get started.
                    </td>
                  </tr>
                ) : (
                  filteredItems.map((item) => (
                    <tr key={item.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 capitalize">
                        {item.type}
                      </td>
                      <td className="px-6 py-4 text-sm">
                        <a
                          href={item.canonical_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[#2563EB] hover:underline break-all"
                        >
                          {item.canonical_url}
                        </a>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {getScoreBadge(item.score)}
                      </td>
                      <td className="px-6 py-4 text-sm">
                        <div className="flex flex-wrap gap-1">
                          {Array.isArray(item.reasons) && item.reasons.length > 0 ? (
                            item.reasons.map((reason, idx) => (
                              <span key={idx} className="px-2 py-1 rounded text-xs bg-gray-100 text-gray-700">
                                {reason}
                              </span>
                            ))
                          ) : (
                            <span className="text-gray-400">-</span>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {item.metrics?.cost ? `$${item.metrics.cost.toFixed(2)}` : '-'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {item.metrics?.impressions?.toLocaleString() || '-'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {item.metrics?.views?.toLocaleString() || '-'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {item.metrics?.viewRate ? `${item.metrics.viewRate.toFixed(2)}%` : '-'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {item.metrics?.avgWatchTime ? `${item.metrics.avgWatchTime.toFixed(1)}s` : '-'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {getStatusBadge(item.status)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm">
                        <div className="flex gap-2">
                          {item.status !== 'reviewed' && (
                            <button
                              onClick={() => updateItemStatus(item.id, 'reviewed')}
                              className="text-blue-600 hover:text-blue-800"
                            >
                              Mark Reviewed
                            </button>
                          )}
                          {item.status !== 'excluded' && (
                            <button
                              onClick={() => updateItemStatus(item.id, 'excluded')}
                              className="text-red-600 hover:text-red-800"
                            >
                              Mark Excluded
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      <Footer toolSpecificDisclaimer="YouTube URL analysis is based on pattern matching and heuristics. Scores are indicative and should not be the sole basis for blocking placements." />
    </div>
  );
};

export default Videotect;

