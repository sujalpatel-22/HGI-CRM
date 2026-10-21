package in.hariguru.billing;

import android.os.Bundle;

import androidx.activity.EdgeToEdge;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(HgiNativePlugin.class);
        // Capacitor 8 SystemBars (insetsHandling = css) expects edge-to-edge to be enabled by the app
        EdgeToEdge.enable(this);
        super.onCreate(savedInstanceState);
    }
}
