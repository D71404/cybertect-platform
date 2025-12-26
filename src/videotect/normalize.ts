export type NormalizedType = 'channel' | 'video' | 'other';

export interface NormalizedUrl {
  type: NormalizedType;
  canonicalUrl: string;
  originalUrl: string;
}

/**
 * Normalizes YouTube URLs to canonical format
 * Handles various YouTube URL formats including channels, videos, and short links
 */
export function normalizeYouTubeUrl(url: string): NormalizedUrl {
  const originalUrl = url.trim();
  
  if (!url) {
    return {
      type: 'other',
      canonicalUrl: originalUrl,
      originalUrl
    };
  }

  try {
    // Handle youtu.be short links
    if (url.includes('youtu.be/')) {
      const match = url.match(/youtu\.be\/([a-zA-Z0-9_-]+)/);
      if (match && match[1]) {
        return {
          type: 'video',
          canonicalUrl: `https://www.youtube.com/watch?v=${match[1]}`,
          originalUrl
        };
      }
    }

    // Parse URL
    const urlObj = new URL(url);
    
    // Ensure we're dealing with YouTube
    if (!urlObj.hostname.includes('youtube.com') && !urlObj.hostname.includes('youtu.be')) {
      return {
        type: 'other',
        canonicalUrl: originalUrl,
        originalUrl
      };
    }

    // Normalize hostname to www.youtube.com
    const normalizedHost = 'www.youtube.com';
    const pathname = urlObj.pathname;

    // Channel URLs
    if (pathname.startsWith('/channel/')) {
      const channelId = pathname.split('/channel/')[1]?.split('/')[0];
      if (channelId && channelId.startsWith('UC')) {
        return {
          type: 'channel',
          canonicalUrl: `https://${normalizedHost}/channel/${channelId}`,
          originalUrl
        };
      }
    }

    // Handle @handle format
    if (pathname.startsWith('/@')) {
      const handle = pathname.split('/@')[1]?.split('/')[0];
      if (handle) {
        return {
          type: 'channel',
          canonicalUrl: `https://${normalizedHost}/@${handle}`,
          originalUrl
        };
      }
    }

    // Handle /c/ format
    if (pathname.startsWith('/c/')) {
      const channelName = pathname.split('/c/')[1]?.split('/')[0];
      if (channelName) {
        return {
          type: 'channel',
          canonicalUrl: `https://${normalizedHost}/c/${channelName}`,
          originalUrl
        };
      }
    }

    // Handle /user/ format
    if (pathname.startsWith('/user/')) {
      const userName = pathname.split('/user/')[1]?.split('/')[0];
      if (userName) {
        return {
          type: 'channel',
          canonicalUrl: `https://${normalizedHost}/user/${userName}`,
          originalUrl
        };
      }
    }

    // Video URLs - watch?v=VIDEOID
    if (pathname === '/watch' && urlObj.searchParams.has('v')) {
      const videoId = urlObj.searchParams.get('v');
      if (videoId) {
        return {
          type: 'video',
          canonicalUrl: `https://${normalizedHost}/watch?v=${videoId}`,
          originalUrl
        };
      }
    }

    // Video URLs - /v/VIDEOID format
    if (pathname.startsWith('/v/')) {
      const videoId = pathname.split('/v/')[1]?.split('/')[0];
      if (videoId) {
        return {
          type: 'video',
          canonicalUrl: `https://${normalizedHost}/watch?v=${videoId}`,
          originalUrl
        };
      }
    }

    // If we can't classify it, return as other
    return {
      type: 'other',
      canonicalUrl: originalUrl,
      originalUrl
    };
  } catch (error) {
    // If URL parsing fails, return as other
    return {
      type: 'other',
      canonicalUrl: originalUrl,
      originalUrl
    };
  }
}

