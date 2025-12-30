// GA4 Vendor Exclusion Layer classifier
// Status: SAFE | FLAG
// Type: VENDOR | PRIVATE | SUSPICIOUS

const VENDOR_UBIQUITY_THRESHOLD = 10;

const ALLOWLISTED_VENDOR_GA4 = new Set([
  'G-FVWZ0RM4DH', // Linkfire
]);

function classifyGa4Id(ga4_id, domain_count) {
  const id = (ga4_id || '').trim().toUpperCase();
  const count = Math.max(0, Number(domain_count) || 0);

  if (!id) {
    return { status: 'SAFE', type: 'PRIVATE', reason: 'Missing GA4 ID' };
  }

  if (ALLOWLISTED_VENDOR_GA4.has(id)) {
    return { status: 'SAFE', type: 'VENDOR', reason: 'Allowlisted vendor GA4 ID' };
  }

  if (count > VENDOR_UBIQUITY_THRESHOLD) {
    return { status: 'SAFE', type: 'VENDOR', reason: `GA4 ID seen on >${VENDOR_UBIQUITY_THRESHOLD} domains` };
  }

  if (count > 1) {
    return { status: 'FLAG', type: 'SUSPICIOUS', reason: 'Shared GA4 ID across multiple domains below vendor threshold' };
  }

  return { status: 'SAFE', type: 'PRIVATE', reason: 'GA4 ID scoped to a single domain' };
}

module.exports = {
  VENDOR_UBIQUITY_THRESHOLD,
  ALLOWLISTED_VENDOR_GA4,
  classifyGa4Id,
};

