import { Capacitor } from "@capacitor/core";
import { Browser } from "@capacitor/browser";
import { App as CapApp } from "@capacitor/app";
import { supabase, isSupabaseConfigured } from "./supabaseClient";

// AndroidManifest.xml의 intent-filter(scheme=com.greenmapz.app, host=login-callback)와 짝을 이룬다.
const NATIVE_REDIRECT_URL = "com.greenmapz.app://login-callback";

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
    // exchangeCodeForSession()이 같은 코드로 중복 호출되는 것을 막는다 (첫 호출만 성공하고
    // 두 번째는 "invalid flow state" 에러가 남는 원인이었음).
    let handled = false;
    let handle: { remove: () => Promise<void> } | null = null;

    CapApp.addListener("appUrlOpen", async ({ url }) => {
      if (handled || !url.startsWith(NATIVE_REDIRECT_URL)) return;
      handled = true;
      handle?.remove().catch(() => {});
      Browser.close().catch(() => {});
      try {
        const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(url);
        if (exchangeError) reject(exchangeError);
        else resolve();
      } catch (e) {
        reject(e);
      }
    }).then((h) => {
      handle = h;
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
