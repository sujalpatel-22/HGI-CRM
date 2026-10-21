package in.hariguru.billing;

import android.os.Bundle;

import androidx.activity.EdgeToEdge;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(HgiNativePlugin.class);
        super.onCreate(savedInstanceState);
        // Edge-to-edge only AFTER BridgeActivity has switched from the splash (launch) theme to
        // AppTheme.NoActionBar. Doing it before super.onCreate() creates the window decor with the
        // launch theme, which leaves a native title bar (with the stretched splash image) over the app
        // on Android 12+. The web header pads itself with the status-bar inset (SystemBars, css mode).
        EdgeToEdge.enable(this);
    }
}
