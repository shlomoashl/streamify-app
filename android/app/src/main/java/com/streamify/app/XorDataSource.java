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

    // הגודל המוצפן: 64KB הראשונים של השיר
    private static final long ENCRYPTED_BYTES = 65536;
    private long currentPosition = 0;
    private boolean streamEncrypted = true;

    public XorDataSource(DataSource upstream) {
        this.upstream = upstream;
    }

    @Override
    public void addTransferListener(TransferListener transferListener) {
        upstream.addTransferListener(transferListener);
    }

    @Override
    public long open(DataSpec dataSpec) throws IOException {
        currentPosition = dataSpec.position;
        boolean encryptionMode = PlaybackService.isEncryptionEnabled();
        streamEncrypted = encryptionMode;

        Uri uri = dataSpec.uri;
        if (uri != null) {
            String scheme = uri.getScheme();
            if ("file".equalsIgnoreCase(scheme) || "content".equalsIgnoreCase(scheme)) {
                streamEncrypted = false;
            } else if ("http".equalsIgnoreCase(scheme) || "https".equalsIgnoreCase(scheme)) {
                String path = uri.getPath();
                if (path != null && path.contains("/get_audio/")) {
                    Uri.Builder builder = uri.buildUpon().clearQuery();
                    for (String paramName : uri.getQueryParameterNames()) {
                        if (!"enc".equals(paramName)) {
                            for (String val : uri.getQueryParameters(paramName)) {
                                builder.appendQueryParameter(paramName, val);
                            }
                        }
                    }
                    builder.appendQueryParameter("enc", encryptionMode ? "1" : "0");
                    Uri updatedUri = builder.build();
                    dataSpec = dataSpec.buildUpon().setUri(updatedUri).build();
                }
            }
        }

        long openedLength = upstream.open(dataSpec);

        // בדיקת כותרת מהשרת לאימות ודאי אם הזרם מוצפן או רגיל
        Map<String, List<String>> headers = upstream.getResponseHeaders();
        if (headers != null) {
            for (Map.Entry<String, List<String>> entry : headers.entrySet()) {
                if (entry.getKey() != null && "x-stream-enc".equalsIgnoreCase(entry.getKey())) {
                    List<String> values = entry.getValue();
                    if (values != null && !values.isEmpty()) {
                        streamEncrypted = !"0".equals(values.get(0));
                    }
                    break;
                }
            }
        }

        return openedLength;
    }

    @Override
    public int read(byte[] buffer, int offset, int length) throws IOException {
        int bytesRead = upstream.read(buffer, offset, length);
        if (bytesRead > 0) {
            // הגנה כפולה: זיהוי אוטומטי של חתימת MP4 (ftyp בבייטים 4..7) בתחילת הקובץ
            if (currentPosition == 0 && bytesRead >= 8) {
                byte b4 = buffer[offset + 4];
                byte b5 = buffer[offset + 5];
                byte b6 = buffer[offset + 6];
                byte b7 = buffer[offset + 7];
                if (b4 == 0x66 && b5 == 0x74 && b6 == 0x79 && b7 == 0x70) {
                    // הקובץ כבר רגיל ונקי (ftyp) - אסור לבצע XOR!
                    streamEncrypted = false;
                } else if ((b4 ^ XOR_KEY) == 0x66 && (b5 ^ XOR_KEY) == 0x74 &&
                           (b6 ^ XOR_KEY) == 0x79 && (b7 ^ XOR_KEY) == 0x70) {
                    // הקובץ מוצפן ב-XOR
                    streamEncrypted = true;
                }
            }

            if (streamEncrypted && currentPosition < ENCRYPTED_BYTES) {
                int bytesToDecrypt = (int) Math.min(bytesRead, ENCRYPTED_BYTES - currentPosition);
                for (int i = 0; i < bytesToDecrypt; i++) {
                    buffer[offset + i] ^= XOR_KEY;
                }
            }
            currentPosition += bytesRead;
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
