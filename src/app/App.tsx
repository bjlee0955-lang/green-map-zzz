import { useState, useEffect, useRef } from "react";
import {
  Camera, MapPin, Leaf, User, ChevronRight, Check, X,
  ArrowLeft, School, BookOpen, Star, AlertCircle, ImageOff,
  Home, Settings, Volume2, VolumeX, Moon, Sun, LogOut,
} from "lucide-react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Capacitor } from "@capacitor/core";
import { Camera as CapCamera, CameraResultType, CameraSource } from "@capacitor/camera";
import { Geolocation } from "@capacitor/geolocation";
import { supabase, isSupabaseConfigured } from "../lib/supabaseClient";
import { signInWithGoogle } from "../lib/googleAuth";
import { fetchProfile, upsertProfile, type RemoteProfile } from "../lib/profiles";

type Screen = "landing" | "login" | "signup" | "googleProfile" | "home" | "upload" | "result" | "map" | "myrecords" | "settings";
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
  isGuest?: boolean;
  authProvider?: "google";
}

function storedUserToRemoteProfile(u: StoredUser): RemoteProfile {
  return {
    id: u.userId,
    name: u.name,
    role: u.role,
    school: u.school,
    school_kind: u.schoolKind,
    grade: u.grade,
    class: u.class,
  };
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

// ── Supabase(Google) 로그인 사용자 → 기존 로컬 사용자 모델 매핑 ────────────────
function googleSessionUserToStoredUser(u: { id: string; email?: string | null; user_metadata?: Record<string, any> }): StoredUser {
  const meta = u.user_metadata ?? {};
  return {
    userId: u.id,
    password: "",
    name: meta.full_name || meta.name || (u.email ? u.email.split("@")[0] : "사용자"),
    email: u.email ?? "",
    school: "",
    schoolKind: "",
    grade: "",
    class: "",
    role: "student",
    authProvider: "google",
  };
}
function remoteProfileToStoredUser(p: RemoteProfile, fallbackEmail: string): StoredUser {
  return {
    userId: p.id,
    password: "",
    name: p.name,
    email: fallbackEmail,
    school: p.school,
    schoolKind: p.school_kind,
    grade: p.grade,
    class: p.class,
    role: p.role,
    authProvider: "google",
  };
}
// 기존 로컬 목록에 있으면 학교/학년 등 저장된 정보를 유지하면서 이름/이메일만 최신화
function upsertGoogleUser(googleUser: StoredUser): StoredUser {
  const users = loadUsers();
  const idx = users.findIndex((u) => u.userId === googleUser.userId);
  const merged: StoredUser = idx >= 0
    ? { ...users[idx], name: googleUser.name, email: googleUser.email }
    : googleUser;
  if (idx >= 0) users[idx] = merged; else users.push(merged);
  saveUsers(users);
  return merged;
}

// ── Guest (비회원) session ───────────────────────────────────────────────────
function createGuestUser(): StoredUser {
  return {
    userId: `guest_${Date.now()}`,
    password: "",
    name: "Guest",
    email: "",
    school: "",
    schoolKind: "",
    grade: "",
    class: "",
    role: "student",
    isGuest: true,
  };
}

// ── Settings (dark mode / sound) ────────────────────────────────────────────
const LS_DARK  = "gmz_dark_mode";
const LS_SOUND = "gmz_sound_enabled";
function loadDarkMode(): boolean {
  return localStorage.getItem(LS_DARK) === "1";
}
function saveDarkMode(v: boolean) {
  localStorage.setItem(LS_DARK, v ? "1" : "0");
}
function loadSoundEnabled(): boolean {
  const v = localStorage.getItem(LS_SOUND);
  return v === null ? true : v === "1";
}
function saveSoundEnabled(v: boolean) {
  localStorage.setItem(LS_SOUND, v ? "1" : "0");
}

// ── Sound effects (synthesized via Web Audio API — no external audio files) ─
let sharedAudioCtx: AudioContext | null = null;
function getAudioCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!sharedAudioCtx) {
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return null;
    sharedAudioCtx = new Ctx();
  }
  if (sharedAudioCtx.state === "suspended") sharedAudioCtx.resume();
  return sharedAudioCtx;
}

function playTone(freq: number, startTime: number, duration: number, ctx: AudioContext, type: OscillatorType = "sine", gainPeak = 0.18) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, startTime);
  gain.gain.setValueAtTime(0.0001, startTime);
  gain.gain.exponentialRampToValueAtTime(gainPeak, startTime + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(startTime);
  osc.stop(startTime + duration + 0.02);
}

// 게이지가 차오를 때: 짧고 가벼운 상승 '틱' 소리
function playGaugeFillSound() {
  if (!loadSoundEnabled()) return;
  const ctx = getAudioCtx();
  if (!ctx) return;
  const t = ctx.currentTime;
  playTone(660, t, 0.12, ctx, "sine", 0.15);
  playTone(880, t + 0.06, 0.14, ctx, "sine", 0.12);
}

// 퀘스트(목표)를 다 채웠을 때: 밝은 3음 팡파레
function playQuestCompleteSound() {
  if (!loadSoundEnabled()) return;
  const ctx = getAudioCtx();
  if (!ctx) return;
  const t = ctx.currentTime;
  playTone(523.25, t, 0.18, ctx, "triangle", 0.2);
  playTone(659.25, t + 0.12, 0.18, ctx, "triangle", 0.2);
  playTone(783.99, t + 0.24, 0.32, ctx, "triangle", 0.22);
}

