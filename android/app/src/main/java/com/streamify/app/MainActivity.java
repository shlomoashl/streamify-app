package com.streamify.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(StreamifyMediaPlugin.class);
        super.onCreate(savedInstanceState);

        // Allow auto-play (audio) without user gesture/interaction
        this.getBridge().getWebView().getSettings().setMediaPlaybackRequiresUserGesture(false);
    }
}