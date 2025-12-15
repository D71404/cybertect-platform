export type Vendor =
  | 'google-analytics'
  | 'gtm'
  | 'google-ads'
  | 'doubleclick'
  | 'meta'
  | 'tiktok'
  | 'unknown';

export interface VendorMatch {
  vendor: Vendor;
  ids: string[];
}

const REGEX = {
  GA4: /G-[A-Z0-9]+/gi,
  UA: /UA-\d+-\d+/gi,
  GTM: /GTM-[A-Z0-9]+/gi,
  AW: /AW-\d+/gi,
  META: /(?:fbq\(['"]init['"],\s*['"]|facebook\.com\/tr\?.*?[?&]id=)(\d{6,20})/gi,
  TIKTOK: /ttq\.identify\(['"](\w{5,})/gi,
};

export function classifyFromText(text: string): VendorMatch[] {
  const matches: VendorMatch[] = [];
  const pushMatch = (vendor: Vendor, ids: string[]) => {
    if (ids.length) {
      matches.push({ vendor, ids: Array.from(new Set(ids.map((id) => id.toUpperCase()))) });
    }
  };

  const finder = (regex: RegExp, vendor: Vendor, mapper?: (val: string) => string) => {
    regex.lastIndex = 0;
    const ids: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = regex.exec(text)) !== null) {
      ids.push(mapper ? mapper(m[1] ?? m[0]) : m[0]);
    }
    pushMatch(vendor, ids);
  };

  finder(REGEX.GA4, 'google-analytics');
  finder(REGEX.UA, 'google-analytics');
  finder(REGEX.GTM, 'gtm');
  finder(REGEX.AW, 'google-ads');
  finder(REGEX.META, 'meta', (val) => val);
  finder(REGEX.TIKTOK, 'tiktok', (val) => val);
  return matches;
}

export function vendorFromDomain(domain: string): Vendor {
  const host = domain.toLowerCase();
  if (host.includes('google-analytics') || host.includes('analytics.google')) return 'google-analytics';
  if (host.includes('googletagmanager.com')) return 'gtm';
  if (host.includes('doubleclick') || host.includes('fls.doubleclick')) return 'doubleclick';
  if (host.includes('facebook') || host.includes('meta')) return 'meta';
  if (host.includes('tiktok')) return 'tiktok';
  if (host.includes('googleads') || host.includes('aw.') || host.includes('ads.google')) return 'google-ads';
  return 'unknown';
}
