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
            // 현장 줄을 누르면 앱을 그날로
            web = "schedapp://day" + (iso.isEmpty() ? "" : "?d=" + iso);
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
            v.setTextViewText(R.id.leg, r.leg);
            v.setViewVisibility(R.id.leg, r.leg.isEmpty() ? android.view.View.GONE : android.view.View.VISIBLE);
            // 줄 사이 선(첫 줄 위는 없음), 지난 현장은 흐리게
            v.setViewVisibility(R.id.divider, p == 0 ? android.view.View.GONE : android.view.View.VISIBLE);
            int ink = c.getColor(r.done ? R.color.w_dim : R.color.w_ink);
            int sub = c.getColor(r.done ? R.color.w_dim : R.color.w_sub);
            v.setTextColor(R.id.time, ink);
            v.setTextColor(R.id.name, ink);
            v.setTextColor(R.id.info, sub);
            v.setTextColor(R.id.leg, r.done ? sub : c.getColor(R.color.w_ink));
            // 검사 종류 배지 (정기·정밀·수시·설치, 차분한 색)
            String k = r.kind;
            boolean has = !k.isEmpty();
            v.setViewVisibility(R.id.kind, has ? android.view.View.VISIBLE : android.view.View.GONE);
            if (has) {
                int bg = R.drawable.kb_j, fg = R.color.kb_j;
                if (k.startsWith("정밀")) { bg = R.drawable.kb_m; fg = R.color.kb_m; }
                else if (k.startsWith("수시")) { bg = R.drawable.kb_s; fg = R.color.kb_s; }
                else if (k.startsWith("설치")) { bg = R.drawable.kb_w; fg = R.color.kb_w; }
                v.setTextViewText(R.id.kind, k);
                v.setInt(R.id.kind, "setBackgroundResource", bg);
                v.setTextColor(R.id.kind, c.getColor(fg));
            }
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
