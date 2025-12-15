import React, { useState } from 'react';
import { ShieldCheck, AlertTriangle, Banknote, Search, RefreshCw, AlertOctagon, CheckCircle2 } from 'lucide-react';

const Dashboard = () => {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  // 💰 Budget State
  const [adSpend, setAdSpend] = useState(1000);
  // Per-row ad spend state (keyed by index)
  const [rowAdSpend, setRowAdSpend] = useState({}); 

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
      // ✅ FIX: UPDATED TO PORT 3001 TO MATCH YOUR TERMINAL
      const response = await fetch('http://localhost:3001/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url })
      });
      const result = await response.json();
      
      if (result.success && result.data) {
        // Map API result to new card format
        const isHighRisk = result.data.riskLevel === 'High';
        const isClean = result.data.analysis === '✅ Clean';

        const newResult = {
          domain: result.data.domain,
          status: isHighRisk ? 'Fraud Detection' : (isClean ? 'Verified Human Traffic' : 'Cautious Items'),
          riskLevel: result.data.riskLevel,
          details: `Analysis: ${result.data.analysis}. IDs found: ${result.data.tags.length}`,
          action: isHighRisk ? 'Block & Report' : (isClean ? 'Monitor' : 'Review'),
          waste: isHighRisk ? '5x' : '1x',
          colorTheme: isHighRisk ? 'red' : (isClean ? 'green' : 'yellow')
        };

        setData(prev => [newResult, ...prev]);
      } else {
        alert(result.error || "Scan failed to return data");
      }

    } catch (error) {
      console.error("Scan failed:", error);
      alert("Backend not reachable! Make sure 'node server/index.js' is running on Port 3001.");
    }
    setLoading(false);
  };

  // Network check function
  const checkNetwork = async (gaId) => {
    try {
      const response = await fetch('/api/network-scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ analyticsId: gaId })
      });
      const data = await response.json();
      console.log("Network found:", data.network);
      return data; // Returns { network: ['site1.com', 'site2.com'], count: 2 }
    } catch (err) {
      console.error("Failed to check network", err);
    }
  };

  // 💰 Loss Calculator Helper
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

  return (
    <div className="min-h-screen bg-white font-sans">
      
      {/* HEADER */}
      <header className="flex justify-between items-center py-5 px-6 max-w-7xl mx-auto">
        {/* LOGO: Ensure you have logo.png in your 'public' folder */}
        <div className="flex items-center gap-2">
           <div className="cybertect-logo">
             <span className="cyber-text">cyber</span>
             <span className="tect-text">tect</span>
             <span className="com-text">.com</span>
           </div>
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

          {/* Budget Input */}
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

                  {/* 💰 Projected Loss Section (Interactive Drain Calculator) */}
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
                </div>
              </div>
            );
          })}
        </div>
      </main>
    </div>
  );
};

export default Dashboard;
