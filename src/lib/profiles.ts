import { supabase } from "./supabaseClient";

// 기존 profiles 테이블에는 email 컬럼이 없다 — 이메일은 Supabase auth 세션에서 바로 가져온다.
export interface RemoteProfile {
  id: string;
  name: string;
  role: "student" | "teacher";
  school: string;
  school_kind: string;
  grade: string;
  class: string;
}

export async function fetchProfile(userId: string): Promise<{ profile: RemoteProfile | null; error: string | null }> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, name, role, school, school_kind, grade, class")
    .eq("id", userId)
    .maybeSingle();
  if (error) {
    console.error("프로필 조회 실패:", error.message);
    return { profile: null, error: error.message };
  }
  return { profile: data, error: null };
}

export async function upsertProfile(profile: RemoteProfile): Promise<{ error: string | null }> {
  const { error } = await supabase.from("profiles").upsert(profile);
  if (error) {
    console.error("프로필 저장 실패:", error.message);
    return { error: error.message };
  }
  return { error: null };
}
