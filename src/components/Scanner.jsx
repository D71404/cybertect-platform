import React, { useMemo, useState } from 'react';
import JSZip from 'jszip';
import {
  ShieldCheck,
  AlertTriangle,
  Banknote,
  Search,
  RefreshCw,
  AlertOctagon,
  CheckCircle2,
  Sparkles,
  Download,
  Send,
  ChevronDown,
  ChevronRight,
  Clock
} from 'lucide-react';
import { useNavigate, Link } from 'react-router-dom';
import Footer from './Footer';
import { ThemeToggle } from './ui/ThemeToggle';
import { useAuth } from '../contexts/AuthContext';

const scannerVersion = 'ui-1.0.0';
import { API_BASE } from '../config';

const severityFromRisk = (risk) => {
  if (risk === 'High') return 'Critical';
  if (risk === 'Medium') return 'Warning';
  return 'Info';
};

const formatTimestamp = (ts) => (ts ? new Date(ts).toLocaleString() : 'Not scanned yet');

const Scanner = () => {
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [adSpend, setAdSpend] = useState(1000);
  const [rowAdSpend, setRowAdSpend] = useState({});
  const [aiValidating, setAiValidating] = useState(false);
  const [aiResults, setAiResults] = useState(null);
  const [data, setData] = useState([]);
  const [latestScanId, setLatestScanId] = useState(null);
  const [latestScanData, setLatestScanData] = useState(null);
  const [affectedVendors, setAffectedVendors] = useState({});
  const [expandedPublishers, setExpandedPublishers] = useState({});
  const [vendorSort, setVendorSort] = useState({ key: 'impressions', direction: 'desc' });
  const [evidencePack, setEvidencePack] = useState(null);
  const [lastScanTimestamp, setLastScanTimestamp] = useState(null);
  const [sortConfig, setSortConfig] = useState({ key: 'riskLevel', direction: 'desc' });
  const [cardOpen, setCardOpen] = useState({
    summary: true,
    analytics: true,
    telemetry: true,
    cms: true
  });

  const riskOrder = { High: 3, Medium: 2, Low: 1 };

  // Normalize ids to keep evidence deterministic and avoid UI-only mutation
  const normalizeIds = (ids = []) => Array.from(new Set(ids.filter(Boolean))).sort();

  // Normalize hits object so we never mutate the server payload when sharing evidence
  const normalizeHits = (hits = {}) => {
    const sorted = {};
    Object.keys(hits || {})
      .sort()
      .forEach((key) => {
        const entry = hits[key] || {};
        const events = entry.events || {};
        sorted[key] = {
          total: entry.total || 0,
          events: Object.fromEntries(
            Object.keys(events)
              .sort()
              .map((eventKey) => [eventKey, events[eventKey]])
          )
        };
      });
    return sorted;
  };

  const resetScanState = () => {
    setData([]);
    setRowAdSpend({});
    setAiResults(null);
    setEvidencePack(null);
    setLatestScanId(null);
    setLatestScanData(null);
  };

  // Shared evidence builder used once per scan and reused for download + AI validation
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
      .map(([id, count]) => ({
        id,
        count,
        severity: count > 2 ? 'Critical' : 'Warning'
      }))
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
      const rowHits = perId.reduce((inner, entry) => inner + (entry.total || 0), 0);
      return sum + rowHits;
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
      telemetry_totals: {
        total_hits: totalHits,
        flagged_rows: results.filter((row) => (row.flags || []).length > 0).length
      }
    };
  };

  // Build CSV string directly from the frozen evidence pack without mutating it
  const buildEvidenceCsv = (pack) => {
    const header = ['domain', 'section', 'key', 'value', 'severity', 'flags'];
    const lines = [header.join(',')];

    (pack.results || []).forEach((row) => {
      const flags = (row.flags || []).join('|');
      const duplicateLookup = new Set((pack.duplicates || []).map((dup) => dup.id));

      Object.entries(row.analytics || {}).forEach(([type, ids]) => {
        (ids || []).forEach((id) => {
          const severity = duplicateLookup.has(id) ? 'duplicate' : '';
          const csvRow = [row.domain, 'analytics', type, id, severity, flags];
          lines.push(csvRow.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(','));
        });
      });

      Object.entries(row.telemetry || {}).forEach(([id, entry]) => {
        const csvRow = [
          row.domain,
          'telemetry',
          id,
          `total:${entry.total}`,
          '',
          flags
        ];
        lines.push(csvRow.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(','));
      });
    });

    return lines.join('\n');
  };

  const handleScan = async () => {
    if (!url) {
      alert('Enter a URL to scan.');
      return;
    }

    const scanStartedAt = new Date().toISOString();
    resetScanState();
    setLoading(true);

    try {
      const response = await fetch(`${API_BASE}/api/scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls: [url] })
      });
      const result = await response.json();

      if (result.results && Array.isArray(result.results) && result.results.length > 0) {
        const tableRows = [];
        const evidenceRows = [];

        result.results.forEach((scanResult) => {
          if (scanResult.error) {
            const errMsg = typeof scanResult.error === 'object' && scanResult.error !== null
              ? (scanResult.error.message || scanResult.error.error || JSON.stringify(scanResult.error))
              : String(scanResult.error);
            alert(`Scan failed for ${scanResult.url}: ${errMsg}`);
            return;
          }

          let domain = scanResult.url || '';
          try {
            domain = new URL(scanResult.url).hostname;
          } catch {
            // fall back to raw url when hostname parsing fails
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
          const hasDuplicatePageViews = Object.values(hitsById).some((hitData) => {
            const pageViewCount = (hitData.events?.['page_view'] || 0) + (hitData.events?.['pageview'] || 0);
            return pageViewCount > 1;
          });

          const hasMultipleFlags = flags.some((f) => f.startsWith('MULTIPLE_'));
          const isHighRisk =
            scanResult.verdict === 'HIGH_RISK' || (scanResult.riskScore && scanResult.riskScore >= 60);
          const isMediumRisk =
            scanResult.verdict === 'SUSPICIOUS' || (scanResult.riskScore && scanResult.riskScore >= 30) || hasMultipleFlags;
          const isClean =
            scanResult.verdict === 'PASS' &&
            (!scanResult.riskScore || scanResult.riskScore < 30) &&
            !hasDuplicatePageViews &&
            !hasMultipleFlags &&
            (ga4Ids.length === 0 && gtmIds.length === 0 && awIds.length === 0 && fbIds.length === 0);

          const fraudCount = scanResult.fraudWarnings ? scanResult.fraudWarnings.length : 0;
          const hasFraud = fraudCount > 0 || isHighRisk;

          const networkEvents = scanResult.metrics?.adRequestCount || scanResult.networkEventsCount || 0;
          const wasteFactor = networkEvents > 50 ? '6x' : networkEvents > 30 ? '5x' : networkEvents > 10 ? '3x' : '1x';

          const tagCountsDisplay = `GA4: ${ga4Ids.length} | GTM: ${gtmIds.length} | FB: ${fbIds.length} | AW: ${awIds.length}`;
          const hitsDisplay = Object.keys(hitsById)
            .map((tid) => {
              const hitData = hitsById[tid];
              const eventCounts = Object.entries(hitData.events || {})
                .map(([eventName, count]) => `${eventName}: ${count}`)
                .join(', ');
              return `${tid} (${hitData.total} hits${eventCounts ? `: ${eventCounts}` : ''})`;
            })
            .join('; ');

          let detailsText = '';
          if (fraudCount > 0) {
            detailsText = `Found ${fraudCount} fraud warning(s). Risk Score: ${scanResult.riskScore || 0}`;
          } else {
            detailsText = `Analysis complete. Risk Score: ${scanResult.riskScore || 0}`;
          }

          if (ga4Ids.length > 0 || gtmIds.length > 0 || awIds.length > 0 || fbIds.length > 0) {
            detailsText += `. ${tagCountsDisplay}`;
          } else {
            detailsText += `. No IDs detected`;
          }

          if (flags.length > 0) {
            detailsText += `. Flags: ${flags.join(', ')}`;
          }

          if (hitsDisplay) {
            detailsText += `. Hits Sent: ${hitsDisplay}`;
          }

          const duplicateIds = [...ga4Ids, ...gtmIds, ...awIds, ...fbIds].filter(
            (id, idx, arr) => arr.indexOf(id) !== idx
          );

          const newResult = {
            domain,
            _pageUrl: scanResult.url,
            status: hasFraud ? 'Fraud Detection' : isClean ? 'Verified Human Traffic' : 'Cautious Items',
            riskLevel: isHighRisk ? 'High' : isMediumRisk ? 'Medium' : 'Low',
            details: detailsText,
            action: hasFraud ? 'Block & Report' : isClean ? 'Monitor' : 'Review',
            waste: wasteFactor,
            colorTheme: hasFraud ? 'red' : isClean ? 'green' : 'yellow',
            _hitsById: hitsById,
            _hitsDisplay: hitsDisplay,
            _tagParity: tagParity,
            _tagCountsDisplay: tagCountsDisplay,
            _flags: flags,
            _ga4Ids: ga4Ids,
            _gtmIds: gtmIds,
            _awIds: awIds,
            _fbIds: fbIds,
            duplicateIds
          };

          const evidenceRow = {
            domain,
            page_url: scanResult.url,
            verdict: scanResult.verdict || newResult.status,
            risk_level: newResult.riskLevel,
            risk_score: scanResult.riskScore || 0,
            analytics: {
              ga4_ids: ga4Ids,
              gtm_containers: gtmIds,
              gads_aw_ids: awIds,
              fb_pixel_ids: fbIds
            },
            telemetry: hitsById,
            flags,
            waste: wasteFactor,
            duplicates: duplicateIds,
            tag_parity: tagParity,
            timestamp: scanStartedAt
          };

          tableRows.push(newResult);
          evidenceRows.push(evidenceRow);
        });

        const sharedEvidence = buildEvidencePack(evidenceRows, scanStartedAt, url);
        setData(tableRows);
        setEvidencePack(sharedEvidence);
        setLastScanTimestamp(scanStartedAt);

        // Store the first scan result for AI validation
        const firstResult = result.results[0];
        const generatedScanId = `scan-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        setLatestScanId(generatedScanId);
        setLatestScanData(firstResult);
      } else if (result.error) {
        const errMsg = typeof result.error === 'object' && result.error !== null
          ? (result.error.message || result.error.error || JSON.stringify(result.error))
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

  const handleRefreshAndRescan = () => {
    // Clear previous evidence + results while keeping layout intact
    resetScanState();
    handleScan();
  };

  const loadAffectedVendors = async (domain, pageUrl) => {
    const targetUrl = pageUrl || (domain.startsWith('http') ? domain : `https://${domain}`);
    setAffectedVendors((prev) => ({
      ...prev,
      [domain]: { ...(prev[domain] || {}), loading: true, error: null }
    }));
    try {
      const scanResp = await fetch(`${API_BASE}/api/ad-impression-verification/scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: targetUrl })
      });
      const scanJson = await scanResp.json();
      const scanId = scanJson.runId;
      const dataResp = await fetch(
        `${API_BASE}/api/scans/${encodeURIComponent(scanId)}/publishers/${encodeURIComponent(domain)}/affected-vendors`
      );
      const dataJson = await dataResp.json();
      setAffectedVendors((prev) => ({
        ...prev,
        [domain]: {
          ...(prev[domain] || {}),
          loading: false,
          scanId,
          rows: dataJson.rows || [],
          verdict: dataJson.verdict || null
        }
      }));
    } catch (error) {
      console.error('Failed to load affected vendors', error);
      setAffectedVendors((prev) => ({
        ...prev,
        [domain]: { ...(prev[domain] || {}), loading: false, error: error.message, rows: [] }
      }));
    }
  };

  const togglePublisherSection = async (domain, pageUrl) => {
    setExpandedPublishers((prev) => ({ ...prev, [domain]: !prev[domain] }));
    const entry = affectedVendors[domain];
    if (!entry) {
      await loadAffectedVendors(domain, pageUrl);
    }
  };

  const sendVendorAiValidation = async (domain) => {
    const entry = affectedVendors[domain];
    if (!entry?.scanId) return;
    setAffectedVendors((prev) => ({
      ...prev,
      [domain]: { ...(prev[domain] || {}), aiLoading: true }
    }));
    try {
      const resp = await fetch(
        `${API_BASE}/api/scans/${encodeURIComponent(entry.scanId)}/publishers/${encodeURIComponent(domain)}/affected-vendors/ai-validate`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({})
        }
      );
      const json = await resp.json();
      setAffectedVendors((prev) => ({
        ...prev,
        [domain]: {
          ...(prev[domain] || {}),
          aiLoading: false,
          aiJob: json
        }
      }));
    } catch (error) {
      console.error('AI validation failed', error);
      setAffectedVendors((prev) => ({
        ...prev,
        [domain]: { ...(prev[domain] || {}), aiLoading: false, aiError: error.message }
      }));
    }
  };

  const handleDownloadEvidence = async () => {
    if (!evidencePack) {
      alert('Run a scan before downloading the evidence pack.');
      return;
    }

    // Use the shared evidence object verbatim to preserve integrity
    const zip = new JSZip();
    const csvContent = buildEvidenceCsv(evidencePack);
    zip.file('evidence.json', JSON.stringify(evidencePack, null, 2));
    zip.file('evidence.csv', csvContent);

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

      const result = await response.json();
      setAiResults(result);

      if (result.jobId) {
        alert(`AI Validation submitted successfully! Job ID: ${result.jobId}`);
      } else if (result.runId) {
        alert(`AI Validation submitted successfully! Run ID: ${result.runId}`);
      }
    } catch (error) {
      console.error('AI Validation error:', error);
      alert('AI Validation failed: ' + error.message);
    } finally {
      setAiValidating(false);
    }
  };

  const calculateLoss = (wasteFactor) => {
    if (!wasteFactor || wasteFactor === '1x' || wasteFactor === 'Clean') return '$0.00';
    if (!adSpend || adSpend <= 0) return '$0.00';
    const factor = parseInt(wasteFactor.toString().replace('x', '')) || 1;
    if (factor <= 1) return '$0.00';
    const realValue = adSpend / factor;
    const loss = adSpend - realValue;
    return `-$${loss.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const getThemeIcon = (theme) => {
    switch (theme) {
      case 'red':
        return <AlertOctagon className="text-red-600" size={16} />;
      case 'yellow':
        return <AlertTriangle className="text-yellow-600" size={16} />;
      case 'green':
        return <CheckCircle2 className="text-green-600" size={16} />;
      default:
        return <ShieldCheck size={16} />;
    }
  };

  const toggleSort = (key) => {
    setSortConfig((prev) => {
      if (prev.key === key) {
        return { key, direction: prev.direction === 'asc' ? 'desc' : 'asc' };
      }
      return { key, direction: 'asc' };
    });
  };

  const handleVendorSort = (key) => {
    setVendorSort((prev) => {
      if (prev.key === key) {
        return { key, direction: prev.direction === 'asc' ? 'desc' : 'asc' };
      }
      return { key, direction: 'asc' };
    });
  };

  const sortedData = useMemo(() => {
    const sorted = [...data];
    sorted.sort((a, b) => {
      if (sortConfig.key === 'domain') {
        return sortConfig.direction === 'asc'
          ? a.domain.localeCompare(b.domain)
          : b.domain.localeCompare(a.domain);
      }

      const aScore = riskOrder[a.riskLevel] || 0;
      const bScore = riskOrder[b.riskLevel] || 0;
      return sortConfig.direction === 'asc' ? aScore - bScore : bScore - aScore;
    });
    return sorted;
  }, [data, sortConfig]);

  const overallSeverity = useMemo(() => {
    if (!data.length) return 'Info';
    const highest = data.reduce((acc, row) => Math.max(acc, riskOrder[row.riskLevel] || 0), 0);
    return highest >= 3 ? 'Critical' : highest === 2 ? 'Warning' : 'Info';
  }, [data, riskOrder]);

  const renderCard = (key, title, severity, content) => {
    const isOpen = cardOpen[key];
    const severityColor =
      severity === 'Critical'
        ? 'bg-red-50 text-red-700 border-red-200'
        : severity === 'Warning'
        ? 'bg-yellow-50 text-yellow-700 border-yellow-200'
        : 'bg-blue-50 text-blue-700 border-blue-200';

    return (
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm">
        <button
          onClick={() => setCardOpen((prev) => ({ ...prev, [key]: !prev[key] }))}
          className="w-full flex items-center justify-between px-4 py-3"
        >
          <div className="flex items-center gap-3">
            {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            <span className="font-semibold text-slate-900">{title}</span>
            <span className={`text-xs font-semibold px-2 py-1 rounded-full border ${severityColor}`}>
              {severity}
            </span>
          </div>
          <span className="text-xs text-slate-500">tap to toggle</span>
        </button>
        {isOpen && <div className="px-4 pb-4">{content}</div>}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-white font-sans text-slate-900 overflow-x-hidden">
      {/* HEADER */}
      <header className="flex justify-between items-center py-5 px-6 max-w-screen-xl mx-auto">
        <div className="flex items-center gap-2">
          <div className="cybertect-logo">
            <span className="cyber-text">cyber</span>
            <span className="tect-text">tect</span>
            <span className="com-text">.com</span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <ThemeToggle />
          {user ? (
            <button
              onClick={async () => {
                await signOut();
                localStorage.removeItem('cybertect_rememberMe');
                navigate('/', { replace: true });
              }}
              className="text-slate-600 font-medium hover:text-slate-900 transition"
            >
              Sign out
            </button>
          ) : (
            <Link to="/auth" className="text-slate-600 font-medium hover:text-slate-900 transition">
              Sign in
            </Link>
          )}
        </div>
      </header>

      {/* ACTION BAR */}
      <div className="sticky top-0 z-40 bg-white backdrop-blur border-b border-slate-200 shadow-sm">
        <div className="max-w-screen-xl mx-auto px-4 py-3 flex flex-wrap gap-3 items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-slate-600">
            <Clock size={16} className="text-slate-500" />
            <span className="font-semibold text-slate-800">Last scan:</span>
            <span>{formatTimestamp(lastScanTimestamp)}</span>
          </div>
          <div className="flex flex-wrap gap-2 justify-end">
            <button
              onClick={handleRefreshAndRescan}
              className="flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-200 bg-white text-slate-800 shadow-sm hover:bg-slate-50 disabled:opacity-60"
              disabled={loading}
            >
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
              <span>Refresh / Re-Scan</span>
            </button>
            <button
              onClick={handleDownloadEvidence}
              className="flex items-center gap-2 px-3 py-2 rounded-lg border border-[#2563EB] bg-white text-[#2563EB] shadow-sm hover:bg-blue-50 disabled:opacity-60"
              disabled={!evidencePack || loading}
            >
              <Download size={16} />
              <span>Download Evidence Pack</span>
            </button>
            <button
              onClick={handleAIValidation}
              className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[#2563EB] text-white shadow-sm hover:bg-[#1d4ed8] disabled:opacity-60"
              disabled={!evidencePack || !latestScanData || aiValidating}
            >
              <Send size={16} className={aiValidating ? 'animate-pulse' : ''} />
              <span>Send to AI Validation</span>
            </button>
          </div>
        </div>
      </div>

      <main className="max-w-screen-xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        {/* SCAN INPUT */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4 sm:p-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-center">
            <div className="flex-grow relative">
              <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                <Search className="text-slate-400" size={20} />
              </div>
              <input
                type="text"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="Enter a URL to scan (no horizontal scroll guaranteed)"
                className="w-full p-4 pl-12 bg-slate-50 border border-slate-200 rounded-xl outline-none text-slate-700 placeholder:text-slate-400 text-base"
              />
            </div>

            <div className="relative md:w-48 md:border-l md:border-slate-200 md:pl-4">
              <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                <Banknote className="text-green-600" size={20} />
              </div>
              <input
                type="number"
                value={adSpend}
                onChange={(e) => setAdSpend(Number(e.target.value))}
                min="0"
                step="100"
                className="w-full p-4 pl-12 bg-slate-50 border border-slate-200 rounded-xl outline-none text-slate-700 font-semibold text-base placeholder:text-slate-400"
                placeholder="Ad Spend"
              />
            </div>

            <button
              onClick={handleScan}
              disabled={loading}
              className="bg-[#2563EB] text-white px-6 py-3 rounded-xl font-semibold text-base hover:bg-[#1d4ed8] transition shadow-md flex items-center justify-center gap-2 min-w-[150px] self-start md:self-auto"
            >
              {loading ? <RefreshCw className="animate-spin" size={18} /> : <ShieldCheck size={18} />}
              {loading ? 'Analyzing...' : 'Run Scan'}
            </button>
          </div>
        </div>

        {/* SUMMARY CARD */}
        {renderCard(
          'summary',
          'Scan Summary',
          overallSeverity,
          <div className="overflow-hidden rounded-xl border border-slate-100">
            <div className="max-h-96 overflow-y-auto">
              <table className="min-w-full table-fixed text-sm">
                <thead className="sticky top-0 bg-white">
                  <tr className="text-left text-xs text-slate-500 uppercase tracking-wide">
                    <th
                      className="px-3 py-2 cursor-pointer select-none"
                      onClick={() => toggleSort('domain')}
                    >
                      Domain
                    </th>
                    <th
                      className="px-3 py-2 cursor-pointer select-none"
                      onClick={() => toggleSort('riskLevel')}
                    >
                      Severity
                    </th>
                    <th className="px-3 py-2">Waste</th>
                    <th className="px-3 py-2">Flags</th>
                    <th className="px-3 py-2">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedData.length === 0 && (
                    <tr>
                      <td className="px-3 py-3 text-slate-500" colSpan={5}>
                        No scans yet. Run a scan to populate this table.
                      </td>
                    </tr>
                  )}
                  {sortedData.map((row, index) => {
                    const severity = severityFromRisk(row.riskLevel);
                    const severityClass =
                      severity === 'Critical'
                        ? 'bg-red-50 text-red-800 border-red-200'
                        : severity === 'Warning'
                        ? 'bg-yellow-50 text-yellow-800 border-yellow-200'
                        : 'bg-green-50 text-green-800 border-green-200';
                    const vendorEntry = affectedVendors[row.domain] || {};
                    const vendorRows = (vendorEntry.rows || []).slice().sort((a, b) => {
                      const dir = vendorSort.direction === 'asc' ? 1 : -1;
                      if (vendorSort.key === 'first_seen_ts' || vendorSort.key === 'last_seen_ts') {
                        return (
                          (new Date(a[vendorSort.key] || 0) - new Date(b[vendorSort.key] || 0)) * dir
                        );
                      }
                      const aVal = a[vendorSort.key] ?? 0;
                      const bVal = b[vendorSort.key] ?? 0;
                      return aVal === bVal ? 0 : aVal > bVal ? dir : -dir;
                    });
                    const isExpanded = expandedPublishers[row.domain];
                    const verdictStatus = vendorEntry.verdict?.ai_verdict_status || vendorEntry.aiJob?.status;
                    const verdictPillClass =
                      verdictStatus === 'fail'
                        ? 'bg-red-100 text-red-700 border-red-200'
                        : verdictStatus === 'pass'
                        ? 'bg-green-100 text-green-700 border-green-200'
                        : verdictStatus
                        ? 'bg-amber-100 text-amber-700 border-amber-200'
                        : 'bg-slate-100 text-slate-700 border-slate-200';

                    return (
                      <React.Fragment key={`${row.domain}-${index}`}>
                        <tr className="border-t border-slate-100 align-top">
                          <td className="px-3 py-3">
                            <div className="flex items-start gap-2">
                              <button
                                onClick={() => togglePublisherSection(row.domain, row._pageUrl)}
                                className="mt-1 text-slate-500 hover:text-slate-800"
                                title="Toggle affected ad vendors"
                              >
                                {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                              </button>
                              <div>
                                <div className="flex items-center gap-2">
                                  {getThemeIcon(row.colorTheme)}
                                  <span className="font-semibold break-words">{row.domain}</span>
                                </div>
                                <p className="text-xs text-slate-500 mt-1 leading-snug line-clamp-2">
                                  {row.details}
                                </p>
                              </div>
                            </div>
                          </td>
                          <td className="px-3 py-3">
                            <span className={`text-xs px-2 py-1 rounded-full border ${severityClass}`}>
                              {severity}
                            </span>
                          </td>
                          <td className="px-3 py-3">
                            <div className="flex items-center gap-2">
                              <span className="font-semibold">{row.waste}</span>
                              {row.waste !== '1x' && (
                                <span className="text-xs text-red-600">{calculateLoss(row.waste)}</span>
                              )}
                            </div>
                          </td>
                          <td className="px-3 py-3">
                            <div className="flex flex-wrap gap-1">
                              {(row._flags || []).map((flag) => (
                                <span
                                  key={flag}
                                  className="px-2 py-0.5 bg-orange-50 text-orange-700 rounded text-[11px] border border-orange-200"
                                >
                                  {flag}
                                </span>
                              ))}
                              {row.duplicateIds?.length > 0 && (
                                <span className="px-2 py-0.5 bg-red-50 text-red-700 rounded text-[11px] border border-red-200">
                                  {row.duplicateIds.length} duplicate ID(s)
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-3 py-3">
                            <span className="inline-flex px-3 py-1 rounded-full bg-slate-50 border border-slate-200 text-xs font-semibold">
                              {row.action}
                            </span>
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr className="border-t border-slate-100 bg-slate-50/60">
                            <td colSpan={5} className="px-3 pb-4">
                              <div className="mt-2 rounded-lg border border-slate-200 bg-white">
                                <div className="flex flex-wrap items-start justify-between gap-3 px-3 py-2">
                                  <div>
                                    <div className="font-semibold text-slate-900">Affected Ad Vendors (Hosts)</div>
                                    <p className="text-xs text-slate-500">
                                      Live count of ad slots that fired confirmed impression events during the scan,
                                      including ad-tech and demand vendor hosts.
                                    </p>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <span
                                      className={`text-[11px] px-2 py-1 rounded-full border ${verdictPillClass}`}
                                      title="AI verdict status"
                                    >
                                      {verdictStatus ? verdictStatus : 'not validated'}
                                    </span>
                                    <button
                                      onClick={() => sendVendorAiValidation(row.domain)}
                                      disabled={!vendorEntry.scanId || vendorEntry.aiLoading}
                                      className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-md bg-[#2563EB] text-white hover:bg-[#1d4ed8] disabled:opacity-50"
                                    >
                                      <Send size={14} className={vendorEntry.aiLoading ? 'animate-pulse' : ''} />
                                      <span>Send to AI Validation</span>
                                    </button>
                                  </div>
                                </div>
                                <div className="px-3 pb-3">
                                  {vendorEntry.loading && (
                                    <div className="text-xs text-slate-500">Loading confirmed impression events…</div>
                                  )}
                                  {vendorEntry.error && (
                                    <div className="text-xs text-red-600">Error: {vendorEntry.error}</div>
                                  )}
                                  {!vendorEntry.loading && !vendorRows.length && !vendorEntry.error && (
                                    <div className="text-xs text-slate-500">
                                      Run a scan to populate affected ad vendor impact.
                                    </div>
                                  )}
                                  {vendorRows.length > 0 && (
                                    <div className="mt-2 max-h-72 overflow-y-auto">
                                      <table className="min-w-full table-fixed text-xs">
                                        <thead className="sticky top-0 bg-white">
                                          <tr className="text-left text-[11px] text-slate-500 uppercase tracking-wide">
                                            <th
                                              className="px-2 py-1 cursor-pointer select-none"
                                              onClick={() => handleVendorSort('vendor_host')}
                                            >
                                              Vendor / Host
                                            </th>
                                            <th
                                              className="px-2 py-1 cursor-pointer select-none"
                                              onClick={() => handleVendorSort('ad_slot_id')}
                                            >
                                              Ad Slot / Tag ID
                                            </th>
                                            <th
                                              className="px-2 py-1 cursor-pointer select-none"
                                              onClick={() => handleVendorSort('impressions')}
                                            >
                                              Impressions
                                            </th>
                                            <th
                                              className="px-2 py-1 cursor-pointer select-none"
                                              onClick={() => handleVendorSort('duplication_rate')}
                                            >
                                              Duplication Rate
                                            </th>
                                            <th
                                              className="px-2 py-1 cursor-pointer select-none"
                                              onClick={() => handleVendorSort('max_impressions_per_second')}
                                            >
                                              Max Imps / Sec
                                            </th>
                                            <th
                                              className="px-2 py-1 cursor-pointer select-none"
                                              onClick={() => handleVendorSort('first_seen_ts')}
                                            >
                                              First Seen
                                            </th>
                                            <th
                                              className="px-2 py-1 cursor-pointer select-none"
                                              onClick={() => handleVendorSort('last_seen_ts')}
                                            >
                                              Last Seen
                                            </th>
                                            <th className="px-2 py-1">Brand (if detected)</th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {vendorRows.map((v, vidx) => {
                                            const rate = v.duplication_rate || 0;
                                            const rowTone =
                                              rate > 0.5 || v.stacking_suspected
                                                ? 'bg-red-50'
                                                : rate > 0.2
                                                ? 'bg-orange-50'
                                                : '';
                                            return (
                                              <tr key={`${v.vendor_host}-${v.ad_slot_id}-${vidx}`} className={rowTone}>
                                                <td className="px-2 py-1 break-words">{v.vendor_host}</td>
                                                <td className="px-2 py-1 break-words">{v.ad_slot_id}</td>
                                                <td className="px-2 py-1">{v.impressions}</td>
                                                <td className="px-2 py-1">
                                                  {((rate || 0) * 100).toFixed(1)}%
                                                </td>
                                                <td className="px-2 py-1">{v.max_impressions_per_second || 0}</td>
                                                <td className="px-2 py-1">{formatTimestamp(v.first_seen_ts)}</td>
                                                <td className="px-2 py-1">{formatTimestamp(v.last_seen_ts)}</td>
                                                <td className="px-2 py-1">
                                                  {v.brand_guess ? `${v.brand_guess} (${v.brand_method})` : '—'}
                                                </td>
                                              </tr>
                                            );
                                          })}
                                        </tbody>
                                      </table>
                                    </div>
                                  )}
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ANALYTICS CARD */}
        {renderCard(
          'analytics',
          'Analytics & IDs',
          overallSeverity,
          <div className="overflow-hidden rounded-xl border border-slate-100">
            <div className="max-h-96 overflow-y-auto">
              <table className="min-w-full table-fixed text-sm">
                <thead className="sticky top-0 bg-white">
                  <tr className="text-left text-xs text-slate-500 uppercase tracking-wide">
                    <th className="px-3 py-2">Domain</th>
                    <th className="px-3 py-2">GA4</th>
                    <th className="px-3 py-2">GTM</th>
                    <th className="px-3 py-2">Ads</th>
                    <th className="px-3 py-2">FB</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedData.length === 0 && (
                    <tr>
                      <td className="px-3 py-3 text-slate-500" colSpan={5}>
                        No analytics detected yet.
                      </td>
                    </tr>
                  )}
                  {sortedData.map((row, idx) => {
                    const duplicateLookup = new Set(row.duplicateIds || []);
                    const renderCell = (ids, color) => {
                      if (!ids?.length) return <span className="text-xs text-slate-400">None</span>;
                      return (
                        <div className="flex flex-wrap gap-1">
                          {ids.map((id) => (
                            <span
                              key={id}
                              className={`px-2 py-0.5 rounded text-[11px] border ${
                                duplicateLookup.has(id)
                                  ? 'bg-orange-50 text-orange-700 border-orange-200'
                                  : color
                              }`}
                            >
                              {id}
                            </span>
                          ))}
                        </div>
                      );
                    };

                    return (
                      <tr key={`${row.domain}-analytics-${idx}`} className="border-t border-slate-100">
                        <td className="px-3 py-3">
                          <div className="font-semibold break-words">{row.domain}</div>
                          <p className="text-[11px] text-slate-500">Counts: {row._tagCountsDisplay}</p>
                        </td>
                        <td className="px-3 py-3">{renderCell(row._ga4Ids, 'bg-blue-50 text-blue-700 border-blue-200')}</td>
                        <td className="px-3 py-3">{renderCell(row._gtmIds, 'bg-purple-50 text-purple-700 border-purple-200')}</td>
                        <td className="px-3 py-3">{renderCell(row._awIds, 'bg-green-50 text-green-700 border-green-200')}</td>
                        <td className="px-3 py-3">{renderCell(row._fbIds, 'bg-indigo-50 text-indigo-700 border-indigo-200')}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TELEMETRY CARD */}
        {renderCard(
          'telemetry',
          'Telemetry & Beacons',
          overallSeverity,
          <div className="overflow-hidden rounded-xl border border-slate-100">
            <div className="max-h-96 overflow-y-auto">
              <table className="min-w-full table-fixed text-sm">
                <thead className="sticky top-0 bg-white">
                  <tr className="text-left text-xs text-slate-500 uppercase tracking-wide">
                    <th className="px-3 py-2">Domain</th>
                    <th className="px-3 py-2">Tracker ID</th>
                    <th className="px-3 py-2">Total Hits</th>
                    <th className="px-3 py-2">Events</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedData.length === 0 && (
                    <tr>
                      <td className="px-3 py-3 text-slate-500" colSpan={4}>
                        No telemetry captured yet.
                      </td>
                    </tr>
                  )}
                  {sortedData.map((row, idx) => {
                    const hits = row._hitsById || {};
                    const hitKeys = Object.keys(hits);
                    if (!hitKeys.length) {
                      return (
                        <tr key={`${row.domain}-telemetry-${idx}`} className="border-t border-slate-100">
                          <td className="px-3 py-3">{row.domain}</td>
                          <td className="px-3 py-3 text-slate-500" colSpan={3}>
                            No beacons sent.
                          </td>
                        </tr>
                      );
                    }

                    return hitKeys.map((tid, innerIdx) => {
                      const hitData = hits[tid] || {};
                      return (
                        <tr
                          key={`${row.domain}-${tid}-${innerIdx}`}
                          className={`border-t border-slate-100 ${
                            (row.duplicateIds || []).includes(tid) ? 'bg-orange-50' : ''
                          }`}
                        >
                          <td className="px-3 py-3">{innerIdx === 0 ? row.domain : ''}</td>
                          <td className="px-3 py-3">
                            <span className="font-semibold break-words">{tid}</span>
                          </td>
                          <td className="px-3 py-3">{hitData.total || 0}</td>
                          <td className="px-3 py-3">
                            <div className="flex flex-wrap gap-1">
                              {Object.entries(hitData.events || {}).map(([eventName, count]) => (
                                <span
                                  key={eventName}
                                  className="px-2 py-0.5 bg-slate-50 text-slate-700 border border-slate-200 rounded text-[11px]"
                                >
                                  {eventName}: {count}
                                </span>
                              ))}
                            </div>
                          </td>
                        </tr>
                      );
                    });
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* CMS / FLAGS CARD */}
        {renderCard(
          'cms',
          'CMS & DOM Findings',
          overallSeverity,
          <div className="overflow-hidden rounded-xl border border-slate-100">
            <div className="max-h-80 overflow-y-auto">
              <table className="min-w-full table-fixed text-sm">
                <thead className="sticky top-0 bg-white">
                  <tr className="text-left text-xs text-slate-500 uppercase tracking-wide">
                    <th className="px-3 py-2">Domain</th>
                    <th className="px-3 py-2">Flags</th>
                    <th className="px-3 py-2">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedData.length === 0 && (
                    <tr>
                      <td className="px-3 py-3 text-slate-500" colSpan={3}>
                        No CMS/DOM findings yet.
                      </td>
                    </tr>
                  )}
                  {sortedData.map((row, idx) => (
                    <tr key={`${row.domain}-cms-${idx}`} className="border-t border-slate-100">
                      <td className="px-3 py-3">
                        <div className="font-semibold break-words">{row.domain}</div>
                        <p className="text-[11px] text-slate-500 mt-1">Risk: {row.riskLevel}</p>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex flex-wrap gap-1">
                          {(row._flags || []).map((flag) => (
                            <span
                              key={flag}
                              className="px-2 py-0.5 bg-orange-50 text-orange-700 rounded text-[11px] border border-orange-200"
                            >
                              {flag}
                            </span>
                          ))}
                          {row.duplicateIds?.length > 0 && (
                            <span className="px-2 py-0.5 bg-red-50 text-red-700 rounded text-[11px] border border-red-200">
                              Duplicate IDs detected
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <p className="text-xs leading-snug text-slate-700 whitespace-normal break-words">
                          {row.details}
                        </p>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {aiResults && (
          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-4">
            <div className="flex items-center gap-2 mb-2">
              <Sparkles size={16} className="text-purple-600" />
              <span className="font-semibold text-slate-900">AI Validation Response</span>
            </div>
            <pre className="bg-slate-50 text-xs p-3 rounded-lg overflow-auto max-h-64 whitespace-pre-wrap break-words">
              {JSON.stringify(aiResults, null, 2)}
            </pre>
          </div>
        )}
      </main>

      <Footer />
    </div>
  );
};

export default Scanner;
