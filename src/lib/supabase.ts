import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
// Support both standard anon key and publishable key naming
const supabaseAnonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ||
  "";

// In local/standalone deployments without real Supabase credentials, create a
// lazy no-op client instead of throwing at module load time (which would crash
// SSR for the whole app). Real auth/session features are only used when valid
// credentials are present.
const hasRealCredentials = Boolean(supabaseUrl && supabaseAnonKey && !supabaseUrl.includes("placeholder"));

export const supabase: SupabaseClient<Database> = hasRealCredentials
  ? createClient<Database>(supabaseUrl, supabaseAnonKey)
  : createClient<Database>("https://placeholder.supabase.co", "placeholder-anon-key");
