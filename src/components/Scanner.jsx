import React, { useState } from 'react';
import { ShieldCheck, AlertTriangle, Banknote, Search, RefreshCw, AlertOctagon, CheckCircle2, Sparkles } from 'lucide-react';
import Footer from './Footer';

const Scanner = () => {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  // 💰 Budget State (Calculator functionality)
  const [adSpend, setAdSpend] = useState(1000);
  // Per-row ad spend state (keyed by index)
  const [rowAdSpend, setRowAdSpend] = useState({}); 
  // AI Validation state
  const [aiValidating, setAiValidating] = useState({});
  const [aiResults, setAiResults] = useState({}); 

  // Mock Data matching the new card style
  const [data, setData] = useState([
    {
      domain: 'www.infobae.com',
      status: 'Fraud Detection',
      riskLevel: 'High',
      details: 'Ad Network: SuspiciousNet, Status: High Risk, Confirmed Fraudulent Traffic (40%)',
      action: 'Block & Report',
      waste: '6x',
      colorTheme: 'red'
    },
    {
      domain: 'www.diariolasamericas.com',
      status: 'Cautious Items',
      riskLevel: 'Medium',
      details: 'Campaign ID: 12345, Status: Warning, Potential Bot Activity (15%)',
      action: 'Review',
      waste: '5x',
      colorTheme: 'yellow'
    },
     {
      domain: 'example.com',
      status: 'Verified Human Traffic',
      riskLevel: 'Low',
      details: 'Sample Domain: example.com, Status: Safe, 98% Verified Human',
      action: 'Monitor',
      waste: '1x',
      colorTheme: 'green'
    }
  ]);

  const handleScan = async () => {
    if (!url) return;
    setLoading(true);
    try {
      // ✅ FIX: Points to Port 3000 (Matches your terminal)
      const response = await fetch('http://localhost:3000/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls: [url] })
      });
      const result = await response.json();
      
      if (result.results && Array.isArray(result.results) && result.results.length > 0) {
        // Process each result from the array
        result.results.forEach(scanResult => {
          if (scanResult.error) {
            alert(`Scan failed for ${scanResult.url}: ${scanResult.error}`);
            return;
          }

          // Extract domain from URL
          let domain = scanResult.url || '';
          try {
            domain = new URL(scanResult.url).hostname;
          } catch (e) {
            // Keep original URL if parsing fails
          }

          // Extract Tag Parity Detection results
          const tagParity = scanResult.tagParity || {};
          const ga4Ids = tagParity.ga4_ids || scanResult.tagInventory?.analyticsIds?.filter(id => id.startsWith('G-')) || [];
          const gtmIds = tagParity.gtm_containers || scanResult.tagInventory?.gtmContainers || [];
          const awIds = tagParity.gads_aw_ids || scanResult.tagInventory?.googleAdsIds || [];
          const fbIds = tagParity.fb_pixel_ids || scanResult.tagInventory?.facebookPixels || [];
          const flags = tagParity.flags || [];

          // Determine risk level from verdict and riskScore
          // Check for page_view duplication issues before marking as Clean
          const hitsById = scanResult.hitsById || {};
          const hasDuplicatePageViews = Object.values(hitsById).some(hitData => {
            const pageViewCount = (hitData.events?.['page_view'] || 0) + (hitData.events?.['pageview'] || 0);
            return pageViewCount > 1;
          });
          
          // Check flags for risk indicators
          const hasMultipleFlags = flags.some(f => f.startsWith('MULTIPLE_'));
          const hasTagsButNoBeacons = flags.includes('TAGS_PRESENT_NO_BEACONS');
          
          const isHighRisk = scanResult.verdict === 'HIGH_RISK' || (scanResult.riskScore && scanResult.riskScore >= 60);
          const isMediumRisk = scanResult.verdict === 'SUSPICIOUS' || 
                               (scanResult.riskScore && scanResult.riskScore >= 30) ||
                               hasMultipleFlags; // Multiple tags = at least Medium risk
          const isClean = scanResult.verdict === 'PASS' && 
                         (!scanResult.riskScore || scanResult.riskScore < 30) && 
                         !hasDuplicatePageViews &&
                         !hasMultipleFlags && // No multiple tags
                         (ga4Ids.length === 0 && gtmIds.length === 0 && awIds.length === 0 && fbIds.length === 0); // No IDs detected
          
          // Get fraud warnings count
          const fraudCount = scanResult.fraudWarnings ? scanResult.fraudWarnings.length : 0;
          const hasFraud = fraudCount > 0 || isHighRisk;

          // Calculate waste factor based on metrics
          const networkEvents = scanResult.metrics?.adRequestCount || scanResult.networkEventsCount || 0;
          const wasteFactor = networkEvents > 50 ? '6x' : networkEvents > 30 ? '5x' : networkEvents > 10 ? '3x' : '1x';

          // Format tag counts for display (compact badge format)
          const tagCountsDisplay = `GA4: ${ga4Ids.length} | GTM: ${gtmIds.length} | FB: ${fbIds.length} | AW: ${awIds.length}`;
          
          // Format IDs for display with Hits Sent data (Tag Assistant-style)
          const hitsDisplay = Object.keys(hitsById).map(tid => {
            const hitData = hitsById[tid];
            const eventCounts = Object.entries(hitData.events || {})
              .map(([eventName, count]) => `${eventName}: ${count}`)
              .join(', ');
            return `${tid} (${hitData.total} hits${eventCounts ? `: ${eventCounts}` : ''})`;
          }).join('; ');
          
          // Build details string
          let detailsText = '';
          if (fraudCount > 0) {
            detailsText = `Found ${fraudCount} fraud warning(s). Risk Score: ${scanResult.riskScore || 0}`;
          } else {
            detailsText = `Analysis complete. Risk Score: ${scanResult.riskScore || 0}`;
          }
          
          // Add tag counts (replace "No IDs" with actual counts)
          if (ga4Ids.length > 0 || gtmIds.length > 0 || awIds.length > 0 || fbIds.length > 0) {
            detailsText += `. ${tagCountsDisplay}`;
          } else {
            detailsText += `. No IDs detected`;
          }
          
          // Add flags if present
          if (flags.length > 0) {
            detailsText += `. Flags: ${flags.join(', ')}`;
          }
          
          // Add Hits Sent information
          if (hitsDisplay) {
            detailsText += `. Hits Sent: ${hitsDisplay}`;
          }
          
          // Store data for display in card
          scanResult._hitsById = hitsById;
          scanResult._hitsDisplay = hitsDisplay;
          scanResult._tagParity = tagParity;
          scanResult._tagCountsDisplay = tagCountsDisplay;
          scanResult._flags = flags;

          const newResult = {
            domain: domain,
            status: hasFraud ? 'Fraud Detection' : (isClean ? 'Verified Human Traffic' : 'Cautious Items'),
            riskLevel: isHighRisk ? 'High' : (isMediumRisk ? 'Medium' : 'Low'),
            details: detailsText,
            action: hasFraud ? 'Block & Report' : (isClean ? 'Monitor' : 'Review'),
            waste: wasteFactor,
            colorTheme: hasFraud ? 'red' : (isClean ? 'green' : 'yellow'),
            _hitsById: hitsById,
            _hitsDisplay: hitsDisplay,
            _tagParity: tagParity,
            _tagCountsDisplay: tagCountsDisplay,
            _flags: flags,
            _ga4Ids: ga4Ids,
            _gtmIds: gtmIds,
            _awIds: awIds,
            _fbIds: fbIds
          };

          setData(prev => [newResult, ...prev]);
        });
      } else if (result.error) {
        alert(result.error || "Scan failed to return data");
      } else {
        alert("No results returned from scan");
      }

    } catch (error) {
      console.error("Scan failed:", error);
      alert("Backend not reachable! Make sure 'node server/index.js' is running on Port 3000.");
    }
    setLoading(false);
  };

  // 💰 Loss Calculator Logic
  const calculateLoss = (wasteFactor) => {
    if (!wasteFactor || wasteFactor === '1x' || wasteFactor === 'Clean') return '$0.00';
    if (!adSpend || adSpend <= 0) return '$0.00';
    const factor = parseInt(wasteFactor.toString().replace('x', '')) || 1;
    if (factor <= 1) return '$0.00';
    const realValue = adSpend / factor;
    const loss = adSpend - realValue;
    return `-$${loss.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  // Helper to get icons based on theme
  const getThemeIcon = (theme) => {
    switch(theme) {
      case 'red': return <AlertOctagon className="text-red-600" size={20} />;
      case 'yellow': return <AlertTriangle className="text-yellow-600" size={20} />;
      case 'green': return <CheckCircle2 className="text-green-600" size={20} />;
      default: return <ShieldCheck size={20} />;
    }
  };

  const handleAIValidation = async (row, index) => {
    setAiValidating(prev => ({ ...prev, [index]: true }));
    try {
      // Create evidence pack from scan data
      const evidencePack = {
        site: row.domain,
        timestamp: new Date().toISOString(),
        scan_window: '30s',
        total_events: row._hitsById ? Object.values(row._hitsById).reduce((sum, h) => sum + h.total, 0) : 0,
        endpoints: [],
        ga4_ids: row._ga4Ids || [],
        gtm_containers: row._gtmIds || [],
        gads_aw_ids: row._awIds || [],
        fb_pixel_ids: row._fbIds || [],
        flags: row._flags || [],
        hitsById: row._hitsById || {},
        verdict: row.status,
        riskLevel: row.riskLevel,
        details: row.details
      };

      // Send to AI validation API (all 3 providers in parallel)
      const providers = ['openai', 'gemini', 'perplexity'];
      const validationPromises = providers.map(async (provider) => {
        const response = await fetch('http://localhost:3000/api/ai-validation/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            caseBrief: evidencePack,
            provider: provider,
            template: 'ad-impression-inflation',
            redactionMode: false
          })
        });
        
        if (!response.ok) {
          throw new Error(`${provider} validation failed`);
        }
        
        const result = await response.json();
        return { provider, result };
      });

      const results = await Promise.allSettled(validationPromises);
      
      // Process results
      const aiValidationResults = {
        timestamp: new Date().toISOString(),
        providers: {}
      };

      results.forEach((result, idx) => {
        const provider = providers[idx];
        if (result.status === 'fulfilled') {
          aiValidationResults.providers[provider] = result.value.result;
        } else {
          aiValidationResults.providers[provider] = { error: result.reason?.message || 'Validation failed' };
        }
      });

      setAiResults(prev => ({ ...prev, [index]: aiValidationResults }));
      
    } catch (error) {
      console.error('AI Validation error:', error);
      alert('AI Validation failed: ' + error.message);
    } finally {
      setAiValidating(prev => ({ ...prev, [index]: false }));
    }
  };

  return (
    <div className="min-h-screen bg-white font-sans">
      
      {/* HEADER */}
      <header className="flex justify-between items-center py-5 px-6 max-w-7xl mx-auto">
        <div className="flex items-center gap-2">
           {/* Replace this with <img src="/logo.png" ... /> if you have the file */}
           <span className="font-bold text-2xl text-slate-800">Qualytics</span>
        </div>
        <button className="text-slate-600 font-medium hover:text-slate-900 transition">Sign in</button>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        
        {/* HERO SECTION */}
        <div className="text-center max-w-3xl mx-auto mb-16">
          <h1 className="text-5xl font-extrabold text-slate-900 leading-tight mb-6">
            We Measure Bad Data
          </h1>
          <p className="text-xl text-slate-500">
            Most fraud tools chase bots. Qualytics follows the numbers—and exposes where your spend actually disappears.
          </p>
        </div>

        {/* SEARCH & BUDGET INPUTS */}
        <div className="bg-white rounded-full shadow-lg border border-slate-200 p-2 mb-16 flex flex-col md:flex-row gap-2 max-w-4xl mx-auto relative z-10">
          
          {/* URL Input */}
          <div className="flex-grow relative">
            <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
              <Search className="text-slate-400" size={20} />
            </div>
            <input 
              type="text" 
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="Search domain or URL for truth in data..."
              className="w-full p-4 pl-12 bg-transparent outline-none text-slate-700 placeholder:text-slate-400 text-lg"
            />
          </div>

          {/* 💰 Budget Input (Restored!) */}
           <div className="relative md:w-48 md:border-l md:border-slate-200">
            <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
               <Banknote className="text-green-600" size={20}/>
            </div>
            <input 
              type="number" 
              value={adSpend}
              onChange={(e) => setAdSpend(Number(e.target.value))}
              min="0" step="100"
              className="w-full p-4 pl-12 bg-transparent outline-none text-slate-700 font-semibold text-lg placeholder:text-slate-400"
              placeholder="Ad Spend"
            />
           </div>

          {/* Analyze Button */}
          <button 
            onClick={handleScan}
            disabled={loading}
            className="bg-gradient-to-r from-blue-500 to-purple-600 text-white px-8 py-4 rounded-full font-bold text-lg hover:opacity-90 transition shadow-md flex items-center justify-center gap-2 min-w-[160px]"
          >
            {loading ? <RefreshCw className="animate-spin" size={22}/> : null}
            {loading ? "Analyzing..." : "Analyze"}
          </button>
        </div>

        {/* RESULTS - NEW CARD LAYOUT */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {data.map((row, index) => {
            const theme = row.colorTheme;
            let bgClass = theme === 'red' ? 'bg-red-50' : (theme === 'yellow' ? 'bg-yellow-50' : 'bg-green-50');
            let borderClass = theme === 'red' ? 'border-red-100' : (theme === 'yellow' ? 'border-yellow-100' : 'border-green-100');
            let textClass = theme === 'red' ? 'text-red-800' : (theme === 'yellow' ? 'text-yellow-800' : 'text-green-800');
            let headerBg = theme === 'red' ? 'bg-red-100' : (theme === 'yellow' ? 'bg-yellow-100' : 'bg-green-100');

            return (
              <div key={index} className={`rounded-2xl border-2 ${borderClass} ${bgClass} overflow-hidden shadow-sm hover:shadow-md transition`}>
                
                {/* Card Header */}
                <div className={`px-6 py-4 ${headerBg} flex items-center gap-3 border-b ${borderClass}`}>
                  {getThemeIcon(theme)}
                  <h3 className={`font-bold text-lg ${textClass}`}>{row.status}</h3>
                </div>

                {/* Card Body */}
                <div className="p-6 space-y-4">
                  <div>
                    <p className="text-sm text-slate-500 font-medium mb-1">Domain</p>
                    <p className="text-slate-900 font-semibold text-lg truncate">{row.domain}</p>
                  </div>
                  
                  <div>
                     <p className="text-sm text-slate-500 font-medium mb-1">Analysis Details</p>
                     <p className="text-slate-700 text-sm leading-relaxed">{row.details}</p>
                  </div>

                  {/* Tag Counts Badge */}
                  {(row._ga4Ids?.length > 0 || row._gtmIds?.length > 0 || row._awIds?.length > 0 || row._fbIds?.length > 0) ? (
                    <div className="bg-white bg-opacity-60 p-3 rounded-xl border border-slate-100">
                      <p className="text-sm text-slate-500 font-medium mb-2">Detected Tags</p>
                      <div className="flex flex-wrap gap-2">
                        {row._ga4Ids?.length > 0 && (
                          <span className="px-2.5 py-1 bg-blue-100 text-blue-800 rounded-md text-xs font-semibold">
                            GA4: {row._ga4Ids.length}
                          </span>
                        )}
                        {row._gtmIds?.length > 0 && (
                          <span className="px-2.5 py-1 bg-purple-100 text-purple-800 rounded-md text-xs font-semibold">
                            GTM: {row._gtmIds.length}
                          </span>
                        )}
                        {row._fbIds?.length > 0 && (
                          <span className="px-2.5 py-1 bg-indigo-100 text-indigo-800 rounded-md text-xs font-semibold">
                            FB: {row._fbIds.length}
                          </span>
                        )}
                        {row._awIds?.length > 0 && (
                          <span className="px-2.5 py-1 bg-green-100 text-green-800 rounded-md text-xs font-semibold">
                            AW: {row._awIds.length}
                          </span>
                        )}
                      </div>
                      {row._flags && row._flags.length > 0 && (
                        <div className="mt-2 pt-2 border-t border-slate-200">
                          <p className="text-xs text-slate-500 mb-1">Flags:</p>
                          <div className="flex flex-wrap gap-1">
                            {row._flags.map((flag, idx) => (
                              <span key={idx} className="px-2 py-0.5 bg-orange-100 text-orange-700 rounded text-xs">
                                {flag}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="bg-white bg-opacity-60 p-3 rounded-xl border border-slate-100">
                      <p className="text-sm text-slate-500 font-medium mb-1">Detected Tags</p>
                      <p className="text-xs text-slate-400">No IDs detected</p>
                    </div>
                  )}
                  
                  {/* Tag Assistant-style Hits Sent */}
                  {row._hitsById && Object.keys(row._hitsById).length > 0 && (
                    <div className="bg-white bg-opacity-60 p-3 rounded-xl border border-slate-100">
                      <p className="text-sm text-slate-500 font-medium mb-2">Hits Sent (Tag Assistant-style)</p>
                      <div className="space-y-2">
                        {Object.entries(row._hitsById).map(([tid, hitData]) => (
                          <div key={tid} className="text-xs">
                            <div className="font-semibold text-slate-900 mb-1">{tid}</div>
                            <div className="text-slate-600 ml-2">
                              Total: {hitData.total} hits
                              {Object.keys(hitData.events || {}).length > 0 && (
                                <div className="mt-1">
                                  {Object.entries(hitData.events).map(([eventName, count]) => (
                                    <span key={eventName} className="inline-block mr-2 px-1.5 py-0.5 bg-blue-50 text-blue-700 rounded">
                                      {eventName}: {count}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* 💰 Projected Loss Section (Interactive) */}
                  {theme !== 'green' && (() => {
                    // Parse multiplier from waste text (e.g., "6x" -> 6)
                    const multiplierMatch = row.waste.match(/(\d+)x?/);
                    const multiplier = multiplierMatch ? parseInt(multiplierMatch[1]) : 1;
                    
                    // Get per-row ad spend or use global default
                    const rowSpend = rowAdSpend[index] !== undefined ? rowAdSpend[index] : adSpend;
                    
                    // Calculate: Spend - (Spend / Multiplier)
                    const calculatedLoss = rowSpend - (rowSpend / multiplier);
                    
                    return (
                      <div className="bg-white bg-opacity-60 p-3 rounded-xl border border-slate-100">
                        <p className="text-sm text-slate-500 font-medium mb-1 flex items-center gap-1">
                          <Banknote size={14} className="text-slate-400"/> Projected Loss
                        </p>
                        <div className="flex items-end gap-2 mb-2">
                          <span className="text-xl font-bold text-slate-900">{calculateLoss(row.waste)}</span>
                          <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${headerBg} ${textClass}`}>
                            {row.waste} Waste
                          </span>
                        </div>
                        <div className="space-y-2">
                          <input
                            type="number"
                            value={rowSpend}
                            onChange={(e) => {
                              const value = Number(e.target.value) || 0;
                              setRowAdSpend(prev => ({ ...prev, [index]: value }));
                            }}
                            min="0"
                            step="100"
                            className="w-24 p-2 border border-slate-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                            placeholder="Ad Spend"
                          />
                          <div className="text-red-600 font-semibold text-sm">
                            ${calculatedLoss.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </div>
                        </div>
                      </div>
                    );
                  })()}

                  <div>
                    <p className="text-sm text-slate-500 font-medium mb-2">Recommended Action</p>
                    <span className={`inline-block px-4 py-1.5 rounded-full text-sm font-bold bg-white border-2 ${borderClass} ${textClass}`}>
                      {row.action}
                    </span>
                  </div>

                  {/* AI Validation Button */}
                  <div className="pt-4 border-t border-slate-200">
                    <button
                      onClick={() => handleAIValidation(row, index)}
                      disabled={aiValidating[index]}
                      className="w-full bg-gradient-to-r from-purple-600 to-blue-600 text-white px-4 py-3 rounded-xl font-semibold text-sm hover:opacity-90 transition shadow-md flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {aiValidating[index] ? (
                        <>
                          <RefreshCw className="animate-spin" size={18}/>
                          AI Validating...
                        </>
                      ) : (
                        <>
                          <Sparkles size={18}/>
                          Send to AI Validator
                        </>
                      )}
                    </button>

                    {/* AI Validation Results */}
                    {aiResults[index] && (
                      <div className="mt-4 space-y-3">
                        <p className="text-sm text-slate-500 font-medium flex items-center gap-2">
                          <Sparkles size={14} className="text-purple-600"/>
                          AI Validation Results
                        </p>
                        
                        {Object.entries(aiResults[index].providers).map(([provider, result]) => (
                          <div key={provider} className="bg-white bg-opacity-80 p-3 rounded-lg border border-slate-200">
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-xs font-bold uppercase text-slate-600">
                                {provider === 'openai' ? 'ChatGPT' : provider === 'gemini' ? 'Gemini' : 'Perplexity'}
                              </span>
                              {result.error ? (
                                <span className="text-xs text-red-600 bg-red-50 px-2 py-1 rounded">Error</span>
                              ) : result.verdict ? (
                                <span className={`text-xs font-bold px-2 py-1 rounded ${
                                  result.verdict.label === 'FAIL' ? 'bg-red-100 text-red-700' :
                                  result.verdict.label === 'WARN' ? 'bg-yellow-100 text-yellow-700' :
                                  'bg-green-100 text-green-700'
                                }`}>
                                  {result.verdict.label} ({result.verdict.confidence}%)
                                </span>
                              ) : null}
                            </div>
                            
                            {result.error ? (
                              <p className="text-xs text-red-600">{result.error}</p>
                            ) : result.verdict ? (
                              <>
                                <p className="text-xs text-slate-700 mb-2">{result.verdict.rationale}</p>
                                {result.findings && result.findings.length > 0 && (
                                  <div className="mt-2 pt-2 border-t border-slate-100">
                                    <p className="text-xs font-semibold text-slate-600 mb-1">Key Findings:</p>
                                    <ul className="text-xs text-slate-600 space-y-1">
                                      {result.findings.slice(0, 2).map((finding, idx) => (
                                        <li key={idx} className="flex items-start gap-1">
                                          <span className="text-purple-600">•</span>
                                          <span>{finding.title}</span>
                                        </li>
                                      ))}
                                    </ul>
                                  </div>
                                )}
                              </>
                            ) : (
                              <p className="text-xs text-slate-500">Processing...</p>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                </div>
              </div>
            );
          })}
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default Scanner;
