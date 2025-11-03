// Minimal Supabase client (v2)
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || import.meta.env.VITE_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anon) {
  console.warn("[supabase] Missing URL or ANON key. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.");
}

export const supabase = createClient(url, anon, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

// Utility to build the reset redirect URL
export function getResetRedirectUrl() {
  // Must be an absolute URL and whitelisted in Supabase Auth settings
  const origin = typeof window !== "undefined" ? window.location.origin : "https://your-domain";
  return `${origin}/reset`;
}
