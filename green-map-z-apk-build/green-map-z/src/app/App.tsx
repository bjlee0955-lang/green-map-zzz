import { useState, useEffect, useRef } from "react";
import {
  Camera, MapPin, Leaf, User, ChevronRight, Check, X,
  ArrowLeft, School, BookOpen, Star, AlertCircle, ImageOff,
} from "lucide-react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Capacitor } from "@capacitor/core";
import { Camera as CapCamera, CameraResultType, CameraSource } from "@capacitor/camera";
import { Geolocation } from "@capacitor/geolocation";

type Screen = "landing" | "login" | "signup" | "home" | "upload" | "result" | "map" | "myrecords";
type Role = "student" | "teacher";
type SchoolKind = "" | "초등학교" | "중학교" | "고등학교";

interface StoredUser {
  userId: string;
  password: string;
  name: string;
  email: string;
  school: string;
  schoolKind: string;
  grade: string;
  class: string;
  role: Role;
}

interface PlantObservation {
  id: string;
  name: string;
  confidence: number;
  date: string;
  lat: number;
  lng: number;
  imgDataUrl: string;
  student: string;
  userId: string;
  address: string;
}

// ── localStorage helpers ────────────────────────────────────────────────────
const LS_USERS   = "gmz_users";
const LS_OBS     = "gmz_observations";
const LS_CUR     = "gmz_current_user";
function loadUsers(): StoredUser[] {
  try { return JSON.parse(localStorage.getItem(LS_USERS) ?? "[]"); } catch { return []; }
}
function saveUsers(users: StoredUser[]) {
  localStorage.setItem(LS_USERS, JSON.stringify(users));
}
function loadObservations(): PlantObservation[] {
  try { return JSON.parse(localStorage.getItem(LS_OBS) ?? "[]"); } catch { return []; }
}
function saveObservations(obs: PlantObservation[]) {
  localStorage.setItem(LS_OBS, JSON.stringify(obs));
}
function loadCurrentUserId(): string | null {
  return localStorage.getItem(LS_CUR);
}
function saveCurrentUserId(id: string | null) {
  if (id) localStorage.setItem(LS_CUR, id);
  else localStorage.removeItem(LS_CUR);
}

interface PendingCapture {
  imgDataUrl: string;
  lat: number | null;
  lng: number | null;
  address: string;
  date: string;
}

interface AiResult {
  name: string;        // Korean common name (or scientific)
  scientificName: string;
  confidence: number;  // 0~100
  color: string;
}

// Korean common name overrides for frequently misnamed species
const KO_NAME_MAP: Record<string, string> = {
  "Prunus serrulata": "왕벚나무", "Prunus yedoensis": "벚나무",
  "Ginkgo biloba": "은행나무", "Rhododendron": "철쭉",
  "Zelkova serrata": "느티나무", "Pinus densiflora": "소나무",
  "Pinus thunbergii": "곰솔", "Acer palmatum": "단풍나무",
  "Magnolia kobus": "목련", "Magnolia denudata": "백목련",
  "Forsythia koreana": "개나리", "Spiraea prunifolia": "조팝나무",
  "Hibiscus syriacus": "무궁화", "Platanus": "플라타너스",
  "Populus": "포플러", "Salix": "버드나무",
  "Quercus": "참나무", "Castanea crenata": "밤나무",
  "Persimmon": "감나무", "Diospyros kaki": "감나무",
  "Bambusa": "대나무", "Phyllostachys": "대나무",
  "Rosa": "장미", "Camellia japonica": "동백나무",
  "Wisteria floribunda": "등나무", "Sophora japonica": "회화나무",
};

const PLANT_ICONS: Record<string, string> = {
  "왕벚나무": "🌸", "벚나무": "🌸", "은행나무": "🍂", "철쭉": "🌺",
  "느티나무": "🌳", "소나무": "🌲", "곰솔": "🌲", "단풍나무": "🍁",
  "목련": "🌼", "백목련": "🌼", "개나리": "🌼", "무궁화": "🌸",
  "대나무": "🎋", "장미": "🌹", "동백나무": "🌺", "감나무": "🍊",
  "밤나무": "🌰", "버드나무": "🌿", "참나무": "🌳", "포플러": "🌳",
  "회화나무": "🌳", "조팝나무": "🌼", "플라타너스": "🌳", "등나무": "🌸",
};

function defaultIcon(name: string): string {
  return PLANT_ICONS[name] ?? "🌿";
}

// ── English → Korean plant name dictionary ──────────────────────────────────
const EN_TO_KO: Record<string, string> = {
  // Trees & shrubs
  "cherry": "벚나무", "cherry tree": "벚나무", "japanese cherry": "벚나무",
  "prunus serrulata": "왕벚나무", "prunus yedoensis": "벚나무",
  "ginkgo": "은행나무", "maidenhair tree": "은행나무",
  "zelkova": "느티나무", "japanese zelkova": "느티나무",
  "pine": "소나무", "red pine": "소나무", "korean pine": "소나무",
  "black pine": "곰솔", "japanese black pine": "곰솔",
  "maple": "단풍나무", "japanese maple": "단풍나무",
  "magnolia": "목련", "kobushi magnolia": "목련", "yulan magnolia": "백목련",
  "forsythia": "개나리",
  "azalea": "철쭉", "royal azalea": "철쭉", "rhododendron": "철쭉",
  "rose of sharon": "무궁화", "hibiscus": "무궁화",
  "bamboo": "대나무", "phyllostachys": "대나무",
  "oak": "참나무", "sawtooth oak": "참나무",
  "chestnut": "밤나무",
  "persimmon": "감나무",
  "plum": "매실나무", "japanese plum": "매실나무",
  "camellia": "동백나무",
  "wisteria": "등나무",
  "willow": "버드나무",
  "poplar": "포플러",
  "birch": "자작나무",
  "elm": "느릅나무",
  "ash": "물푸레나무",
  "cedar": "삼나무",
  "cypress": "측백나무",
  "juniper": "향나무",
  "plane tree": "플라타너스", "london plane": "플라타너스",
  "linden": "피나무", "basswood": "피나무",
  "locust": "아까시나무", "black locust": "아까시나무",
  "paulownia": "오동나무",
  "liquidambar": "단풍나무", "sweetgum": "단풍나무",
  // Flowers
  "rose": "장미",
  "chrysanthemum": "국화",
  "lotus": "연꽃",
  "iris": "붓꽃",
  "lily": "백합",
  "tulip": "튤립",
  "sunflower": "해바라기",
  "daisy": "데이지",
  "lavender": "라벤더",
  "cosmos": "코스모스",
  "peony": "모란",
  "peach blossom": "복숭아꽃",
  "plum blossom": "매화",
  "dandelion": "민들레",
  "clover": "클로버",
  // Herbs & ground
  "fern": "고사리",
  "moss": "이끼",
  "grass": "잔디",
  "bamboo grass": "조릿대",
  // Fruits / vegetables (garden)
  "tomato": "토마토", "pepper": "고추", "lettuce": "상추",
  "cabbage": "양배추", "pumpkin": "호박", "cucumber": "오이",
};

function toKorean(label: string): string {
  const lower = label.toLowerCase().trim();
  // Direct lookup
  if (EN_TO_KO[lower]) return EN_TO_KO[lower];
  // Partial match — check if any key is contained in the label
  for (const [key, val] of Object.entries(EN_TO_KO)) {
    if (lower.includes(key) || key.includes(lower)) return val;
  }
  // Scientific name fallback from KO_NAME_MAP
  for (const [sci, ko] of Object.entries(KO_NAME_MAP)) {
    if (lower.includes(sci.toLowerCase())) return ko;
  }
  // Return original if no match
  return label;
}

// ── Plant identification via Transformers.js (runs fully in browser, no API key) ──
import { pipeline, type ImageClassificationOutput } from "@huggingface/transformers";

const COLORS = ["#2d6a4f", "#52b788", "#95d5b2"] as const;

// Singleton pipeline — model downloaded once, cached in browser IndexedDB
let classifierPromise: Promise<any> | null = null;

function getClassifier() {
  if (!classifierPromise) {
    // mobilevit-small: ~22MB quantized, 1000 ImageNet classes including many plants
    classifierPromise = pipeline(
      "image-classification",
      "Xenova/mobilevit-small",
      { dtype: "q8" }
    );
  }
  return classifierPromise;
}

