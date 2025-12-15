// --- NEW REVERSE LOOKUP ENDPOINT ---

// 1. Endpoint that takes an Analytics ID and finds connected domains
app.post('/api/network-scan', async (req, res) => {
  const { analyticsId } = req.body;

  if (!analyticsId) {
    return res.status(400).json({ error: 'No Analytics ID provided' });
  }

  console.log(`🔎 Scanning network for ID: ${analyticsId}`);

  try {
    // We use HackerTarget's API to find sites sharing this ID
    // (Note: This is a free endpoint and may have rate limits)
    const response = await axios.get(`https://api.hackertarget.com/analyticslookup/?q=${analyticsId}`);
    
    const rawData = response.data;
    
    // Check if the API request failed or hit a limit
    if (typeof rawData !== 'string' || rawData.includes('API count exceeded')) {
       console.warn('⚠️ API Limit hit or invalid response');
       // Return empty network to prevent crashing
       return res.json({ network: [], count: 0 });
    }

    // Convert the text response into a clean list of websites
    const sites = rawData.split('\n').filter(site => site && site.trim().length > 0);

    res.json({ 
      network: sites, 
      count: sites.length 
    });

  } catch (error) {
    console.error('Network scan failed:', error.message);
    res.json({ network: [], count: 0 });
  }
});