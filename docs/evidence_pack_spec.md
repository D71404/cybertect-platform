# Evidence Pack Specification (v1)

## Purpose
A stable, auditor-friendly bundle for each scan/run. Every pack must be self-contained and replayable.

## Bundle Layout
```
runs/<run_id>/
  run_metadata.json
  network.har
  dom_initial.html
  dom_t3.html
  dom_t6.html
  screenshots/
    full.png
    crop_<iframeId>.png
  iframes.json
  tags.json
  gpt_events.json
```

## Files
- **run_metadata.json**: { runId, url, startedAt, finishedAt, userAgent, viewport{width,height}, locale?, template?, crawlerVersion, featureFlags?, notes? }
- **network.har**: Standard HAR or structured network JSON.
- **dom_initial.html / dom_t3.html / dom_t6.html**: Raw HTML snapshots (t=0, +3s, +6s).
- **screenshots/full.png**: Full-page screenshot at t=0 (PNG). Crops: `crop_<iframeId>.png`.
- **iframes.json**: `{ iframes: IframeRecord[] }`
  - IframeRecord: { id, src, bbox:{x,y,width,height}, zIndex?, visibility?, opacity?, inViewportPct, areaPctOfViewport, overlapPctWith?:[{otherId,pct}], isTiny?, isHidden?, isAdIframe? }
- **tags.json**: `{ tags: TagRecord[] }`
  - TagRecord: { id, type ("GTM"|"GA4"|"UA"|"Ads"|"Custom"), name?, containerId?, triggers?:string[], fired?:boolean, frameUrl?, pageUrl? }
- **gpt_events.json**: `{ events: GptEvent[] }`
  - GptEvent: { ts, type ("slotRenderEnded"|"impressionViewable"|"adRequested"), slotId?, adUnitPath?, requestId?, size?, payload? }

## Evidence Levels (used by modules)
- Observed: Data present (e.g., ad request) but no render/visibility proof.
- Supported: Data + partial causal chain (request + render OR request + viewability).
- Confirmed: Full causal chain: tag/container -> network request -> iframe/slot render -> visibility/layout evidence (screenshot/DOM) with timestamps.

## Stop-Ship Principle
Do not emit “Confirmed” unless the causal chain is satisfied. Prefer degrading to Supported/Observed over over-claiming.
# Evidence Pack Specification (v1)

## Bundle Layout
- `run_metadata.json` — run id, url, timestamps, ua, viewport, locale/template, version, flags.
- `network.har` — full network capture (or compatible HAR-like JSON).
- `dom_initial.html`, `dom_t3.html`, `dom_t6.html` — DOM snapshots at t0/t+3s/t+6s.
- `screenshots/full.png` — full-page screenshot.
- `screenshots/crops/<iframe_id>.png` — per-iframe crops for flagged placements.
- `iframes.json` — iframe inventory with geometry/visibility and overlap data.
- `tags.json` — GTM containers, tag names/types, triggers if available.
- `gpt_events.json` — GPT/GAM events (slotRenderEnded, impressionViewable, etc.) when present.

## JSON Schemas
Located in `schemas/evidence_pack/`:
- `run_metadata.schema.json`
- `iframes.schema.json`
- `tags.schema.json`
- `gpt_events.schema.json`

## Evidence Levels
- Observed: single-source signal (e.g., network request).
- Supported: multi-source alignment (e.g., network + DOM).
- Confirmed: causal chain satisfied — (GTM/tag) → (network req) → (iframe/slot render) → (visibility/layout) with timestamps.

## Required Fields (summaries)
- `run_metadata`: runId, url, startedAt/finishedAt, userAgent, viewport {width,height}, locale, template, crawlerVersion, featureFlags.
- `iframes[]`: id, src, name, boundingBox {x,y,width,height}, viewportCoveragePct, zIndex, visibility, opacity, inViewport, overlapPairs[] (id, overlapPct), classification (ad/unknown), tinyFlag, hiddenFlag, offscreenFlag, timestamps {initial,t3,t6}.
- `tags[]`: containerId, type (GTM/GA4/UA/custom), tagName, trigger, firedAt, source (inline/script URL), evidence (domPath, requestUrl), severity (observed/supported/confirmed).
- `gpt_events[]`: event (slotRenderEnded, impressionViewable, impression), slotId, adUnit, size, ts, requestId, viewabilityPct, payloadHash, source (network/log), matchedIframeId.

## Timestamps
- All times in epoch ms.
- Matching window for causal links: ±3000ms unless module overrides.

## Dedupe & Matching
- Retry dedupe: same endpoint + payload hash within 3s counts once.
- GPT retries deduped unless payload differs.
- Impressions match chain: request → render → viewable using ts window ±3s and requestId/slotId if present.

## Screenshots & Crops
- `screenshots/full.png` captured at final state (≥t+6s).
- Crops keyed by iframe id; include coordinates in filename metadata when possible.

## Expectations Per Module
- Tag/Vendor & GPT Inventory: must populate `tags.json`, `gpt_events.json` (if GPT), and `network.har`.
- CMS Drift: uses `run_metadata.template/locale` + `tags.json` presence to diff expected vs observed.
- Publisher Forensics: uses `iframes.json`, DOM snapshots, screenshots/crops.
- Ad Impression Verification: uses network + `gpt_events.json` + `iframes.json` for request/render/viewable levels.
- Injected Telemetry: uses network + DOM mutations; must not label GTM/GPT as injected without post-load mutation + allowlist check + idle/no-input gating.
- Analytics Integrity: consumes `tags.json` + analytics hits from `network.har`; must handle missing analyticsEntries safely.

