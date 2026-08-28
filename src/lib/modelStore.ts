import { supabase, isSupabaseConfigured } from "./supabaseClient";

// Supabase Storage의 models 버킷에서 최신 모델을 받아 캐시해두고 쓴다.
// 대시보드에서 파일만 교체하면(버전 표시용 파일을 따로 고칠 필요 없이) 다음 실행 때
// 앱이 갱신을 감지해 새 모델을 내려받는다. 네트워크가 없으면 캐시 → 앱에 동봉된
// 모델 순으로 물러난다.
const BUCKET = "models";
const MODEL_FILE = "plant_classifier.onnx";
const LABELS_FILE = "labels.json";

const CACHE_NAME = "gmz-model-cache";
const CACHE_MODEL_KEY = "/__gmz_model__/plant_classifier.onnx";
const CACHE_LABELS_KEY = "/__gmz_model__/labels.json";
const LS_VERSION = "gmz_model_version";

// 앱에 동봉된 기본 모델 (서버·캐시 모두 못 쓸 때)
const BUNDLED_MODEL_URL = "./model/plant_classifier.onnx";
const BUNDLED_LABELS_URL = "./model/labels.json";

export type ModelSource = "server" | "cache" | "bundled";

export interface LoadedModel {
  modelData: Uint8Array;
  labels: string[];
  source: ModelSource;
  version: string | null;
}

function cacheAvailable(): boolean {
  return typeof caches !== "undefined";
}

async function readCache(key: string): Promise<Response | undefined> {
  if (!cacheAvailable()) return undefined;
  try {
    const cache = await caches.open(CACHE_NAME);
    return await cache.match(key);
  } catch {
    return undefined;
  }
}

async function writeCache(key: string, res: Response): Promise<void> {
  if (!cacheAvailable()) return;
  try {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(key, res);
  } catch {
    // 캐시에 못 넣어도 이번 실행에는 영향이 없으므로 무시한다.
  }
}

// 두 파일의 마지막 수정 시각을 합쳐 버전 문자열로 쓴다. 모델만 바꾸든 라벨까지 바꾸든
// 값이 달라지므로, 사용자는 파일만 교체하면 되고 별도의 버전 표기를 관리하지 않아도 된다.
async function fetchRemoteVersion(): Promise<string | null> {
  if (!isSupabaseConfigured) return null;
  try {
    const { data, error } = await supabase.storage.from(BUCKET).list("", { limit: 100 });
    if (error || !data) return null;
    const model = data.find((f) => f.name === MODEL_FILE);
    const labels = data.find((f) => f.name === LABELS_FILE);
    if (!model || !labels) return null;
    const stamp = (f: any) => f.updated_at ?? f.created_at ?? "";
    return `${stamp(model)}|${stamp(labels)}`;
  } catch {
    return null;
  }
}

function publicUrl(file: string): string {
  return supabase.storage.from(BUCKET).getPublicUrl(file).data.publicUrl;
}

async function downloadFromServer(): Promise<{ model: Response; labels: Response }> {
  const [model, labels] = await Promise.all([
    fetch(publicUrl(MODEL_FILE)),
    fetch(publicUrl(LABELS_FILE)),
  ]);
  if (!model.ok) throw new Error(`모델 내려받기 실패 (${model.status})`);
  if (!labels.ok) throw new Error(`라벨 내려받기 실패 (${labels.status})`);
  return { model, labels };
}

async function fromResponses(
  model: Response,
  labels: Response,
  source: ModelSource,
  version: string | null
): Promise<LoadedModel> {
  const [buffer, labelJson] = await Promise.all([model.arrayBuffer(), labels.json()]);
  return { modelData: new Uint8Array(buffer), labels: labelJson, source, version };
}

async function loadFromCache(version: string | null): Promise<LoadedModel | null> {
  const [model, labels] = await Promise.all([readCache(CACHE_MODEL_KEY), readCache(CACHE_LABELS_KEY)]);
  if (!model || !labels) return null;
  return fromResponses(model, labels, "cache", version);
}

async function loadBundled(): Promise<LoadedModel> {
  const [model, labels] = await Promise.all([fetch(BUNDLED_MODEL_URL), fetch(BUNDLED_LABELS_URL)]);
  return fromResponses(model, labels, "bundled", null);
}

export async function loadModelAssets(): Promise<LoadedModel> {
  const remoteVersion = await fetchRemoteVersion();
  const cachedVersion = localStorage.getItem(LS_VERSION);

  // 서버 버전이 캐시와 같으면 내려받지 않는다 (모델이 바뀔 때만 11MB를 새로 받음).
  if (remoteVersion && remoteVersion === cachedVersion) {
    const cached = await loadFromCache(remoteVersion);
    if (cached) return cached;
  }

  if (remoteVersion) {
    try {
      const { model, labels } = await downloadFromServer();
      // 캐시에는 사본을 넣고 본문은 그대로 읽는다 (Response 본문은 한 번만 소비 가능).
      await Promise.all([
        writeCache(CACHE_MODEL_KEY, model.clone()),
        writeCache(CACHE_LABELS_KEY, labels.clone()),
      ]);
      const loaded = await fromResponses(model, labels, "server", remoteVersion);
      localStorage.setItem(LS_VERSION, remoteVersion);
      return loaded;
    } catch (e) {
      console.error("서버 모델을 받지 못했습니다:", e);
    }
  }

  // 서버를 못 쓰면 이전에 받아둔 모델이라도 쓴다.
  const cached = await loadFromCache(cachedVersion);
  if (cached) return cached;

  return loadBundled();
}
