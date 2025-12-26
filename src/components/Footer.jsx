import React from 'react';

const Footer = ({ toolSpecificDisclaimer }) => {
  return (
    <footer className="bg-white border-t border-gray-200 mt-16">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="space-y-4">
          {toolSpecificDisclaimer && (
            <p className="text-sm text-gray-600 leading-relaxed">
              {toolSpecificDisclaimer}
            </p>
          )}
          <p className="text-sm text-gray-600 leading-relaxed">
            <strong>Disclaimer:</strong> The results provided by Cybertect tools are for informational purposes only. 
            Cybertect does not guarantee the accuracy, completeness, or reliability of scan results. 
            Results may contain false positives or false negatives. Users should verify findings independently 
            before making business decisions. Cybertect is not liable for any decisions made based on these results.
          </p>
          <div className="flex flex-wrap items-center gap-4 text-sm text-gray-600">
            <a 
              href="/terms-of-service.html" 
              className="hover:text-gray-900 transition-colors"
            >
              Terms of Service
            </a>
            <span className="text-gray-400">|</span>
            <a 
              href="/privacy-policy.html" 
              className="hover:text-gray-900 transition-colors"
            >
              Privacy Policy
            </a>
          </div>
          <p className="text-sm text-gray-500">
            © 2025 Cybertect. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
};

export default Footer;