// 지도에 관찰 기록이 새로 표시될 때: 짧은 '퐁' 마커 사운드
function playMarkerPlacedSound() {
  if (!loadSoundEnabled()) return;
  const ctx = getAudioCtx();
  if (!ctx) return;
  const t = ctx.currentTime;
  playTone(440, t, 0.1, ctx, "sine", 0.16);
  playTone(660, t + 0.05, 0.16, ctx, "sine", 0.14);
}

interface PendingCapture {
  imgDataUrl: string;
  lat: number | null;
  lng: number | null;
  address: string;
  date: string;
}

interface AiResult {
  name: string;         // AI 모델이 예측한 종 이름 (그대로 표시/저장)
  confidence: number;   // 0~100
  color: string;
}

const PLANT_ICONS: Record<string, string> = {
  "왕벚나무": "🌸", "벚나무": "🌸", "은행나무": "🍂", "철쭉": "🌺",
  "느티나무": "🌳", "소나무": "🌲", "곰솔": "🌲", "단풍나무": "🍁",
  "목련": "🌼", "백목련": "🌼", "개나리": "🌼", "무궁화": "🌸",
  "대나무": "🎋", "장미": "🌹", "동백나무": "🌺", "감나무": "🍊",
  "밤나무": "🌰", "버드나무": "🌿", "참나무": "🌳", "포플러": "🌳",
  "회화나무": "🌳", "조팝나무": "🌼", "플라타너스": "🌳", "등나무": "🌸",
};

function defaultIcon(name: string): string {
  // 라벨이 한글이 아니면(학명이면) 잎 이모지로 기본 처리
  return PLANT_ICONS[name] ?? "🌿";
}

// ── Plant identification via custom-trained ONNX model (runs fully in browser) ──
import * as ort from "onnxruntime-web/wasm";

// vite가 wasm 파일을 자동으로 번들링/서빙하므로 wasmPaths는 별도로 지정하지 않음
ort.env.wasm.numThreads = 1;

const COLORS = ["#2d6a4f", "#52b788", "#95d5b2"] as const;
const MODEL_URL = "./model/plant_classifier.onnx";
const LABELS_URL = "./model/labels.json";
const IMG_SIZE = 224;
// ImageNet 정규화 값 (모델 학습 시 사용한 것과 동일해야 함)
const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];

let sessionPromise: Promise<ort.InferenceSession> | null = null;
let labelsPromise: Promise<string[]> | null = null;

function getSession(): Promise<ort.InferenceSession> {
  if (!sessionPromise) {
    sessionPromise = ort.InferenceSession.create(MODEL_URL, {
      executionProviders: ["wasm"],
    });
  }
  return sessionPromise;
}

function getLabels(): Promise<string[]> {
  if (!labelsPromise) {
    labelsPromise = fetch(LABELS_URL).then((r) => r.json());
  }
  return labelsPromise;
}

// 이미지를 224x224로 리사이즈(짧은 변 256 기준 center-crop)한 뒤
// [1,3,224,224] Float32 텐서로 변환 + ImageNet 정규화
async function preprocessImage(imgDataUrl: string): Promise<Float32Array> {
  const img = new Image();
  img.src = imgDataUrl;
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("이미지를 불러오지 못했습니다."));
  });

  // Resize(256) → CenterCrop(224), matching the Python preprocessing pipeline
  const RESIZE = 256;
  const scale = RESIZE / Math.min(img.width, img.height);
  const resizedW = Math.round(img.width * scale);
  const resizedH = Math.round(img.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = resizedW;
  canvas.height = resizedH;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0, resizedW, resizedH);

  const cropX = Math.floor((resizedW - IMG_SIZE) / 2);
  const cropY = Math.floor((resizedH - IMG_SIZE) / 2);
  const cropped = ctx.getImageData(cropX, cropY, IMG_SIZE, IMG_SIZE);

  // HWC(RGBA) → CHW(RGB), normalize
  const data = cropped.data;
  const chw = new Float32Array(3 * IMG_SIZE * IMG_SIZE);
  const plane = IMG_SIZE * IMG_SIZE;
  for (let i = 0; i < plane; i++) {
    const r = data[i * 4] / 255;
    const g = data[i * 4 + 1] / 255;
    const b = data[i * 4 + 2] / 255;
    chw[i] = (r - MEAN[0]) / STD[0];
    chw[plane + i] = (g - MEAN[1]) / STD[1];
    chw[plane * 2 + i] = (b - MEAN[2]) / STD[2];
  }
  return chw;
}

function softmax(logits: Float32Array | number[]): number[] {
  const max = Math.max(...logits);
  const exps = Array.from(logits, (v) => Math.exp(v - max));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map((v) => v / sum);
}

