import { useState } from 'react';
import { Shield, Zap, Sparkles, Radar, Download, Loader2, RefreshCw } from 'lucide-react';
import Footer from './Footer';

const LandingPage = ({ onNavigateToDashboard }) => {
  // Scanner state
  const [urls, setUrls] = useState('');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState([]);
  const [globalHistory, setGlobalHistory] = useState([]);
  const [downloadingEvidence, setDownloadingEvidence] = useState(false);

  const handleClearHistory = () => {
    if (globalHistory.length === 0) return;
    if (confirm(`Clear all ${globalHistory.length} scanned domains?`)) {
      setGlobalHistory([]);
      setResults([]);
    }
  };

  const handleDownloadEvidencePack = async () => {
    if (globalHistory.length === 0) {
      alert("No scan results to download");
      return;
    }
    
    setDownloadingEvidence(true);
    try {
      const response = await fetch('http://localhost:3000/api/scans/evidence-pack', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Failed to generate evidence pack' }));
        throw new Error(errorData.error || 'Failed to generate evidence pack');
      }
      
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `scan-evidence-pack-${new Date().toISOString().slice(0,10)}.zip`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      alert("Failed to download evidence pack: " + err.message);
    } finally {
      setDownloadingEvidence(false);
    }
  };

  return (
    <div className="min-h-screen bg-white">
      {/* Navbar */}
      <nav className="sticky top-0 z-50 bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            {/* Logo */}
            <div className="flex items-center">
              <div className="cybertect-logo">
                <span className="cyber-text">cyber</span>
                <span className="tect-text">tect</span>
                <span className="com-text">.com</span>
              </div>
            </div>

            {/* Center Links */}
            <div className="hidden md:flex items-center space-x-8">
              <a href="#product" className="text-gray-700 hover:text-gray-900 text-sm font-medium">
                Product
              </a>
              
              {/* Tools Dropdown */}
              <div className="relative group">
                <button className="text-gray-700 hover:text-gray-900 text-sm font-medium flex items-center gap-1">
                  Tools
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                <div className="absolute left-0 mt-2 w-64 bg-white rounded-lg shadow-xl border border-gray-200 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-50">
                  <a href="/videotect" className="block px-4 py-3 text-sm text-gray-700 hover:bg-gray-50 border-b border-gray-100">
                    <div className="font-medium text-gray-900">Videotect</div>
                    <div className="text-xs text-gray-500 mt-0.5">Video ad waste detection & analytics</div>
                  </a>
                  <a href="/ai-validation" className="block px-4 py-3 text-sm text-gray-700 hover:bg-gray-50">
                    <div className="font-medium text-gray-900">AI Validation</div>
                    <div className="text-xs text-gray-500 mt-0.5">Validate AI-generated content</div>
                  </a>
                </div>
              </div>
              
              <a href="#solutions" className="text-gray-700 hover:text-gray-900 text-sm font-medium">
                Solutions
              </a>
              <a href="#pricing" className="text-gray-700 hover:text-gray-900 text-sm font-medium">
                Pricing
              </a>
            </div>

            {/* Dashboard Link */}
            {onNavigateToDashboard && (
              <a 
                href="/scanner"
                className="bg-[#2563EB] text-white px-6 py-2 rounded-full text-sm font-medium hover:bg-[#1d4ed8] transition-colors"
              >
                Dashboard
              </a>
            )}
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 lg:py-32">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
          {/* Left Content */}
          <div>
            <h1 className="text-4xl lg:text-5xl font-light text-gray-900 mb-6 leading-tight">
              Stop Paying for Phantom Impressions
            </h1>
            <p className="text-lg lg:text-xl text-gray-600 mb-8 leading-relaxed">
              Most fraud tools hunt bots. Cybertect audits the page itself—verifying which ad slots actually rendered, which beacons were real impressions, and where inflated telemetry quietly burns budget.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 mb-6">
              <a 
                href="/scanner"
                className="bg-[#2563EB] text-white px-8 py-3 rounded-full text-base font-medium hover:bg-[#1d4ed8] transition-colors shadow-sm text-center"
              >
                Run Forensic Scan
              </a>
              <button
                onClick={() => {
                  // Scroll to sample section or open placeholder modal
                  const sampleSection = document.getElementById('sample-report');
                  if (sampleSection) {
                    sampleSection.scrollIntoView({ behavior: 'smooth' });
                  } else {
                    alert('Sample report coming soon');
                  }
                }}
                className="bg-white text-gray-700 px-8 py-3 rounded-full text-base font-medium border-2 border-gray-300 hover:border-gray-400 transition-colors text-center"
              >
                View Sample Report
              </button>
            </div>
          </div>

          {/* Right Image */}
          <div className="relative">
            <div className="animate-float">
              <img 
                src="/hero-house.svg" 
                alt="Illustration of a cracked house with blue door" 
                className="w-full h-auto rounded-3xl shadow-2xl"
              />
            </div>
          </div>
        </div>
      </section>

      {/* Outcome Strip */}
      <section className="bg-[#F8F9FA] py-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <p className="text-sm font-medium text-gray-700 mb-4">What you get in minutes:</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="flex items-start gap-3">
              <span className="text-[#2563EB] font-bold mt-0.5">•</span>
              <p className="text-sm text-gray-600">Verified Impressions you can reconcile against ad server/DSP delivery</p>
            </div>
            <div className="flex items-start gap-3">
              <span className="text-[#2563EB] font-bold mt-0.5">•</span>
              <p className="text-sm text-gray-600">Fraud mechanics identified (stacking, pixel stuffing, hidden slots, spoofed beacons)</p>
            </div>
            <div className="flex items-start gap-3">
              <span className="text-[#2563EB] font-bold mt-0.5">•</span>
              <p className="text-sm text-gray-600">Exportable report for disputes and remediation</p>
            </div>
          </div>
        </div>
      </section>

      {/* Problem Section */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-4xl font-light text-gray-900 mb-6">
            The biggest waste isn't bots. It's bad measurement.
          </h2>
          <p className="text-lg text-gray-600 leading-relaxed">
            Inflation often happens inside the page: stacked ad slots, tiny frames, forced-hidden placements, duplicate analytics, and generic sync pixels counted like impressions. Cybertect exposes the mechanics—with evidence you can take to publishers, SSPs, and auditors.
          </p>
        </div>
      </section>

      {/* Scanner Section */}
      <section id="scanner" className="bg-white py-20 scroll-mt-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="bg-white border border-gray-200 rounded-3xl p-8 shadow-sm mb-8">
            <label className="block text-sm font-medium text-gray-900 mb-3">
              Enter publisher URLs
            </label>
            <textarea
              value={urls}
              onChange={(e) => setUrls(e.target.value)}
              placeholder="https://example.com"
              className="w-full h-32 p-4 border border-gray-300 rounded-xl font-mono text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB] focus:border-transparent"
            />
            <p className="text-xs text-gray-500 mt-2">
              One per line. We'll crawl each page, map ad slots + tags, and generate proof-grade evidence (timelines, requests, slot geometry, screenshots).
            </p>
            
            <div className="flex items-center gap-4 mt-6">
              <button
                onClick={async () => {
                  if (!urls.trim()) {
                    alert("Please enter URLs");
                    return;
                  }

                  setLoading(true);
                  const urlList = urls.split(/[\n,]+/).map(u => u.trim()).filter(u => u.length > 0);

                  try {
                    const res = await fetch('http://localhost:3000/api/scan', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ urls: urlList })
                    });
                    const data = await res.json();
                    
                    // Merge with existing results
                    const newHistory = [...globalHistory, ...data.results];
                    const uniqueMap = new Map();
                    newHistory.forEach(item => uniqueMap.set(item.url, item));
                    const deduplicated = Array.from(uniqueMap.values());
                    
                    setGlobalHistory(deduplicated);
                    setResults(data.results);
                  } catch (err) {
                    alert("Connection Error: " + err.message);
                  } finally {
                    setLoading(false);
                  }
                }}
                disabled={loading}
                className="bg-[#2563EB] text-white px-6 py-3 rounded-full text-sm font-medium hover:bg-[#1d4ed8] transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Scanning...
                  </>
                ) : (
                  <>
                    <Radar className="w-4 h-4" />
                    Run Forensic Scan
                  </>
                )}
              </button>

              {globalHistory.length > 0 && (
                <>
                  <button
                    onClick={handleClearHistory}
                    className="bg-gray-500 text-white px-6 py-3 rounded-full text-sm font-medium hover:bg-gray-600 transition-colors flex items-center gap-2"
                    title="Clear scanned domains"
                  >
                    <RefreshCw className="w-4 h-4" />
                    Clear History
                  </button>
                  <button
                    onClick={handleDownloadEvidencePack}
                    disabled={downloadingEvidence}
                    className="bg-purple-600 text-white px-6 py-3 rounded-full text-sm font-medium hover:bg-purple-700 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center gap-2"
                    title="Download evidence pack"
                  >
                    {downloadingEvidence ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Generating...
                      </>
                    ) : (
                      <>
                        <Download className="w-4 h-4" />
                        Evidence Pack
                      </>
                    )}
                  </button>
                  <button
                    onClick={() => {
                      if (globalHistory.length === 0) return alert("No data");
                      const headers = ["Domain", "Risk", "Fraud", "IDs", "Views", "Waste"];
                      const rows = globalHistory.map(r => {
                        const host = new URL(r.url).hostname;
                        const risk = r.fraudWarnings.length > 0 ? "High" : "Low";
                        const fraud = r.fraudWarnings.map(f => f.type).join("; ");
                        const ids = (r.analyticsIds || []).join("; ");
                        const waste = Math.max(1, Math.round(r.networkEventsCount / 50)) + "x";
                        return [host, risk, fraud, ids, r.pageViewCount || 0, waste];
                      });
                      const csv = "data:text/csv;charset=utf-8," + [headers, ...rows].map(row => 
                        row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')
                      ).join("\n");
                      const link = document.createElement("a");
                      link.href = encodeURI(csv);
                      link.download = `Qualytics_Audit_${new Date().toISOString().slice(0,10)}.csv`;
                      document.body.appendChild(link);
                      link.click();
                    }}
                    className="bg-green-600 text-white px-6 py-3 rounded-full text-sm font-medium hover:bg-green-700 transition-colors flex items-center gap-2 ml-auto"
                  >
                    <Download className="w-4 h-4" />
                    Save Report
                  </button>
                  {onNavigateToDashboard && (
                    <button
                      onClick={onNavigateToDashboard}
                      className="bg-gray-600 text-white px-6 py-3 rounded-full text-sm font-medium hover:bg-gray-700 transition-colors"
                    >
                      View Dashboard
                    </button>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Advertiser Impact Section */}
          <div className="mb-12">
            <h2 className="text-3xl font-light text-gray-900 mb-4">
              See who gets impacted—and how often—during the scan
            </h2>
            <p className="text-lg text-gray-600 mb-6">
              Cybertect surfaces which advertiser tags fired, which slots they fired in, and how many times, with first/last seen timestamps—so you can quantify impact and prioritize disputes.
            </p>
          </div>

          {/* Results Table */}
          {globalHistory.length > 0 ? (
            <div className="bg-white border border-gray-200 rounded-3xl overflow-hidden shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-[#F8F9FA]">
                    <tr>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">DOMAIN</th>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">RISK LEVEL</th>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">DIGITAL SIGNATURE (Analytics IDs)</th>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">FRAUD TYPES FOUND</th>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">VIEWS</th>
                      <th className="px-6 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">NETWORK & IMPACT ANALYSIS</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {(() => {
                      // Network detection for shared IDs
                      const idToHosts = {};
                      globalHistory.forEach(r => {
                        if(r.analyticsIds) {
                          const h = new URL(r.url).hostname;
                          r.analyticsIds.forEach(id => {
                            if (!idToHosts[id]) idToHosts[id] = new Set();
                            idToHosts[id].add(h);
                          });
                        }
                      });

                      return globalHistory.map((r, idx) => {
                        if (r.error) {
                          return (
                            <tr key={idx}>
                              <td colSpan="6" className="px-6 py-4 text-red-600">{r.url} - Scan Failed</td>
                            </tr>
                          );
                        }

                        const host = new URL(r.url).hostname;
                        let sharedIdFound = false;

                        const ids = (r.analyticsIds || []).map(id => {
                          const isShared = idToHosts[id] && idToHosts[id].size > 1;
                          if (isShared) sharedIdFound = true;
                          const style = isShared 
                            ? "bg-red-600 text-white" 
                            : "bg-blue-100 text-blue-700";
                          
                          // Add Hits Sent info from hitsById if available
                          const hitsById = r.hitsById || {};
                          const hitData = hitsById[id];
                          const title = isShared 
                            ? 'Shared Network ID - Appears across multiple domains' 
                            : hitData 
                              ? `Standard Analytics ID - ${hitData.total} hits sent (${Object.entries(hitData.events || {}).map(([e, c]) => `${e}:${c}`).join(', ')})`
                              : 'Standard Analytics ID';
                          
                          return (
                            <span
                              key={id}
                              className={`px-2 py-1 rounded-lg text-xs font-medium mr-1 ${style}`}
                              title={title}
                            >
                              {id}
                              {hitData && hitData.total > 0 && (
                                <span className="ml-1 text-xs opacity-75">({hitData.total})</span>
                              )}
                            </span>
                          );
                        });

                        const fraud = r.fraudWarnings.map(f => (
                          <span
                            key={f.type}
                            className="px-2 py-1 rounded-lg text-xs font-medium mr-1 bg-red-100 text-red-700"
                          >
                            {f.type}
                          </span>
                        ));

                        const waste = Math.max(1, Math.round(r.networkEventsCount / 50));
                        let analysis = [];
                        if (sharedIdFound) analysis.push(<div key="shared" className="text-red-600 font-semibold">⚠ Shared Network</div>);
                        if (waste > 2) analysis.push(<div key="waste">💸 {waste}x Budget Drain</div>);

                        return (
                          <tr key={idx} className="hover:bg-gray-50">
                            <td className="px-6 py-4 font-medium text-gray-900">{host}</td>
                            <td className="px-6 py-4">
                              {r.fraudWarnings.length > 0 ? (
                                <span className="px-2 py-1 rounded-lg text-xs font-medium bg-red-100 text-red-700">🔴 High</span>
                              ) : (
                                <span className="px-2 py-1 rounded-lg text-xs font-medium bg-green-100 text-green-700">🟢 Low</span>
                              )}
                            </td>
                            <td className="px-6 py-4">{ids.length > 0 ? ids : "-"}</td>
                            <td className="px-6 py-4">
                              {fraud.length > 0 ? fraud : (
                                (() => {
                                  // Check for duplicate pageviews before marking as Clean
                                  const hitsById = r.hitsById || {};
                                  const hasDuplicatePageViews = Object.values(hitsById).some(hitData => {
                                    const pageViewCount = (hitData.events?.['page_view'] || 0) + (hitData.events?.['pageview'] || 0);
                                    return pageViewCount > 1;
                                  });
                                  return hasDuplicatePageViews ? (
                                    <span className="px-2 py-1 rounded-lg text-xs font-medium bg-yellow-100 text-yellow-700">⚠ Duplicate Pageviews</span>
                                  ) : (
                                    <span className="px-2 py-1 rounded-lg text-xs font-medium bg-green-100 text-green-700">Clean</span>
                                  );
                                })()
                              )}
                            </td>
                            <td className="px-6 py-4 text-center font-medium">
                              {r.pageviewsPerNavigation !== undefined ? r.pageviewsPerNavigation : (r.pageViewCount || "-")}
                            </td>
                            <td className="px-6 py-4 text-sm">{analysis.length > 0 ? analysis : "-"}</td>
                          </tr>
                        );
                      });
                    })()}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="bg-gray-50 border border-gray-200 rounded-3xl p-12 text-center">
              <p className="text-gray-600">
                Run a scan to populate advertiser impact and generate a shareable evidence trail.
              </p>
            </div>
          )}
        </div>
      </section>

      {/* Detections Section */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
        <h2 className="text-4xl font-light text-gray-900 mb-12 text-center">
          Page-level forensics that standard IVT tools don't see
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {/* Card 1 */}
          <div className="bg-white p-8 rounded-3xl border border-gray-200 shadow-sm hover:shadow-md transition-shadow">
            <div className="w-12 h-12 bg-red-100 rounded-2xl flex items-center justify-center mb-6">
              <Radar className="w-6 h-6 text-red-600" />
            </div>
            <h3 className="text-2xl font-semibold text-gray-900 mb-3">
              Ad Stacking Radar
            </h3>
            <p className="text-gray-600 leading-relaxed">
              Detects overlapping ad iframes and flags placements where multiple impressions compete for the same pixels. Includes overlap % and slot evidence.
            </p>
          </div>

          {/* Card 2 */}
          <div className="bg-white p-8 rounded-3xl border border-gray-200 shadow-sm hover:shadow-md transition-shadow">
            <div className="w-12 h-12 bg-blue-100 rounded-2xl flex items-center justify-center mb-6">
              <Zap className="w-6 h-6 text-[#2563EB]" />
            </div>
            <h3 className="text-2xl font-semibold text-gray-900 mb-3">
              Pixel Stuffing Sniffer
            </h3>
            <p className="text-gray-600 leading-relaxed">
              Finds 1×1 and tiny frames used to generate noise impressions. Filters known ID-sync endpoints so you don't chase false positives.
            </p>
          </div>

          {/* Card 3 */}
          <div className="bg-white p-8 rounded-3xl border border-gray-200 shadow-sm hover:shadow-md transition-shadow">
            <div className="w-12 h-12 bg-green-100 rounded-2xl flex items-center justify-center mb-6">
              <Shield className="w-6 h-6 text-green-600" />
            </div>
            <h3 className="text-2xl font-semibold text-gray-900 mb-3">
              Visibility Forensics
            </h3>
            <p className="text-gray-600 leading-relaxed">
              Captures computed CSS (display/visibility/opacity/offscreen) to prove when rendered wasn't viewable—or wasn't visible at all.
            </p>
          </div>

          {/* Card 4 */}
          <div className="bg-white p-8 rounded-3xl border border-gray-200 shadow-sm hover:shadow-md transition-shadow">
            <div className="w-12 h-12 bg-purple-100 rounded-2xl flex items-center justify-center mb-6">
              <Sparkles className="w-6 h-6 text-purple-600" />
            </div>
            <h3 className="text-2xl font-semibold text-gray-900 mb-3">
              Analytics Inflation Alerts
            </h3>
            <p className="text-gray-600 leading-relaxed">
              Flags duplicate/competing analytics and tag collisions that inflate sessions, pageviews, and event volume—polluting ROI and attribution.
            </p>
          </div>
        </div>
      </section>

      {/* Verified Impression Section */}
      <section className="bg-[#F8F9FA] py-20">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-4xl font-light text-gray-900 mb-6">
            Verified Impression = evidence-backed, not just a request fired.
          </h2>
          <p className="text-lg text-gray-600 mb-6">
            Cybertect only counts an impression as verified when it's supported by at least one of:
          </p>
          <ul className="space-y-3 mb-8">
            <li className="flex items-start gap-3">
              <span className="text-[#2563EB] font-bold mt-1">•</span>
              <p className="text-gray-700">A non-empty slot render event, or</p>
            </li>
            <li className="flex items-start gap-3">
              <span className="text-[#2563EB] font-bold mt-1">•</span>
              <p className="text-gray-700">A GAM request tied to a slot plus a render signal, or</p>
            </li>
            <li className="flex items-start gap-3">
              <span className="text-[#2563EB] font-bold mt-1">•</span>
              <p className="text-gray-700">A known impression beacon that can be tied to a slot/creative (not generic sync traffic)</p>
            </li>
          </ul>
          <p className="text-sm text-gray-600">
            So your report separates real delivery from noise, sync traffic, and spoofable signals.
          </p>
        </div>
      </section>

      {/* How it Works */}
      <section className="bg-white py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-4xl font-light text-gray-900 text-center mb-16">
            Three steps to proof
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-12">
            <div className="text-center">
              <div className="w-16 h-16 bg-[#2563EB] rounded-full flex items-center justify-center mx-auto mb-6">
                <span className="text-white text-2xl font-semibold">1</span>
              </div>
              <h3 className="text-2xl font-semibold text-gray-900 mb-3">Scan publisher URLs</h3>
              <p className="text-gray-600">Cybertect crawls pages and maps ad slots, tag IDs, and network requests.</p>
            </div>
            <div className="text-center">
              <div className="w-16 h-16 bg-[#2563EB] rounded-full flex items-center justify-center mx-auto mb-6">
                <span className="text-white text-2xl font-semibold">2</span>
              </div>
              <h3 className="text-2xl font-semibold text-gray-900 mb-3">Verify delivery mechanics</h3>
              <p className="text-gray-600">We correlate slot geometry, render signals, and telemetry to classify what's real vs inflated.</p>
            </div>
            <div className="text-center">
              <div className="w-16 h-16 bg-[#2563EB] rounded-full flex items-center justify-center mx-auto mb-6">
                <span className="text-white text-2xl font-semibold">3</span>
              </div>
              <h3 className="text-2xl font-semibold text-gray-900 mb-3">Export evidence</h3>
              <p className="text-gray-600">Download a report built for action: fraud flags, screenshots, timestamps, and remediation guidance.</p>
            </div>
          </div>
          <div className="text-center mt-12">
            <a 
              href="/scanner"
              className="bg-[#2563EB] text-white px-8 py-3 rounded-full text-base font-medium hover:bg-[#1d4ed8] transition-colors shadow-sm inline-block"
            >
              Run a scan now
            </a>
          </div>
        </div>
      </section>

      {/* Forensics Engine Section */}
      <section className="bg-[#F8F9FA] py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-4xl font-light text-gray-900 mb-6 text-center">
            The forensics engine that updates live as you scan
          </h2>
          <p className="text-lg text-gray-600 mb-12 text-center max-w-3xl mx-auto">
            Every crawl maps iframe dimensions, DOM placement, computed visibility, and network telemetry to identify inflation patterns with audit-ready artifacts.
          </p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-8">
            <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm text-center">
              <div className="text-4xl font-bold text-[#2563EB] mb-2">{globalHistory.length}</div>
              <div className="text-sm font-medium text-gray-600">Scans Logged</div>
            </div>
            <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm text-center">
              <div className="text-4xl font-bold text-red-600 mb-2">
                {globalHistory.reduce((acc, r) => acc + (r.fraudWarnings?.filter(f => f.type?.includes('Stacking') || f.type?.includes('stack')).length || 0), 0)}
              </div>
              <div className="text-sm font-medium text-gray-600">Stacking Alerts</div>
            </div>
            <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm text-center">
              <div className="text-4xl font-bold text-orange-600 mb-2">
                {globalHistory.reduce((acc, r) => acc + (r.fraudWarnings?.filter(f => f.type?.includes('Pixel') || f.type?.includes('pixel')).length || 0), 0)}
              </div>
              <div className="text-sm font-medium text-gray-600">Pixel Stuffers</div>
            </div>
            <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm text-center">
              <div className="text-4xl font-bold text-purple-600 mb-2">
                {globalHistory.reduce((acc, r) => acc + (r.fraudWarnings?.filter(f => f.type?.includes('Analytics') || f.type?.includes('Inflation')).length || 0), 0)}
              </div>
              <div className="text-sm font-medium text-gray-600">Analytics Inflation Alerts</div>
            </div>
          </div>
          <p className="text-sm text-gray-500 text-center">
            These totals update as Cybertect observes new evidence across scans.
          </p>
        </div>
      </section>

      {/* Final CTA */}
      <section className="bg-white py-20">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-4xl font-light text-gray-900 mb-6">
            If you can't prove the impression, you shouldn't pay for it.
          </h2>
          <p className="text-lg text-gray-600 mb-8">
            Run a scan and get a proof-grade report you can use to pause waste, dispute inflated delivery, and push remediation.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <a 
              href="/scanner"
              className="bg-[#2563EB] text-white px-8 py-3 rounded-full text-base font-medium hover:bg-[#1d4ed8] transition-colors shadow-sm"
            >
              Run Forensic Scan
            </a>
            <button
              onClick={async () => {
                try {
                  // Check if file exists using fetch before attempting download
                  const response = await fetch('/sample-report.pdf', { method: 'HEAD' });
                  
                  if (response.ok) {
                    // File exists - proceed with download
                    const link = document.createElement('a');
                    link.href = '/sample-report.pdf';
                    link.download = 'cybertect-sample-report.pdf';
                    document.body.appendChild(link);
                    link.click();
                    link.remove();
                  } else {
                    // File doesn't exist - show alert
                    alert('Sample report coming soon');
                  }
                } catch (error) {
                  // Network error or file doesn't exist - show alert
                  alert('Sample report coming soon');
                }
              }}
              className="bg-white text-gray-700 px-8 py-3 rounded-full text-base font-medium border-2 border-gray-300 hover:border-gray-400 transition-colors"
            >
              Download Sample Report
            </button>
          </div>
        </div>
      </section>

      {/* FAQ Section */}
      <section className="bg-[#F8F9FA] py-20">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-4xl font-light text-gray-900 mb-12 text-center">
            Frequently Asked Questions
          </h2>
          <div className="space-y-8">
            <div>
              <h3 className="text-xl font-semibold text-gray-900 mb-3">
                How is this different from IAS/DV/MOAT?
              </h3>
              <p className="text-gray-600 leading-relaxed">
                They focus on traffic and viewability signals at the network/user level. Cybertect audits the page implementation—slot geometry, hidden frames, stacked placements, and telemetry duplication—where inflation often originates.
              </p>
            </div>
            <div>
              <h3 className="text-xl font-semibold text-gray-900 mb-3">
                Will this create false positives from sync pixels?
              </h3>
              <p className="text-gray-600 leading-relaxed">
                Cybertect identifies and excludes common ID-sync patterns so generic sync traffic doesn't get counted as impressions.
              </p>
            </div>
            <div>
              <h3 className="text-xl font-semibold text-gray-900 mb-3">
                What do I get to share with publishers or partners?
              </h3>
              <p className="text-gray-600 leading-relaxed">
                A report with timestamps, offender URLs, render/telemetry correlation, and evidence artifacts designed for disputes and remediation.
              </p>
            </div>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
};

export default LandingPage;
