import { supabase } from "./supabaseClient";

// 사진은 Storage에, 기록은 observations 테이블에 저장한다(테이블의 image_path가
// 이미지 원본이 아니라 경로를 담도록 되어 있다). 경로는 항상 "<user_id>/<기록 id>.jpg"
// 형태로 두어, Storage 정책이 첫 번째 폴더명으로 소유자를 판별할 수 있게 한다.
export const PHOTO_BUCKET = "observation-photos";

export interface RemoteObservation {
  id: string;
  user_id: string;
  species_name: string;
  confidence: number | null;
  image_path: string;
  lat: number | null;
  lng: number | null;
  address: string | null;
  created_at: string;
}

export function photoPublicUrl(imagePath: string): string {
  return supabase.storage.from(PHOTO_BUCKET).getPublicUrl(imagePath).data.publicUrl;
}

function storagePath(userId: string, observationId: string): string {
  return `${userId}/${observationId}.jpg`;
}

async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const res = await fetch(dataUrl);
  return res.blob();
}

/**
 * 저장에 쓸 계정 id는 반드시 인증 세션에서 직접 읽는다. 앱이 들고 있는 사용자 정보는
 * 예전 계정의 값이 남아 있을 수 있는데, Storage 정책과 테이블 정책은 auth.uid() 기준이라
 * 그 둘이 어긋나면 "row-level security policy" 위반으로 거절된다.
 */
async function currentAuthUserId(): Promise<{ id: string | null; error: string | null }> {
  const { data, error } = await supabase.auth.getUser();
  if (error) return { id: null, error: error.message };
  if (!data.user) return { id: null, error: "로그인 정보가 없습니다. 다시 로그인해 주세요." };
  return { id: data.user.id, error: null };
}

/**
 * 사진을 Storage에 올린 뒤 기록 한 건을 저장한다. 사진 업로드가 실패하면
 * image_path가 NOT NULL이라 행을 만들 수 없으므로 거기서 멈춘다.
 */
export async function saveObservationToServer(params: {
  id: string;
  userId: string;
  speciesName: string;
  confidence: number;
  imgDataUrl: string;
  lat: number | null;
  lng: number | null;
  address: string;
  createdAt: string;
}): Promise<{ imagePath: string | null; error: string | null }> {
  const { id: authUserId, error: authError } = await currentAuthUserId();
  if (!authUserId) return { imagePath: null, error: authError };

  const path = storagePath(authUserId, params.id);

  try {
    const blob = await dataUrlToBlob(params.imgDataUrl);
    const { error: uploadError } = await supabase.storage
      .from(PHOTO_BUCKET)
      .upload(path, blob, { contentType: "image/jpeg", upsert: true });
    if (uploadError) return { imagePath: null, error: `사진 업로드 실패: ${uploadError.message}` };
  } catch (e: any) {
    return { imagePath: null, error: `사진 준비 실패: ${e?.message ?? e}` };
  }

  const { error: insertError } = await supabase.from("observations").insert({
    id: params.id,
    user_id: authUserId,
    species_name: params.speciesName,
    confidence: params.confidence,
    image_path: path,
    lat: params.lat,
    lng: params.lng,
    address: params.address,
    created_at: params.createdAt,
  });

  if (insertError) {
    // 기록이 안 남는데 사진만 남으면 용량만 잡아먹으므로 되돌린다.
    await supabase.storage.from(PHOTO_BUCKET).remove([path]).catch(() => {});
    return { imagePath: null, error: insertError.message };
  }

  return { imagePath: path, error: null };
}

export async function fetchMyObservations(): Promise<{
  rows: RemoteObservation[];
  error: string | null;
}> {
  const { id: authUserId, error: authError } = await currentAuthUserId();
  if (!authUserId) return { rows: [], error: authError };

  const { data, error } = await supabase
    .from("observations")
    .select("id, user_id, species_name, confidence, image_path, lat, lng, address, created_at")
    .eq("user_id", authUserId)
    .order("created_at", { ascending: true });

  if (error) return { rows: [], error: error.message };
  return { rows: (data ?? []) as RemoteObservation[], error: null };
}

export async function deleteObservationFromServer(
  observationId: string
): Promise<{ error: string | null }> {
  const { id: authUserId, error: authError } = await currentAuthUserId();
  if (!authUserId) return { error: authError };

  const { error } = await supabase.from("observations").delete().eq("id", observationId);
  if (error) return { error: error.message };
  await supabase.storage
    .from(PHOTO_BUCKET)
    .remove([storagePath(authUserId, observationId)])
    .catch(() => {});
  return { error: null };
}