// Keywords that indicate a result is plant-related (ImageNet label filter)
const PLANT_KEYWORDS = new Set([
  "daisy","sunflower","rose","tulip","dandelion","orchid","lily","lotus",
  "iris","fern","moss","grass","bamboo","pine","oak","maple","willow","birch",
  "palm","cactus","vine","herb","shrub","bush","blossom","flower","leaf","plant",
  "tree","bark","root","petal","pollen","spore","fungi","fungus","mushroom",
  "agaric","bolete","lichen","algae","seaweed","corn","wheat","rice","hay",
  "broccoli","cauliflower","cabbage","lettuce","spinach","artichoke","pepper",
  "cucumber","pumpkin","zucchini","tomato","strawberry","lemon","orange",
  "banana","pineapple","mango","fig","acorn","pinecone","rapeseed","broom",
  "magnolia","cherry","peach","plum","camellia","wisteria","forsythia","azalea",
  "chrysanthemum","lavender","cosmos","peony","clover","cedar","cypress","juniper",
  "elm","ash","chestnut","persimmon","poplar","ginkgo","zelkova","hibiscus",
]);

function isPlantLabel(label: string): boolean {
  const lower = label.toLowerCase();
  for (const kw of PLANT_KEYWORDS) {
    if (lower.includes(kw)) return true;
  }
  return false;
}

async function identifyPlant(imgDataUrl: string): Promise<AiResult[]> {
  const classifier = await getClassifier();
  const output = await classifier(imgDataUrl, { topk: 20 }) as { label: string; score: number }[];
  const all = Array.isArray(output) ? output : [output];
  if (!all.length) throw new Error("식물을 인식하지 못했습니다.");

  // Prefer plant-labeled results; fall back to top results if none match
  const plantResults = all.filter((r) => isPlantLabel(r.label));
  const candidates = plantResults.length > 0 ? plantResults : all;

  return candidates.slice(0, 3).map((r, i) => ({
    name: toKorean(r.label),
    scientificName: r.label,
    confidence: Math.round(r.score * 100),
    color: COLORS[i] ?? "#95d5b2",
  }));
}

// Korean translation via MyMemory free API
async function translateToKorean(text: string): Promise<string> {
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=en|ko`;
  const res = await fetch(url);
  const data = await res.json() as { responseData?: { translatedText?: string } };
  const translated = data.responseData?.translatedText ?? "";
  // MyMemory sometimes returns the same text if it can't translate
  if (!translated || translated.toLowerCase() === text.toLowerCase()) return text;
  return translated;
}

// ── Reverse geocode via OSM Nominatim ──────────────────────────────────────
async function reverseGeocode(lat: number, lng: number): Promise<string> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&accept-language=ko`,
      { headers: { "Accept-Language": "ko" } }
    );
    const data = await res.json();
    const addr = data.address ?? {};
    return (
      addr.road ?? addr.suburb ?? addr.neighbourhood ??
      addr.county ?? addr.city ?? data.display_name?.split(",")[0] ?? "위치 불명"
    );
  } catch {
    return `${lat.toFixed(4)}°N, ${lng.toFixed(4)}°E`;
  }
}

