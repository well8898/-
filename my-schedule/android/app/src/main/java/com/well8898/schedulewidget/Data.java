package com.well8898.schedulewidget;

import android.content.Context;
import android.content.SharedPreferences;
import android.net.Uri;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.TimeZone;

/** 위젯 주소 저장, 일정 JSON 받기/보관, 현장 줄 만들기. */
final class Data {
    static final String PREFS = "widget";

    static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static String url(Context c) {
        return prefs(c).getString("url", "");
    }

    /** 웹앱 주소에서 ?w= 개인 주소만 남긴다 (&view=1 등은 뺀다). */
    static String normalize(String s) {
        if (s == null) return "";
        s = s.trim();
        int i = s.indexOf("https://script.google.com/");
        if (i < 0) return "";
        s = s.substring(i).split("\\s")[0];
        Uri u = Uri.parse(s);
        String w = u.getQueryParameter("w");
        if (w == null || !w.matches("[a-z0-9]{12,32}")) return "";
        return u.buildUpon().clearQuery().appendQueryParameter("w", w).build().toString();
    }

    static String appUrl(Context c) {
        String u = url(c);
        int q = u.indexOf('?');
        return q < 0 ? u : u.substring(0, q);
    }

    static JSONObject cached(Context c) {
        try {
            String s = prefs(c).getString("json", null);
            return s == null ? null : new JSONObject(s);
        } catch (Exception e) {
            return null;
        }
    }

    /** 서버에서 새로 받아 보관. 실패하면 예외. */
    static JSONObject fetch(Context c) throws Exception {
        String u = url(c);
        if (u.isEmpty()) throw new IllegalStateException("주소 없음");
        HttpURLConnection con = (HttpURLConnection) new URL(u).openConnection();
        con.setConnectTimeout(15000);
        con.setReadTimeout(40000);
        con.setInstanceFollowRedirects(true);
        try (InputStream in = con.getInputStream()) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            for (int n; (n = in.read(buf)) > 0; ) out.write(buf, 0, n);
            String body = out.toString("UTF-8").trim();
            if (!body.startsWith("{")) throw new IllegalStateException("웹앱 응답이 일정 데이터가 아님 · 배포 액세스가 「모든 사용자」인지 확인");
            JSONObject o = new JSONObject(body);
            prefs(c).edit().putString("json", body).putLong("at", System.currentTimeMillis()).apply();
            return o;
        } finally {
            con.disconnect();
        }
    }

    static String why(Exception e) {
        String m = e.getMessage();
        return m == null || m.isEmpty() ? e.getClass().getSimpleName() : m;
    }

    static final class Row {
        String time, name, info, link;
        boolean done;
    }

    static List<Row> rows(JSONObject o) {
        List<Row> list = new ArrayList<>();
        if (o == null) return list;
        JSONArray a = o.optJSONArray("lines");
        if (a == null) return list;
        boolean today = o.optString("title").startsWith("오늘");
        SimpleDateFormat f = new SimpleDateFormat("HH:mm", Locale.KOREA);
        f.setTimeZone(TimeZone.getTimeZone("Asia/Seoul"));
        String now = f.format(new Date());
        for (int i = 0; i < a.length(); i++) {
            JSONObject l = a.optJSONObject(i);
            if (l == null) continue;
            Row r = new Row();
            r.time = l.optString("time");
            r.name = l.optString("name");
            String area = l.optString("area");
            String kind = (l.optString("kind") + " " + l.optString("units")).trim();
            r.info = area.isEmpty() ? kind : kind.isEmpty() ? area : area + " · " + kind;
            JSONObject nav = l.optJSONObject("nav");
            r.link = nav != null ? nav.optString("tmap") : "";
            if (r.link.isEmpty()) {
                r.link = "https://map.kakao.com/?eName=" + Uri.encode((area + " " + r.name).trim());
            }
            r.done = today && !r.time.isEmpty() && r.time.compareTo(now) < 0;
            list.add(r);
        }
        return list;
    }
}
