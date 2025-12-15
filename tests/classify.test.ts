import { describe, it, expect } from 'vitest';
import { classifyFromText, vendorFromDomain } from '../src/classify.js';

describe('classifyFromText', () => {
  it('detects GA4 and GTM ids', () => {
    const text = `
      <script>gtag('config','G-ABC1234567');</script>
      <script src="https://www.googletagmanager.com/gtm.js?id=GTM-XYZ12"></script>
    `;
    const matches = classifyFromText(text);
    expect(matches.find((m) => m.vendor === 'google-analytics')?.ids).toContain('G-ABC1234567');
    expect(matches.find((m) => m.vendor === 'gtm')?.ids).toContain('GTM-XYZ12');
  });
});

describe('vendorFromDomain', () => {
  it('classifies known domains', () => {
    expect(vendorFromDomain('www.google-analytics.com')).toBe('google-analytics');
    expect(vendorFromDomain('www.facebook.com')).toBe('meta');
    expect(vendorFromDomain('unknown.example.com')).toBe('unknown');
  });
});