async function identifyPlant(imgDataUrl: string): Promise<AiResult[]> {
  const [session, labels] = await Promise.all([getSession(), getLabels()]);
  const inputData = await preprocessImage(imgDataUrl);
  const tensor = new ort.Tensor("float32", inputData, [1, 3, IMG_SIZE, IMG_SIZE]);

  const outputs = await session.run({ input: tensor });
  const outputTensor = outputs.output ?? outputs[Object.keys(outputs)[0]];
  const logits = outputTensor.data as Float32Array;
  const probs = softmax(logits);

  // top-3 인덱스 추출
  const indexed = probs.map((p, i) => ({ p, i }));
  indexed.sort((a, b) => b.p - a.p);
  const top3 = indexed.slice(0, 3);

  return top3.map(({ p, i }, rank) => ({
    name: labels[i] ?? "알 수 없음",
    confidence: Math.round(p * 100),
    color: COLORS[rank] ?? "#95d5b2",
  }));
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

// ── Google 로그인 버튼 ───────────────────────────────────────────────────────
function GoogleIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.1 8 3l5.7-5.7C34.6 6.1 29.6 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.7-.4-3.5z"/>
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.6 15.9 18.9 13 24 13c3.1 0 5.8 1.1 8 3l5.7-5.7C34.6 6.1 29.6 4 24 4 16.3 4 9.6 8.3 6.3 14.7z"/>
      <path fill="#4CAF50" d="M24 44c5.5 0 10.4-1.9 14.1-5.1l-6.5-5.5C29.4 35 26.9 36 24 36c-5.3 0-9.7-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/>
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.2-4.2 5.5l6.5 5.5C39.9 36.9 44 30.9 44 24c0-1.3-.1-2.7-.4-3.5z"/>
    </svg>
  );
}

function GoogleLoginButton({ label = "Google로 계속하기" }: { label?: string }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleClick = async () => {
    setError("");
    setLoading(true);
    try {
      await signInWithGoogle();
    } catch (err: any) {
      setError(err?.message ?? "Google 로그인에 실패했습니다.");
      setLoading(false);
    }
  };

  return (
    <div>
      <button
        onClick={handleClick}
        disabled={loading}
        className="w-full bg-card text-foreground rounded-2xl py-4 font-bold text-base border border-border shadow-sm hover:bg-secondary/50 active:scale-[0.98] transition-all flex items-center justify-center gap-2 disabled:opacity-50"
        style={{ fontFamily: "Nunito, sans-serif" }}
      >
        <GoogleIcon size={18} />
        {loading ? "이동 중..." : label}
      </button>
      {error && (
        <div className="flex items-start gap-2 bg-destructive/10 rounded-xl px-4 py-3 mt-2">
          <AlertCircle size={15} className="text-destructive shrink-0 mt-0.5" />
          <p className="text-sm text-destructive font-semibold whitespace-pre-wrap break-all">{error}</p>
        </div>
      )}
    </div>
  );
}

// ── Landing Screen ──────────────────────────────────────────────────────────
function LandingScreen({ onLogin, onSignup, onGuest }: { onLogin: () => void; onSignup: () => void; onGuest: () => void }) {
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
          <GoogleLoginButton />
          <button
            onClick={onSignup}
            className="w-full bg-card text-foreground rounded-2xl py-4 font-bold text-base border border-border shadow-sm hover:bg-secondary/50 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
            style={{ fontFamily: "Nunito, sans-serif" }}
          >
            <BookOpen size={18} className="text-primary" />
            회원가입
          </button>
          <button
            onClick={onGuest}
            className="w-full text-muted-foreground rounded-2xl py-3 font-semibold text-sm hover:text-foreground active:scale-[0.98] transition-all flex items-center justify-center gap-1.5"
            style={{ fontFamily: "Nunito, sans-serif" }}
          >
            비회원으로 둘러보기
            <ChevronRight size={15} />
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

          <div className="flex items-center gap-3 py-1">
            <div className="flex-1 h-px bg-border" />
            <span className="text-xs text-muted-foreground">또는</span>
            <div className="flex-1 h-px bg-border" />
          </div>

          <GoogleLoginButton />
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

// ── Google 로그인 최초 가입자용 추가 정보 입력 화면 ──────────────────────────
function GoogleProfileScreen({ user, onComplete }: { user: StoredUser; onComplete: (updated: StoredUser) => void }) {
  const [role, setRole] = useState<Role>("student");
  const [name, setName] = useState(user.name);
  const [school, setSchool] = useState("");
  const [schoolKind, setSchoolKind] = useState<SchoolKind>("");
  const [grade, setGrade] = useState("");
  const [klass, setKlass] = useState("");
  const isStudent = role === "student";
  const maxGrade = schoolKind === "초등학교" ? 6 : 3;
  const canSubmit = !!name && !!school && !!schoolKind;

  return (
    <div className="flex flex-col min-h-screen bg-background">
      <div className="px-5 pt-12 pb-4">
        <h2 className="font-extrabold text-xl text-foreground" style={{ fontFamily: "Nunito, sans-serif" }}>거의 다 됐어요!</h2>
        <p className="text-xs text-muted-foreground mt-1">{user.email}로 로그인했어요 · 학교 정보만 알려주세요</p>
      </div>

      <div className="flex-1 px-5 pb-10 overflow-y-auto space-y-5">
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
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="홍길동" className="w-full bg-input-background rounded-xl px-4 py-3.5 text-foreground placeholder:text-muted-foreground outline-none focus:ring-2 focus:ring-ring/40 border border-transparent focus:border-primary/30 transition-all" />
        </div>
        <div>
          <label className="text-sm font-bold text-foreground block mb-1.5" style={{ fontFamily: "Nunito, sans-serif" }}>학교 이름</label>
          <input value={school} onChange={(e) => setSchool(e.target.value)} placeholder="예) 서울" className="w-full bg-input-background rounded-xl px-4 py-3.5 text-foreground placeholder:text-muted-foreground outline-none focus:ring-2 focus:ring-ring/40 border border-transparent focus:border-primary/30 transition-all" />
        </div>
        <div>
          <label className="text-sm font-bold text-foreground block mb-2" style={{ fontFamily: "Nunito, sans-serif" }}>학교 종류</label>
          <div className="grid grid-cols-3 gap-2">
            {(["초등학교", "중학교", "고등학교"] as SchoolKind[]).map((k) => (
              <button key={k} onClick={() => { setSchoolKind(k); setGrade(""); }} className={`rounded-xl py-3 text-sm font-bold border transition-all ${schoolKind === k ? "bg-primary text-primary-foreground border-primary shadow-md" : "bg-card text-foreground border-border hover:border-primary/40"}`} style={{ fontFamily: "Nunito, sans-serif" }}>{k}</button>
            ))}
          </div>
        </div>
        {isStudent && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-bold text-foreground block mb-1.5" style={{ fontFamily: "Nunito, sans-serif" }}>학년</label>
              <select value={grade} onChange={(e) => setGrade(e.target.value)} disabled={!schoolKind} className="w-full bg-input-background rounded-xl px-4 py-3.5 text-foreground outline-none border border-transparent focus:ring-2 focus:ring-ring/40 transition-all appearance-none disabled:opacity-50">
                <option value="">선택</option>
                {Array.from({ length: maxGrade }, (_, i) => i + 1).map((g) => <option key={g}>{g}학년</option>)}
              </select>
            </div>
            <div>
              <label className="text-sm font-bold text-foreground block mb-1.5" style={{ fontFamily: "Nunito, sans-serif" }}>반</label>
              <input value={klass} onChange={(e) => setKlass(e.target.value)} placeholder="예) 3" className="w-full bg-input-background rounded-xl px-4 py-3.5 text-foreground placeholder:text-muted-foreground outline-none focus:ring-2 focus:ring-ring/40 border border-transparent focus:border-primary/30 transition-all" />
            </div>
          </div>
        )}
        <button
          onClick={() => onComplete({ ...user, role, name, school, schoolKind, grade, class: klass })}
          disabled={!canSubmit}
          className="w-full bg-primary text-primary-foreground rounded-2xl py-4 font-bold text-base shadow-md disabled:opacity-40 hover:bg-primary/90 active:scale-[0.98] transition-all"
          style={{ fontFamily: "Nunito, sans-serif" }}
        >
          시작하기
        </button>
      </div>
    </div>
  );
}

