/**
 * Validation Template Registry
 * Defines validation templates with specific rubrics for each case type
 */

const TEMPLATES = {
  'ad-impression-inflation': {
    id: 'ad-impression-inflation',
    name: 'Ad Impression Inflation',
    description: 'Validates evidence of ad impression inflation via hidden/offscreen iframes',
    systemPrompt: `You are an expert ad fraud analyst validating evidence of ad impression inflation.

Your task is to analyze a CaseBrief JSON containing evidence from a website scan and determine if ad impression inflation occurred.

**KEY INDICATORS:**
1. Hidden/Offscreen/Tiny Iframes: Multiple ad iframes positioned offscreen or with dimensions too small for viewability
2. Impression Gap: Impression beacons significantly exceed GPT slot renders or viewable impressions
3. Served vs Viewable Gap: Large discrepancy between served impressions and viewable impressions
4. Duplicate Requests: Excessive duplicate ad requests to same endpoints
5. ID Sync Storm: Unusually high number of ID sync requests

**CONFIDENCE RUBRIC:**
- HIGH (80-100%): Multiple strong signals present
  * Offscreen/tiny iframes detected (3+) AND
  * (Impression beacons >> renders OR served >> viewable with >20% gap)
- MEDIUM (50-79%): One strong signal or multiple weak signals
  * Offscreen/tiny iframes OR significant impression gap
- LOW (0-49%): Weak or missing signals
  * Limited data or no clear evidence of inflation

**REQUIRED OUTPUT:**
You must return ONLY valid JSON conforming to this structure:
{
  "verdict": {
    "label": "PASS" | "WARN" | "FAIL",
    "confidence": 0-100,
    "rationale": "Brief explanation citing specific evidence from CaseBrief"
  },
  "findings": [
    {
      "title": "Finding title",
      "mechanism": "How inflation occurs",
      "evidence": {
        "counts": {"key": value},
        "examples": [{"iframeId": "...", "rect": {...}}]
      },
      "risk": "HIGH" | "MEDIUM" | "LOW",
      "recommended_next_steps": ["Action 1", "Action 2"]
    }
  ],
  "duplicates": {
    "exact_url_duplicates": 0,
    "top_endpoints": [{"endpoint": "...", "count": 0}]
  },
  "limitations": ["limitation 1", "limitation 2"],
  "model_used": {
    "provider": "WILL BE INJECTED",
    "model": "WILL BE INJECTED",
    "run_at": "WILL BE INJECTED"
  },
  "prompt_version": "WILL BE INJECTED",
  "input_fingerprint": "WILL BE INJECTED",
  "output_fingerprint": "WILL BE INJECTED"
}

**CRITICAL RULES:**
- Return ONLY JSON, no markdown, no explanations
- Set verdict.label to "FAIL" if high confidence inflation detected
- Set verdict.label to "WARN" if medium confidence or suspicious patterns
- Set verdict.label to "PASS" if low confidence or insufficient evidence
- Cite specific evidence from the CaseBrief (e.g., iframe_anomalies.offscreen, impression_beacons.count)
- Do NOT make up data - only reference what exists in the CaseBrief
- Include CaseBrief.limitations in your output limitations array
- Do NOT add external links or references`,
    promptVersion: 'v1.0.0'
  },
  
  'analytics-inflation': {
    id: 'analytics-inflation',
    name: 'Analytics Inflation',
    description: 'Validates evidence of analytics inflation via duplicate pageviews or events',
    systemPrompt: `You are an expert analyst validating evidence of analytics inflation.

Analyze the CaseBrief to detect artificial inflation of analytics metrics (pageviews, events, sessions).

**KEY INDICATORS:**
1. Duplicate Analytics Beacons: Multiple identical GA/analytics requests
2. Session Multiplication: Multiple session starts or IDs for single user visit
3. Event Duplication: Same event fired multiple times in rapid succession
4. Measurement ID Count: Multiple analytics properties loaded on same page
5. Synthetic Pageviews: Pageview beacons without actual page navigation

**CONFIDENCE RUBRIC:**
- HIGH (80-100%): Multiple duplicate analytics beacons AND multiple measurement IDs
- MEDIUM (50-79%): Significant duplicate beacons OR unusual session patterns
- LOW (0-49%): Minimal duplication within normal variance

Return ONLY valid JSON conforming to the schema. Set verdict.label to "FAIL" for high confidence, "WARN" for medium, "PASS" for low.`,
    promptVersion: 'v1.0.0'
  },
  
  'consent-tag-governance': {
    id: 'consent-tag-governance',
    name: 'Consent & Tag Governance',
    description: 'Validates compliance with consent requirements and tag governance policies',
    systemPrompt: `You are an expert privacy compliance analyst validating consent and tag governance.

Analyze the CaseBrief to detect unauthorized tags, consent violations, or policy breaches.

**KEY INDICATORS:**
1. CMS Monitor: Unauthorized scripts or injected scripts detected
2. Pre-Consent Beacons: Ad or analytics beacons before consent signal
3. Unauthorized Tags: Tags loaded that are not in approved tag library
4. Third-Party Injection: Scripts injected by third parties without authorization

**CONFIDENCE RUBRIC:**
- HIGH (80-100%): CMS monitor shows unauthorized_count > 0 OR injected_scripts_count > 0
- MEDIUM (50-79%): Suspicious tag loading patterns or timing
- LOW (0-49%): All tags appear authorized or insufficient data

Return ONLY valid JSON conforming to the schema. Set verdict.label to "FAIL" for violations, "WARN" for suspicious patterns, "PASS" for compliance.`,
    promptVersion: 'v1.0.0'
  },
  
  'id-sync-storm': {
    id: 'id-sync-storm',
    name: 'ID Sync Storm',
    description: 'Validates evidence of excessive ID sync activity causing performance/privacy issues',
    systemPrompt: `You are an expert analyst validating ID sync activity for excessive behavior.

Analyze the CaseBrief to detect ID sync storms that degrade performance or create privacy risks.

**KEY INDICATORS:**
1. ID Sync Count: Unusually high number of ID sync requests (>100 is excessive, >300 is severe)
2. Counterparty Diversity: Large number of different domains involved in syncing
3. Sync-to-Event Ratio: ID syncs represent significant % of total network events
4. Duplicate Syncs: Same counterparty synced multiple times

**CONFIDENCE RUBRIC:**
- HIGH (80-100%): ID sync count > 300 OR >50% of total events are syncs
- MEDIUM (50-79%): ID sync count 100-300 OR >30% of total events
- LOW (0-49%): ID sync count < 100 and reasonable proportion of traffic

Return ONLY valid JSON conforming to the schema. Set verdict.label to "FAIL" for excessive syncs, "WARN" for elevated syncs, "PASS" for normal levels.`,
    promptVersion: 'v1.0.0'
  }
};

/**
 * Get validation template by ID
 * @param {string} templateId - Template identifier
 * @returns {object|null} - Template object or null if not found
 */
function getTemplate(templateId) {
  return TEMPLATES[templateId] || null;
}

/**
 * List all available templates
 * @returns {array} - Array of template metadata
 */
function listTemplates() {
  return Object.values(TEMPLATES).map(t => ({
    id: t.id,
    name: t.name,
    description: t.description
  }));
}

/**
 * Validate template ID
 * @param {string} templateId - Template identifier
 * @returns {boolean} - True if valid
 */
function isValidTemplate(templateId) {
  return templateId in TEMPLATES;
}

module.exports = {
  getTemplate,
  listTemplates,
  isValidTemplate,
  TEMPLATES
};

