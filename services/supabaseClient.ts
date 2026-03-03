import { createClient } from '@supabase/supabase-js'
import { API_BASE_URL } from './frontendConfig';

// We'll initialize with placeholders and then update once we fetch the real config.
// Or we can just use a proxy.

let realClient: any = null;
let initPromise: Promise<any> | null = null;

const handler = {
    get: (target: any, prop: string) => {
        if (!realClient) {
            throw new Error("Supabase client not initialized. Call initSupabase() first.");
        }
        return realClient[prop];
    }
};

/**
 * AUTH-ONLY CLIENT:
 * For a senior cybersecurity architecture, we only expose the Supabase client
 * to the frontend for AUTHENTICATION purposes. 
 * Database CRUD operations are proxied through our backend to hide the keys and URL.
 */
export const supabase = new Proxy({}, handler);

export const initSupabase = async () => {
    if (realClient) return realClient;
    if (initPromise) return initPromise;

    initPromise = (async () => {
        try {
            const res = await fetch(`${API_BASE_URL}/api/config/supabase`);
            if (!res.ok) throw new Error("Failed to fetch Supabase config");
            const { url, key } = await res.json();

            if (!url || !key) {
                console.error("Supabase config is missing url or key");
                throw new Error("Invalid Supabase config");
            }

            realClient = createClient(url, key);
            return realClient;
        } catch (err) {
            initPromise = null; // Allow retry on failure
            throw err;
        }
    })();

    return initPromise;
};