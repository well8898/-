package com.well8898.schedulewidget;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.widget.RemoteViews;
import android.widget.RemoteViewsService;

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

        Factory(Context c) { this.c = c; }

        @Override public void onCreate() { }
        @Override public void onDestroy() { }
        @Override public void onDataSetChanged() { rows = Data.rows(Data.cached(c)); }
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
            v.setTextColor(R.id.go, fg);
            v.setInt(R.id.go, "setBackgroundResource", r.done ? R.drawable.pill_dim : R.drawable.pill);
            Intent fill = new Intent().setData(Uri.parse(r.link));
            v.setOnClickFillInIntent(R.id.row, fill);
            v.setOnClickFillInIntent(R.id.go, fill);
            return v;
        }
    }
}
