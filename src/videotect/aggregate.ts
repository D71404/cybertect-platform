import { normalizeYouTubeUrl } from './normalize';
import { scorePlacement, Metrics } from './scoring';
import { ParsedRow } from './csv-parser';

export interface AggregatedItem {
  type: 'channel' | 'video' | 'other';
  canonicalUrl: string;
  originalUrl: string;
  metrics: Metrics;
  aggregatedFromCount: number;
  allOriginalUrls: string[];
}

/**
 * Aggregates CSV rows by canonical URL
 */
export function aggregateRows(rows: ParsedRow[]): Map<string, AggregatedItem> {
  const aggregated = new Map<string, AggregatedItem>();

  for (const row of rows) {
    const normalized = normalizeYouTubeUrl(row.placementUrl);
    const key = `${normalized.type}:${normalized.canonicalUrl}`;

    if (!aggregated.has(key)) {
      aggregated.set(key, {
        type: normalized.type,
        canonicalUrl: normalized.canonicalUrl,
        originalUrl: normalized.originalUrl,
        metrics: {},
        aggregatedFromCount: 0,
        allOriginalUrls: []
      });
    }

    const item = aggregated.get(key)!;
    item.aggregatedFromCount++;
    item.allOriginalUrls.push(row.placementUrl);

    // Sum numeric metrics
    if (row.cost !== undefined) {
      item.metrics.cost = (item.metrics.cost || 0) + row.cost;
    }

    if (row.impressions !== undefined) {
      item.metrics.impressions = (item.metrics.impressions || 0) + row.impressions;
    }

    if (row.views !== undefined) {
      item.metrics.views = (item.metrics.views || 0) + row.views;
    }

    if (row.clicks !== undefined) {
      item.metrics.clicks = (item.metrics.clicks || 0) + row.clicks;
    }

    if (row.conversions !== undefined) {
      item.metrics.conversions = (item.metrics.conversions || 0) + row.conversions;
    }

    // For rates and averages, we'll calculate them after aggregation
    // Store raw values for now (we'll average them)
    if (!item.metrics._viewRates) {
      item.metrics._viewRates = [];
    }
    if (row.viewRate !== undefined) {
      item.metrics._viewRates.push(row.viewRate);
    }

    if (!item.metrics._watchTimes) {
      item.metrics._watchTimes = [];
    }
    if (row.avgWatchTime !== undefined) {
      item.metrics._watchTimes.push(row.avgWatchTime);
    }
  }

  // Calculate averages for rates and watch times
  for (const item of aggregated.values()) {
    // Calculate average view rate
    if (item.metrics._viewRates && item.metrics._viewRates.length > 0) {
      const sum = item.metrics._viewRates.reduce((a, b) => a + b, 0);
      item.metrics.viewRate = sum / item.metrics._viewRates.length;
      delete item.metrics._viewRates;
    }

    // Calculate average watch time
    if (item.metrics._watchTimes && item.metrics._watchTimes.length > 0) {
      const sum = item.metrics._watchTimes.reduce((a, b) => a + b, 0);
      item.metrics.avgWatchTime = sum / item.metrics._watchTimes.length;
      delete item.metrics._watchTimes;
    }

    // Calculate view rate from impressions/views if not provided
    if (!item.metrics.viewRate && item.metrics.impressions && item.metrics.views) {
      item.metrics.viewRate = (item.metrics.views / item.metrics.impressions) * 100;
    }
  }

  return aggregated;
}

/**
 * Scores all aggregated items
 */
export function scoreAggregatedItems(
  aggregated: Map<string, AggregatedItem>
): Map<string, AggregatedItem & { score: number; reasons: string[] }> {
  const allUrls = Array.from(aggregated.values()).map(item => item.canonicalUrl);

  const scored = new Map<string, AggregatedItem & { score: number; reasons: string[] }>();

  for (const [key, item] of aggregated.entries()) {
    // Score the item
    const scoringResult = scorePlacement(item.canonicalUrl, item.metrics, allUrls);
    
    scored.set(key, {
      ...item,
      score: scoringResult.score,
      reasons: scoringResult.reasons
    });
  }

  return scored;
}

