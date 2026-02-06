import React, { useState } from 'react';
import JSZip from 'jszip';
import { useNavigate, Link } from 'react-router-dom';
import { ShieldCheck, AlertTriangle, AlertOctagon, CheckCircle2, RefreshCw, Send, Download, Radar, Zap, Eye } from 'lucide-react';
import Footer from './Footer';
import { useAuth } from '../contexts/AuthContext';

import { API_BASE } from '../config';
const scannerVersion = 'ui-1.0.0';

const normalizeIds = (ids = []) => Array.from(new Set(ids.filter(Boolean))).sort();

const normalizeHits = (hits = {}) => {
  const sorted = {};
  Object.keys(hits || {})
    .sort()
    .forEach((key) => {
      const entry = hits[key] || {};
      sorted[key] = {
        total: entry.total || 0,
        events: Object.fromEntries(
          Object.keys(entry.events || {})
            .sort()
            .map((k) => [k, entry.events[k]])
        )
      };
    });
  return sorted;
};

const Dashboard = () => {
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const [urlsInput, setUrlsInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [aiValidating, setAiValidating] = useState(false);
  const [data, setData] = useState([]);
  const [latestScanId, setLatestScanId] = useState(null);
  const [latestScanData, setLatestScanData] = useState(null);
  const [evidencePack, setEvidencePack] = useState(null);
  const [lastScanTimestamp, setLastScanTimestamp] = useState(null);

  const resetScanState = () => {
    setData([]);
    setEvidencePack(null);
    setLatestScanId(null);
    setLatestScanData(null);
  };

  const buildEvidencePack = (rows, scannedAt, scannedUrl) => {
    const domain =
      (scannedUrl && (() => {
        try {
          return new URL(scannedUrl).hostname;
        } catch {
          return scannedUrl;
        }
      })()) ||
      rows[0]?.domain ||
      'unknown';

    const allIds = {};
    rows.forEach((row) => {
      const analytics = row.analytics || {};
      Object.values(analytics).forEach((ids) => {
        (ids || []).forEach((id) => {
          allIds[id] = (allIds[id] || 0) + 1;
        });
      });
    });

    const duplicates = Object.entries(allIds)
      .filter(([, count]) => count > 1)
      .map(([id, count]) => ({ id, count, severity: count > 2 ? 'Critical' : 'Warning' }))
      .sort((a, b) => b.count - a.count || a.id.localeCompare(b.id));

    const results = rows
      .map((row) => ({
        ...row,
        analytics: {
          ga4_ids: normalizeIds(row.analytics?.ga4_ids || []),
          gtm_containers: normalizeIds(row.analytics?.gtm_containers || []),
          gads_aw_ids: normalizeIds(row.analytics?.gads_aw_ids || []),
          fb_pixel_ids: normalizeIds(row.analytics?.fb_pixel_ids || [])
        },
        flags: (row.flags || []).sort()
      }))
      .sort((a, b) => a.domain.localeCompare(b.domain));

    const totalHits = results.reduce((sum, row) => {
      const perId = Object.values(row.telemetry || {});
      return sum + perId.reduce((inner, entry) => inner + (entry.total || 0), 0);
    }, 0);

    return {
      scan_type: 'cybertect_main_scan',
      scanner_version: scannerVersion,
      page_url: scannedUrl,
      domain,
      scanned_at: scannedAt,
      evidence_version: '1.0',
      duplicates,
      results,
      telemetry_totals: { total_hits: totalHits, flagged_rows: results.filter((r) => (r.flags || []).length > 0).length }
    };
  };

  const buildEvidenceCsv = (pack) => {
    const header = ['domain', 'section', 'key', 'value', 'severity', 'flags'];
    const lines = [header.join(',')];
    const duplicateLookup = new Set((pack.duplicates || []).map((d) => d.id));

    (pack.results || []).forEach((row) => {
      const flags = (row.flags || []).join('|');
      Object.entries(row.analytics || {}).forEach(([type, ids]) => {
        (ids || []).forEach((id) => {
          const severity = duplicateLookup.has(id) ? 'duplicate' : '';
          lines.push([row.domain, 'analytics', type, id, severity, flags].map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(','));
        });
      });
      Object.entries(row.telemetry || {}).forEach(([id, entry]) => {
        lines.push([row.domain, 'telemetry', id, `total:${entry.total}`, '', flags].map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(','));
      });
    });
    return lines.join('\n');
  };

  const handleScan = async () => {
    const urlList = urlsInput
      .split(/[\n,]+/)
      .map((u) => u.trim())
      .filter((u) => u.length > 0);
    if (!urlList.length) {
      alert('Enter at least one URL to scan.');
      return;
    }

    const scanStartedAt = new Date().toISOString();
    resetScanState();
    setLoading(true);

    try {
      const response = await fetch(`${API_BASE}/api/scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls: urlList })
      });
      const result = await response.json();

      if (result.results && Array.isArray(result.results) && result.results.length > 0) {
        const tableRows = [];
        const evidenceRows = [];

        result.results.forEach((scanResult) => {
          if (scanResult.error) {
            const errMsg =
              typeof scanResult.error === 'object' && scanResult.error !== null
                ? scanResult.error.message || scanResult.error.error || JSON.stringify(scanResult.error)
                : String(scanResult.error);
            alert(`Scan failed for ${scanResult.url}: ${errMsg}`);
            return;
          }

          let domain = scanResult.url || '';
          try {
            domain = new URL(scanResult.url).hostname;
          } catch {
            /* fallback */
          }

          const tagParity = scanResult.tagParity || {};
          const ga4Ids = normalizeIds([
            ...(tagParity.ga4_ids || []),
            ...(scanResult.tagInventory?.analyticsIds?.filter((id) => id.startsWith('G-')) || [])
          ]);
          const gtmIds = normalizeIds([
            ...(tagParity.gtm_containers || []),
            ...(scanResult.tagInventory?.gtmContainers || [])
          ]);
          const awIds = normalizeIds([
            ...(tagParity.gads_aw_ids || []),
            ...(scanResult.tagInventory?.googleAdsIds || [])
          ]);
          const fbIds = normalizeIds([
            ...(tagParity.fb_pixel_ids || []),
            ...(scanResult.tagInventory?.facebookPixels || [])
          ]);
          const flags = (tagParity.flags || []).slice();
          const hitsById = normalizeHits(scanResult.hitsById || {});

          const hasMultipleFlags = flags.some((f) => f.startsWith('MULTIPLE_'));
          const isHighRisk = scanResult.verdict === 'HIGH_RISK' || (scanResult.riskScore && scanResult.riskScore >= 60);
          const isMediumRisk =
            scanResult.verdict === 'SUSPICIOUS' ||
            (scanResult.riskScore && scanResult.riskScore >= 30) ||
            hasMultipleFlags;
          const isClean =
            scanResult.verdict === 'PASS' &&
            (!scanResult.riskScore || scanResult.riskScore < 30) &&
            !hasMultipleFlags &&
            ga4Ids.length === 0 &&
            gtmIds.length === 0 &&
            awIds.length === 0 &&
            fbIds.length === 0;

          const fraudCount = scanResult.fraudWarnings ? scanResult.fraudWarnings.length : 0;
          const hasFraud = fraudCount > 0 || isHighRisk;

          const networkEvents = scanResult.metrics?.adRequestCount || scanResult.networkEventsCount || 0;
          const wasteFactor = networkEvents > 50 ? '6x' : networkEvents > 30 ? '5x' : networkEvents > 10 ? '3x' : '1x';

          const pageviews =
            scanResult.pageviewsPerNavigation !== undefined
              ? scanResult.pageviewsPerNavigation
              : scanResult.pageViewCount ?? '-';

          const newResult = {
            domain,
            _pageUrl: scanResult.url,
            status: hasFraud ? 'Fraud Detection' : isClean ? 'Verified Human Traffic' : 'Cautious Items',
            riskLevel: isHighRisk ? 'High' : isMediumRisk ? 'Medium' : 'Low',
            action: hasFraud ? 'Block & Report' : isClean ? 'Monitor' : 'Review',
            waste: wasteFactor,
            colorTheme: hasFraud ? 'red' : isClean ? 'green' : 'yellow',
            _flags: flags,
            _ga4Ids: ga4Ids,
            _gtmIds: gtmIds,
            _awIds: awIds,
            _fbIds: fbIds,
            fraudWarnings: scanResult.fraudWarnings || [],
            pageviews,
            analytics: {
              ga4_ids: ga4Ids,
              gtm_containers: gtmIds,
              gads_aw_ids: awIds,
              fb_pixel_ids: fbIds
            },
            telemetry: hitsById,
            flags,
            duplicateIds: [...ga4Ids, ...gtmIds, ...awIds, ...fbIds].filter((id, idx, arr) => arr.indexOf(id) !== idx)
          };

          const evidenceRow = {
            domain,
            page_url: scanResult.url,
            verdict: scanResult.verdict || newResult.status,
            risk_level: newResult.riskLevel,
            risk_score: scanResult.riskScore || 0,
            analytics: { ga4_ids: ga4Ids, gtm_containers: gtmIds, gads_aw_ids: awIds, fb_pixel_ids: fbIds },
            telemetry: hitsById,
            flags,
            waste: wasteFactor,
            duplicates: newResult.duplicateIds,
            tag_parity: tagParity,
            timestamp: scanStartedAt
          };

          tableRows.push(newResult);
          evidenceRows.push(evidenceRow);
        });

        const scannedUrl = urlList[0];
        const sharedEvidence = buildEvidencePack(evidenceRows, scanStartedAt, scannedUrl);
        setData((prev) => [...tableRows, ...prev]);
        setEvidencePack(sharedEvidence);
        setLastScanTimestamp(scanStartedAt);
        setLatestScanId(`scan-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`);
        setLatestScanData(result.results[0]);
      } else if (result.error) {
        const errMsg =
          typeof result.error === 'object' && result.error !== null
            ? result.error.message || result.error.error || JSON.stringify(result.error)
            : String(result.error);
        alert(errMsg || 'Scan failed to return data');
      } else {
        alert('No results returned from scan');
      }
    } catch (error) {
      console.error('Scan failed:', error);
      alert(`Backend not reachable! Make sure 'node server.cjs' is running on ${API_BASE}.`);
    }

    setLoading(false);
  };

  const downloadEvidencePack = async () => {
    if (!evidencePack) {
      alert('Run a scan before downloading the evidence pack.');
      return;
    }

    const zip = new JSZip();
    zip.file('evidence.json', JSON.stringify(evidencePack, null, 2));
    zip.file('evidence.csv', buildEvidenceCsv(evidencePack));

    const blob = await zip.generateAsync({ type: 'blob' });
    const ts = evidencePack.scanned_at?.replace(/[:.]/g, '-').replace('T', '_') || Date.now();
    const domainSafe = (evidencePack.domain || 'site').replace(/[^a-zA-Z0-9.-]/g, '_');
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `cybertect_evidence_${domainSafe}_${ts}.zip`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const handleAIValidation = async () => {
    if (!latestScanData) {
      alert('Run a scan first before sending to AI validation.');
      return;
    }
    if (!evidencePack) {
      alert('No evidence pack available. Please run a scan first.');
      return;
    }

    setAiValidating(true);
    try {
      const response = await fetch(`${API_BASE}/api/ai-validation/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scanId: latestScanId || null,
          evidenceData: latestScanData,
          scan_type: evidencePack.scan_type,
          domain: evidencePack.domain,
          scanner_version: evidencePack.scanner_version,
          evidence_pack: evidencePack,
          provider: 'chatgpt',
          template: 'analytics_inflation'
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'AI validation request failed');
      }

      const res = await response.json();
      if (res.jobId) alert(`AI Validation submitted successfully! Job ID: ${res.jobId}`);
      else if (res.runId) alert(`AI Validation submitted successfully! Run ID: ${res.runId}`);
    } catch (error) {
      console.error('AI Validation error:', error);
      alert('AI Validation failed: ' + error.message);
    } finally {
      setAiValidating(false);
    }
  };

  const stats = {
    scansLogged: data.length,
    stackingAlerts: data.reduce((acc, r) => acc + (r.fraudWarnings?.filter((f) => /stack/i.test(f.type || '')).length || 0), 0),
    pixelStuffers: data.reduce((acc, r) => acc + (r.fraudWarnings?.filter((f) => /pixel/i.test(f.type || '')).length || 0), 0),
    qaInflationAlerts: data.reduce((acc, r) => acc + (r.fraudWarnings?.filter((f) => /analytics|inflation/i.test(f.type || '')).length || 0), 0)
  };

  const getRiskBadge = (riskLevel) => {
    const isHigh = riskLevel === 'High';
    const isLow = riskLevel === 'Low';
    return (
      <span
        className={`inline-flex px-2 py-1 rounded-lg text-xs font-semibold ${
          isHigh ? 'bg-red-100 text-red-700' : isLow ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
        }`}
      >
        {riskLevel}
      </span>
    );
  };

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900 antialiased">
      {/* HEADER */}
      <header className="bg-white border-b border-slate-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex justify-between items-center h-16">
          <div className="cybertect-logo flex items-baseline">
            <span className="cyber-text font-bold text-xl">Cybertect</span>
            <span className="com-text font-bold text-xl text-slate-500">.com</span>
          </div>
          {user ? (
            <button
              onClick={async () => {
                await signOut();
                localStorage.removeItem('cybertect_rememberMe');
                navigate('/', { replace: true });
              }}
              className="text-slate-600 font-medium hover:text-slate-900 transition px-4 py-2 rounded-lg hover:bg-slate-100"
            >
              Sign Out
            </button>
          ) : (
            <Link to="/auth" className="text-slate-600 font-medium hover:text-slate-900 transition px-4 py-2 rounded-lg hover:bg-slate-100">
              Sign In
            </Link>
          )}
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 space-y-12">
        {/* HERO */}
        <section className="flex flex-col md:flex-row items-center gap-8">
          <div className="flex-1">
            <h1 className="text-4xl md:text-5xl font-bold text-slate-900 leading-tight mb-4">
              We Measure Bad Data
            </h1>
            <p className="text-lg text-slate-600 leading-relaxed max-w-2xl">
              Most fraud tools chase bots. Cybertect follows the numbers—and exposes where your ad spend and ROI evaporates.
            </p>
          </div>
          <div className="flex-shrink-0 w-64 h-48 md:w-80 md:h-60 bg-slate-50 rounded-2xl border border-slate-200 flex items-center justify-center overflow-hidden p-4">
            <svg viewBox="0 0 320 240" className="w-full h-full" fill="none" xmlns="http://www.w3.org/2000/svg">
              {/* Scattered data points and chaos */}
              <circle cx="45" cy="55" r="8" fill="#fca5a5" opacity="0.9" />
              <circle cx="120" cy="35" r="6" fill="#fdba74" opacity="0.85" />
              <circle cx="200" cy="80" r="10" fill="#fcd34d" opacity="0.8" />
              <circle cx="75" cy="120" r="7" fill="#86efac" opacity="0.7" />
              <circle cx="250" cy="140" r="9" fill="#93c5fd" opacity="0.85" />
              <circle cx="160" cy="180" r="5" fill="#c4b5fd" opacity="0.9" />
              <circle cx="40" cy="190" r="6" fill="#f9a8d4" opacity="0.75" />
              <circle cx="280" cy="60" r="7" fill="#fda4af" opacity="0.8" />
              <circle cx="290" cy="200" r="5" fill="#67e8f9" opacity="0.7" />
              {/* Tangled / crossed lines - bad data connections */}
              <path d="M50 60 Q90 20 150 70 T250 50" stroke="#94a3b8" strokeWidth="1.5" strokeDasharray="4 3" opacity="0.6" />
              <path d="M80 110 L180 40 L240 120 L100 170 Z" stroke="#64748b" strokeWidth="1.2" opacity="0.5" />
              <path d="M30 180 Q120 100 200 160 T280 80" stroke="#cbd5e1" strokeWidth="1" strokeDasharray="3 2" opacity="0.5" />
              <path d="M140 90 L220 150 L260 90" stroke="#94a3b8" strokeWidth="1" opacity="0.5" />
              {/* Bar chart gone wrong - overlapping bars */}
              <rect x="20" y="100" width="18" height="50" rx="2" fill="#ef4444" opacity="0.6" />
              <rect x="35" y="80" width="18" height="70" rx="2" fill="#f97316" opacity="0.6" />
              <rect x="50" y="90" width="18" height="60" rx="2" fill="#eab308" opacity="0.6" />
              <rect x="65" y="70" width="18" height="80" rx="2" fill="#22c55e" opacity="0.5" />
              <rect x="80" y="85" width="18" height="65" rx="2" fill="#3b82f6" opacity="0.5" />
              {/* Question marks - uncertain data */}
              <text x="260" y="100" fill="#64748b" fontSize="20" fontFamily="system-ui,sans-serif" fontWeight="bold" opacity="0.6">?</text>
              <text x="150" y="140" fill="#94a3b8" fontSize="14" fontFamily="system-ui,sans-serif" fontWeight="bold" opacity="0.5">?</text>
              {/* Warning / alert icon */}
              <path d="M270 180 L275 165 L280 180 Z" fill="#f59e0b" opacity="0.8" />
              <circle cx="275" cy="175" r="2" fill="#f59e0b" />
            </svg>
          </div>
        </section>

        {/* SCAN INPUT CARD */}
        <section className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
          <label className="block text-sm font-semibold text-slate-700 mb-3">
            Enter Target URLs (One per line)
          </label>
          <textarea
            value={urlsInput}
            onChange={(e) => setUrlsInput(e.target.value)}
            placeholder="https://example.com"
            rows={4}
            className="w-full p-4 border border-slate-200 rounded-xl text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#2563EB] focus:border-transparent resize-y"
          />
          <div className="flex flex-wrap gap-3 mt-4">
            <button
              onClick={handleScan}
              disabled={loading}
              className="inline-flex items-center gap-2 bg-[#2563EB] hover:bg-[#1d4ed8] text-white px-6 py-3 rounded-xl font-semibold shadow-sm transition disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {loading ? <RefreshCw className="w-5 h-5 animate-spin" /> : <Radar className="w-5 h-5" />}
              {loading ? 'Scanning...' : 'Start Forensic Scan'}
            </button>
            <button
              onClick={downloadEvidencePack}
              disabled={!evidencePack}
              className="inline-flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white px-6 py-3 rounded-xl font-semibold shadow-sm transition disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <Download className="w-5 h-5" />
              Save Report
            </button>
          </div>
        </section>

        {/* STATS ROW */}
        <section className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 text-center">
            <div className="text-2xl font-bold text-[#2563EB]">{stats.scansLogged}</div>
            <div className="text-sm font-medium text-slate-600 mt-1">Scans Logged</div>
          </div>
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 text-center">
            <div className="text-2xl font-bold text-red-600">{stats.stackingAlerts}</div>
            <div className="text-sm font-medium text-slate-600 mt-1">Stacking Alerts</div>
          </div>
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 text-center">
            <div className="text-2xl font-bold text-amber-600">{stats.pixelStuffers}</div>
            <div className="text-sm font-medium text-slate-600 mt-1">Pixel Stuffers</div>
          </div>
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 text-center">
            <div className="text-2xl font-bold text-purple-600">{stats.qaInflationAlerts}</div>
            <div className="text-sm font-medium text-slate-600 mt-1">QA Inflation Alerts</div>
          </div>
        </section>

        {/* FEATURE CARDS */}
        <section className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
            <div className="w-12 h-12 bg-red-100 rounded-xl flex items-center justify-center mb-4">
              <Radar className="w-6 h-6 text-red-600" />
            </div>
            <h3 className="font-semibold text-slate-900 text-lg mb-2">Stacking Radar</h3>
            <p className="text-slate-600 text-sm leading-relaxed">
              Cross-compares frame bounding boxes to detect overlapping ad placements and flag competition for the same pixels.
            </p>
          </div>
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
            <div className="w-12 h-12 bg-amber-100 rounded-xl flex items-center justify-center mb-4">
              <Zap className="w-6 h-6 text-amber-600" />
            </div>
            <h3 className="font-semibold text-slate-900 text-lg mb-2">Pixel Stuffing Sniffer</h3>
            <p className="text-slate-600 text-sm leading-relaxed">
              Flags frames 1×1 and tiny placements used to generate noise impressions, filtering known ID-sync endpoints.
            </p>
          </div>
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
            <div className="w-12 h-12 bg-green-100 rounded-xl flex items-center justify-center mb-4">
              <Eye className="w-6 h-6 text-green-600" />
            </div>
            <h3 className="font-semibold text-slate-900 text-lg mb-2">Visibility Forensics</h3>
            <p className="text-slate-600 text-sm leading-relaxed">
              Captures computed CSS (display, visibility, opacity, offscreen) to prove when rendered wasn&apos;t viewable.
            </p>
          </div>
        </section>

        {/* RESULTS TABLE */}
        <section className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-4">
            <h2 className="font-semibold text-slate-900 text-lg">Scan Results</h2>
            <button
              onClick={handleAIValidation}
              disabled={!evidencePack || !latestScanData || aiValidating}
              className="inline-flex items-center gap-2 bg-[#2563EB] hover:bg-[#1d4ed8] text-white px-4 py-2 rounded-lg font-medium text-sm transition disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <Send className="w-4 h-4" />
              Send to AI Validation
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">Domain</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">Risk Level</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">Digital Signature</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">Issues Found</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">Pageviews / Session</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">Network Analysis</th>
                  <th className="px-6 py-4 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {data.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-6 py-12 text-center text-slate-500">
                      No scans yet. Enter URLs and click &quot;Start Forensic Scan&quot; to populate results.
                    </td>
                  </tr>
                ) : (
                  data.map((row, index) => (
                    <tr key={`${row.domain}-${index}`} className="hover:bg-slate-50/50">
                      <td className="px-6 py-4">
                        <span className="font-medium text-slate-900">{row.domain}</span>
                      </td>
                      <td className="px-6 py-4">{getRiskBadge(row.riskLevel)}</td>
                      <td className="px-6 py-4">
                        <div className="flex flex-wrap gap-1">
                          {[...(row._ga4Ids || []), ...(row._gtmIds || [])].slice(0, 6).map((id) => (
                            <span
                              key={id}
                              className="inline-flex px-2 py-0.5 rounded-md text-xs font-medium bg-blue-100 text-blue-700"
                            >
                              {id}
                            </span>
                          ))}
                          {([...(row._ga4Ids || []), ...(row._gtmIds || [])].length === 0 && <span className="text-slate-400 text-sm">—</span>)}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-wrap gap-1">
                          {(row.fraudWarnings || []).map((f, i) => (
                            <span key={i} className="inline-flex px-2 py-0.5 rounded-md text-xs font-medium bg-red-50 text-red-700">
                              {f.type || f}
                            </span>
                          ))}
                          {(row._flags || []).map((flag) => (
                            <span key={flag} className="inline-flex px-2 py-0.5 rounded-md text-xs font-medium bg-amber-50 text-amber-700">
                              {flag}
                            </span>
                          ))}
                          {(row.fraudWarnings || []).length === 0 && (row._flags || []).length === 0 && (
                            <span className="text-slate-400 text-sm">Clean</span>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-slate-700">{row.pageviews ?? '—'}</td>
                      <td className="px-6 py-4">
                        <span className={`font-semibold ${row.waste !== '1x' ? 'text-red-600' : 'text-slate-700'}`}>
                          {row.waste}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <span className="inline-flex px-3 py-1 rounded-lg text-xs font-medium bg-slate-100 text-slate-700">
                          {row.action}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
};

export default Dashboard;
