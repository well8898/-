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
    // 웹앱·서버 주소 (Vercel)
    static final String HOST = "my-schedule-henna.vercel.app";
    static final String BASE = "https://" + HOST + "/";

    /** 앱에서 지사·이름을 고르면: 위젯은 그 사람 일정을 서버에서 바로 받음 */
    static void setUser(Context c, String branch, String name) {
        String u = BASE + "api/w?b=" + Uri.encode(branch) + "&n=" + Uri.encode(name);
        SharedPreferences.Editor e = prefs(c).edit().putString("branch", branch).putString("name", name);
        if (!u.equals(url(c))) e.putString("url", u).remove("json").remove("sel");
        e.apply();
    }

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
        // 구글 앱스 스크립트(…/exec?w=) 또는 Vercel(…vercel.app/?w=) 주소
        java.util.regex.Matcher m = java.util.regex.Pattern
                .compile("https://(script\\.google\\.com|[a-z0-9-]+(\\.[a-z0-9-]+)*\\.vercel\\.app)/\\S*").matcher(s);
        if (!m.find()) return "";
        s = m.group();
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

    /** 지금 위젯에 보여 줄 날. 고른 날이 없으면 기본(오늘·다음 근무일) = 응답 맨 위 */
    static JSONObject day(Context c, JSONObject o) {
        if (o == null) return null;
        String sel = prefs(c).getString("sel", "");
        JSONArray days = o.optJSONArray("days");
        if (sel.isEmpty() || days == null) return o;
        for (int i = 0; i < days.length(); i++) {
            JSONObject d = days.optJSONObject(i);
            if (d != null && sel.equals(d.optString("iso"))) return d;
        }
        return o;
    }

    /** ◀ ▶ : 일정표의 근무일 사이를 넘긴다 (끝에서 멈춤). 기본 날로 돌아오면 고른 날을 지운다. */
    static void shift(Context c, int dir) {
        JSONObject o = cached(c);
        JSONArray days = o == null ? null : o.optJSONArray("days");
        if (days == null || days.length() == 0) return;
        String main = o.optString("main");
        String cur = prefs(c).getString("sel", "");
        if (cur.isEmpty()) cur = main;
        int idx = -1;
        for (int i = 0; i < days.length(); i++) if (cur.equals(days.optJSONObject(i).optString("iso"))) idx = i;
        int next = idx < 0 ? (dir > 0 ? 0 : days.length() - 1) : Math.max(0, Math.min(days.length() - 1, idx + dir));
        String iso = days.optJSONObject(next).optString("iso");
        prefs(c).edit().putString("sel", iso.equals(main) ? "" : iso).apply();
    }

    static void resetDay(Context c) {
        prefs(c).edit().remove("sel").apply();
    }

    static final class Row {
        String time, name, info, leg, link, kakao, naver;
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
            // 구간 거리 (지사→12.3km / ↑4.0km / 같은 곳)
            r.leg = l.optString("leg");
            JSONObject nav = l.optJSONObject("nav");
            // 좌표를 못 찾은 현장은 이름으로 검색
            String q = Uri.encode((area + " " + r.name).trim());
            r.link = nav != null ? nav.optString("tmap") : "";
            r.kakao = nav != null ? nav.optString("kakao") : "";
            r.naver = nav != null ? nav.optString("naver") : "";
            if (r.kakao.isEmpty()) r.kakao = "https://map.kakao.com/?eName=" + q;
            if (r.naver.isEmpty()) r.naver = "https://map.naver.com/p/search/" + q;
            if (r.link.isEmpty()) r.link = r.kakao;
            r.done = today && !r.time.isEmpty() && r.time.compareTo(now) < 0;
            list.add(r);
        }
        return list;
    }
}
