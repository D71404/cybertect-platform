import { normalizeYouTubeUrl } from './normalize';

export interface ScoringResult {
  score: number;
  reasons: string[];
}

export interface Metrics {
  impressions?: number;
  views?: number;
  viewRate?: number;
  avgWatchTime?: number;
  cost?: number;
  clicks?: number;
  conversions?: number;
}

/**
 * Suspicious tokens that indicate spam channels/videos
 */
const SUSPICIOUS_TOKENS = [
  'free', 'promo', 'airdrop', 'crypto', 'giveaway', 'earn', 'elon', 
  'mrbeast', 'tesla', 'trading', 'bitcoin', 'money', 'cash', 'win',
  'prize', 'lottery', 'click', 'subscribe', 'like', 'share'
];

/**
 * Scores a YouTube placement based on URL patterns and performance metrics
 */
export function scorePlacement(
  url: string,
  metrics: Metrics = {},
  allPlacements: string[] = []
): ScoringResult {
  const normalized = normalizeYouTubeUrl(url);
  let score = 0;
  const reasons: string[] = [];

  // URL/Pattern signals (work without metrics)
  
  // Check for suspicious tokens in URL
  const urlLower = normalized.canonicalUrl.toLowerCase();
  for (const token of SUSPICIOUS_TOKENS) {
    if (urlLower.includes(token)) {
      score += 25;
      reasons.push(`Suspicious keyword: "${token}"`);
      break; // Only count once
    }
  }

  // Check for extremely long/garbled IDs
  if (normalized.type === 'channel') {
    const channelPart = normalized.canonicalUrl.split('/').pop() || '';
    if (channelPart.length > 40 && !channelPart.startsWith('UC')) {
      score += 20;
      reasons.push('Unusually long channel identifier');
    }
  } else if (normalized.type === 'video') {
    const videoId = normalized.canonicalUrl.split('v=')[1]?.split('&')[0] || '';
    if (videoId.length > 15) {
      score += 20;
      reasons.push('Unusually long video ID');
    }
  }

  // Check for near-duplicate placements (suggesting laundering)
  if (allPlacements.length > 0) {
    const similarCount = allPlacements.filter(p => {
      const otherNorm = normalizeYouTubeUrl(p);
      if (otherNorm.type !== normalized.type) return false;
      
      // Check if URLs are very similar (differ only by minor params)
      const baseUrl = normalized.canonicalUrl.split('?')[0];
      const otherBase = otherNorm.canonicalUrl.split('?')[0];
      return baseUrl === otherBase && p !== url;
    }).length;

    if (similarCount >= 5) {
      score += 15;
      reasons.push(`Many similar placements detected (${similarCount})`);
    }
  }

  // Performance anomaly signals (if metrics exist)
  
  const { impressions, views, viewRate, avgWatchTime, cost, clicks, conversions } = metrics;

  // High impressions + very low views + low view rate
  if (impressions !== undefined && views !== undefined && viewRate !== undefined) {
    if (impressions > 1000 && views < impressions * 0.02 && viewRate < 2) {
      score += 25;
      reasons.push(`Low view rate: ${viewRate.toFixed(2)}% (${views}/${impressions} views)`);
    }
  }

  // Very low average watch time
  if (avgWatchTime !== undefined && avgWatchTime < 3) {
    score += 20;
    reasons.push(`Very low watch time: ${avgWatchTime.toFixed(1)}s`);
  }

  // Abnormal CPC/CPV relative to upload medians
  // Note: We'll calculate medians from all placements in aggregation step
  // For now, flag if cost exists but seems abnormal
  if (cost !== undefined && views !== undefined && views > 0) {
    const cpv = cost / views;
    // Flag if CPV > $0.50 (typically spam channels have high CPV)
    if (cpv > 0.5) {
      score += 20;
      reasons.push(`High cost per view: $${cpv.toFixed(2)}`);
    }
  }

  // Clicks exist but conversions = 0 with substantial spend
  if (clicks !== undefined && conversions !== undefined && cost !== undefined) {
    if (clicks > 10 && conversions === 0 && cost > 50) {
      score += 15;
      reasons.push(`No conversions despite ${clicks} clicks and $${cost.toFixed(2)} spend`);
    }
  }

  // Cap score at 100
  score = Math.min(score, 100);

  // Return top 3 reasons
  const topReasons = reasons.slice(0, 3);

  return {
    score,
    reasons: topReasons
  };
}

/**
 * Calculates median values from an array of metrics
 */
export function calculateMedians(items: Metrics[]): Metrics {
  const medians: Metrics = {};

  const costs = items.map(m => m.cost).filter((c): c is number => c !== undefined);
  if (costs.length > 0) {
    costs.sort((a, b) => a - b);
    medians.cost = costs[Math.floor(costs.length / 2)];
  }

  const viewRates = items.map(m => m.viewRate).filter((v): v is number => v !== undefined);
  if (viewRates.length > 0) {
    viewRates.sort((a, b) => a - b);
    medians.viewRate = viewRates[Math.floor(viewRates.length / 2)];
  }

  const watchTimes = items.map(m => m.avgWatchTime).filter((w): w is number => w !== undefined);
  if (watchTimes.length > 0) {
    watchTimes.sort((a, b) => a - b);
    medians.avgWatchTime = watchTimes[Math.floor(watchTimes.length / 2)];
  }

  return medians;
}

