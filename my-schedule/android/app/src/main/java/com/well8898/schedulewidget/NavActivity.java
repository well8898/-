package com.well8898.schedulewidget;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;

/** 위젯 줄을 누르면 여기로 와서 그 줄의 길안내 주소를 연다 (안드로이드 14는 위젯 목록에서 바로 여는 방식을 막음). */
public class NavActivity extends Activity {
    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        Uri u = getIntent().getData();
        if (u != null) {
            try {
                startActivity(new Intent(Intent.ACTION_VIEW, u).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            } catch (Exception ignored) {
            }
        }
        finish();
    }
}