// ── Landing Screen ──────────────────────────────────────────────────────────
function LandingScreen({ onLogin, onSignup }: { onLogin: () => void; onSignup: () => void }) {
  return (
    <div className="flex flex-col min-h-screen bg-background">
      <div className="relative">
        <img
          src="https://images.unsplash.com/photo-1441974231531-c6227db76b6e?w=800&h=420&fit=crop&auto=format"
          alt="숲 풍경"
          className="w-full h-64 object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-black/10 to-background" />
        <div className="absolute top-0 left-0 right-0 px-6 pt-12 flex items-center gap-3">
          <div className="w-11 h-11 bg-primary rounded-2xl flex items-center justify-center shadow-lg">
            <Leaf size={22} className="text-primary-foreground" />
          </div>
          <div>
            <p className="text-white font-extrabold text-2xl leading-none tracking-tight drop-shadow-md" style={{ fontFamily: "Nunito, sans-serif" }}>
              Green Map-Z
            </p>
            <p className="text-white/70 text-xs drop-shadow" style={{ fontFamily: "DM Mono, monospace" }}>
              학교 식물 관찰 플랫폼
            </p>
          </div>
        </div>
      </div>

      <div className="flex-1 px-6 pt-5 pb-12 flex flex-col">
        <div className="mb-8">
          <h1 className="text-2xl font-extrabold text-foreground leading-snug mb-2" style={{ fontFamily: "Nunito, sans-serif" }}>
            우리 학교 식물을<br />함께 발견해요 🌿
          </h1>
          <p className="text-muted-foreground text-sm">사진 촬영 → AI 식물 판별 → 지도 기록</p>
        </div>

        <div className="flex gap-2 mb-10 flex-wrap">
          {[{ icon: Camera, label: "사진 + GPS" }, { icon: Leaf, label: "AI 식별" }, { icon: MapPin, label: "지도 핀" }].map(({ icon: Icon, label }) => (
            <div key={label} className="flex items-center gap-1.5 bg-secondary rounded-xl px-3 py-2">
              <Icon size={13} className="text-primary" />
              <span className="text-xs font-bold text-primary" style={{ fontFamily: "Nunito, sans-serif" }}>{label}</span>
            </div>
          ))}
        </div>

        <div className="mt-auto space-y-3">
          <button
            onClick={onLogin}
            className="w-full bg-primary text-primary-foreground rounded-2xl py-4 font-bold text-base shadow-md hover:bg-primary/90 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
            style={{ fontFamily: "Nunito, sans-serif" }}
          >
            <User size={18} />
            로그인
          </button>
          <button
            onClick={onSignup}
            className="w-full bg-card text-foreground rounded-2xl py-4 font-bold text-base border border-border shadow-sm hover:bg-secondary/50 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
            style={{ fontFamily: "Nunito, sans-serif" }}
          >
            <BookOpen size={18} className="text-primary" />
            회원가입
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Login Screen ─────────────────────────────────────────────────────────────
function LoginScreen({ onBack, onSuccess }: {
  onBack: () => void;
  onSuccess: (user: StoredUser, observations: PlantObservation[]) => void;
}) {
  const [userId, setUserId] = useState("");
  const [pw, setPw] = useState("");
  const [error, setError] = useState("");

  const handleLogin = () => {
    setError("");
    const users = loadUsers();
    const found = users.find((u) => u.userId === userId.trim());
    if (!found) { setError("존재하지 않는 아이디입니다."); return; }
    if (found.password !== pw) { setError("비밀번호가 올바르지 않습니다."); return; }
    saveCurrentUserId(found.userId);
    onSuccess(found, loadObservations());
  };

  return (
    <div className="flex flex-col min-h-screen bg-background">
      <div className="flex items-center gap-3 px-5 pt-12 pb-6">
        <button onClick={onBack} className="w-9 h-9 flex items-center justify-center rounded-xl hover:bg-muted transition-colors">
          <ArrowLeft size={20} className="text-foreground" />
        </button>
        <div>
          <h2 className="font-extrabold text-xl text-foreground" style={{ fontFamily: "Nunito, sans-serif" }}>로그인</h2>
          <p className="text-xs text-muted-foreground">Green Map-Z에 오신 것을 환영합니다</p>
        </div>
      </div>

      <div className="flex-1 px-5 pb-10">
        <div className="w-16 h-16 bg-primary rounded-3xl flex items-center justify-center shadow-lg mx-auto mb-8">
          <Leaf size={30} className="text-primary-foreground" />
        </div>

        <div className="space-y-4">
          <div>
            <label className="text-sm font-bold text-foreground block mb-1.5" style={{ fontFamily: "Nunito, sans-serif" }}>아이디</label>
            <input
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              placeholder="아이디를 입력하세요"
              autoCapitalize="none"
              className="w-full bg-input-background rounded-xl px-4 py-3.5 text-foreground placeholder:text-muted-foreground outline-none focus:ring-2 focus:ring-ring/40 border border-transparent focus:border-primary/30 transition-all"
            />
          </div>
          <div>
            <label className="text-sm font-bold text-foreground block mb-1.5" style={{ fontFamily: "Nunito, sans-serif" }}>비밀번호</label>
            <input
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              placeholder="비밀번호를 입력하세요"
              type="password"
              onKeyDown={(e) => e.key === "Enter" && handleLogin()}
              className="w-full bg-input-background rounded-xl px-4 py-3.5 text-foreground placeholder:text-muted-foreground outline-none focus:ring-2 focus:ring-ring/40 border border-transparent focus:border-primary/30 transition-all"
            />
          </div>

          {error && (
            <div className="flex items-center gap-2 bg-destructive/10 rounded-xl px-4 py-3">
              <AlertCircle size={15} className="text-destructive shrink-0" />
              <p className="text-sm text-destructive font-semibold">{error}</p>
            </div>
          )}

          <button
            onClick={handleLogin}
            disabled={!userId || !pw}
            className="w-full bg-primary text-primary-foreground rounded-2xl py-4 font-bold text-base shadow-md disabled:opacity-40 hover:bg-primary/90 active:scale-[0.98] transition-all mt-2"
            style={{ fontFamily: "Nunito, sans-serif" }}
          >
            로그인
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Sign Up Screen ──────────────────────────────────────────────────────────
function SignupScreen({ onBack, onComplete }: {
  onBack: () => void;
  onComplete: (user: StoredUser, observations: PlantObservation[]) => void;
}) {
  const [step, setStep] = useState<1 | 2>(1);
  const [role, setRole] = useState<Role>("student");
  const [form, setForm] = useState({ name: "", school: "", schoolKind: "" as SchoolKind, grade: "", class: "", email: "", userId: "", pw: "" });
  const [agreed, setAgreed] = useState(false);
  const [idError, setIdError] = useState("");
  const isStudent = role === "student";
  const maxGrade = form.schoolKind === "초등학교" ? 6 : 3;

  return (
    <div className="flex flex-col min-h-screen bg-background">
      <div className="flex items-center gap-3 px-5 pt-12 pb-4">
        <button onClick={step === 1 ? onBack : () => setStep(1)} className="w-9 h-9 flex items-center justify-center rounded-xl hover:bg-muted transition-colors">
          <ArrowLeft size={20} className="text-foreground" />
        </button>
        <div>
          <h2 className="font-extrabold text-xl text-foreground" style={{ fontFamily: "Nunito, sans-serif" }}>{isStudent ? "학생 회원가입" : "교사 회원가입"}</h2>
          <p className="text-xs text-muted-foreground">단계 {step} / 2</p>
        </div>
        <div className="ml-auto flex gap-1">
          {[1, 2].map((s) => <div key={s} className={`h-1.5 rounded-full transition-all ${s <= step ? "w-8 bg-primary" : "w-4 bg-border"}`} />)}
        </div>
      </div>

      <div className="flex-1 px-5 pb-10 overflow-y-auto">
        {step === 1 ? (
          <div className="space-y-5 mt-4">
            {/* Role selector */}
            <div>
              <label className="text-sm font-bold text-foreground block mb-2" style={{ fontFamily: "Nunito, sans-serif" }}>계정 유형</label>
              <div className="grid grid-cols-2 gap-2">
                {([["student", "학생", BookOpen], ["teacher", "교사", School]] as const).map(([r, label, Icon]) => (
                  <button key={r} onClick={() => setRole(r as Role)} className={`rounded-xl py-3 flex items-center justify-center gap-2 text-sm font-bold border transition-all ${role === r ? "bg-primary text-primary-foreground border-primary shadow-md" : "bg-card text-foreground border-border hover:border-primary/40"}`} style={{ fontFamily: "Nunito, sans-serif" }}>
                    <Icon size={15} />{label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-sm font-bold text-foreground block mb-1.5" style={{ fontFamily: "Nunito, sans-serif" }}>이름</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="홍길동" className="w-full bg-input-background rounded-xl px-4 py-3.5 text-foreground placeholder:text-muted-foreground outline-none focus:ring-2 focus:ring-ring/40 border border-transparent focus:border-primary/30 transition-all" />
            </div>
            <div>
              <label className="text-sm font-bold text-foreground block mb-1.5" style={{ fontFamily: "Nunito, sans-serif" }}>학교 이름</label>
              <input value={form.school} onChange={(e) => setForm({ ...form, school: e.target.value })} placeholder="예) 서울" className="w-full bg-input-background rounded-xl px-4 py-3.5 text-foreground placeholder:text-muted-foreground outline-none focus:ring-2 focus:ring-ring/40 border border-transparent focus:border-primary/30 transition-all" />
            </div>
            <div>
              <label className="text-sm font-bold text-foreground block mb-2" style={{ fontFamily: "Nunito, sans-serif" }}>학교 종류</label>
              <div className="grid grid-cols-3 gap-2">
                {(["초등학교", "중학교", "고등학교"] as SchoolKind[]).map((k) => (
                  <button key={k} onClick={() => setForm({ ...form, schoolKind: k, grade: "" })} className={`rounded-xl py-3 text-sm font-bold border transition-all ${form.schoolKind === k ? "bg-primary text-primary-foreground border-primary shadow-md" : "bg-card text-foreground border-border hover:border-primary/40"}`} style={{ fontFamily: "Nunito, sans-serif" }}>{k}</button>
                ))}
              </div>
            </div>
            {isStudent && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm font-bold text-foreground block mb-1.5" style={{ fontFamily: "Nunito, sans-serif" }}>학년</label>
                  <select value={form.grade} onChange={(e) => setForm({ ...form, grade: e.target.value })} disabled={!form.schoolKind} className="w-full bg-input-background rounded-xl px-4 py-3.5 text-foreground outline-none border border-transparent focus:ring-2 focus:ring-ring/40 transition-all appearance-none disabled:opacity-50">
                    <option value="">선택</option>
                    {Array.from({ length: maxGrade }, (_, i) => i + 1).map((g) => <option key={g}>{g}학년</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-sm font-bold text-foreground block mb-1.5" style={{ fontFamily: "Nunito, sans-serif" }}>반</label>
                  <input value={form.class} onChange={(e) => setForm({ ...form, class: e.target.value })} placeholder="예) 3" className="w-full bg-input-background rounded-xl px-4 py-3.5 text-foreground placeholder:text-muted-foreground outline-none focus:ring-2 focus:ring-ring/40 border border-transparent focus:border-primary/30 transition-all" />
                </div>
              </div>
            )}
            <button onClick={() => { if (form.name && form.school && form.schoolKind) setStep(2); }} disabled={!form.name || !form.school || !form.schoolKind} className="w-full bg-primary text-primary-foreground rounded-2xl py-4 font-bold text-base shadow-md disabled:opacity-40 hover:bg-primary/90 active:scale-[0.98] transition-all" style={{ fontFamily: "Nunito, sans-serif" }}>다음 단계</button>
          </div>
        ) : (
          <div className="space-y-4 mt-4">
            <div>
              <label className="text-sm font-bold text-foreground block mb-1.5" style={{ fontFamily: "Nunito, sans-serif" }}>이메일</label>
              <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="example@school.kr" type="email" className="w-full bg-input-background rounded-xl px-4 py-3.5 text-foreground placeholder:text-muted-foreground outline-none focus:ring-2 focus:ring-ring/40 border border-transparent focus:border-primary/30 transition-all" />
            </div>
            <div>
              <label className="text-sm font-bold text-foreground block mb-1.5" style={{ fontFamily: "Nunito, sans-serif" }}>아이디</label>
              <input
                value={form.userId}
                onChange={(e) => { setForm({ ...form, userId: e.target.value }); setIdError(""); }}
                placeholder="로그인에 사용할 아이디"
                autoCapitalize="none"
                className={`w-full bg-input-background rounded-xl px-4 py-3.5 text-foreground placeholder:text-muted-foreground outline-none focus:ring-2 focus:ring-ring/40 border transition-all ${idError ? "border-destructive/50" : "border-transparent focus:border-primary/30"}`}
              />
              {idError && (
                <div className="flex items-center gap-1.5 mt-1.5">
                  <AlertCircle size={12} className="text-destructive shrink-0" />
                  <p className="text-xs text-destructive">{idError}</p>
                </div>
              )}
            </div>
            <div>
              <label className="text-sm font-bold text-foreground block mb-1.5" style={{ fontFamily: "Nunito, sans-serif" }}>비밀번호</label>
              <input value={form.pw} onChange={(e) => setForm({ ...form, pw: e.target.value })} placeholder="8자 이상 입력" type="password" className="w-full bg-input-background rounded-xl px-4 py-3.5 text-foreground placeholder:text-muted-foreground outline-none focus:ring-2 focus:ring-ring/40 border border-transparent focus:border-primary/30 transition-all" />
            </div>
            <div className="bg-secondary/60 rounded-2xl p-4">
              <p className="text-sm font-bold text-foreground mb-2" style={{ fontFamily: "Nunito, sans-serif" }}>가입 정보 확인</p>
              <div className="space-y-1 text-xs text-muted-foreground" style={{ fontFamily: "DM Mono, monospace" }}>
                <div>이름: {form.name}</div>
                <div>아이디: {form.userId || "—"}</div>
                <div>학교: {form.school} {form.schoolKind}</div>
                {isStudent && <div>학년/반: {form.grade} {form.class}반</div>}
                <div>역할: {isStudent ? "학생" : "교사"}</div>
              </div>
            </div>
            <button onClick={() => setAgreed(!agreed)} className="flex items-center gap-3 w-full text-left">
              <div className={`w-6 h-6 rounded-lg flex items-center justify-center border-2 transition-all shrink-0 ${agreed ? "bg-primary border-primary" : "border-border bg-card"}`}>
                {agreed && <Check size={14} className="text-primary-foreground" />}
              </div>
              <span className="text-sm text-muted-foreground">개인정보 수집 및 이용에 동의합니다</span>
            </button>
            <button
              onClick={() => {
                setIdError("");
                if (!form.userId.trim()) { setIdError("아이디를 입력해주세요."); return; }
                const users = loadUsers();
                if (users.find((u) => u.userId === form.userId.trim())) {
                  setIdError("이미 사용 중인 아이디입니다."); return;
                }
                const newUser: StoredUser = {
                  userId: form.userId.trim(),
                  password: form.pw,
                  name: form.name,
                  email: form.email,
                  school: form.school,
                  schoolKind: form.schoolKind,
                  grade: form.grade,
                  class: form.class,
                  role,
                };
                saveUsers([...users, newUser]);
                saveCurrentUserId(newUser.userId);
                onComplete(newUser, loadObservations());
              }}
              disabled={!form.email || !form.userId || !form.pw || !agreed}
              className="w-full bg-primary text-primary-foreground rounded-2xl py-4 font-bold text-base shadow-md disabled:opacity-40 hover:bg-primary/90 active:scale-[0.98] transition-all"
              style={{ fontFamily: "Nunito, sans-serif" }}
            >
              가입 완료
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Home Screen ─────────────────────────────────────────────────────────────
function HomeScreen({ name, role, count, observations, onUpload, onMap, onMyRecords, onLogout }: {
  name: string; role: Role; count: number; observations: PlantObservation[];
  onUpload: () => void; onMap: () => void; onMyRecords: () => void; onLogout: () => void;
}) {
  const GOAL = 5;
  return (
    <div className="flex flex-col min-h-screen bg-background pb-24">
      <div className="px-5 pt-12 pb-4 flex items-center justify-between">
        <div>
          <p className="text-sm text-muted-foreground font-semibold" style={{ fontFamily: "Nunito, sans-serif" }}>안녕하세요 👋</p>
          <h1 className="text-2xl font-extrabold text-foreground" style={{ fontFamily: "Nunito, sans-serif" }}>{name}님</h1>
        </div>
        <div className="flex items-center gap-2">
          <div className="text-right">
            <p className="text-xs font-extrabold text-primary" style={{ fontFamily: "Nunito, sans-serif" }}>Green Map-Z</p>
            <p className="text-xs text-muted-foreground" style={{ fontFamily: "DM Mono, monospace" }}>{role === "student" ? "학생" : "교사"}</p>
          </div>
          <button onClick={onLogout} className="w-10 h-10 bg-primary rounded-2xl flex items-center justify-center shadow-md hover:bg-primary/80 active:scale-95 transition-all" title="로그아웃">
            <User size={18} className="text-primary-foreground" />
          </button>
        </div>
      </div>

      {/* Goal banner */}
      <div className="mx-5 mb-5 bg-primary rounded-3xl p-5 shadow-lg overflow-hidden relative">
        <img src="https://images.unsplash.com/photo-1518531933037-91b2f5f229cc?w=600&h=200&fit=crop&auto=format" alt="" className="absolute inset-0 w-full h-full object-cover opacity-20 mix-blend-luminosity" />
        <div className="relative">
          <p className="text-primary-foreground/80 text-sm font-semibold mb-1" style={{ fontFamily: "Nunito, sans-serif" }}>이번 주 목표</p>
          <p className="text-primary-foreground text-xl font-extrabold mb-3" style={{ fontFamily: "Nunito, sans-serif" }}>
            {count >= GOAL ? "목표 달성! 🎉" : `식물 ${GOAL}종 관찰하기 🌱`}
          </p>
          <div className="flex items-center gap-2 mb-3">
            <div className="flex-1 h-2.5 bg-white/20 rounded-full overflow-hidden">
              <div className="h-full bg-white rounded-full transition-all duration-700 ease-out" style={{ width: `${Math.min((count / GOAL) * 100, 100)}%` }} />
            </div>
            <span className="text-white text-xs font-bold" style={{ fontFamily: "DM Mono, monospace" }}>{count}/{GOAL}</span>
          </div>
          <div className="flex gap-1.5">
            {Array.from({ length: GOAL }).map((_, i) => (
              <div key={i} className="flex-1 h-1.5 rounded-full transition-all duration-500" style={{ background: i < count ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.25)", transitionDelay: `${i * 60}ms` }} />
            ))}
          </div>
        </div>
      </div>

      {/* Action grid */}
      <div className="px-5 grid grid-cols-2 gap-3 mb-5">
        <button onClick={onUpload} className="bg-card rounded-3xl p-5 border border-border shadow-sm text-left hover:shadow-md hover:border-primary/30 active:scale-[0.98] transition-all col-span-2">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 bg-primary rounded-2xl flex items-center justify-center shadow-md"><Camera size={26} className="text-primary-foreground" /></div>
            <div>
              <p className="font-extrabold text-lg text-foreground" style={{ fontFamily: "Nunito, sans-serif" }}>식물 촬영하기</p>
              <p className="text-sm text-muted-foreground">카메라 · GPS 자동 저장 · AI 식별</p>
            </div>
            <ChevronRight size={20} className="text-muted-foreground ml-auto" />
          </div>
        </button>
        <button onClick={onMap} className="bg-card rounded-3xl p-4 border border-border shadow-sm text-left hover:shadow-md hover:border-primary/30 active:scale-[0.98] transition-all">
          <div className="w-10 h-10 bg-secondary rounded-xl flex items-center justify-center mb-3"><MapPin size={18} className="text-primary" /></div>
          <p className="font-bold text-base text-foreground" style={{ fontFamily: "Nunito, sans-serif" }}>지도 보기</p>
          <p className="text-xs text-muted-foreground mt-0.5">{observations.length}개 관찰 기록</p>
        </button>
        <button onClick={onMyRecords} className="bg-card rounded-3xl p-4 border border-border shadow-sm text-left hover:shadow-md hover:border-primary/30 active:scale-[0.98] transition-all">
          <div className="w-10 h-10 bg-secondary rounded-xl flex items-center justify-center mb-3"><Star size={18} className="text-primary" /></div>
          <p className="font-bold text-base text-foreground" style={{ fontFamily: "Nunito, sans-serif" }}>내 기록</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            <span className="font-bold text-primary" style={{ fontFamily: "DM Mono, monospace" }}>{count}</span>종 관찰함
          </p>
        </button>
      </div>

      {/* Recent list */}
      {observations.length > 0 && (
        <div className="px-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-extrabold text-base text-foreground" style={{ fontFamily: "Nunito, sans-serif" }}>최근 관찰 기록</h3>
            <button onClick={onMap} className="text-xs text-primary font-bold" style={{ fontFamily: "Nunito, sans-serif" }}>지도에서 보기</button>
          </div>
          <div className="space-y-2">
            {[...observations].reverse().slice(0, 4).map((obs) => (
              <div key={obs.id} className="bg-card rounded-2xl p-3 flex items-center gap-3 border border-border shadow-sm">
                <img src={obs.imgDataUrl} alt={obs.name} className="w-12 h-12 rounded-xl object-cover bg-muted" />
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-sm text-foreground" style={{ fontFamily: "Nunito, sans-serif" }}>{PLANT_ICONS[obs.name] ?? "🌿"} {obs.name}</p>
                  <p className="text-xs text-muted-foreground truncate">{obs.address} · {obs.student}</p>
                </div>
                <div className="text-right shrink-0">
                  <span className="text-xs font-bold text-accent" style={{ fontFamily: "DM Mono, monospace" }}>{obs.confidence}%</span>
                  <p className="text-xs text-muted-foreground">{obs.date.slice(5)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Image compression (canvas resize to max 900px, JPEG 0.75) ───────────────
function compressImage(dataUrl: string): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const MAX = 900;
      let { width, height } = img;
      if (width > MAX || height > MAX) {
        if (width > height) { height = Math.round((height * MAX) / width); width = MAX; }
        else { width = Math.round((width * MAX) / height); height = MAX; }
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      canvas.getContext("2d")!.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL("image/jpeg", 0.75));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

// ── Upload Screen (real camera + GPS) ────────────────────────────────────────
function UploadScreen({ onBack, onResult }: {
  onBack: () => void;
  onResult: (capture: PendingCapture) => void;
}) {
  const [imgDataUrl, setImgDataUrl] = useState<string | null>(null);
  const [gps, setGps] = useState<{ lat: number; lng: number; address: string } | null>(null);
  const [gpsLoading, setGpsLoading] = useState(false);
  const [gpsError, setGpsError] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  // Ref keeps latest GPS value accessible inside setTimeout closures
  const gpsRef = useRef<{ lat: number; lng: number; address: string } | null>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const today = new Date().toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric" });

  const fetchGps = async () => {
    setGpsLoading(true);
    setGpsError(false);
    try {
      let lat: number, lng: number;
      if (Capacitor.isNativePlatform()) {
        // Native: use Capacitor Geolocation plugin
        const pos = await Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 12000 });
        lat = pos.coords.latitude;
        lng = pos.coords.longitude;
      } else {
        // Web fallback
        const pos = await new Promise<GeolocationPosition>((res, rej) =>
          navigator.geolocation.getCurrentPosition(res, rej, { enableHighAccuracy: true, timeout: 12000 })
        );
        lat = pos.coords.latitude;
        lng = pos.coords.longitude;
      }
      const address = await reverseGeocode(lat, lng);
      const value = { lat, lng, address };
      gpsRef.current = value;
      setGps(value);
    } catch {
      setGpsError(true);
    } finally {
      setGpsLoading(false);
    }
  };

  // Web file input handler (fallback when not native)
  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const raw = ev.target?.result as string;
      const compressed = await compressImage(raw);
      setImgDataUrl(compressed);
      fetchGps();
    };
    reader.readAsDataURL(file);
  };

  // Native camera via Capacitor Camera plugin
  const handleNativeCamera = async (source: CameraSource) => {
    try {
      const photo = await CapCamera.getPhoto({
        quality: 75,
        allowEditing: false,
        resultType: CameraResultType.DataUrl,
        source,
      });
      if (photo.dataUrl) {
        const compressed = await compressImage(photo.dataUrl);
        setImgDataUrl(compressed);
        fetchGps();
      }
    } catch (err: any) {
      // User cancelled — ignore
      if (!String(err).includes("cancelled") && !String(err).includes("cancel")) {
        console.error("Camera error:", err);
      }
    }
  };

  const handleAnalyze = () => {
    if (!imgDataUrl) return;
    setAnalyzing(true);
    const capturedImg = imgDataUrl;
    // Use ref to get the latest GPS even if it resolves after button press
    const g = gpsRef.current;
    onResult({
      imgDataUrl: capturedImg,
      lat: g?.lat ?? null,
      lng: g?.lng ?? null,
      address: g?.address ?? "위치 정보 없음",
      date: new Date().toISOString().slice(0, 10),
    });
  };

  return (
    <div className="flex flex-col min-h-screen bg-background">
      <div className="flex items-center gap-3 px-5 pt-12 pb-4">
        <button onClick={onBack} className="w-9 h-9 flex items-center justify-center rounded-xl hover:bg-muted transition-colors">
          <ArrowLeft size={20} className="text-foreground" />
        </button>
        <h2 className="font-extrabold text-xl text-foreground" style={{ fontFamily: "Nunito, sans-serif" }}>식물 촬영</h2>
      </div>

      {/* GPS status card */}
      <div className="mx-5 mb-4">
        <div className="bg-card rounded-3xl p-4 border border-border shadow-sm space-y-2">
          <div className="flex items-center gap-2 text-sm">
            <MapPin size={14} className={`shrink-0 ${gps ? "text-primary" : gpsLoading ? "text-muted-foreground animate-pulse" : "text-muted-foreground"}`} />
            <span className="text-muted-foreground">위치</span>
            <span className="font-semibold text-foreground ml-auto text-sm truncate max-w-[200px]">
              {gpsLoading ? "위치 가져오는 중..." : gps ? gps.address : gpsError ? "위치 권한 필요" : "사진 촬영 시 자동 저장"}
            </span>
          </div>
          {gps && (
            <div className="flex items-center gap-2 text-xs">
              <div className="w-3.5 h-3.5 shrink-0" />
              <span className="text-muted-foreground font-mono" style={{ fontFamily: "DM Mono, monospace" }}>
                {gps.lat.toFixed(5)}°N, {gps.lng.toFixed(5)}°E
              </span>
            </div>
          )}
          {gpsError && (
            <div className="flex items-center gap-2 text-xs text-destructive">
              <AlertCircle size={12} className="shrink-0" />
              <span>위치 권한을 허용해 주세요. 사진은 저장 가능합니다.</span>
            </div>
          )}
          <div className="flex items-center gap-2 text-sm">
            <div className="w-3.5 h-3.5 rounded border-2 border-primary shrink-0" />
            <span className="text-muted-foreground">날짜</span>
            <span className="font-semibold text-foreground ml-auto text-sm">{today}</span>
          </div>
        </div>
      </div>

      <div className="mx-5 flex-1">
        {/* Web fallback inputs (hidden on native) */}
        {!Capacitor.isNativePlatform() && (
          <>
            <input ref={cameraInputRef}  type="file" accept="image/*" capture="environment" className="hidden" onChange={handleFile} />
            <input ref={galleryInputRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
          </>
        )}

        {!imgDataUrl && !analyzing && (
          <div className="space-y-3">
            <button
              onClick={() => Capacitor.isNativePlatform()
                ? handleNativeCamera(CameraSource.Camera)
                : cameraInputRef.current?.click()}
              className="w-full rounded-3xl border-2 border-dashed border-primary/40 bg-secondary/30 h-64 flex flex-col items-center justify-center gap-4 hover:bg-secondary/50 transition-colors"
            >
              <div className="w-20 h-20 bg-primary rounded-3xl flex items-center justify-center shadow-lg">
                <Camera size={36} className="text-primary-foreground" />
              </div>
              <div className="text-center">
                <p className="font-extrabold text-lg text-foreground" style={{ fontFamily: "Nunito, sans-serif" }}>카메라로 촬영</p>
                <p className="text-sm text-muted-foreground">탭하면 카메라가 열립니다</p>
              </div>
            </button>
            <button
              onClick={() => Capacitor.isNativePlatform()
                ? handleNativeCamera(CameraSource.Photos)
                : galleryInputRef.current?.click()}
              className="w-full bg-card border border-border rounded-2xl py-3.5 font-bold text-sm text-muted-foreground flex items-center justify-center gap-2 hover:border-primary/30 transition-all"
              style={{ fontFamily: "Nunito, sans-serif" }}
            >
              <ImageOff size={16} />
              갤러리에서 선택
            </button>
          </div>
        )}

        {imgDataUrl && !analyzing && (
          <div className="space-y-4">
            <div className="relative rounded-3xl overflow-hidden">
              <img src={imgDataUrl} alt="촬영된 식물" className="w-full h-72 object-cover" />
              <button
                onClick={() => { setImgDataUrl(null); setGps(null); gpsRef.current = null; setGpsError(false); }}
                className="absolute top-3 right-3 w-9 h-9 bg-black/50 rounded-xl flex items-center justify-center backdrop-blur-sm"
              >
                <X size={16} className="text-white" />
              </button>
              {gps && (
                <div className="absolute bottom-3 left-3 bg-black/60 rounded-xl px-3 py-1.5 backdrop-blur-sm">
                  <span className="text-white text-xs" style={{ fontFamily: "DM Mono, monospace" }}>{gps.lat.toFixed(4)}, {gps.lng.toFixed(4)}</span>
                </div>
              )}
              {gpsLoading && (
                <div className="absolute bottom-3 left-3 bg-black/60 rounded-xl px-3 py-1.5 backdrop-blur-sm flex items-center gap-2">
                  <div className="w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                  <span className="text-white text-xs">GPS 수신 중...</span>
                </div>
              )}
            </div>
            <button onClick={handleAnalyze} className="w-full bg-primary text-primary-foreground rounded-2xl py-4 font-bold text-base shadow-md hover:bg-primary/90 active:scale-[0.98] transition-all flex items-center justify-center gap-2" style={{ fontFamily: "Nunito, sans-serif" }}>
              <Leaf size={18} />AI로 식물 판별하기
            </button>
          </div>
        )}

        {analyzing && (
          <div className="rounded-3xl bg-card border border-border p-8 flex flex-col items-center gap-5 shadow-sm">
            <div className="relative w-24 h-24">
              <div className="w-24 h-24 rounded-full border-4 border-secondary animate-spin border-t-primary" />
              <div className="absolute inset-0 flex items-center justify-center"><Leaf size={28} className="text-primary" /></div>
            </div>
            <div className="text-center">
              <p className="font-extrabold text-xl text-foreground mb-1" style={{ fontFamily: "Nunito, sans-serif" }}>AI 분석 중...</p>
              <p className="text-sm text-muted-foreground">식물 종류를 파악하고 있어요</p>
            </div>
            <div className="flex gap-1.5">
              {[0, 1, 2].map((i) => <div key={i} className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />)}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── AI Result Screen ─────────────────────────────────────────────────────────
function ResultScreen({ capture, userName, userId, onBack, onSave }: {
  capture: PendingCapture;
  userName: string;
  userId: string;
  onBack: () => void;
  onSave: (obs: PlantObservation) => void;
}) {
  const [loading, setLoading] = useState(true);
  const [aiResults, setAiResults] = useState<AiResult[] | null>(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [translations, setTranslations] = useState<Record<string, string>>({});

  const handleTranslate = async () => {
    if (!aiResults) return;
    setTranslating(true);
    const map: Record<string, string> = {};
    for (const r of aiResults) {
      if (!toKorean(r.scientificName) || toKorean(r.scientificName) === r.scientificName) {
        map[r.scientificName] = await translateToKorean(r.scientificName).catch(() => r.scientificName);
      }
    }
    setTranslations(map);
    setTranslating(false);
  };

  const runIdentification = async () => {
    setLoading(true);
    setError("");
    setAiResults(null);
    try {
      const results = await identifyPlant(capture.imgDataUrl);
      setAiResults(results);
    } catch (e: any) {
      setError(e.message ?? "알 수 없는 오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { runIdentification(); }, []);

  const top = aiResults?.[0];

  const handleSave = () => {
    if (!top) return;
    const obs: PlantObservation = {
      id: Date.now().toString(),
      name: top.name,
      confidence: top.confidence,
      date: capture.date,
      lat: capture.lat ?? 0,
      lng: capture.lng ?? 0,
      imgDataUrl: capture.imgDataUrl,
      student: userName,
      userId,
      address: capture.address,
    };
    setSaved(true);
    onSave(obs);
  };

  return (
    <div className="flex flex-col min-h-screen bg-background pb-10">
      <div className="flex items-center gap-3 px-5 pt-12 pb-4">
        <button onClick={onBack} className="w-9 h-9 flex items-center justify-center rounded-xl hover:bg-muted transition-colors">
          <ArrowLeft size={20} className="text-foreground" />
        </button>
        <h2 className="font-extrabold text-xl text-foreground" style={{ fontFamily: "Nunito, sans-serif" }}>AI 판별 결과</h2>
      </div>

      {/* Photo */}
      <div className="mx-5 mb-4 rounded-3xl overflow-hidden relative">
        <img src={capture.imgDataUrl} alt="촬영된 식물" className="w-full h-52 object-cover bg-muted" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
        {top && (
          <div className="absolute bottom-4 left-4 right-4 flex items-end justify-between">
            <div>
              <p className="text-white/70 text-xs mb-1">가장 유력한 식물</p>
              <p className="text-white font-extrabold text-2xl" style={{ fontFamily: "Nunito, sans-serif" }}>
                {defaultIcon(top.name)} {top.name}
              </p>
              <p className="text-white/60 text-xs italic">{top.scientificName}</p>
            </div>
            <div className="bg-primary rounded-2xl px-4 py-2 text-center shadow-lg">
              <p className="text-primary-foreground/80 text-xs" style={{ fontFamily: "DM Mono, monospace" }}>신뢰도</p>
              <p className="text-primary-foreground font-extrabold text-2xl" style={{ fontFamily: "DM Mono, monospace" }}>{top.confidence}%</p>
            </div>
          </div>
        )}
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40 backdrop-blur-sm">
            <div className="w-12 h-12 border-4 border-white/30 border-t-white rounded-full animate-spin" />
          </div>
        )}
      </div>

      {/* Loading state */}
      {loading && (
        <div className="mx-5 bg-card rounded-3xl p-8 border border-border shadow-sm flex flex-col items-center gap-4">
          <div className="relative w-20 h-20">
            <div className="w-20 h-20 rounded-full border-4 border-secondary animate-spin border-t-primary" />
            <div className="absolute inset-0 flex items-center justify-center"><Leaf size={24} className="text-primary" /></div>
          </div>
          <div className="text-center">
            <p className="font-extrabold text-lg text-foreground mb-1" style={{ fontFamily: "Nunito, sans-serif" }}>AI 분석 중...</p>
            <p className="text-sm text-muted-foreground">식물 종류를 파악하고 있어요</p>
            <p className="text-xs text-muted-foreground mt-1 opacity-60">처음 실행 시 AI 모델 다운로드로 30~60초 소요돼요</p>
          </div>
          <div className="flex gap-1.5">
            {[0, 1, 2].map((i) => <div key={i} className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />)}
          </div>
        </div>
      )}

      {/* Error */}
      {error && !loading && (
        <div className="mx-5 space-y-3">
          <div className="bg-destructive/10 rounded-2xl p-4 flex items-start gap-3">
            <AlertCircle size={18} className="text-destructive shrink-0 mt-0.5" />
            <div>
              <p className="font-bold text-sm text-destructive mb-1">판별 실패</p>
              <p className="text-xs text-destructive/80">{error}</p>
            </div>
          </div>
          <button
            onClick={runIdentification}
            className="w-full bg-primary text-primary-foreground rounded-2xl py-3.5 font-bold text-sm hover:bg-primary/90 active:scale-[0.98] transition-all"
            style={{ fontFamily: "Nunito, sans-serif" }}
          >
            다시 시도
          </button>
        </div>
      )}

      {/* Results */}
      {aiResults && !loading && (
        <>
          <div className="mx-5 bg-card rounded-3xl p-5 border border-border shadow-sm mb-4">
            <div className="flex items-center justify-between mb-4">
              <p className="font-bold text-xs text-muted-foreground uppercase tracking-widest" style={{ fontFamily: "DM Mono, monospace" }}>AI 예측 결과</p>
              <button
                onClick={handleTranslate}
                disabled={translating}
                className="flex items-center gap-1.5 bg-secondary text-secondary-foreground rounded-xl px-3 py-1.5 text-xs font-bold hover:bg-secondary/80 active:scale-95 transition-all disabled:opacity-50"
                style={{ fontFamily: "Nunito, sans-serif" }}
              >
                {translating ? (
                  <><div className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />번역 중...</>
                ) : (
                  <><span>🌐</span> 한국어 번역</>
                )}
              </button>
            </div>
            <div className="space-y-4">
              {aiResults.map((r, i) => {
                const displayName = translations[r.scientificName] ?? r.name;
                return (
                  <div key={r.scientificName + i}>
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2 min-w-0">
                        {i === 0 && <div className="w-5 h-5 bg-primary rounded-md flex items-center justify-center shrink-0"><Check size={11} className="text-white" /></div>}
                        <div className="min-w-0">
                          <p className={`font-bold text-sm truncate ${i === 0 ? "text-foreground" : "text-muted-foreground"}`} style={{ fontFamily: "Nunito, sans-serif" }}>
                            {defaultIcon(displayName)} {displayName}
                          </p>
                          <p className="text-xs text-muted-foreground/60 italic truncate">{r.scientificName}</p>
                        </div>
                      </div>
                      <span className="font-bold text-sm shrink-0 ml-2" style={{ fontFamily: "DM Mono, monospace", color: r.color }}>{r.confidence}%</span>
                    </div>
                    <div className="h-2 bg-muted rounded-full overflow-hidden mt-1.5">
                      <div className="h-full rounded-full transition-all duration-700" style={{ width: `${r.confidence}%`, background: r.color }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="mx-5 bg-secondary/50 rounded-3xl p-4 border border-primary/10 mb-4">
            <p className="font-bold text-sm text-foreground mb-2" style={{ fontFamily: "Nunito, sans-serif" }}>📍 관찰 정보</p>
            <div className="grid grid-cols-2 gap-y-2 text-xs" style={{ fontFamily: "DM Mono, monospace" }}>
              <span className="text-muted-foreground">장소</span><span className="text-foreground">{capture.address}</span>
              {capture.lat !== null && <><span className="text-muted-foreground">좌표</span><span className="text-foreground">{capture.lat?.toFixed(4)}°N</span></>}
              <span className="text-muted-foreground">날짜</span><span className="text-foreground">{capture.date}</span>
              <span className="text-muted-foreground">관찰자</span><span className="text-foreground">{userName}</span>
            </div>
          </div>

          <div className="mx-5 mt-auto">
            <button
              onClick={handleSave}
              disabled={saved}
              className={`w-full rounded-2xl py-4 font-bold text-base shadow-md active:scale-[0.98] transition-all flex items-center justify-center gap-2 ${saved ? "bg-accent text-white" : "bg-primary text-primary-foreground hover:bg-primary/90"}`}
              style={{ fontFamily: "Nunito, sans-serif" }}
            >
              {saved ? <><Check size={18} />저장 완료! 지도에 추가됩니다</> : <><MapPin size={18} />지도에 저장하기</>}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ── My Records Screen ────────────────────────────────────────────────────────
function MyRecordsScreen({ observations, userId, userName, onBack }: {
  observations: PlantObservation[];
  userId: string;
  userName: string;
  onBack: () => void;
}) {
  const [selected, setSelected] = useState<PlantObservation | null>(null);
  const mine = [...observations].filter((o) => o.userId === userId).reverse();

  if (selected) {
    return (
      <div className="flex flex-col min-h-screen bg-background">
        <div className="flex items-center gap-3 px-5 pt-12 pb-4">
          <button onClick={() => setSelected(null)} className="w-9 h-9 flex items-center justify-center rounded-xl hover:bg-muted transition-colors">
            <ArrowLeft size={20} className="text-foreground" />
          </button>
          <h2 className="font-extrabold text-xl text-foreground" style={{ fontFamily: "Nunito, sans-serif" }}>관찰 상세</h2>
        </div>
        <div className="mx-5 rounded-3xl overflow-hidden mb-4 relative">
          <img src={selected.imgDataUrl} alt={selected.name} className="w-full h-64 object-cover bg-muted" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent" />
          <div className="absolute bottom-4 left-4">
            <p className="text-white font-extrabold text-2xl" style={{ fontFamily: "Nunito, sans-serif" }}>
              {PLANT_ICONS[selected.name] ?? "🌿"} {selected.name}
            </p>
          </div>
          <div className="absolute bottom-4 right-4 bg-primary rounded-2xl px-3 py-1.5">
            <p className="text-primary-foreground font-bold text-lg" style={{ fontFamily: "DM Mono, monospace" }}>{selected.confidence}%</p>
          </div>
        </div>
        <div className="mx-5 bg-card rounded-3xl p-5 border border-border shadow-sm">
          <p className="font-bold text-xs text-muted-foreground mb-4 uppercase tracking-widest" style={{ fontFamily: "DM Mono, monospace" }}>관찰 정보</p>
          <div className="grid grid-cols-2 gap-y-4 text-sm">
            {[
              { label: "식물명", value: selected.name },
              { label: "신뢰도", value: `${selected.confidence}%` },
              { label: "날짜", value: selected.date },
              { label: "관찰자", value: selected.student },
              { label: "장소", value: selected.address },
              ...(selected.lat ? [{ label: "위도", value: `${selected.lat.toFixed(5)}°N` }] : []),
              ...(selected.lng ? [{ label: "경도", value: `${selected.lng.toFixed(5)}°E` }] : []),
            ].map(({ label, value }) => (
              <div key={label}>
                <p className="text-xs text-muted-foreground mb-0.5" style={{ fontFamily: "DM Mono, monospace" }}>{label}</p>
                <p className="font-bold text-foreground text-sm" style={{ fontFamily: "Nunito, sans-serif" }}>{value}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen bg-background pb-10">
      <div className="flex items-center gap-3 px-5 pt-12 pb-4">
        <button onClick={onBack} className="w-9 h-9 flex items-center justify-center rounded-xl hover:bg-muted transition-colors">
          <ArrowLeft size={20} className="text-foreground" />
        </button>
        <h2 className="font-extrabold text-xl text-foreground" style={{ fontFamily: "Nunito, sans-serif" }}>내 기록</h2>
        <div className="ml-auto bg-secondary text-primary text-xs font-bold px-3 py-1.5 rounded-xl" style={{ fontFamily: "DM Mono, monospace" }}>
          {mine.length}개
        </div>
      </div>

      {mine.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 px-10 text-center">
          <div className="w-20 h-20 bg-secondary rounded-3xl flex items-center justify-center">
            <Camera size={32} className="text-primary" />
          </div>
          <p className="font-extrabold text-xl text-foreground" style={{ fontFamily: "Nunito, sans-serif" }}>아직 관찰 기록이 없어요</p>
          <p className="text-sm text-muted-foreground">식물 촬영하기 버튼을 눌러<br />첫 번째 식물을 발견해보세요!</p>
        </div>
      ) : (
        <div className="px-5 space-y-3">
          {mine.map((obs) => (
            <button key={obs.id} onClick={() => setSelected(obs)} className="w-full bg-card rounded-3xl p-4 flex gap-4 items-center border border-border shadow-sm hover:border-primary/30 hover:shadow-md active:scale-[0.98] transition-all text-left">
              <img src={obs.imgDataUrl} alt={obs.name} className="w-20 h-20 rounded-2xl object-cover bg-muted shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-lg">{PLANT_ICONS[obs.name] ?? "🌿"}</span>
                  <p className="font-extrabold text-base text-foreground" style={{ fontFamily: "Nunito, sans-serif" }}>{obs.name}</p>
                  <span className="ml-auto font-bold text-sm text-accent shrink-0" style={{ fontFamily: "DM Mono, monospace" }}>{obs.confidence}%</span>
                </div>
                <div className="flex items-center gap-1 text-xs text-muted-foreground mb-1">
                  <MapPin size={11} className="shrink-0" />
                  <span className="truncate">{obs.address}</span>
                </div>
                <p className="text-xs text-muted-foreground" style={{ fontFamily: "DM Mono, monospace" }}>{obs.date}</p>
              </div>
              <ChevronRight size={16} className="text-muted-foreground shrink-0" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Map Screen (vanilla Leaflet) ─────────────────────────────────────────────
function LeafletMap({ observations, selected, onSelect }: {
  observations: PlantObservation[];
  selected: PlantObservation | null;
  onSelect: (obs: PlantObservation) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersRef = useRef<L.Marker[]>([]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    // Find a valid center from observations; fall back to Seoul
    const validObs = observations.filter((o) => o.lat || o.lng);
    const last = validObs[validObs.length - 1];
    const defaultCenter: [number, number] = last
      ? [last.lat, last.lng]
      : [37.5664, 126.9779];

    const map = L.map(containerRef.current, {
      center: defaultCenter,
      zoom: 16,
      zoomControl: true,
      attributionControl: false,
    });
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(map);
    mapRef.current = map;

    // Force size recalculation after the container is fully painted
    requestAnimationFrame(() => { map.invalidateSize(); });

    return () => { map.remove(); mapRef.current = null; markersRef.current = []; };
  }, []);

  // Re-render markers whenever observations change
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    observations.forEach((obs) => {
      if (!obs.lat && !obs.lng) return;
      const icon = L.divIcon({
        html: `<div style="font-size:26px;line-height:1;filter:drop-shadow(0 2px 5px rgba(0,0,0,0.4));cursor:pointer">${PLANT_ICONS[obs.name] ?? "🌿"}</div>`,
        className: "",
        iconSize: [34, 34],
        iconAnchor: [17, 30],
        popupAnchor: [0, -30],
      });
      const marker = L.marker([obs.lat, obs.lng], { icon }).addTo(map);
      marker.bindPopup(`
        <div style="font-family:Nunito,sans-serif;min-width:130px;padding:2px 0">
          <strong style="font-size:14px">${PLANT_ICONS[obs.name] ?? "🌿"} ${obs.name}</strong><br/>
          <span style="font-size:11px;color:#5a7a5a">${obs.address}</span><br/>
          <span style="font-size:11px;color:#5a7a5a">${obs.confidence}% · ${obs.student}</span>
        </div>`);
      marker.on("click", () => onSelect(obs));
      markersRef.current.push(marker);
    });
  }, [observations]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selected || (!selected.lat && !selected.lng)) return;
    map.flyTo([selected.lat, selected.lng], 17, { duration: 0.8 });
  }, [selected]);

  return <div ref={containerRef} style={{ width: "100%", height: "100%" }} />;
}

function MapScreen({ observations, onBack }: { observations: PlantObservation[]; onBack: () => void }) {
  const [selected, setSelected] = useState<PlantObservation | null>(null);

  return (
    <div className="flex flex-col min-h-screen bg-background">
      <div className="flex items-center gap-3 px-5 pt-12 pb-3 shrink-0">
        <button onClick={onBack} className="w-9 h-9 flex items-center justify-center rounded-xl hover:bg-muted transition-colors">
          <ArrowLeft size={20} className="text-foreground" />
        </button>
        <h2 className="font-extrabold text-xl text-foreground" style={{ fontFamily: "Nunito, sans-serif" }}>관찰 지도</h2>
        <div className="ml-auto bg-secondary text-primary text-xs font-bold px-3 py-1.5 rounded-xl" style={{ fontFamily: "DM Mono, monospace" }}>
          {observations.length}개 관찰
        </div>
      </div>

      <div className="mx-5 mb-3 rounded-3xl overflow-hidden border border-border shadow-md" style={{ height: 340 }}>
        <LeafletMap observations={observations} selected={selected} onSelect={setSelected} />
      </div>

      {observations.length === 0 ? (
        <div className="mx-5 bg-card rounded-3xl p-6 border border-border shadow-sm flex flex-col items-center gap-3 text-center">
          <MapPin size={28} className="text-muted-foreground" />
          <p className="font-bold text-base text-foreground" style={{ fontFamily: "Nunito, sans-serif" }}>아직 관찰 기록이 없어요</p>
          <p className="text-sm text-muted-foreground">식물을 촬영하면 지도에 핀이 표시됩니다</p>
        </div>
      ) : selected ? (
        <div className="mx-5 bg-card rounded-3xl p-4 border border-primary/20 shadow-md flex gap-4 items-start">
          <img src={selected.imgDataUrl} alt={selected.name} className="w-16 h-16 rounded-2xl object-cover bg-muted shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xl">{PLANT_ICONS[selected.name] ?? "🌿"}</span>
              <p className="font-extrabold text-lg text-foreground" style={{ fontFamily: "Nunito, sans-serif" }}>{selected.name}</p>
              <span className="ml-auto font-bold text-accent text-sm" style={{ fontFamily: "DM Mono, monospace" }}>{selected.confidence}%</span>
            </div>
            <p className="text-xs text-muted-foreground">{selected.address}</p>
            <p className="text-xs text-muted-foreground">{selected.date} · {selected.student}</p>
          </div>
          <button onClick={() => setSelected(null)} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-muted">
            <X size={14} className="text-muted-foreground" />
          </button>
        </div>
      ) : (
        <div className="mx-5">
          <p className="text-sm font-bold text-muted-foreground mb-2" style={{ fontFamily: "Nunito, sans-serif" }}>핀을 탭하거나 목록에서 선택하세요</p>
          <div className="grid grid-cols-5 gap-2">
            {[...observations].reverse().slice(0, 5).map((obs) => (
              <button key={obs.id} onClick={() => setSelected(obs)} className="bg-card rounded-2xl p-2 border border-border flex flex-col items-center gap-1 hover:border-primary/30 transition-colors">
                <img src={obs.imgDataUrl} alt={obs.name} className="w-10 h-10 rounded-xl object-cover bg-muted" />
                <span className="text-xs font-bold text-foreground text-center leading-tight" style={{ fontFamily: "Nunito, sans-serif" }}>{obs.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Root App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [screen, setScreen] = useState<Screen>("landing");
  const [currentUser, setCurrentUser] = useState<StoredUser | null>(null);
  const [observations, setObservations] = useState<PlantObservation[]>([]);
  const [pendingCapture, setPendingCapture] = useState<PendingCapture | null>(null);

  // Restore session on mount
  useEffect(() => {
    const uid = loadCurrentUserId();
    if (!uid) return;
    const users = loadUsers();
    const user = users.find((u) => u.userId === uid);
    if (user) { setCurrentUser(user); setObservations(loadObservations()); setScreen("home"); }
  }, []);

  const myCount = observations.filter((o) => o.userId === currentUser?.userId).length;

  const handleLoginSuccess = (user: StoredUser, obs: PlantObservation[]) => {
    setCurrentUser(user);
    setObservations(obs);
    setScreen("home");
  };

  const addObservation = (obs: PlantObservation) => {
    setObservations((prev) => {
      const next = [...prev, obs];
      saveObservations(next);
      return next;
    });
    setTimeout(() => setScreen("home"), 1200);
  };

  const handleLogout = () => {
    saveCurrentUserId(null);
    setCurrentUser(null);
    setObservations([]);
    setScreen("landing");
  };

  return (
    <div className="min-h-screen bg-background" style={{ fontFamily: "Nunito, sans-serif", maxWidth: 480, margin: "0 auto" }}>
      {screen === "landing" && (
        <LandingScreen
          onLogin={() => setScreen("login")}
          onSignup={() => setScreen("signup")}
        />
      )}
      {screen === "login" && (
        <LoginScreen onBack={() => setScreen("landing")} onSuccess={handleLoginSuccess} />
      )}
      {screen === "signup" && (
        <SignupScreen onBack={() => setScreen("landing")} onComplete={handleLoginSuccess} />
      )}
      {screen === "home" && currentUser && (
        <HomeScreen
          name={currentUser.name}
          role={currentUser.role}
          count={Math.min(myCount, 5)}
          observations={observations}
          onUpload={() => setScreen("upload")}
          onMap={() => setScreen("map")}
          onMyRecords={() => setScreen("myrecords")}
          onLogout={handleLogout}
        />
      )}
      {screen === "upload" && (
        <UploadScreen onBack={() => setScreen("home")} onResult={(capture) => { setPendingCapture(capture); setScreen("result"); }} />
      )}
      {screen === "result" && pendingCapture && currentUser && (
        <ResultScreen
          capture={pendingCapture}
          userName={currentUser.name}
          userId={currentUser.userId}
          onBack={() => setScreen("upload")}
          onSave={addObservation}
        />
      )}
      {screen === "map" && (
        <MapScreen observations={observations} onBack={() => setScreen("home")} />
      )}
      {screen === "myrecords" && currentUser && (
        <MyRecordsScreen observations={observations} userId={currentUser.userId} userName={currentUser.name} onBack={() => setScreen("home")} />
      )}
    </div>
  );
}
