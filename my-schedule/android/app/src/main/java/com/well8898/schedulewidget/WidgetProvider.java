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

    @Override
    public void onUpdate(Context c, AppWidgetManager m, int[] ids) {
        refresh(c, goAsync());
    }

    @Override
    public void onReceive(Context c, Intent i) {
        if (REFRESH.equals(i.getAction())) {
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
            if (!hasUrl) {
                v.setTextViewText(R.id.title, "오늘 현장");
                v.setTextViewText(R.id.sub, "앱을 열어 주소를 넣어 주세요");
            } else if (o == null) {
                v.setTextViewText(R.id.title, "일정 불러오는 중…");
                v.setTextViewText(R.id.sub, note == null ? "" : note);
            } else {
                v.setTextViewText(R.id.title, o.optString("title"));
                v.setTextViewText(R.id.sub, note != null ? note : o.optString("sub"));
            }
            v.setTextViewText(R.id.updated, o == null ? "" : o.optString("updated"));
            v.setTextViewText(R.id.empty, hasUrl ? "표시할 현장이 없어요" : "앱을 열어 내 위젯 주소를 넣어 주세요");

            // 제목 누르면 새로고침 (주소가 없으면 앱 열기)
            PendingIntent head = hasUrl
                    ? PendingIntent.getBroadcast(c, 1, new Intent(c, WidgetProvider.class).setAction(REFRESH),
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE)
                    : PendingIntent.getActivity(c, 2, new Intent(c, MainActivity.class),
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            v.setOnClickPendingIntent(R.id.header, head);

            String rk = o == null ? "" : o.optString("rk");
            v.setViewVisibility(R.id.route, rk.isEmpty() ? View.GONE : View.VISIBLE);
            if (!rk.isEmpty()) v.setOnClickPendingIntent(R.id.route, view(c, 3, rk));
            if (hasUrl) v.setOnClickPendingIntent(R.id.app, view(c, 4, Data.appUrl(c)));
            else v.setOnClickPendingIntent(R.id.app, head);

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
        Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        return PendingIntent.getActivity(c, code, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
}
