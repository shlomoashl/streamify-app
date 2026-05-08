package com.streamify.app;

import android.net.Uri;
import androidx.annotation.Nullable;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.datasource.DataSource;
import androidx.media3.datasource.DataSpec;
import androidx.media3.datasource.TransferListener;

import java.io.IOException;
import java.util.List;
import java.util.Map;

@UnstableApi
public class XorDataSource implements DataSource {
    private final DataSource upstream;
    // חייב להיות בדיוק אותו מפתח הצפנה כמו בפייתון
    private static final byte XOR_KEY = 0x77;
    
    // נגדיר את הגודל המוצפן ל-128KB (שווה ערך ל-2 צ'אנקים של 64KB)
    private static final long ENCRYPTED_BYTES = 131072; 
    private long currentPosition = 0;

    public XorDataSource(DataSource upstream) {
        this.upstream = upstream;
    }

    @Override
    public void addTransferListener(TransferListener transferListener) {
        upstream.addTransferListener(transferListener);
    }

    @Override
    public long open(DataSpec dataSpec) throws IOException {
        // שומרים את המיקום שממנו הנגן מתחיל לבקש את המידע (חשוב מאוד לדילוגים/Seek!)
        currentPosition = dataSpec.position;
        return upstream.open(dataSpec);
    }

    @Override
    public int read(byte[] buffer, int offset, int length) throws IOException {
        int bytesRead = upstream.read(buffer, offset, length);
        if (bytesRead > 0) {
            for (int i = 0; i < bytesRead; i++) {
                // מפענחים אך ורק אם המיקום האבסולוטי של הבייט הוא בתוך ה-128KB הראשונים של השיר
                if (currentPosition < ENCRYPTED_BYTES) {
                    buffer[offset + i] ^= XOR_KEY;
                }
                currentPosition++;
            }
        }
        return bytesRead;
    }

    @Nullable
    @Override
    public Uri getUri() {
        return upstream.getUri();
    }

    @Override
    public void close() throws IOException {
        upstream.close();
    }

    @Override
    public Map<String, List<String>> getResponseHeaders() {
        return upstream.getResponseHeaders();
    }
}