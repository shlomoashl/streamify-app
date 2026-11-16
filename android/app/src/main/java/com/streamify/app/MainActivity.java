package com.streamify.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.os.Bundle;
import android.util.Log;

import com.getcapacitor.BridgeActivity;

import java.io.File;

public class MainActivity extends BridgeActivity {
    private static final String TAG = "MainActivity";
    private static final String APK_TRACKER_PREFS = "StreamifyApkUpdateTracker";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        clearStaleOtaBundlesIfApkUpdated();
        registerPlugin(StreamifyMediaPlugin.class);
        super.onCreate(savedInstanceState);

        // Allow auto-play (audio) without user gesture/interaction
        if (this.getBridge() != null && this.getBridge().getWebView() != null) {
            this.getBridge().getWebView().getSettings().setMediaPlaybackRequiresUserGesture(false);
        }
    }

    /**
     * כאשר מתקינים קובץ APK חדש מעל אפליקציה קיימת (בלי להסיר),
     * פלאגין ה-OTA (@capgo/capacitor-updater) עלול לטעון קובץ update.zip ישן ששמור בזיכרון הפנימי
     * במקום את הקוד החדש שבתוך ה-APK.
     * פונקציה זו רצה לפני עליית ה-WebView, מזהה שה-APK עודכן (לפי lastUpdateTime),
     * ומנקה אך ורק את ה-Bundle הישן של ה-OTA (מבלי לגעת במשתמש, בפלייליסטים או בשיר האחרון!).
     */
    private void clearStaleOtaBundlesIfApkUpdated() {
        try {
            PackageInfo pkgInfo = getPackageManager().getPackageInfo(getPackageName(), 0);
            long currentUpdateTime = pkgInfo.lastUpdateTime;
            int currentVersionCode = pkgInfo.versionCode;

            SharedPreferences tracker = getSharedPreferences(APK_TRACKER_PREFS, Context.MODE_PRIVATE);
            long savedUpdateTime = tracker.getLong("last_apk_update_time", -1L);
            int savedVersionCode = tracker.getInt("last_apk_version_code", -1);

            if (savedUpdateTime != currentUpdateTime || savedVersionCode != currentVersionCode) {
                Log.i(TAG, "APK update detected (time: " + savedUpdateTime + " -> " + currentUpdateTime +
                        ", ver: " + savedVersionCode + " -> " + currentVersionCode + "). Clearing stale OTA bundles.");

                // 1. איפוס הנתיב של Capacitor WebView כדי שיטען את ה-assets החדשים מתוך ה-APK
                getSharedPreferences("CapWebViewSettings", Context.MODE_PRIVATE)
                        .edit()
                        .clear()
                        .commit();

                // 2. איפוס ההגדרות של Capgo CapacitorUpdater
                getSharedPreferences("CapgoUpdater", Context.MODE_PRIVATE)
                        .edit()
                        .clear()
                        .commit();
                getSharedPreferences(getPackageName() + ".CapacitorUpdater", Context.MODE_PRIVATE)
                        .edit()
                        .clear()
                        .commit();

                // 3. מחיקת תיקיית versions הישנה של ה-OTA בלבד
                File versionsDir = new File(getFilesDir(), "versions");
                deleteDirectoryRecursively(versionsDir);

                tracker.edit()
                        .putLong("last_apk_update_time", currentUpdateTime)
                        .putInt("last_apk_version_code", currentVersionCode)
                        .commit();
            }
        } catch (Exception e) {
            Log.w(TAG, "Failed to check/clear stale OTA bundles", e);
        }
    }

    private void deleteDirectoryRecursively(File fileOrDir) {
        if (fileOrDir == null || !fileOrDir.exists()) return;
        if (fileOrDir.isDirectory()) {
            File[] children = fileOrDir.listFiles();
            if (children != null) {
                for (File child : children) {
                    deleteDirectoryRecursively(child);
                }
            }
        }
        try {
            fileOrDir.delete();
        } catch (Exception ignored) {}
    }
}
