/**
 * API base URL for backend requests.
 * Set VITE_API_URL in .env for production (e.g. https://api.yourdomain.com).
 */
export const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001';
