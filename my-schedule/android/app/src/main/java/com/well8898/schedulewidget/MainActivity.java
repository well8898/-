package com.well8898.schedulewidget;

import android.app.Activity;
import android.appwidget.AppWidgetManager;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.ComponentName;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.text.InputType;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import org.json.JSONObject;

/** 처음 한 번: 웹앱의 「홈 화면 위젯 주소」를 붙여넣고 저장 → 위젯 추가. */
public class MainActivity extends Activity {
    private EditText input;
    private TextView status;

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        getWindow().setStatusBarColor(0xFF12161E);
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        int pad = dp(20);
        box.setPadding(pad, pad, pad, pad);

        box.addView(text("오늘 현장 위젯", 22, Color.WHITE, true));
        box.addView(text("웹앱 아래쪽 「홈 화면 위젯 주소」의 주소를 복사해서 아래에 붙여넣고 저장하세요.", 14, 0xFF8B95A5, false));

        input = new EditText(this);
        input.setHint("https://script.google.com/macros/s/…/exec?w=…");
        input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        input.setTextColor(Color.WHITE);
        input.setHintTextColor(0xFF5B6575);
        input.setTextSize(14);
        input.setText(Data.url(this));
        box.addView(input, lp(dp(14)));

        box.addView(button("붙여넣기", 0xFF222834, v -> paste(true)), lp(dp(10)));
        box.addView(button("저장", 0xFF4C8DFF, v -> save()), lp(dp(10)));
        box.addView(button("홈 화면에 위젯 추가", 0xFF222834, v -> pin()), lp(dp(10)));
        box.addView(button("위젯 새로고침", 0xFF222834, v -> WidgetProvider.update(this)), lp(dp(10)));

        status = text("", 14, 0xFF8B95A5, false);
        box.addView(status, lp(dp(16)));
        box.addView(text("위젯에서: 현장 줄이나 「티맵」을 누르면 길안내, 맨 위 제목을 누르면 새로고침. "
                + "위젯 추가 버튼이 안 되면 홈 화면을 길게 눌러 위젯 → 오늘 현장을 고르세요.", 13, 0xFF8B95A5, false), lp(dp(24)));

        ScrollView sv = new ScrollView(this);
        sv.setBackgroundColor(0xFF12161E);
        sv.addView(box);
        setContentView(sv);
        showSaved();
    }

    @Override
    public void onWindowFocusChanged(boolean focus) {
        super.onWindowFocusChanged(focus);
        // 복사해 둔 주소가 있으면 자동으로 채워 준다
        if (focus && input.getText().toString().trim().isEmpty()) paste(false);
    }

    private void paste(boolean tell) {
        ClipboardManager cm = (ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
        ClipData clip = cm == null ? null : cm.getPrimaryClip();
        String s = clip != null && clip.getItemCount() > 0 && clip.getItemAt(0).getText() != null
                ? clip.getItemAt(0).getText().toString() : "";
        String u = Data.normalize(s);
        if (!u.isEmpty()) input.setText(u);
        else if (tell) status.setText("복사한 내용에 위젯 주소(…/exec?w=…)가 없어요.");
    }

    private void save() {
        String u = Data.normalize(input.getText().toString());
        if (u.isEmpty()) {
            status.setText("주소가 올바르지 않아요. …/exec?w=영문숫자 형태여야 해요.");
            return;
        }
        input.setText(u);
        Data.prefs(this).edit().putString("url", u).remove("json").apply();
        status.setText("확인하는 중…");
        new Thread(() -> {
            String msg;
            try {
                JSONObject o = Data.fetch(this);
                msg = o.optBoolean("ok", true) ? "저장했어요 ✓  " + o.optString("title") : o.optString("title") + " — " + o.optString("text");
            } catch (Exception e) {
                msg = "저장은 했는데 서버에 연결하지 못했어요. 웹앱 배포가 「모든 사용자」인지 확인해 주세요.";
            }
            String m = msg;
            runOnUiThread(() -> {
                status.setText(m);
                WidgetProvider.update(this);
            });
        }).start();
    }

    private void showSaved() {
        JSONObject o = Data.cached(this);
        if (o != null) status.setText("현재 위젯: " + o.optString("title"));
    }

    private void pin() {
        AppWidgetManager m = getSystemService(AppWidgetManager.class);
        if (m != null && m.isRequestPinAppWidgetSupported()) {
            m.requestPinAppWidget(new ComponentName(this, WidgetProvider.class), null, null);
        } else {
            status.setText("이 홈 화면은 자동 추가를 지원하지 않아요. 홈 화면을 길게 눌러 위젯 → 오늘 현장을 추가하세요.");
        }
    }

    private TextView text(String s, int sp, int color, boolean bold) {
        TextView t = new TextView(this);
        t.setText(s);
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp);
        t.setTextColor(color);
        if (bold) t.setTypeface(t.getTypeface(), android.graphics.Typeface.BOLD);
        t.setPadding(0, dp(6), 0, 0);
        return t;
    }

    private Button button(String s, int color, View.OnClickListener l) {
        Button b = new Button(this);
        b.setText(s);
        b.setAllCaps(false);
        b.setTextColor(Color.WHITE);
        b.setTextSize(15);
        b.setGravity(Gravity.CENTER);
        GradientDrawable g = new GradientDrawable();
        g.setColor(color);
        g.setCornerRadius(dp(12));
        b.setBackground(g);
        b.setMinHeight(dp(48));
        b.setOnClickListener(l);
        return b;
    }

    private LinearLayout.LayoutParams lp(int top) {
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        p.topMargin = top;
        return p;
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }
}
