// Ad Impression Inflation Scanner
// Usage: node ga-inflation-scanner.js https://example.com

const { chromium } = require('playwright');

async function runScan(targetUrl) {
  const result = {
    url: targetUrl,
    observed_seconds: 12,
    verdict: 'PASS',
    risk_score: 0,
    signals: [],
    metrics: {},
    evidence: {
      sample_events: [],
      ad_impression_query_ids: [],
      measurement_ids: []
    }
  };

  if (!targetUrl) {
    return {
      ...result,
      error: { message: 'URL is required', stage: 'nav' }
    };
  }

  const trackedEvents = [];
  const observedQueryIds = new Set();
  const measurementIds = new Set();

  let browser;
  const observationWindowMs = 12_000;
  const startTime = Date.now();

  const GA_ENDPOINTS = [
    'https://www.google-analytics.com/g/collect',
    'https://www.google-analytics.com/collect'
  ];

  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      locale: 'en-US',
      timezoneId: 'UTC',
      ignoreHTTPSErrors: true
    });
    const page = await context.newPage();

    page.on('request', (request) => {
      const url = request.url();
      if (GA_ENDPOINTS.some(endpoint => url.startsWith(endpoint))) {
        const timestamp = Date.now();
        try {
          const event = normalizeGaRequest(url, timestamp);
          trackedEvents.push(event);
          if (event.tid) measurementIds.add(event.tid);
          if (event.ep && event.ep.query_id) observedQueryIds.add(event.ep.query_id);
        } catch (err) {
          // ignore malformed GA requests but keep scanning
        }
      }
    });

    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForTimeout(observationWindowMs);

    await context.close();
  } catch (err) {
    if (browser) await browser.close();
    return {
      ...result,
      error: { message: err.message || 'Navigation failed', stage: 'observe' }
    };
  }

  if (browser) {
    await browser.close();
  }

  try {
    const metrics = computeMetrics(trackedEvents, startTime, observationWindowMs);
    const scoring = scoreSignals(metrics);

    result.metrics = metrics;
    result.signals = scoring.signals;
    result.risk_score = scoring.score;
    result.verdict = scoring.verdict;
    result.evidence.sample_events = trackedEvents.slice(0, 10);
    result.evidence.ad_impression_query_ids = Array.from(observedQueryIds).slice(0, 20);
    result.evidence.measurement_ids = Array.from(measurementIds);

    return result;
  } catch (err) {
    return {
      ...result,
      error: { message: err.message || 'Scoring failed', stage: 'score' }
    };
  }
}

function normalizeGaRequest(requestUrl, timestamp) {
  const parsed = new URL(requestUrl);
  const params = parsed.searchParams;

  const event = {
    timestamp,
    tid: params.get('tid') || null,
    en: params.get('en') || null,
    dl: params.get('dl') || null,
    dr: params.get('dr') || null,
    dt: params.get('dt') || null,
    sid: params.get('sid') || null,
    sct: params.get('sct') || null,
    seg: params.get('seg') || null,
    _p: params.get('_p') || null,
    ep: {}
  };

  for (const [key, value] of params.entries()) {
    if (key.startsWith('ep.')) {
      event.ep[key.slice(3)] = value;
    }
  }

  return event;
}

function computeMetrics(events, startTime, windowMs) {
  const adImpressionEvents = events.filter(evt => evt.en === 'ad_impression');
  const totalEvents = events.length;
  const totalAdImpression = adImpressionEvents.length;
  const uniqueQueryIds = new Set(
    adImpressionEvents.map(evt => evt.ep.query_id).filter(Boolean)
  );
  const uniqueTids = new Set(events.map(evt => evt.tid).filter(Boolean));
  const firstImpression = adImpressionEvents.length
    ? adImpressionEvents[0].timestamp - startTime
    : null;
  const viewabilityKeys = ['view', 'inview', 'visible', 'viewable'];
  const hasViewability = events.some(evt =>
    Object.keys(evt.ep).some(k =>
      viewabilityKeys.some(term => k.toLowerCase().includes(term)))
  );
  const selfReferrer = events.some(evt => evt.dl && evt.dr && evt.dl === evt.dr);

  return {
    total_events: totalEvents,
    total_ad_impression: totalAdImpression,
    unique_query_id_count: uniqueQueryIds.size,
    unique_tid_count: uniqueTids.size,
    ad_impression_per_second: windowMs ? Number((totalAdImpression / (windowMs / 1000)).toFixed(3)) : 0,
    first_ad_impression_ms: firstImpression,
    has_viewability_params: hasViewability,
    self_referrer: selfReferrer,
    observed_seconds: windowMs / 1000
  };
}

function scoreSignals(metrics) {
  let score = 0;
  const signals = [];

  const addSignal = (id, severity, detail, points) => {
    score += points;
    signals.push({ id, severity, detail });
  };

  if (metrics.total_ad_impression >= 5) {
    addSignal('rapid_impressions', 'high', '5+ ad_impression events within 12s', 30);
  }

  if (metrics.unique_query_id_count >= 3) {
    addSignal('query_id_churn', 'med', 'Multiple unique query_id values detected', 20);
  }

  if (
    metrics.total_ad_impression > 0 &&
    metrics.unique_query_id_count / metrics.total_ad_impression >= 0.8
  ) {
    addSignal('query_id_ratio', 'med', 'High ratio of unique query IDs per impression', 15);
  }

  if (!metrics.has_viewability_params) {
    addSignal('no_viewability', 'med', 'No viewability parameters present', 15);
  }

  if (metrics.unique_tid_count > 1) {
    addSignal('multi_tids', 'low', 'Multiple measurement IDs used simultaneously', 10);
  }

  if (metrics.self_referrer) {
    addSignal('self_referrer', 'low', 'Self-referring GA hits detected', 5);
  }

  const cappedScore = Math.min(score, 100);
  let verdict = 'PASS';
  if (cappedScore >= 60) verdict = 'HIGH_RISK';
  else if (cappedScore >= 30) verdict = 'SUSPICIOUS';

  return { score: cappedScore, verdict, signals };
}

if (require.main === module) {
  const url = process.argv[2];
  runScan(url)
    .then(output => {
      console.log(JSON.stringify(output, null, 2));
    })
    .catch(err => {
      console.error(JSON.stringify({
        url,
        error: { message: err.message || 'Unexpected failure', stage: 'unknown' }
      }, null, 2));
      process.exit(1);
    });
}

module.exports = { runScan };
