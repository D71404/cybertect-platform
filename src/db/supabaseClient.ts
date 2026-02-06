import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// FIX: Reconstruct __dirname for ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from project root
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

let supabase: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient {
  if (supabase) {
    return supabase;
  }

  const url = process.env.SUPABASE_URL;
  // Check for either naming convention
  const key = process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY;

  if (!url || !key) {
    console.error('❌ Debug - Missing Credentials:');
    console.log('   SUPABASE_URL:', url ? 'Found' : 'Missing');
    console.log('   SUPABASE_KEY:', key ? 'Found' : 'Missing');
    
    throw new Error(
      'Supabase credentials missing. Please set SUPABASE_URL and SUPABASE_ANON_KEY in your .env file.'
    );
  }

  supabase = createClient(url, key, {
    auth: { persistSession: false }
  });
  
  return supabase;
}

export const db = new Proxy({} as SupabaseClient, {
  get(_, prop) {
    return (getSupabaseClient() as any)[prop];
  },
});

export async function testConnection(): Promise<boolean> {
  try {
    const client = getSupabaseClient();
    // Select count to be lightweight
    const { error, count } = await client.from('scans').select('*', { count: 'exact', head: true });

    if (error) {
      console.error('[Supabase] Connection test failed:', error.message);
      return false;
    }

    console.log(`[Supabase] ✅ Connected! Found ${count ?? 0} existing scans.`);
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[Supabase] Connection test failed:', message);
    return false;
  }
}