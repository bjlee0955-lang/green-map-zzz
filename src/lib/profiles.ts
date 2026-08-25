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

export async function fetchProfile(userId: string): Promise<RemoteProfile | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, name, email, role, school, school_kind, grade, class")
    .eq("id", userId)
    .maybeSingle();
  if (error) {
    console.error("프로필 조회 실패:", error.message);
    return null;
  }
  return data;
}

export async function upsertProfile(profile: RemoteProfile): Promise<void> {
  const { error } = await supabase.from("profiles").upsert(profile);
  if (error) console.error("프로필 저장 실패:", error.message);
}
