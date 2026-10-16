package com.well8898.schedulewidget;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;

/**
 * 위젯 줄을 누르면 여기로 와서 길안내를 연다 (안드로이드 14는 위젯 목록에서 바로 여는 방식을 막음).
 * 티맵 링크는 웹 페이지를 거치면 「TMAP 앱을 열어주세요」에서 멈추므로 좌표로 티맵 앱을 바로 연다.
 */
public class NavActivity extends Activity {
    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        Uri u = getIntent().getData();
        if (u != null && !open(tmapApp(u))) open(u);
        finish();
    }

    /** apis.openapi.sk.com/tmap/app/routes?name=&lon=&lat= → tmap://route?goalname=&goalx=&goaly= */
    static Uri tmapApp(Uri u) {
        if (!"apis.openapi.sk.com".equals(u.getHost())) return null;
        String lon = u.getQueryParameter("lon"), lat = u.getQueryParameter("lat");
        if (lon == null || lat == null) return null;
        String name = u.getQueryParameter("name");
        return Uri.parse("tmap://route?goalname=" + Uri.encode(name == null ? "목적지" : name)
                + "&goalx=" + lon + "&goaly=" + lat);
    }

    private boolean open(Uri u) {
        if (u == null) return false;
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, u).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            return true;
        } catch (Exception e) {
            return false;
        }
    }
}
