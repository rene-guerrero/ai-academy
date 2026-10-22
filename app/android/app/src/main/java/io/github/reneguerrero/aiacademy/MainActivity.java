package io.github.reneguerrero.aiacademy;

import android.content.Intent;
import android.content.res.Configuration;
import android.net.Uri;
import android.graphics.Color;
import android.os.Bundle;
import android.view.View;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    private static final String BACK_SCRIPT = "(function(){var d=document.querySelectorAll('dialog[open]');if(!d.length)return false;var x=d[d.length-1];if(x.dispatchEvent(new Event('cancel',{cancelable:true})))x.close();return true;})()";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        if (savedInstanceState != null && getIntent() != null) {
            getIntent().removeExtra(AcademyWidget.EXTRA_URL);
        }
        registerPlugin(WidgetBridgePlugin.class);
        super.onCreate(savedInstanceState);
        View root = findViewById(android.R.id.content);
        ViewCompat.setOnApplyWindowInsetsListener(root, (view, insets) -> {
            Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout() | WindowInsetsCompat.Type.ime());
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            return WindowInsetsCompat.CONSUMED;
        });
        applyBarColors();
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                handleBack();
            }
        });
        openWidgetUrl(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        openWidgetUrl(intent);
    }

    private void openWidgetUrl(Intent intent) {
        Bridge current = getBridge();
        if (intent == null || current == null || current.getWebView() == null) return;
        Uri data = intent.getData();
        if (data != null && "aiacademy".equals(data.getScheme()) && "auth".equals(data.getHost())) {
            intent.setData(null);
            String query = data.getQueryParameter("q");
            String hash = data.getQueryParameter("h");
            StringBuilder target = new StringBuilder("https://rene-guerrero.github.io/ai-academy/index.html");
            if (query != null && !query.isEmpty()) target.append('?').append(query);
            if (hash != null && !hash.isEmpty()) target.append('#').append(hash);
            current.getWebView().loadUrl(target.toString());
            return;
        }
        String url = intent.getStringExtra(AcademyWidget.EXTRA_URL);
        if (url == null) return;
        intent.removeExtra(AcademyWidget.EXTRA_URL);
        if (AcademyWidget.isAllowedUrl(url)) current.getWebView().loadUrl(url);
    }

    private void handleBack() {
        Bridge current = getBridge();
        WebView web = current == null ? null : current.getWebView();
        if (web == null) {
            moveTaskToBack(true);
            return;
        }
        web.evaluateJavascript(BACK_SCRIPT, value -> {
            if ("true".equals(value)) return;
            if (web.canGoBack()) web.goBack();
            else moveTaskToBack(true);
        });
    }

    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        applyBarColors();
    }

    private void applyBarColors() {
        boolean dark = (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
        int color = dark ? Color.rgb(17, 17, 18) : Color.rgb(245, 245, 247);
        View root = findViewById(android.R.id.content);
        root.setBackgroundColor(color);
        getWindow().getDecorView().setBackgroundColor(color);
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        controller.setAppearanceLightStatusBars(!dark);
        controller.setAppearanceLightNavigationBars(!dark);
    }
}
