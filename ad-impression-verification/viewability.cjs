/**
 * Viewability Measurement Module
 * Injects scripts to measure ad viewability using IntersectionObserver
 */

/**
 * Generate viewability measurement script to inject into page
 * @param {Object} rule - { percent: number, duration: number } e.g., { percent: 50, duration: 1000 }
 * @returns {string} - JavaScript code to inject
 */
function generateViewabilityScript(rule) {
  const percent = rule.percent || 50;
  const duration = rule.duration || 1000; // milliseconds
  
  return `
(function() {
  'use strict';
  
  const VIEWABILITY_RULE = { percent: ${percent}, duration: ${duration} };
  const viewabilityEvents = [];
  
  // Function to hook Google Publisher Tag events
  function hookGPTEvents() {
    if (!window.googletag) {
      return false;
    }
    
    try {
      // Wait for GPT API to be ready
      if (window.googletag.apiReady) {
        attachGPTListeners();
        return true;
      } else {
        // Wait for API to be ready
        window.googletag.cmd = window.googletag.cmd || [];
        window.googletag.cmd.push(function() {
          attachGPTListeners();
        });
        return true;
      }
    } catch (e) {
      console.warn('[Cybertect] GPT hook failed:', e);
      return false;
    }
  }
  
  // Attach GPT event listeners
  function attachGPTListeners() {
    try {
      const pubads = window.googletag.pubads();
      if (!pubads || !pubads.addEventListener) {
        return;
      }
      
      // Listen for slotRenderEnded (ad served)
      pubads.addEventListener('slotRenderEnded', function(event) {
        const slot = event.slot;
        const slotId = slot.getSlotElementId();
        const adUnitPath = slot.getAdUnitPath();
        const creativeId = slot.getCreativeId ? slot.getCreativeId() : null;
        const lineItemId = slot.getLineItemId ? slot.getLineItemId() : null;
        const sizes = slot.getSizes ? slot.getSizes().map(s => s.getWidth() + 'x' + s.getHeight()).join(',') : null;
        const isEmpty = event.isEmpty || false;
        
        const gptEvent = {
          type: 'GPT_SLOT_RENDER',
          source: 'gpt',
          slotId: slotId,
          adUnitPath: adUnitPath,
          creativeId: creativeId || slotId,
          lineItemId: lineItemId,
          placement: adUnitPath || slotId,
          sizes: sizes,
          isEmpty: isEmpty,
          timestamp: Date.now()
        };
        
        viewabilityEvents.push(gptEvent);
        
        // Send to parent via console message bridge
        console.log('[CYBERTECT_GPT_EVENT]', JSON.stringify(gptEvent));
      });
      
      // Listen for impressionViewable (viewability verified)
      pubads.addEventListener('impressionViewable', function(event) {
        const slot = event.slot;
        const slotId = slot.getSlotElementId();
        const adUnitPath = slot.getAdUnitPath();
        const creativeId = slot.getCreativeId ? slot.getCreativeId() : null;
        const lineItemId = slot.getLineItemId ? slot.getLineItemId() : null;
        const sizes = slot.getSizes ? slot.getSizes().map(s => s.getWidth() + 'x' + s.getHeight()).join(',') : null;
        
        const gptEvent = {
          type: 'GPT_VIEWABLE',
          source: 'gpt',
          slotId: slotId,
          adUnitPath: adUnitPath,
          creativeId: creativeId || slotId,
          lineItemId: lineItemId,
          placement: adUnitPath || slotId,
          sizes: sizes,
          timestamp: Date.now()
        };
        
        viewabilityEvents.push(gptEvent);
        
        // Send to parent via console message bridge
        console.log('[CYBERTECT_GPT_EVENT]', JSON.stringify(gptEvent));
      });
      
      console.log('[Cybertect] GPT event listeners attached successfully');
    } catch (e) {
      console.warn('[Cybertect] Failed to attach GPT listeners:', e);
    }
  }
  
  // Try to hook GPT events immediately
  if (!hookGPTEvents()) {
    // Retry after DOMContentLoaded
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function() {
        setTimeout(hookGPTEvents, 500);
      });
    } else {
      setTimeout(hookGPTEvents, 500);
    }
    
    // Also retry after window load
    window.addEventListener('load', function() {
      setTimeout(hookGPTEvents, 1000);
    });
  }
  
  // Detect ad iframes by size heuristics
  const AD_SIZES = [
    { w: 300, h: 250 }, // Medium Rectangle
    { w: 728, h: 90 },  // Leaderboard
    { w: 320, h: 50 },  // Mobile Banner
    { w: 970, h: 250 }, // Billboard
    { w: 300, h: 600 }, // Half Page
    { w: 320, h: 100 }, // Mobile Banner Large
    { w: 336, h: 280 }, // Large Rectangle
    { w: 250, h: 250 }, // Square
    { w: 200, h: 200 }  // Small Square
  ];
  
  function isAdSize(width, height) {
    const tolerance = 5;
    return AD_SIZES.some(size => 
      Math.abs(width - size.w) <= tolerance && Math.abs(height - size.h) <= tolerance
    );
  }
  
  // Track viewability for each element
  const trackedElements = new Map();
  
  function trackElement(element, creativeId, placement) {
    if (trackedElements.has(element)) return;
    
    let inViewTime = 0;
    let lastInView = null;
    let observer = null;
    
    const checkViewability = () => {
      const rect = element.getBoundingClientRect();
      const viewportHeight = window.innerHeight;
      const viewportWidth = window.innerWidth;
      
      const visibleWidth = Math.max(0, Math.min(rect.right, viewportWidth) - Math.max(rect.left, 0));
      const visibleHeight = Math.max(0, Math.min(rect.bottom, viewportHeight) - Math.max(rect.top, 0));
      const visibleArea = visibleWidth * visibleHeight;
      const totalArea = rect.width * rect.height;
      
      const percentInView = totalArea > 0 ? (visibleArea / totalArea) * 100 : 0;
      const isInView = percentInView >= VIEWABILITY_RULE.percent;
      
      const now = Date.now();
      
      if (isInView) {
        if (lastInView === null) {
          lastInView = now;
        }
        inViewTime = now - lastInView;
        
        if (inViewTime >= VIEWABILITY_RULE.duration) {
          // Emit viewability event (fallback when GPT not available)
          const event = {
            type: 'VIEWABILITY',
            source: 'intersection',
            creativeId: creativeId || element.id || 'unknown',
            placement: placement || 'unknown',
            timestamp: now,
            percentInView: Math.round(percentInView),
            duration: inViewTime,
            elementId: element.id || null,
            elementTag: element.tagName || null
          };
          
          viewabilityEvents.push(event);
          console.log('[CYBERTECT_VIEWABILITY]', JSON.stringify(event));
          
          // Stop tracking once viewability is met
          if (observer) {
            observer.disconnect();
            trackedElements.delete(element);
          }
        }
      } else {
        lastInView = null;
        inViewTime = 0;
      }
    };
    
    // Use IntersectionObserver for efficient tracking
    try {
      observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            const rect = entry.boundingClientRect;
            const visibleArea = entry.intersectionArea;
            const totalArea = rect.width * rect.height;
            const percentInView = totalArea > 0 ? (visibleArea / totalArea) * 100 : 0;
            
            if (percentInView >= VIEWABILITY_RULE.percent) {
              const now = Date.now();
              if (lastInView === null) {
                lastInView = now;
              }
              
              setTimeout(() => {
                const elapsed = Date.now() - lastInView;
                if (elapsed >= VIEWABILITY_RULE.duration) {
                  const event = {
                    type: 'VIEWABILITY',
                    source: 'intersection',
                    creativeId: creativeId || element.id || 'unknown',
                    placement: placement || 'unknown',
                    timestamp: Date.now(),
                    percentInView: Math.round(percentInView),
                    duration: elapsed,
                    elementId: element.id || null,
                    elementTag: element.tagName || null
                  };
                  
                  viewabilityEvents.push(event);
                  console.log('[CYBERTECT_VIEWABILITY]', JSON.stringify(event));
                  
                  if (observer) {
                    observer.disconnect();
                    trackedElements.delete(element);
                  }
                }
              }, VIEWABILITY_RULE.duration);
            } else {
              lastInView = null;
            }
          } else {
            lastInView = null;
          }
        });
      }, {
        threshold: [VIEWABILITY_RULE.percent / 100],
        rootMargin: '0px'
      });
      
      observer.observe(element);
      trackedElements.set(element, { observer, creativeId, placement });
    } catch (e) {
      console.warn('[Cybertect] IntersectionObserver failed:', e);
      // Fallback to polling
      const interval = setInterval(checkViewability, 100);
      trackedElements.set(element, { interval, creativeId, placement });
    }
  }
  
  // Scan for ad iframes and elements
  function scanForAds() {
    // Check iframes
    document.querySelectorAll('iframe').forEach(iframe => {
      try {
        const width = iframe.offsetWidth || iframe.width;
        const height = iframe.offsetHeight || iframe.height;
        
        if (isAdSize(parseInt(width), parseInt(height))) {
          const src = iframe.src || '';
          const creativeId = iframe.getAttribute('data-creative-id') || 
                            iframe.id || 
                            src.split('/').pop().split('?')[0] || 
                            'iframe-' + Date.now();
          const placement = iframe.getAttribute('data-placement') || 
                           iframe.getAttribute('data-slot') || 
                           iframe.id || 
                           'unknown';
          
          trackElement(iframe, creativeId, placement);
        }
      } catch (e) {
        // Cross-origin iframe, skip
      }
    });
    
    // Check divs with ad-like classes/ids
    document.querySelectorAll('div[id*="ad"], div[class*="ad"], div[data-ad], div[data-slot]').forEach(div => {
      const width = div.offsetWidth;
      const height = div.offsetHeight;
      
      if (isAdSize(width, height) && !trackedElements.has(div)) {
        const creativeId = div.getAttribute('data-creative-id') || 
                          div.id || 
                          'div-' + Date.now();
        const placement = div.getAttribute('data-placement') || 
                         div.getAttribute('data-slot') || 
                         div.id || 
                         'unknown';
        
        trackElement(div, creativeId, placement);
      }
    });
  }
  
  // Initial scan
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scanForAds);
  } else {
    scanForAds();
  }
  
  // Periodic rescan for dynamically loaded ads
  setInterval(scanForAds, 2000);
  
  // Expose for debugging
  window.__cybertectViewability = {
    events: viewabilityEvents,
    tracked: trackedElements.size,
    rescan: scanForAds
  };
})();
`;
}

module.exports = {
  generateViewabilityScript
};

