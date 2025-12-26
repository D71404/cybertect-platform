import { useState } from 'react';
import { Shield, Zap, Sparkles, Radar, Download, Loader2, RefreshCw } from 'lucide-react';

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
                href="#scanner"
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
            <h2 className="text-4xl lg:text-5xl font-light text-gray-900 mb-8 leading-tight">
              Cybertect detects inaccurate measurement and invalid traffic across your sites and campaigns—so you can block waste, fix tagging issues, and spend with confidence.
            </h2>
            <div className="flex flex-col sm:flex-row gap-4 mb-6">
              <a 
                href="#demo"
                className="bg-[#2563EB] text-white px-8 py-3 rounded-full text-base font-medium hover:bg-[#1d4ed8] transition-colors shadow-sm text-center"
              >
                Get a Demo
              </a>
              <a 
                href="#scanner"
                className="bg-white text-gray-700 px-8 py-3 rounded-full text-base font-medium border-2 border-gray-300 hover:border-gray-400 transition-colors text-center"
              >
                Run a Quick Audit
              </a>
            </div>
            <p className="text-sm text-gray-500">
              Works with GA4, GTM, Google Ads, Meta, DV360, The Trade Desk, CM360, and more.
            </p>
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

      {/* Scanner Section */}
      <section id="scanner" className="bg-white py-20 scroll-mt-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="mb-8 text-center">
            <h2 className="text-4xl font-light text-gray-900 mb-4">
              We Measure Bad Data
            </h2>
            <p className="text-lg text-gray-600">
              Most fraud tools chase bots. Qualytics follows the numbers—and exposes where your spend actually disappears.
            </p>
          </div>

          <div className="bg-white border border-gray-200 rounded-3xl p-8 shadow-sm mb-8">
            <label className="block text-sm font-medium text-gray-900 mb-3">
              Enter Target URLs (One per line)
            </label>
            <textarea
              value={urls}
              onChange={(e) => setUrls(e.target.value)}
              placeholder="https://example.com"
              className="w-full h-32 p-4 border border-gray-300 rounded-xl font-mono text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB] focus:border-transparent"
            />
            
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
                    Start Forensic Scan
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
                        return [host, risk, `"${fraud}"`, `"${ids}"`, r.pageViewCount || 0, waste];
                      });
                      const csv = "data:text/csv;charset=utf-8," + [headers, ...rows].map(e => e.join(",")).join("\n");
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

          {/* Results Table */}
          {globalHistory.length > 0 && (
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
          )}
        </div>
      </section>

      {/* Social Proof */}
      <section className="bg-[#F8F9FA] py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <p className="text-center text-gray-500 text-sm mb-8">
            Trusted by modern data teams at
          </p>
          <div className="flex justify-center items-center gap-12 flex-wrap">
            {/* Placeholder for company logos */}
            <div className="h-8 w-24 bg-gray-300 rounded opacity-50"></div>
            <div className="h-8 w-24 bg-gray-300 rounded opacity-50"></div>
            <div className="h-8 w-24 bg-gray-300 rounded opacity-50"></div>
            <div className="h-8 w-24 bg-gray-300 rounded opacity-50"></div>
          </div>
        </div>
      </section>

      {/* Value Props */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {/* Card 1 */}
          <div className="bg-white p-8 rounded-3xl border border-gray-200 shadow-sm hover:shadow-md transition-shadow">
            <div className="w-12 h-12 bg-red-100 rounded-2xl flex items-center justify-center mb-6">
              <Shield className="w-6 h-6 text-red-600" />
            </div>
            <h3 className="text-2xl font-semibold text-gray-900 mb-3">
              Don't break production.
            </h3>
            <p className="text-gray-600 leading-relaxed">
              We catch bad data before it hits your dashboard.
            </p>
          </div>

          {/* Card 2 */}
          <div className="bg-white p-8 rounded-3xl border border-gray-200 shadow-sm hover:shadow-md transition-shadow">
            <div className="w-12 h-12 bg-blue-100 rounded-2xl flex items-center justify-center mb-6">
              <Zap className="w-6 h-6 text-[#2563EB]" />
            </div>
            <h3 className="text-2xl font-semibold text-gray-900 mb-3">
              Insights in real-time.
            </h3>
            <p className="text-gray-600 leading-relaxed">
              Why wait for the weekly report? See your data health as it happens.
            </p>
          </div>

          {/* Card 3 */}
          <div className="bg-white p-8 rounded-3xl border border-gray-200 shadow-sm hover:shadow-md transition-shadow">
            <div className="w-12 h-12 bg-green-100 rounded-2xl flex items-center justify-center mb-6">
              <Sparkles className="w-6 h-6 text-green-600" />
            </div>
            <h3 className="text-2xl font-semibold text-gray-900 mb-3">
              Automated Cleaning.
            </h3>
            <p className="text-gray-600 leading-relaxed">
              Our engine automatically standardizes formats and removes duplicates.
            </p>
          </div>
        </div>
      </section>

      {/* How it Works */}
      <section className="bg-[#F8F9FA] py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-4xl font-light text-gray-900 text-center mb-16">
            How it Works
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-12">
            <div className="text-center">
              <div className="w-16 h-16 bg-[#2563EB] rounded-full flex items-center justify-center mx-auto mb-6">
                <span className="text-white text-2xl font-semibold">1</span>
              </div>
              <h3 className="text-2xl font-semibold text-gray-900 mb-3">Connect</h3>
              <p className="text-gray-600">Link existing databases.</p>
            </div>
            <div className="text-center">
              <div className="w-16 h-16 bg-[#2563EB] rounded-full flex items-center justify-center mx-auto mb-6">
                <span className="text-white text-2xl font-semibold">2</span>
              </div>
              <h3 className="text-2xl font-semibold text-gray-900 mb-3">Clean</h3>
              <p className="text-gray-600">Standardize formats.</p>
            </div>
            <div className="text-center">
              <div className="w-16 h-16 bg-[#2563EB] rounded-full flex items-center justify-center mx-auto mb-6">
                <span className="text-white text-2xl font-semibold">3</span>
              </div>
              <h3 className="text-2xl font-semibold text-gray-900 mb-3">Create</h3>
              <p className="text-gray-600">Build beautiful reports.</p>
            </div>
          </div>
        </div>
      </section>

      {/* Footer CTA */}
      <footer className="bg-white py-20">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-4xl font-light text-gray-900 mb-6">
            Ready to trust your data?
          </h2>
          <a 
            href="#scanner"
            className="bg-[#2563EB] text-white px-8 py-3 rounded-full text-base font-medium hover:bg-[#1d4ed8] transition-colors shadow-sm inline-block"
          >
            Get Started
          </a>
        </div>
      </footer>
    </div>
  );
};

export default LandingPage;
