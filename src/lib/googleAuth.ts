import { Capacitor } from "@capacitor/core";
import { Browser } from "@capacitor/browser";
import { App as CapApp } from "@capacitor/app";
import { supabase, isSupabaseConfigured } from "./supabaseClient";

// AndroidManifest.xml의 intent-filter(scheme=com.greenmapz.app, host=login-callback)와 짝을 이룬다.
const NATIVE_REDIRECT_URL = "com.greenmapz.app://login-callback";

// 커스텀 스킴 URL(com.greenmapz.app://login-callback?error=... 또는 #access_token=...)에서
// 쿼리/해시 파라미터를 꺼낸다. new URL()이 커스텀 스킴을 항상 안정적으로 파싱하진 않아 직접 자른다.
function parseCallbackParams(url: string): URLSearchParams {
  const raw = url.includes("#") ? url.split("#")[1] : url.split("?")[1] ?? "";
  return new URLSearchParams(raw);
}

async function signInWithGoogleNative(): Promise<void> {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: NATIVE_REDIRECT_URL, skipBrowserRedirect: true },
  });
  if (error) throw error;
  if (!data?.url) throw new Error("Google 로그인 URL을 가져오지 못했습니다.");

  await Browser.open({ url: data.url });

  await new Promise<void>((resolve, reject) => {
    // 딥링크 리다이렉트가 android:launchMode="singleTask" 환경에서 두 번 전달될 때가 있어
    // exchangeCodeForSession()이 같은 코드로 중복 호출되는 것을 막는다.
    let handled = false;
    let appUrlHandle: { remove: () => Promise<void> } | null = null;
    let browserFinishedHandle: { remove: () => Promise<void> } | null = null;

    const cleanup = () => {
      appUrlHandle?.remove().catch(() => {});
      browserFinishedHandle?.remove().catch(() => {});
    };

    CapApp.addListener("appUrlOpen", async ({ url }) => {
      if (handled || !url.startsWith(NATIVE_REDIRECT_URL)) return;
      handled = true;
      cleanup();
      Browser.close().catch(() => {});

      const params = parseCallbackParams(url);
      const errorDescription = params.get("error_description");
      if (errorDescription) {
        reject(
          new Error(
            `${decodeURIComponent(errorDescription)} [${params.get("error_code") ?? params.get("error") ?? "unknown"}]\n원본: ${url}`
          )
        );
        return;
      }

      try {
        const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(url);
        if (exchangeError) reject(new Error(`${exchangeError.message}\n원본: ${url}`));
        else resolve();
      } catch (e: any) {
        reject(new Error(`${e?.message ?? e}\n원본: ${url}`));
      }
    }).then((h) => {
      appUrlHandle = h;
      if (handled) h.remove().catch(() => {});
    });

    // 사용자가 딥링크 없이 브라우저 창을 직접 닫은 경우(로그인 취소) 무한 대기하지 않도록 처리
    Browser.addListener("browserFinished", () => {
      if (handled) return;
      handled = true;
      cleanup();
      reject(new Error("Google 로그인이 취소되었습니다."));
    }).then((h) => {
      browserFinishedHandle = h;
      if (handled) h.remove().catch(() => {});
    });
  });
}

async function signInWithGoogleWeb(): Promise<void> {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: window.location.origin },
  });
  if (error) throw error;
  // 성공 시 브라우저가 Google 로그인 페이지로 전체 리다이렉트되므로 이후 코드는 실행되지 않음
}

export async function signInWithGoogle(): Promise<void> {
  if (!isSupabaseConfigured) {
    throw new Error("Supabase 설정이 아직 완료되지 않았습니다. .env.local을 확인해주세요.");
  }
  if (Capacitor.isNativePlatform()) {
    await signInWithGoogleNative();
  } else {
    await signInWithGoogleWeb();
  }
}