// ── Home Screen ─────────────────────────────────────────────────────────────
function HomeScreen({ name, role, count, observations, isGuest, onUpload, onMap, onMyRecords, onSettings, onSignupPrompt }: {
  name: string; role: Role; count: number; observations: PlantObservation[]; isGuest: boolean;
  onUpload: () => void; onMap: () => void; onMyRecords: () => void; onSettings: () => void; onSignupPrompt: () => void;
}) {
  const GOAL = 5;
  const prevCountRef = useRef(count);
  useEffect(() => {
    if (count > prevCountRef.current) {
      if (count >= GOAL && prevCountRef.current < GOAL) {
        playQuestCompleteSound();
      } else {
        playGaugeFillSound();
      }
    }
    prevCountRef.current = count;
  }, [count]);

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
            <p className="text-xs text-muted-foreground" style={{ fontFamily: "DM Mono, monospace" }}>{isGuest ? "비회원" : role === "student" ? "학생" : "교사"}</p>
          </div>
          <button onClick={onSettings} className="w-10 h-10 bg-primary rounded-2xl flex items-center justify-center shadow-md hover:bg-primary/80 active:scale-95 transition-all" title="설정">
            <Settings size={18} className="text-primary-foreground" />
          </button>
        </div>
      </div>

      {isGuest && (
        <button
          onClick={onSignupPrompt}
          className="mx-5 mb-4 bg-secondary rounded-2xl px-4 py-3 flex items-center gap-3 text-left hover:bg-secondary/70 active:scale-[0.98] transition-all"
        >
          <div className="w-8 h-8 bg-primary/15 rounded-lg flex items-center justify-center shrink-0">
            <User size={14} className="text-primary" />
          </div>
          <p className="text-xs text-secondary-foreground flex-1" style={{ fontFamily: "Nunito, sans-serif" }}>
            <span className="font-bold">비회원으로 둘러보는 중이에요.</span> 회원가입하면 기록이 안전하게 저장돼요.
          </p>
          <ChevronRight size={16} className="text-secondary-foreground/60 shrink-0" />
        </button>
      )}

      {/* Goal banner */}
      <div className="mx-5 mb-5 bg-primary rounded-3xl p-5 shadow-lg overflow-hidden relative">
        <img src="https://images.unsplash.com/photo-1518531933037-91b2f5f229cc?w=600&h=200&fit=crop&auto=format" alt="" className="absolute inset-0 w-full h-full object-cover opacity-20 mix-blend-luminosity" />
        <div className="relative">
          <p className="text-primary-foreground/80 text-sm font-semibold mb-1" style={{ fontFamily: "Nunito, sans-serif" }}>이번 주 목표</p>
          <p className="text-primary-foreground text-xl font-extrabold mb-3" style={{ fontFamily: "Nunito, sans-serif" }}>
            {count >= GOAL ? "목표 달성! 🎉" : `식물 ${GOAL}종 관찰하기 🌱`}
          </p>
          <div className="flex items-center gap-2">
            <div className="flex-1 flex gap-1.5">
              {Array.from({ length: GOAL }).map((_, i) => (
                <div key={i} className="flex-1 h-2.5 rounded-full transition-all duration-500" style={{ background: i < count ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.25)", transitionDelay: `${i * 60}ms` }} />
              ))}
            </div>
            <span className="text-white text-xs font-bold" style={{ fontFamily: "DM Mono, monospace" }}>{count}/{GOAL}</span>
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
        // 카메라 원본(고화질) 사진을 그대로 DataUrl로 변환하면 메모리 부족으로 앱이
        // 튕길 수 있어 네이티브 단에서 미리 축소한다 (최종 리사이즈는 compressImage가 담당)
        width: 1600,
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

  const [showGpsWaitModal, setShowGpsWaitModal] = useState(false);
  const [showGpsErrorModal, setShowGpsErrorModal] = useState(false);

  // GPS 로딩이 끝나면(성공/실패 무관) 대기 팝업 자동 닫기
  useEffect(() => {
    if (!gpsLoading) {
      if (showGpsWaitModal) setShowGpsWaitModal(false);
      if (!gpsError && showGpsErrorModal) setShowGpsErrorModal(false);
    }
  }, [gpsLoading, gpsError]);

  const handleAnalyze = () => {
    if (!imgDataUrl) return;
    // 위치 정보를 아직 불러오는 중이면 분석을 진행하지 않고 안내 팝업을 띄움
    if (gpsLoading) {
      setShowGpsWaitModal(true);
      return;
    }
    // 위치 정보 획득에 실패(권한 거부 등)한 경우도 진행을 막고 재요청 팝업을 띄움
    if (gpsError || !gpsRef.current) {
      setShowGpsErrorModal(true);
      return;
    }
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

      {/* GPS 아직 로딩중인데 판별 버튼을 눌렀을 때 뜨는 안내 팝업 */}
      {showGpsWaitModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-6" style={{ background: "rgba(0,0,0,0.5)" }}>
          <div className="bg-card rounded-3xl p-6 w-full max-w-sm shadow-xl">
            <div className="w-14 h-14 bg-secondary rounded-2xl flex items-center justify-center mb-4 mx-auto">
              <div className="w-6 h-6 border-[3px] border-primary/30 border-t-primary rounded-full animate-spin" />
            </div>
            <p className="text-center font-extrabold text-lg text-foreground mb-1.5" style={{ fontFamily: "Nunito, sans-serif" }}>
              위치정보를 불러오는 중입니다
            </p>
            <p className="text-center text-sm text-muted-foreground mb-6">
              잠시만 기다려 주세요. 위치 정보가 확인되면<br />바로 판별을 진행할 수 있어요.
            </p>
            <div className="space-y-2">
              <button
                onClick={fetchGps}
                className="w-full bg-primary text-primary-foreground rounded-2xl py-3.5 font-bold text-sm shadow-md hover:bg-primary/90 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
                style={{ fontFamily: "Nunito, sans-serif" }}
              >
                <MapPin size={16} />
                위치정보 권한 다시 요청하기
              </button>
              <button
                onClick={() => setShowGpsWaitModal(false)}
                className="w-full text-muted-foreground rounded-2xl py-2.5 font-semibold text-sm hover:text-foreground transition-all"
                style={{ fontFamily: "Nunito, sans-serif" }}
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}

      {/* GPS 획득 실패(권한 거부 등)일 때 판별 버튼을 눌렀을 때 뜨는 안내 팝업 */}
      {showGpsErrorModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-6" style={{ background: "rgba(0,0,0,0.5)" }}>
          <div className="bg-card rounded-3xl p-6 w-full max-w-sm shadow-xl">
            <div className="w-14 h-14 bg-destructive/10 rounded-2xl flex items-center justify-center mb-4 mx-auto">
              <MapPin size={24} className="text-destructive" />
            </div>
            <p className="text-center font-extrabold text-lg text-foreground mb-1.5" style={{ fontFamily: "Nunito, sans-serif" }}>
              위치정보 권한이 필요해요
            </p>
            <p className="text-center text-sm text-muted-foreground mb-6">
              위치 정보를 가져오지 못했어요.<br />권한을 허용하고 다시 시도해 주세요.
            </p>
            <div className="space-y-2">
              <button
                onClick={fetchGps}
                className="w-full bg-primary text-primary-foreground rounded-2xl py-3.5 font-bold text-sm shadow-md hover:bg-primary/90 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
                style={{ fontFamily: "Nunito, sans-serif" }}
              >
                <MapPin size={16} />
                위치정보 권한 다시 받기
              </button>
              <button
                onClick={() => setShowGpsErrorModal(false)}
                className="w-full text-muted-foreground rounded-2xl py-2.5 font-semibold text-sm hover:text-foreground transition-all"
                style={{ fontFamily: "Nunito, sans-serif" }}
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}
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
            <p className="font-bold text-xs text-muted-foreground uppercase tracking-widest mb-4" style={{ fontFamily: "DM Mono, monospace" }}>AI 예측 결과</p>
            <div className="space-y-4">
              {aiResults.map((r, i) => (
                <div key={r.name + i}>
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2 min-w-0">
                      {i === 0 && <div className="w-5 h-5 bg-primary rounded-md flex items-center justify-center shrink-0"><Check size={11} className="text-white" /></div>}
                      <div className="min-w-0">
                        <p className={`font-bold text-sm truncate ${i === 0 ? "text-foreground" : "text-muted-foreground"}`} style={{ fontFamily: "Nunito, sans-serif" }}>
                          {defaultIcon(r.name)} {r.name}
                        </p>
                      </div>
                    </div>
                    <span className="font-bold text-sm shrink-0 ml-2" style={{ fontFamily: "DM Mono, monospace", color: r.color }}>{r.confidence}%</span>
                  </div>
                  <div className="h-2 bg-muted rounded-full overflow-hidden mt-1.5">
                    <div className="h-full rounded-full transition-all duration-700" style={{ width: `${r.confidence}%`, background: r.color }} />
                  </div>
                </div>
              ))}
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
// ── Settings Screen ──────────────────────────────────────────────────────────
function SettingsScreen({ onBack, onLogout, darkMode, onToggleDarkMode, soundEnabled, onToggleSound, currentUser, onUpdateUser, onSignupPrompt }: {
  onBack: () => void;
  onLogout: () => void;
  darkMode: boolean;
  onToggleDarkMode: () => void;
  soundEnabled: boolean;
  onToggleSound: () => void;
  currentUser: StoredUser;
  onUpdateUser: (updated: StoredUser) => void;
  onSignupPrompt: () => void;
}) {
  const isGuest = !!currentUser.isGuest;
  const isStudent = currentUser.role === "student";
  const [school, setSchool] = useState(currentUser.school);
  const [schoolKind, setSchoolKind] = useState<SchoolKind>((currentUser.schoolKind as SchoolKind) || "");
  const [grade, setGrade] = useState(currentUser.grade);
  const [klass, setKlass] = useState(currentUser.class);
  const [saved, setSaved] = useState(false);

  const maxGrade = schoolKind === "초등학교" ? 6 : 3;
  const isDirty =
    school !== currentUser.school ||
    schoolKind !== currentUser.schoolKind ||
    grade !== currentUser.grade ||
    klass !== currentUser.class;

  const handleSave = () => {
    onUpdateUser({ ...currentUser, school, schoolKind, grade, class: klass });
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  };

  return (
    <div className="flex flex-col min-h-screen bg-background pb-10">
      <div className="flex items-center gap-3 px-5 pt-12 pb-3 shrink-0">
        <button onClick={onBack} className="w-9 h-9 flex items-center justify-center rounded-xl hover:bg-muted transition-colors">
          <ArrowLeft size={20} className="text-foreground" />
        </button>
        <h2 className="font-extrabold text-xl text-foreground" style={{ fontFamily: "Nunito, sans-serif" }}>설정</h2>
      </div>

      <div className="px-5 mt-2 space-y-3">
        {/* School / grade editor (회원 전용) */}
        {isGuest ? (
          <button
            onClick={onSignupPrompt}
            className="w-full bg-card rounded-2xl border border-border shadow-sm p-4 flex items-center gap-4 text-left hover:border-primary/30 hover:shadow-md transition-all"
          >
            <div className="w-10 h-10 bg-secondary rounded-xl flex items-center justify-center shrink-0">
              <School size={16} className="text-primary" />
            </div>
            <div className="flex-1">
              <p className="font-bold text-sm text-foreground" style={{ fontFamily: "Nunito, sans-serif" }}>학교 정보 설정하기</p>
              <p className="text-xs text-muted-foreground mt-0.5">비회원은 학교/학년을 저장할 수 없어요. 회원가입하고 설정해보세요.</p>
            </div>
            <ChevronRight size={18} className="text-muted-foreground shrink-0" />
          </button>
        ) : (
        <div className="bg-card rounded-2xl border border-border shadow-sm p-4 space-y-4">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 bg-secondary rounded-xl flex items-center justify-center shrink-0">
              <School size={16} className="text-primary" />
            </div>
            <p className="font-bold text-sm text-foreground" style={{ fontFamily: "Nunito, sans-serif" }}>학교 정보</p>
          </div>

          <div>
            <label className="text-xs font-bold text-muted-foreground block mb-1.5" style={{ fontFamily: "Nunito, sans-serif" }}>학교 이름</label>
            <input
              value={school}
              onChange={(e) => setSchool(e.target.value)}
              placeholder="예) 서울초등학교"
              className="w-full bg-input-background rounded-xl px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-2 focus:ring-ring/40 border border-transparent focus:border-primary/30 transition-all"
            />
          </div>

          <div>
            <label className="text-xs font-bold text-muted-foreground block mb-1.5" style={{ fontFamily: "Nunito, sans-serif" }}>학교 종류</label>
            <div className="grid grid-cols-3 gap-2">
              {(["초등학교", "중학교", "고등학교"] as SchoolKind[]).map((k) => (
                <button
                  key={k}
                  onClick={() => { setSchoolKind(k); if (Number(grade.replace(/[^0-9]/g, "")) > (k === "초등학교" ? 6 : 3)) setGrade(""); }}
                  className={`rounded-xl py-2.5 text-xs font-bold border transition-all ${schoolKind === k ? "bg-primary text-primary-foreground border-primary shadow-md" : "bg-background text-foreground border-border hover:border-primary/40"}`}
                  style={{ fontFamily: "Nunito, sans-serif" }}
                >
                  {k}
                </button>
              ))}
            </div>
          </div>

          {isStudent && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-bold text-muted-foreground block mb-1.5" style={{ fontFamily: "Nunito, sans-serif" }}>학년</label>
                <select
                  value={grade}
                  onChange={(e) => setGrade(e.target.value)}
                  disabled={!schoolKind}
                  className="w-full bg-input-background rounded-xl px-4 py-3 text-sm text-foreground outline-none border border-transparent focus:ring-2 focus:ring-ring/40 transition-all appearance-none disabled:opacity-50"
                >
                  <option value="">선택</option>
                  {Array.from({ length: maxGrade }, (_, i) => i + 1).map((g) => <option key={g}>{g}학년</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-bold text-muted-foreground block mb-1.5" style={{ fontFamily: "Nunito, sans-serif" }}>반</label>
                <input
                  value={klass}
                  onChange={(e) => setKlass(e.target.value)}
                  placeholder="예) 3"
                  className="w-full bg-input-background rounded-xl px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-2 focus:ring-ring/40 border border-transparent focus:border-primary/30 transition-all"
                />
              </div>
            </div>
          )}

          <button
            onClick={handleSave}
            disabled={!isDirty || !school || !schoolKind}
            className="w-full bg-primary text-primary-foreground rounded-xl py-3 font-bold text-sm shadow-md disabled:opacity-40 hover:bg-primary/90 active:scale-[0.98] transition-all"
            style={{ fontFamily: "Nunito, sans-serif" }}
          >
            {saved ? "저장됨 ✓" : "변경사항 저장"}
          </button>
        </div>
        )}

        <div className="bg-card rounded-2xl border border-border shadow-sm divide-y divide-border overflow-hidden">
          <button onClick={onToggleDarkMode} className="w-full flex items-center gap-4 p-4 hover:bg-muted/50 transition-colors">
            <div className="w-10 h-10 bg-secondary rounded-xl flex items-center justify-center shrink-0">
              {darkMode ? <Moon size={18} className="text-primary" /> : <Sun size={18} className="text-primary" />}
            </div>
            <div className="flex-1 text-left">
              <p className="font-bold text-sm text-foreground" style={{ fontFamily: "Nunito, sans-serif" }}>다크 모드</p>
              <p className="text-xs text-muted-foreground">{darkMode ? "켜짐" : "꺼짐"}</p>
            </div>
            <div className={`w-11 h-6 rounded-full relative transition-colors ${darkMode ? "bg-primary" : "bg-muted"}`}>
              <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${darkMode ? "left-[22px]" : "left-0.5"}`} />
            </div>
          </button>

          <button onClick={onToggleSound} className="w-full flex items-center gap-4 p-4 hover:bg-muted/50 transition-colors">
            <div className="w-10 h-10 bg-secondary rounded-xl flex items-center justify-center shrink-0">
              {soundEnabled ? <Volume2 size={18} className="text-primary" /> : <VolumeX size={18} className="text-primary" />}
            </div>
            <div className="flex-1 text-left">
              <p className="font-bold text-sm text-foreground" style={{ fontFamily: "Nunito, sans-serif" }}>효과음</p>
              <p className="text-xs text-muted-foreground">{soundEnabled ? "켜짐" : "꺼짐"}</p>
            </div>
            <div className={`w-11 h-6 rounded-full relative transition-colors ${soundEnabled ? "bg-primary" : "bg-muted"}`}>
              <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${soundEnabled ? "left-[22px]" : "left-0.5"}`} />
            </div>
          </button>
        </div>

        <button onClick={isGuest ? onSignupPrompt : onLogout} className="w-full bg-card rounded-2xl border border-border shadow-sm flex items-center gap-4 p-4 hover:bg-destructive/5 transition-colors">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${isGuest ? "bg-primary/10" : "bg-destructive/10"}`}>
            {isGuest ? <User size={18} className="text-primary" /> : <LogOut size={18} className="text-destructive" />}
          </div>
          <p className={`font-bold text-sm ${isGuest ? "text-primary" : "text-destructive"}`} style={{ fontFamily: "Nunito, sans-serif" }}>
            {isGuest ? "회원가입 / 로그인 하러가기" : "로그아웃"}
          </p>
        </button>
      </div>
    </div>
  );
}

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
  const prevObsCountRef = useRef<number | null>(null);
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

    if (prevObsCountRef.current !== null && observations.length > prevObsCountRef.current) {
      playMarkerPlacedSound();
    }
    prevObsCountRef.current = observations.length;
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
  const [darkMode, setDarkMode] = useState<boolean>(() => loadDarkMode());
  const [soundEnabled, setSoundEnabled] = useState<boolean>(() => loadSoundEnabled());

  // Restore session on mount
  useEffect(() => {
    const uid = loadCurrentUserId();
    if (!uid) return;
    const users = loadUsers();
    const user = users.find((u) => u.userId === uid);
    if (user) { setCurrentUser(user); setObservations(loadObservations()); setScreen("home"); }
  }, []);

  // Supabase(Google) 로그인 세션 감지 — 로그인 성공 시 홈으로 진입
  useEffect(() => {
    if (!isSupabaseConfigured) return;
    const enterWithGoogleSession = async (sUser: any) => {
      const base = googleSessionUserToStoredUser(sUser);
      // 서버(Supabase profiles 테이블)에 저장된 프로필이 있으면 그걸 우선 사용 —
      // 앱을 지웠다 다시 깔아도 같은 구글 계정으로 로그인하면 학교 정보가 복원됨
      const { profile: remote, error: fetchError } = await fetchProfile(base.userId);
      if (fetchError) alert(`프로필 서버 조회 실패: ${fetchError}`);
      // 회원가입 트리거가 이름/역할만 채운 빈 row를 미리 만들어두므로, row가
      // 있다는 것만으로는 온보딩 완료 여부를 알 수 없다 — school까지 채워져 있어야 완료로 본다.
      const isComplete = !!remote?.school;
      const merged = remote ? remoteProfileToStoredUser(remote, base.email) : upsertGoogleUser(base);
      // 로컬 캐시도 최신 상태로 동기화 (다음 실행 시 오프라인에서도 바로 보이도록)
      upsertGoogleUser(merged);
      saveCurrentUserId(merged.userId);
      setCurrentUser(merged);
      setObservations(loadObservations());
      // 서버 프로필이 없거나 아직 학교 정보가 없는 최초 Google 가입자는 추가 정보 입력 화면으로
      setScreen(isComplete ? "home" : "googleProfile");
    };

    supabase.auth.getSession().then(({ data }) => {
      if (data.session?.user) enterWithGoogleSession(data.session.user);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" && session?.user) enterWithGoogleSession(session.user);
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  // Apply dark mode to <html> so Tailwind's `dark:` variants (if any) and any
  // custom CSS variables can respond globally.
  useEffect(() => {
    document.documentElement.classList.toggle("dark", darkMode);
  }, [darkMode]);

  const myCount = observations.filter((o) => o.userId === currentUser?.userId).length;

  const handleLoginSuccess = (user: StoredUser, obs: PlantObservation[]) => {
    setCurrentUser(user);
    setObservations(obs);
    setScreen("home");
  };

  const handleGuestEnter = () => {
    const guest = createGuestUser();
    setCurrentUser(guest);
    setObservations(loadObservations());
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
    supabase.auth.signOut().catch(() => {});
    saveCurrentUserId(null);
    setCurrentUser(null);
    setObservations([]);
    setScreen("landing");
  };

  const toggleDarkMode = () => {
    setDarkMode((prev) => {
      const next = !prev;
      saveDarkMode(next);
      return next;
    });
  };

  const toggleSound = () => {
    setSoundEnabled((prev) => {
      const next = !prev;
      saveSoundEnabled(next);
      return next;
    });
  };

  const handleUpdateUser = (updated: StoredUser) => {
    if (!updated.isGuest) {
      const users = loadUsers();
      const next = users.map((u) => (u.userId === updated.userId ? updated : u));
      saveUsers(next);
    }
    setCurrentUser(updated);
    // Google 계정은 Supabase profiles 테이블에도 반영 — 앱 재설치 후 같은 계정으로
    // 로그인해도 학교/학년 등 정보가 그대로 복원되도록
    if (updated.authProvider === "google") {
      upsertProfile(storedUserToRemoteProfile(updated)).then(({ error }) => {
        if (error) alert(`프로필 서버 저장 실패: ${error}`);
      });
    }
  };

  const handleGoogleProfileComplete = (updated: StoredUser) => {
    handleUpdateUser(updated);
    setScreen("home");
  };

  const handleSignupPrompt = () => {
    // 게스트 세션 종료 후 회원가입 화면으로 이동 (관찰기록은 로컬에 남아있음)
    saveCurrentUserId(null);
    setCurrentUser(null);
    setObservations([]);
    setScreen("signup");
  };

  return (
    <div className="min-h-screen bg-background" style={{ fontFamily: "Nunito, sans-serif", maxWidth: 480, margin: "0 auto" }}>
      {screen === "landing" && (
        <LandingScreen
          onLogin={() => setScreen("login")}
          onSignup={() => setScreen("signup")}
          onGuest={handleGuestEnter}
        />
      )}
      {screen === "login" && (
        <LoginScreen onBack={() => setScreen("landing")} onSuccess={handleLoginSuccess} />
      )}
      {screen === "signup" && (
        <SignupScreen onBack={() => setScreen("landing")} onComplete={handleLoginSuccess} />
      )}
      {screen === "googleProfile" && currentUser && (
        <GoogleProfileScreen user={currentUser} onComplete={handleGoogleProfileComplete} />
      )}
      {screen === "home" && currentUser && (
        <HomeScreen
          name={currentUser.name}
          role={currentUser.role}
          count={Math.min(myCount, 5)}
          observations={observations}
          isGuest={!!currentUser.isGuest}
          onUpload={() => setScreen("upload")}
          onMap={() => setScreen("map")}
          onMyRecords={() => setScreen("myrecords")}
          onSettings={() => setScreen("settings")}
          onSignupPrompt={handleSignupPrompt}
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
      {screen === "settings" && currentUser && (
        <SettingsScreen
          onBack={() => setScreen("home")}
          onLogout={handleLogout}
          darkMode={darkMode}
          onToggleDarkMode={toggleDarkMode}
          soundEnabled={soundEnabled}
          onToggleSound={toggleSound}
          currentUser={currentUser}
          onUpdateUser={handleUpdateUser}
          onSignupPrompt={handleSignupPrompt}
        />
      )}
    </div>
  );
}
