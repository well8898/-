package com.well8898.schedulewidget;

import android.app.Activity;
import android.content.res.Configuration;
import android.graphics.Insets;
import android.os.Build;
import android.view.WindowInsets;
import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

/**
 * 앱 화면 = 웹앱(시안 B)을 그대로 띄운다. 처음에 웹앱에서 지사·이름을 고르면
 * AndroidApp.setUser 로 알려 주고, 위젯은 그 이름의 일정을 서버에서 바로 받는다(주소 복사 없음).
 */
public class MainActivity extends Activity {
    private WebView web;
    private TextView update;
    private ValueCallback<Uri[]> fileCb;

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        // 휴대폰이 어두운 모드면 위·아래 띠도 어둡게 (웹 화면 배경색과 같게)
        boolean night = (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
        int bg = night ? 0xFF0F1419 : Color.WHITE;
        getWindow().setStatusBarColor(bg);
        getWindow().setNavigationBarColor(bg);
        if (!night) getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);

        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setBackgroundColor(bg);
        // 안드로이드 15+ 는 화면이 상태 표시줄·내비게이션 바 밑까지 그려짐 → 그만큼 안쪽으로 (키보드가 뜨면 키보드 위로)
        box.setOnApplyWindowInsetsListener((v, ins) -> {
            if (Build.VERSION.SDK_INT >= 30) {
                Insets in = ins.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime());
                v.setPadding(in.left, in.top, in.right, in.bottom);
                return WindowInsets.CONSUMED;
            }
            v.setPadding(ins.getSystemWindowInsetLeft(), ins.getSystemWindowInsetTop(), ins.getSystemWindowInsetRight(), ins.getSystemWindowInsetBottom());
            return ins.consumeSystemWindowInsets();
        });
        // 새 버전이 있으면 맨 위에 초록 띠
        update = new TextView(this);
        update.setBackgroundColor(0xFF16A34A);
        update.setTextColor(Color.WHITE);
        update.setTextSize(15);
        update.setPadding(dp(16), dp(12), dp(16), dp(12));
        update.setVisibility(View.GONE);
        update.setOnClickListener(v -> startActivity(new Intent(Intent.ACTION_VIEW, Update.where(this))));
        box.addView(update, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setSupportMultipleWindows(false); // target=_blank 도 같은 화면 → 아래에서 가로채기
        s.setUserAgentString(s.getUserAgentString() + " ScheduleWidgetApp/" + Update.currentName(this));
        web.addJavascriptInterface(new Bridge(), "AndroidApp");
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                Uri u = r.getUrl();
                // 우리 웹앱은 앱 안에서, 그 밖(길안내·지도·카톡 등)은 해당 앱으로
                if (("https".equals(u.getScheme()) || "http".equals(u.getScheme())) && Data.HOST.equals(u.getHost())) return false;
                openOutside(u);
                return true;
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams p) {
                // 일정표 파일 올리기
                if (fileCb != null) fileCb.onReceiveValue(null);
                fileCb = cb;
                try {
                    startActivityForResult(p.createIntent(), 42);
                } catch (Exception e) {
                    fileCb = null;
                    return false;
                }
                return true;
            }
        });
        box.addView(web, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));
        setContentView(box);

        if (!fromLink(getIntent())) web.loadUrl(startUrl(getIntent()));
        new Thread(() -> {
            Update.check(this, true);
            runOnUiThread(this::showUpdate);
        }).start();
    }

    /** 위젯 줄을 눌러 열면 그날(?d=) 로 */
    private String startUrl(Intent i) {
        String d = i == null ? null : i.getStringExtra("d");
        String q = "?app=1";
        String b = Data.prefs(this).getString("branch", ""), n = Data.prefs(this).getString("name", "");
        if (!b.isEmpty()) q += "&b=" + Uri.encode(b) + (n.isEmpty() ? "" : "&n=" + Uri.encode(n));
        if (d != null && d.matches("\\d{4}-\\d{2}-\\d{2}")) q += "&d=" + d;
        return Data.BASE + q;
    }

    @Override
    protected void onNewIntent(Intent i) {
        super.onNewIntent(i);
        if (!fromLink(i) && i.hasExtra("d")) web.loadUrl(startUrl(i));
    }

    // 예전 방식: 웹앱 「위젯 앱에 바로 연결」 → schedwidget://set?u=위젯주소
    private boolean fromLink(Intent i) {
        Uri d = i == null ? null : i.getData();
        if (d == null || !"schedwidget".equals(d.getScheme())) return false;
        String u = Data.normalize(d.getQueryParameter("u"));
        if (!u.isEmpty()) {
            Data.prefs(this).edit().putString("url", u).remove("json").apply();
            WidgetProvider.update(this);
            pin();
        }
        web.loadUrl(startUrl(null));
        return true;
    }

    private void openOutside(Uri u) {
        try {
            if ("intent".equals(u.getScheme())) {
                startActivity(Intent.parseUri(u.toString(), Intent.URI_INTENT_SCHEME));
                return;
            }
        } catch (Exception e) { /* 아래로 */ }
        // 티맵·카카오맵·네이버지도 웹 링크는 앱으로 바로 (NavActivity 와 같은 규칙)
        startActivity(new Intent(this, NavActivity.class).setData(u));
    }

    @Override
    protected void onActivityResult(int req, int res, Intent data) {
        if (req == 42 && fileCb != null) {
            fileCb.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(res, data));
            fileCb = null;
            return;
        }
        super.onActivityResult(req, res, data);
    }

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    private void showUpdate() {
        String nv = Update.available(this);
        if (nv == null) return;
        update.setText("새 버전 " + nv + "이 나왔어요 · 눌러서 받기");
        update.setVisibility(View.VISIBLE);
    }

    private void pin() {
        AppWidgetManager m = getSystemService(AppWidgetManager.class);
        if (m != null && m.isRequestPinAppWidgetSupported()) {
            m.requestPinAppWidget(new ComponentName(this, WidgetProvider.class), null, null);
        } else {
            Toast.makeText(this, "홈 화면을 길게 눌러 위젯 → 오늘 현장을 추가하세요", Toast.LENGTH_LONG).show();
        }
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }

    /** 웹앱에서 부르는 함수 (window.AndroidApp) */
    final class Bridge {
        @JavascriptInterface
        public void setUser(String branch, String name) {
            if (branch == null || name == null || branch.isEmpty() || name.isEmpty()) return;
            Data.setUser(MainActivity.this, branch, name);
            WidgetProvider.update(MainActivity.this);
        }

        /** 회사 메일 인증 열쇠: 위젯도 이 열쇠로 서버에서 일정을 받음 */
        @JavascriptInterface
        public void setAuth(String token) {
            if (token == null || token.isEmpty() || token.equals(Data.prefs(MainActivity.this).getString("tok", ""))) return;
            Data.prefs(MainActivity.this).edit().putString("tok", token).apply();
            WidgetProvider.update(MainActivity.this);
        }

        @JavascriptInterface
        public void addWidget() {
            runOnUiThread(MainActivity.this::pin);
        }

        @JavascriptInterface
        public String version() {
            return Update.currentName(MainActivity.this);
        }

        /** 「최신인지 확인」: 깃허브에서 새 버전을 바로 확인 → window.onAppUpdate(새버전 또는 '', 지금버전) */
        @JavascriptInterface
        public void checkUpdate() {
            new Thread(() -> {
                Update.check(MainActivity.this, true);
                String nv = Update.available(MainActivity.this);
                runOnUiThread(() -> {
                    showUpdate();
                    web.evaluateJavascript("window.onAppUpdate&&window.onAppUpdate("
                            + org.json.JSONObject.quote(nv == null ? "" : nv) + ","
                            + org.json.JSONObject.quote(Update.currentName(MainActivity.this)) + ")", null);
                });
            }).start();
        }

        /** 새 버전 APK 받기 (브라우저로 내려받아 설치) */
        @JavascriptInterface
        public void openUpdate() {
            runOnUiThread(() -> {
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, Update.where(MainActivity.this)));
                } catch (Exception e) {
                    startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse("https://play.google.com/store/apps/details?id=" + getPackageName())));
                }
            });
        }

        /** 플레이스토어에서 받은 앱인가 (그러면 화면에서 「앱 새 버전 받기」를 안 보여 줌 — 스토어가 업데이트) */
        @JavascriptInterface
        public boolean store() {
            return BuildConfig.STORE;
        }
    }
}
