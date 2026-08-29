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
  const path = storagePath(params.userId, params.id);

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
    user_id: params.userId,
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

export async function fetchMyObservations(
  userId: string
): Promise<{ rows: RemoteObservation[]; error: string | null }> {
  const { data, error } = await supabase
    .from("observations")
    .select("id, user_id, species_name, confidence, image_path, lat, lng, address, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });

  if (error) return { rows: [], error: error.message };
  return { rows: (data ?? []) as RemoteObservation[], error: null };
}

export async function deleteObservationFromServer(
  userId: string,
  observationId: string
): Promise<{ error: string | null }> {
  const { error } = await supabase.from("observations").delete().eq("id", observationId);
  if (error) return { error: error.message };
  await supabase.storage.from(PHOTO_BUCKET).remove([storagePath(userId, observationId)]).catch(() => {});
  return { error: null };
}
