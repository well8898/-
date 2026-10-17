package com.well8898.schedulewidget;

import android.content.Context;
import android.content.pm.PackageInfo;
import android.net.Uri;
import android.os.Build;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** 새 버전 확인: GitHub 릴리스 "widget-apk" 설명의 versionCode=N 과 설치된 버전을 비교. */
final class Update {
    static final String APK = "https://github.com/well8898/-/releases/download/widget-apk/schedule-widget.apk";

    /** 새 버전 받는 곳: 플레이스토어 앱이면 스토어 화면, 아니면 APK 파일 */
    static Uri where(Context c) {
        return Uri.parse(BuildConfig.STORE ? "market://details?id=" + c.getPackageName() : APK);
    }
    private static final String API = "https://api.github.com/repos/well8898/-/releases/tags/widget-apk";
    private static final long EVERY = 6 * 60 * 60 * 1000L;

    static long current(Context c) {
        try {
            PackageInfo p = c.getPackageManager().getPackageInfo(c.getPackageName(), 0);
            return Build.VERSION.SDK_INT >= 28 ? p.getLongVersionCode() : p.versionCode;
        } catch (Exception e) {
            return 0;
        }
    }

    static String currentName(Context c) {
        try {
            return c.getPackageManager().getPackageInfo(c.getPackageName(), 0).versionName;
        } catch (Exception e) {
            return "";
        }
    }

    /** 6시간에 한 번만 (force 면 바로). 네트워크를 쓰므로 백그라운드에서 부른다. */
    static void check(Context c, boolean force) {
        if (BuildConfig.STORE) return; // 플레이스토어 앱은 스토어가 업데이트 (스스로 받으면 정책 위반)
        long now = System.currentTimeMillis();
        if (!force && now - Data.prefs(c).getLong("upAt", 0) < EVERY) return;
        try {
            HttpURLConnection con = (HttpURLConnection) new URL(API).openConnection();
            con.setConnectTimeout(10000);
            con.setReadTimeout(15000);
            con.setRequestProperty("User-Agent", "schedule-widget");
            con.setRequestProperty("Accept", "application/vnd.github+json");
            try (InputStream in = con.getInputStream()) {
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                byte[] buf = new byte[8192];
                for (int n; (n = in.read(buf)) > 0; ) out.write(buf, 0, n);
                String body = new JSONObject(out.toString("UTF-8")).optString("body");
                Matcher vc = Pattern.compile("versionCode=(\\d+)").matcher(body);
                Matcher vn = Pattern.compile("versionName=([\\w.]+)").matcher(body);
                if (vc.find()) {
                    Data.prefs(c).edit()
                            .putLong("upVc", Long.parseLong(vc.group(1)))
                            .putString("upVn", vn.find() ? vn.group(1) : "")
                            .putLong("upAt", now).apply();
                }
            } finally {
                con.disconnect();
            }
        } catch (Exception ignored) {
            // 확인 못 하면 다음에 다시
        }
    }

    /** 새 버전 이름 (없으면 null) */
    static String available(Context c) {
        if (BuildConfig.STORE) return null;
        long vc = Data.prefs(c).getLong("upVc", 0);
        if (vc <= current(c)) return null;
        String vn = Data.prefs(c).getString("upVn", "");
        return vn.isEmpty() ? "새 버전" : vn;
    }
}
