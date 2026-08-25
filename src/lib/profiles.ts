import { supabase } from "./supabaseClient";

export interface RemoteProfile {
  id: string;
  name: string;
  email: string;
  role: "student" | "teacher";
  school: string;
  school_kind: string;
  grade: string;
  class: string;
}

export async function fetchProfile(userId: string): Promise<{ profile: RemoteProfile | null; error: string | null }> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, name, email, role, school, school_kind, grade, class")
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
