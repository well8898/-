package com.well8898.schedulewidget;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.view.View;
import android.widget.RemoteViews;

import org.json.JSONObject;

public class WidgetProvider extends AppWidgetProvider {
    static final String REFRESH = "com.well8898.schedulewidget.REFRESH";
    static final String PREV = "com.well8898.schedulewidget.PREV";
    static final String NEXT = "com.well8898.schedulewidget.NEXT";

    @Override
    public void onUpdate(Context c, AppWidgetManager m, int[] ids) {
        refresh(c, goAsync());
    }

    @Override
    public void onReceive(Context c, Intent i) {
        if (PREV.equals(i.getAction()) || NEXT.equals(i.getAction())) {
            // 날짜 넘기기는 받아 둔 데이터로 바로 (인터넷 안 씀)
            Data.shift(c, NEXT.equals(i.getAction()) ? 1 : -1);
            render(c, Data.cached(c), null);
            return;
        }
        if (REFRESH.equals(i.getAction())) {
            Data.resetDay(c);
            render(c, null, "새로고침 중…");
            refresh(c, goAsync());
            return;
        }
        super.onReceive(c, i);
    }

    /** 앱에서 주소를 저장한 뒤 바로 갱신할 때도 쓴다. */
    static void update(Context c) {
        Intent i = new Intent(c, WidgetProvider.class).setAction(REFRESH);
        c.sendBroadcast(i);
    }

    private static void refresh(Context c, PendingResult pr) {
        render(c, Data.cached(c), null);
        new Thread(() -> {
            String err = null;
            JSONObject o = Data.cached(c);
            Update.check(c, false);
            try {
                if (!Data.url(c).isEmpty()) o = Data.fetch(c);
            } catch (Exception e) {
                err = "연결 실패(" + Data.why(e) + ") · 제목을 눌러 다시 시도";
            }
            render(c, o, err);
            if (pr != null) pr.finish();
        }).start();
    }

    static void render(Context c, JSONObject o, String note) {
        try {
            draw(c, o, note);
        } catch (Exception e) {
            AppWidgetManager m = AppWidgetManager.getInstance(c);
            RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget);
            v.setTextViewText(R.id.title, "위젯 오류");
            v.setTextViewText(R.id.sub, String.valueOf(e));
            m.updateAppWidget(new ComponentName(c, WidgetProvider.class), v);
        }
    }

    private static void draw(Context c, JSONObject o, String note) {
        AppWidgetManager m = AppWidgetManager.getInstance(c);
        int[] ids = m.getAppWidgetIds(new ComponentName(c, WidgetProvider.class));
        boolean hasUrl = !Data.url(c).isEmpty();
        for (int id : ids) {
            RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget);
            JSONObject d = Data.day(c, o);
            int sub = c.getColor(R.color.w_sub);
            v.setTextColor(R.id.sub, sub);
            if (!hasUrl) {
                v.setTextViewText(R.id.title, "오늘 현장");
                v.setTextViewText(R.id.sub, "앱을 열어 이름을 골라 주세요");
            } else if (o == null) {
                v.setTextViewText(R.id.title, "일정 불러오는 중…");
                v.setTextViewText(R.id.sub, note == null ? "" : note);
            } else {
                v.setTextViewText(R.id.title, d.optString("title"));
                String up = o.optString("updated");
                String nv = Update.available(c);
                // 새 버전 안내는 초록색으로 눈에 띄게
                v.setTextColor(R.id.sub, note == null && nv != null ? 0xFF16A34A : sub);
                v.setTextViewText(R.id.sub, note != null ? note
                        : nv != null ? "⬆ 앱 새 버전 " + nv + " · 앱을 열어 업데이트하세요"
                        : d.optString("sub") + (up.isEmpty() ? "" : " · " + up + " 저장"));
            }
            v.setTextViewText(R.id.empty, hasUrl ? "이날은 검사 현장이 없어요" : "앱을 열어 이름을 골라 주세요");

            // 제목 누르면 앱(그날), ↻ 는 기본 날로 돌아가며 새로고침
            String iso = d == null ? "" : d.optString("iso", o == null ? "" : o.optString("main"));
            v.setOnClickPendingIntent(R.id.header, view(c, 2, "schedapp://day" + (iso.isEmpty() ? "" : "?d=" + iso)));
            v.setOnClickPendingIntent(R.id.refresh, hasUrl
                    ? PendingIntent.getBroadcast(c, 1, new Intent(c, WidgetProvider.class).setAction(REFRESH),
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE)
                    : view(c, 1, "schedapp://day"));
            v.setOnClickPendingIntent(R.id.prev, PendingIntent.getBroadcast(c, 7,
                    new Intent(c, WidgetProvider.class).setAction(PREV), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));
            v.setOnClickPendingIntent(R.id.next, PendingIntent.getBroadcast(c, 8,
                    new Intent(c, WidgetProvider.class).setAction(NEXT), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));


            // 하루 경로 (지사 → 현장들 → 마지막 현장). 티맵은 경유지 링크가 없어 빠짐
            String rk = d == null ? "" : d.optString("rk");
            String rv = d == null ? "" : d.optString("rv");
            v.setViewVisibility(R.id.route, rk.isEmpty() ? View.GONE : View.VISIBLE);
            v.setViewVisibility(R.id.route_naver, rv.isEmpty() ? View.GONE : View.VISIBLE);
            if (!rk.isEmpty()) v.setOnClickPendingIntent(R.id.route, view(c, 3, rk));
            if (!rv.isEmpty()) v.setOnClickPendingIntent(R.id.route_naver, view(c, 6, rv));

            // 현장 목록: 줄을 누르면 그 줄의 길안내 주소를 연다
            Intent svc = new Intent(c, RowService.class).putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id);
            svc.setData(Uri.parse(svc.toUri(Intent.URI_INTENT_SCHEME)));
            v.setRemoteAdapter(R.id.list, svc);
            v.setEmptyView(R.id.list, R.id.empty);
            v.setPendingIntentTemplate(R.id.list, PendingIntent.getActivity(c, 5,
                    new Intent(c, NavActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_MUTABLE));
            m.updateAppWidget(id, v);
        }
        m.notifyAppWidgetViewDataChanged(ids, R.id.list);
    }

    private static PendingIntent view(Context c, int code, String url) {
        Intent i = new Intent(c, NavActivity.class).setData(Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        return PendingIntent.getActivity(c, code, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
}
