import { createClient } from "@supabase/supabase-js";

const envUrl = import.meta.env.VITE_SUPABASE_URL;
const envAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(envUrl && envAnonKey);

if (!isSupabaseConfigured) {
  console.warn(
    "Supabase 환경변수가 설정되지 않았습니다. .env.local에 VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY를 설정하면 Google 로그인이 동작합니다."
  );
}

// 환경변수가 없어도 createClient()가 즉시 예외를 던지지 않도록 더미 값으로 대체한다.
// (Google 로그인 미설정 상태에서도 앱의 나머지 기능은 정상 동작해야 하므로)
export const supabase = createClient(
  envUrl || "https://placeholder.supabase.co",
  envAnonKey || "placeholder-anon-key",
  {
    auth: {
      flowType: "pkce",
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  }
);
