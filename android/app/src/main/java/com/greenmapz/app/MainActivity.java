package com.greenmapz.app;

import android.app.AlertDialog;
import android.os.Bundle;
import android.os.Looper;
import android.util.Log;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // 진단용 임시 코드: USB/adb 없이도 크래시 원인을 화면에서 바로 확인하기 위한 핸들러.
        // 원인 확인 후에는 제거할 것.
        Thread.setDefaultUncaughtExceptionHandler((thread, throwable) -> {
            final String trace = Log.getStackTraceString(throwable);
            Log.e("GreenMapZCrash", trace);
            try {
                new AlertDialog.Builder(MainActivity.this)
                    .setTitle("앱 오류 (진단용)")
                    .setMessage(trace)
                    .setCancelable(false)
                    .setPositiveButton("종료", (dialog, which) -> {
                        android.os.Process.killProcess(android.os.Process.myPid());
                    })
                    .show();
                Looper.loop();
            } catch (Throwable ignored) {
                android.os.Process.killProcess(android.os.Process.myPid());
            }
        });
    }
}
