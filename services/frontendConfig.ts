/**
 * Centralized Frontend Configuration
 * This ensures the API URL is handled consistently across all services.
 */

const getApiUrl = () => {
    // Check multiple locations for the API URL
    const rawUrl =
        (import.meta.env.VITE_API_URL) ||
        (process?.env?.VITE_API_URL) ||
        'http://localhost:3001';

    // Remove any trailing slash to prevent double slashes in paths like //api/...
    const cleanUrl = rawUrl.endsWith('/') ? rawUrl.slice(0, -1) : rawUrl;

    return cleanUrl;
};

export const API_BASE_URL = getApiUrl();

// Debug log to help identify where the app is calling
if (typeof window !== 'undefined') {
    (window as any).DEBUG_API_URL = API_BASE_URL;
}

if (import.meta.env.PROD) {
    console.log(`🚀 Production Build: Calling backend at ${API_BASE_URL}`);
} else {
    console.log(`🛠️ Development Build: Calling backend at ${API_BASE_URL}`);
}
