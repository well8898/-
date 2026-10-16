package com.well8898.schedulewidget;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.widget.RemoteViews;
import android.widget.RemoteViewsService;

import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

public class RowService extends RemoteViewsService {
    @Override
    public RemoteViewsFactory onGetViewFactory(Intent intent) {
        return new Factory(getApplicationContext());
    }

    static final class Factory implements RemoteViewsFactory {
        private final Context c;
        private List<Data.Row> rows = new ArrayList<>();
        private String web = "";

        Factory(Context c) { this.c = c; }

        @Override public void onCreate() { }
        @Override public void onDestroy() { }
        @Override
        public void onDataSetChanged() {
            JSONObject o = Data.cached(c), d = Data.day(c, o);
            rows = Data.rows(d);
            // 현장 이름 쪽을 누르면 웹앱을 그날 하루 보기로
            String iso = d == null ? "" : d.optString("iso", o.optString("main"));
            String app = Data.appUrl(c);
            web = app.isEmpty() ? "" : app + (iso.isEmpty() ? "" : "?d=" + iso);
        }
        @Override public int getCount() { return rows.size(); }
        @Override public RemoteViews getLoadingView() { return null; }
        @Override public int getViewTypeCount() { return 1; }
        @Override public long getItemId(int p) { return p; }
        @Override public boolean hasStableIds() { return false; }

        @Override
        public RemoteViews getViewAt(int p) {
            RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.row);
            if (p >= rows.size()) return v;
            Data.Row r = rows.get(p);
            v.setTextViewText(R.id.time, r.time);
            v.setTextViewText(R.id.name, r.name);
            v.setTextViewText(R.id.info, r.info);
            // 지난 현장은 흐리게
            int fg = r.done ? 0x66FFFFFF : 0xFFFFFFFF;
            v.setTextColor(R.id.time, fg);
            v.setTextColor(R.id.name, fg);
            v.setTextColor(R.id.info, r.done ? 0x558B95A5 : 0xFF8B95A5);
            // 줄(시간·현장명)은 웹앱 그날 일정, 「티맵」「카카오」「네이버」는 각 앱 길안내
            Intent tmap = new Intent().setData(Uri.parse(r.link));
            v.setOnClickFillInIntent(R.id.row, web.isEmpty() ? tmap : new Intent().setData(Uri.parse(web)));
            v.setOnClickFillInIntent(R.id.go, tmap);
            v.setOnClickFillInIntent(R.id.kakao, new Intent().setData(Uri.parse(r.kakao)));
            v.setOnClickFillInIntent(R.id.naver, new Intent().setData(Uri.parse(r.naver)));
            return v;
        }
    }
}
