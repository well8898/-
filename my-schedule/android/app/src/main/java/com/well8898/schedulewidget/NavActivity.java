package com.well8898.schedulewidget;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;

import java.util.List;

/**
 * 위젯 줄을 누르면 여기로 와서 길안내를 연다 (안드로이드 14는 위젯 목록에서 바로 여는 방식을 막음).
 * 웹 링크는 「앱을 열어주세요」 페이지에서 멈추기 쉬워서, 좌표가 있으면 각 앱을 바로 연다.
 * 앱이 없거나 열리지 않으면 원래 웹 링크로 연다.
 */
public class NavActivity extends Activity {
    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        Uri u = getIntent().getData();
        if (u != null && !open(direct(u)) && !open(u)) open(fallback(u));
        finish();
    }

    /** 웹 링크 → 앱 직접 실행 주소 */
    static Uri direct(Uri u) {
        String host = String.valueOf(u.getHost());
        if (host.equals("apis.openapi.sk.com")) {
            // 티맵: /tmap/app/routes?name=&lon=&lat=
            String lon = u.getQueryParameter("lon"), lat = u.getQueryParameter("lat");
            if (lon == null || lat == null) return null;
            String name = u.getQueryParameter("name");
            return Uri.parse("tmap://route?goalname=" + Uri.encode(name == null ? "목적지" : name)
                    + "&goalx=" + lon + "&goaly=" + lat);
        }
        if (host.equals("map.kakao.com")) {
            // 카카오맵: /link/to/이름,위도,경도 → 자동차 길찾기
            List<String> seg = u.getPathSegments();
            if (seg.size() >= 3 && seg.get(0).equals("link") && seg.get(1).equals("to")) {
                String[] p = seg.get(2).split(",");
                if (p.length >= 3) return Uri.parse("kakaomap://route?ep=" + p[p.length - 2] + "," + p[p.length - 1] + "&by=CAR");
            }
        }
        return null;
    }

    /** 네이버 지도 앱(nmap://)이 없으면 웹 지도로 (하루 경로는 도착지만) */
    static Uri fallback(Uri u) {
        if ("nmap".equals(u.getScheme())) {
            String name = u.getQueryParameter("dname");
            return Uri.parse("https://map.naver.com/p/search/" + Uri.encode(name == null ? "" : name));
        }
        return null;
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
