package com.streamify.app;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.NetworkRequest;
import android.net.Uri;
import android.net.wifi.WifiManager;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.annotation.OptIn;
import androidx.media3.common.AudioAttributes;
import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MediaMetadata;
import androidx.media3.common.MimeTypes;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.datasource.DataSource;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.datasource.HttpDataSource;
import androidx.media3.exoplayer.DefaultLoadControl;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;
import androidx.media3.session.MediaSession;
import androidx.media3.session.MediaSessionService;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.EOFException;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.net.ConnectException;
import java.net.HttpURLConnection;
import java.net.NoRouteToHostException;
import java.net.SocketTimeoutException;
import java.net.URL;
import java.net.UnknownHostException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import javax.net.ssl.SSLException;

public class PlaybackService extends MediaSessionService {
    private static final String TAG = "PlaybackService";
    public static final String PREFS_NAME = "StreamifyPlaybackState";

    // קבצי גיבוי אטומיים עם סנכרון חומרה (fsync) שמבטיחים 100% שרידות בכיבוי סוויץ' מיידי ברכב
    private static final String CHECKPOINT_FILE = "streamify_checkpoint.json";
    private static final String CHECKPOINT_BAK_FILE = "streamify_checkpoint.bak";
    private static final String QUEUE_FILE = "streamify_queue.json";
    private static final String QUEUE_BAK_FILE = "streamify_queue.bak";

    private static volatile PlaybackService instance;
    private static volatile boolean bootAutoPlayHandled = false;
    private static volatile boolean encryptionEnabled = true;

    private MediaSession mediaSession;
    private ExoPlayer player;

    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final Handler retryHandler = new Handler(Looper.getMainLooper());
    // תהליכון ייעודי לכתיבת fsync לדיסק בלי לתקוע את ה-Main Thread
    private final ExecutorService diskExecutor = Executors.newSingleThreadExecutor();

    private PowerManager.WakeLock transitionWakeLock;
    private WifiManager.WifiLock wifiLock;
    private ConnectivityManager connectivityManager;
    private ConnectivityManager.NetworkCallback networkCallback;

    // דגלי בקרה קריטיים (Single Source of Truth)
    private volatile boolean isRestoringState = false;
    private volatile boolean userPaused = true;
    private volatile boolean waitingForNetwork = false;
    private volatile String currentContextId = "";
    private volatile boolean currentIsShuffled = false;

    // ניהול שגיאות חכם
    private int consecutiveSongErrors = 0;
    private int networkRetryCount = 0;
    private static final int MAX_CONSECUTIVE_SONG_ERRORS = 3;
    private static final int MAX_NETWORK_RETRIES = 4;

    // מניעת חימום כפול לאותו שיר
    private String lastWarmedUpForSongId = null;

    // שמירה מחזורית כל 2 שניות עבור מולטימדיה לרכב (שומרת גם את השיר הנוכחי וגם את המיקום עם fsync!)
    private final Runnable saveRunnable = new Runnable() {
        @Override
        public void run() {
            try {
                if (player != null && !isRestoringState && player.isPlaying()
                        && player.getPlaybackState() == Player.STATE_READY) {
                    long currentPos = player.getCurrentPosition();
                    long duration = player.getDuration();
                    MediaItem currentItem = player.getCurrentMediaItem();
                    int currentIndex = player.getCurrentMediaItemIndex();

                    // שומרים גם את פרטי השיר הנוכחי וגם את המיקום בכל 2 שניות!
                    if (currentItem != null && currentPos >= 1000) {
                        persistLivePlayerState(currentItem, currentIndex, currentPos, duration, false);
                    }

                    // איפוס מונה שגיאות שירים + חימום השיר הבא רק אחרי 5 שניות של ניגון יציב!
                    if (currentPos >= 5000) {
                        consecutiveSongErrors = 0;
                        networkRetryCount = 0;
                        waitingForNetwork = false;
                        maybeWarmupNextTrack();
                    }
                }
            } catch (Exception e) {
                Log.e(TAG, "Error in periodic saveRunnable", e);
            }
            mainHandler.postDelayed(this, 2000);
        }
    };

    public static PlaybackService getInstance() {
        return instance;
    }

    public static boolean isBootAutoPlayHandled() {
        return bootAutoPlayHandled;
    }

    public static void markBootAutoPlayHandled() {
        bootAutoPlayHandled = true;
    }

    public static boolean isEncryptionEnabled() {
        return encryptionEnabled;
    }

    public static void setEncryptionEnabledStatic(Context context, boolean enabled) {
        encryptionEnabled = enabled;
        if (context != null) {
            SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            prefs.edit().putBoolean("encryption_enabled", enabled).commit();
        }
    }

    public boolean isUserPaused() {
        return userPaused;
    }

    public void setUserPaused(boolean paused) {
        this.userPaused = paused;
        if (paused) {
            this.waitingForNetwork = false;
            retryHandler.removeCallbacksAndMessages(null);
            saveCurrentPositionSafely(true);
        } else {
            SharedPreferences prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            prefs.edit().putBoolean("user_paused", false).commit();
        }
    }

    @OptIn(markerClass = UnstableApi.class)
    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;

        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        encryptionEnabled = prefs.getBoolean("encryption_enabled", true);

        initLocks();
        initNetworkMonitor();

        String userAgent = "Streamify";
        DefaultHttpDataSource.Factory httpDataSourceFactory = new DefaultHttpDataSource.Factory()
                .setAllowCrossProtocolRedirects(true)
                .setUserAgent(userAgent)
                .setConnectTimeoutMs(20000)
                .setReadTimeoutMs(25000);

        DataSource.Factory xorDataSourceFactory = () -> new XorDataSource(httpDataSourceFactory.createDataSource());

        DefaultMediaSourceFactory mediaSourceFactory = new DefaultMediaSourceFactory(this)
                .setDataSourceFactory(xorDataSourceFactory);

        DefaultLoadControl loadControl = new DefaultLoadControl.Builder()
                .setBufferDurationsMs(
                        30000, // Min buffer 30s
                        60000, // Max buffer 60s
                        500,   // Buffer for playback start
                        1000   // Buffer for playback after rebuffer
                )
                .setPrioritizeTimeOverSizeThresholds(true)
                .build();

        player = new ExoPlayer.Builder(this)
                .setMediaSourceFactory(mediaSourceFactory)
                .setLoadControl(loadControl)
                .setWakeMode(C.WAKE_MODE_NETWORK)
                .setHandleAudioBecomingNoisy(true)
                .build();

        AudioAttributes audioAttributes = new AudioAttributes.Builder()
                .setUsage(C.USAGE_MEDIA)
                .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
                .build();
        player.setAudioAttributes(audioAttributes, true);

        setupPlayerListeners();

        mediaSession = new MediaSession.Builder(this, player).build();
        restoreLastPlayedState();
        mainHandler.post(saveRunnable);
    }

    // =========================================================================
    // מנגנון כתיבה וקריאה אטומי עם FileDescriptor.sync() (fsync לחומרת הפלאש ברכב)
    // =========================================================================

    private static void writeAtomicSyncedFile(Context context, String fileName, String bakName, String content) {
        synchronized (PlaybackService.class) {
            File dir = context.getFilesDir();
            File mainFile = new File(dir, fileName);
            File bakFile = new File(dir, bakName);
            File tmpFile = new File(dir, fileName + ".tmp");

            try {
                byte[] bytes = content.getBytes(StandardCharsets.UTF_8);

                // 1. כתיבה לקובץ זמני + fsync שמכריח את בקר ה-eMMC ברכב לצרוב פיזית לזיכרון הפלאש
                try (FileOutputStream fos = new FileOutputStream(tmpFile)) {
                    fos.write(bytes);
                    fos.flush();
                    fos.getFD().sync();
                }

                // 2. גיבוי הקובץ התקין הקודם (למקרה שהחשמל ברכב ייפול בדיוק במילישנייה של ההחלפה)
                if (mainFile.exists() && mainFile.length() > 10) {
                    if (bakFile.exists()) {
                        bakFile.delete();
                    }
                    mainFile.renameTo(bakFile);
                }

                // 3. החלפה אטומית לקובץ הראשי
                tmpFile.renameTo(mainFile);
            } catch (Exception e) {
                Log.e(TAG, "Failed to write atomic synced file " + fileName, e);
            }
        }
    }

    private static String readAtomicSyncedFile(Context context, String fileName, String bakName) {
        synchronized (PlaybackService.class) {
            File dir = context.getFilesDir();
            File mainFile = new File(dir, fileName);
            File bakFile = new File(dir, bakName);

            String content = readFileSafely(mainFile);
            if (content != null && !content.trim().isEmpty()) {
                return content;
            }

            Log.w(TAG, "Primary file " + fileName + " missing or empty, recovering from backup " + bakName);
            return readFileSafely(bakFile);
        }
    }

    private static String readFileSafely(File file) {
        if (file == null || !file.exists() || file.length() == 0) return null;
        try (FileInputStream fis = new FileInputStream(file);
             ByteArrayOutputStream bos = new ByteArrayOutputStream((int) file.length())) {
            byte[] buf = new byte[4096];
            int n;
            while ((n = fis.read(buf)) != -1) {
                bos.write(buf, 0, n);
            }
            return bos.toString("UTF-8");
        } catch (Exception e) {
            return null;
        }
    }

    public static JSONObject readBestSavedCheckpoint(Context context) {
        try {
            String raw = readAtomicSyncedFile(context, CHECKPOINT_FILE, CHECKPOINT_BAK_FILE);
            if (raw != null) {
                JSONObject obj = new JSONObject(raw);
                if (!obj.optString("id", "").isEmpty()) {
                    return obj;
                }
            }
        } catch (Exception e) {
            Log.w(TAG, "Failed to parse checkpoint JSON, falling back to SharedPreferences", e);
        }

        // Fallback ל-SharedPreferences
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        String id = prefs.getString("last_id", "");
        if (id != null && !id.isEmpty()) {
            try {
                JSONObject fallback = new JSONObject();
                fallback.put("id", id);
                fallback.put("url", prefs.getString("last_url", ""));
                fallback.put("title", prefs.getString("last_title", ""));
                fallback.put("artist", prefs.getString("last_artist", ""));
                fallback.put("artwork", prefs.getString("last_artwork", ""));
                fallback.put("contextId", prefs.getString("last_context_id", ""));
                fallback.put("isShuffled", prefs.getBoolean("is_shuffled", false));
                fallback.put("index", prefs.getInt("last_index", 0));
                fallback.put("position", prefs.getLong("last_position", 0));
                fallback.put("duration", prefs.getLong("last_duration", 0));
                fallback.put("userPaused", prefs.getBoolean("user_paused", true));
                return fallback;
            } catch (Exception ignored) {}
        }
        return null;
    }

    public static JSONArray readBestSavedQueue(Context context) {
        try {
            String raw = readAtomicSyncedFile(context, QUEUE_FILE, QUEUE_BAK_FILE);
            if (raw != null) {
                JSONArray arr = new JSONArray(raw);
                if (arr.length() > 0) return arr;
            }
        } catch (Exception e) {
            Log.w(TAG, "Failed to parse queue file, falling back to SharedPreferences", e);
        }

        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        String qJson = prefs.getString("queue_json", null);
        if (qJson != null && !qJson.isEmpty()) {
            try {
                return new JSONArray(qJson);
            } catch (Exception ignored) {}
        }
        return null;
    }

    private void persistCheckpointToDisk(
            final String id,
            final String url,
            final String title,
            final String artist,
            final String artwork,
            final String contextId,
            final boolean isShuffled,
            final int index,
            final long posMs,
            final long durationMs,
            final boolean paused,
            final boolean runSynchronously
    ) {
        if (id == null || id.isEmpty()) return;

        Runnable writeTask = () -> {
            try {
                Context ctx = getApplicationContext();
                SharedPreferences prefs = ctx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
                SharedPreferences.Editor editor = prefs.edit();
                editor.putString("last_id", id);
                if (url != null && !url.isEmpty()) editor.putString("last_url", url);
                if (title != null) editor.putString("last_title", title);
                if (artist != null) editor.putString("last_artist", artist);
                if (artwork != null) editor.putString("last_artwork", artwork);
                if (contextId != null && !contextId.isEmpty()) editor.putString("last_context_id", contextId);
                editor.putBoolean("is_shuffled", isShuffled);
                editor.putInt("last_index", index);
                editor.putLong("last_position", Math.max(0L, posMs));
                if (durationMs > 0) editor.putLong("last_duration", durationMs);
                editor.putBoolean("user_paused", paused);
                editor.commit();

                JSONObject cp = new JSONObject();
                cp.put("id", id);
                cp.put("url", url != null ? url : "");
                cp.put("title", title != null ? title : "");
                cp.put("artist", artist != null ? artist : "");
                cp.put("artwork", artwork != null ? artwork : "");
                cp.put("contextId", contextId != null ? contextId : "");
                cp.put("isShuffled", isShuffled);
                cp.put("index", index);
                cp.put("position", Math.max(0L, posMs));
                cp.put("duration", Math.max(0L, durationMs));
                cp.put("userPaused", paused);
                cp.put("updatedAt", System.currentTimeMillis());

                writeAtomicSyncedFile(ctx, CHECKPOINT_FILE, CHECKPOINT_BAK_FILE, cp.toString());
            } catch (Exception e) {
                Log.e(TAG, "Error persisting checkpoint to disk", e);
            }
        };

        if (runSynchronously) {
            writeTask.run();
        } else {
            diskExecutor.execute(writeTask);
        }
    }

    private void persistLivePlayerState(@NonNull MediaItem item, int index, long posMs, long durationMs, boolean syncNow) {
        String id = item.mediaId;
        if (id == null || id.isEmpty()) return;

        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        String url = (item.localConfiguration != null && item.localConfiguration.uri != null)
                ? item.localConfiguration.uri.toString()
                : prefs.getString("last_url", "");

        String title = "";
        String artist = "";
        String artwork = "";
        String contextId = this.currentContextId;

        if (item.mediaMetadata != null) {
            if (item.mediaMetadata.title != null) title = item.mediaMetadata.title.toString();
            if (item.mediaMetadata.artist != null) artist = item.mediaMetadata.artist.toString();
            if (item.mediaMetadata.artworkUri != null) artwork = item.mediaMetadata.artworkUri.toString();
            if ((contextId == null || contextId.isEmpty())
                    && item.mediaMetadata.extras != null
                    && item.mediaMetadata.extras.containsKey("contextId")) {
                contextId = item.mediaMetadata.extras.getString("contextId", "");
                this.currentContextId = contextId;
            }
        }

        if (contextId == null || contextId.isEmpty()) {
            contextId = prefs.getString("last_context_id", "");
        }

        persistCheckpointToDisk(
                id,
                url,
                title,
                artist,
                artwork,
                contextId,
                this.currentIsShuffled,
                Math.max(0, index),
                posMs,
                durationMs > 0 ? durationMs : 0L,
                this.userPaused,
                syncNow
        );
    }

    private void initLocks() {
        try {
            PowerManager powerManager = (PowerManager) getSystemService(Context.POWER_SERVICE);
            if (powerManager != null) {
                transitionWakeLock = powerManager.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Streamify:TransitionWakeLock");
                transitionWakeLock.setReferenceCounted(false);
            }
            WifiManager wifiManager = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
            if (wifiManager != null) {
                wifiLock = wifiManager.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "Streamify:WifiLock");
                wifiLock.setReferenceCounted(false);
            }
        } catch (Exception e) {
            Log.w(TAG, "Failed to initialize locks", e);
        }
    }

    private void acquireTransitionWakeLock(long timeoutMs) {
        try {
            if (transitionWakeLock != null) {
                transitionWakeLock.acquire(timeoutMs);
            }
        } catch (Exception ignored) {}
    }

    private void setWifiLock(boolean active) {
        if (wifiLock == null) return;
        try {
            if (active) {
                if (!wifiLock.isHeld()) wifiLock.acquire();
            } else {
                if (wifiLock.isHeld()) wifiLock.release();
            }
        } catch (Exception ignored) {}
    }

    private boolean isNetworkConnected() {
        try {
            if (connectivityManager == null) {
                connectivityManager = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
            }
            if (connectivityManager == null) return true;
            Network network = connectivityManager.getActiveNetwork();
            if (network == null) return false;
            NetworkCapabilities caps = connectivityManager.getNetworkCapabilities(network);
            return caps != null && caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);
        } catch (Exception e) {
            return true;
        }
    }

    private void initNetworkMonitor() {
        try {
            connectivityManager = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
            if (connectivityManager == null) return;

            networkCallback = new ConnectivityManager.NetworkCallback() {
                @Override
                public void onAvailable(@NonNull Network network) {
                    mainHandler.post(() -> {
                        PluginEvents.postEvent("networkRestored", null);
                        if (waitingForNetwork && !userPaused && player != null) {
                            Log.i(TAG, "Network restored while waitingForNetwork=true. Resuming current track in 1.5s...");
                            retryHandler.removeCallbacksAndMessages(null);
                            retryHandler.postDelayed(() -> {
                                if (!userPaused && player != null && waitingForNetwork) {
                                    waitingForNetwork = false;
                                    networkRetryCount = 0;
                                    resumeCurrentTrackFromSavedPosition();
                                }
                            }, 1500);
                        }
                    });
                }

                @Override
                public void onLost(@NonNull Network network) {
                    mainHandler.post(() -> {
                        if (!isNetworkConnected()) {
                            PluginEvents.postEvent("networkLost", null);
                        }
                    });
                }
            };

            NetworkRequest request = new NetworkRequest.Builder()
                    .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                    .build();
            connectivityManager.registerNetworkCallback(request, networkCallback);
        } catch (Exception e) {
            Log.w(TAG, "Failed to register NetworkCallback", e);
        }
    }

    private void resumeCurrentTrackFromSavedPosition() {
        if (player == null || userPaused || player.getMediaItemCount() == 0) return;
        JSONObject cp = readBestSavedCheckpoint(this);
        long savedPos = cp != null ? cp.optLong("position", 0) : 0;
        long currentPos = player.getCurrentPosition();
        long targetPos = Math.max(savedPos, currentPos);

        int currentIndex = player.getCurrentMediaItemIndex();
        if (currentIndex < 0) currentIndex = 0;

        Log.i(TAG, "Resuming track at index " + currentIndex + " from position " + targetPos + "ms");
        player.seekTo(currentIndex, Math.max(0L, targetPos));
        player.prepare();
        player.play();
    }

    private void setupPlayerListeners() {
        player.addListener(new Player.Listener() {
            @Override
            public void onMediaItemTransition(@Nullable MediaItem mediaItem, int reason) {
                if (mediaItem == null || isRestoringState) return;

                acquireTransitionWakeLock(10000);
                saveTrackMetadataOnTransition(mediaItem, reason);
                PluginEvents.postEvent("itemTransition", mediaItem.mediaId);
            }

            @Override
            public void onPlayWhenReadyChanged(boolean playWhenReady, int reason) {
                if (!playWhenReady && (
                        reason == Player.PLAY_WHEN_READY_CHANGE_REASON_USER_REQUEST ||
                        reason == Player.PLAY_WHEN_READY_CHANGE_REASON_AUDIO_BECOMING_NOISY ||
                        reason == Player.PLAY_WHEN_READY_CHANGE_REASON_AUDIO_FOCUS_LOSS)) {
                    setUserPaused(true);
                } else if (playWhenReady && reason == Player.PLAY_WHEN_READY_CHANGE_REASON_USER_REQUEST) {
                    setUserPaused(false);
                    markBootAutoPlayHandled();
                }
            }

            @Override
            public void onPlaybackStateChanged(int playbackState) {
                if (player == null) return;

                boolean active = !userPaused && player.getPlayWhenReady() &&
                        (playbackState == Player.STATE_READY || playbackState == Player.STATE_BUFFERING);
                setWifiLock(active);

                if (playbackState == Player.STATE_ENDED) {
                    PluginEvents.postEvent("playbackState", false);
                    PluginEvents.postEvent("completed", null);
                } else {
                    PluginEvents.postEvent("playbackState", active);
                }
            }

            @Override
            public void onIsPlayingChanged(boolean isPlaying) {
                setWifiLock(isPlaying);
                if (!isPlaying && !isRestoringState) {
                    saveCurrentPositionSafely(false);
                }
                PluginEvents.postEvent("playbackState", isPlaying && !userPaused);
            }

            @Override
            public void onPlayerError(@NonNull PlaybackException error) {
                handlePlayerErrorInternal(error);
            }
        });
    }

    private void handlePlayerErrorInternal(@NonNull PlaybackException error) {
        Log.e(TAG, "ExoPlayer Error (" + error.getErrorCodeName() + "): " + error.getMessage(), error);
        retryHandler.removeCallbacksAndMessages(null);
        saveCurrentPositionSafely(false);

        if (userPaused) {
            Log.i(TAG, "Ignoring player error because userPaused=true");
            PluginEvents.postEvent("playbackState", false);
            return;
        }

        if (isNetworkOrTransientError(error)) {
            waitingForNetwork = true;
            Log.w(TAG, "Network/Transient error detected. Will NOT skip song. Waiting/retrying same track.");

            if (isNetworkConnected() && networkRetryCount < MAX_NETWORK_RETRIES) {
                networkRetryCount++;
                long delayMs = 2500L * networkRetryCount;
                Log.i(TAG, "Scheduling same-track retry #" + networkRetryCount + " in " + delayMs + "ms");
                retryHandler.postDelayed(() -> {
                    if (!userPaused && player != null) {
                        resumeCurrentTrackFromSavedPosition();
                    }
                }, delayMs);
            } else {
                PluginEvents.postEvent("networkWait", "ממתין לחיבור רשת יציב...");
            }
            return;
        }

        consecutiveSongErrors++;
        Log.w(TAG, "Track-specific error! consecutiveSongErrors=" + consecutiveSongErrors + "/" + MAX_CONSECUTIVE_SONG_ERRORS);

        if (consecutiveSongErrors <= MAX_CONSECUTIVE_SONG_ERRORS && player != null && player.hasNextMediaItem()) {
            String failedId = player.getCurrentMediaItem() != null ? player.getCurrentMediaItem().mediaId : "";
            PluginEvents.postEvent("songSkipped", failedId);

            retryHandler.postDelayed(() -> {
                if (!userPaused && player != null && player.hasNextMediaItem()) {
                    acquireTransitionWakeLock(10000);
                    player.seekToNextMediaItem();
                    player.prepare();
                    player.play();
                }
            }, 1200);
        } else {
            Log.e(TAG, "Stopping playback: reached max consecutive track errors (" + consecutiveSongErrors + ")");
            setUserPaused(true);
            if (player != null) {
                player.pause();
            }
            consecutiveSongErrors = 0;
            PluginEvents.postEvent("playbackState", false);
            PluginEvents.postEvent("error", "מספר שירים נכשלו בטעינה ברצף. הניגון נעצר.");
        }
    }

    @OptIn(markerClass = UnstableApi.class)
    private boolean isNetworkOrTransientError(@NonNull PlaybackException error) {
        if (!isNetworkConnected()) {
            return true;
        }

        if (error.errorCode == PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED ||
            error.errorCode == PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT) {
            return true;
        }

        Throwable cause = error.getCause();
        while (cause != null) {
            if (cause instanceof UnknownHostException ||
                cause instanceof SocketTimeoutException ||
                cause instanceof ConnectException ||
                cause instanceof NoRouteToHostException ||
                cause instanceof SSLException ||
                cause instanceof EOFException) {
                return true;
            }
            if (cause instanceof HttpDataSource.InvalidResponseCodeException) {
                int responseCode = ((HttpDataSource.InvalidResponseCodeException) cause).responseCode;
                if (responseCode == 503 || responseCode == 504 || responseCode == 429) {
                    return true;
                }
                return false;
            }
            cause = cause.getCause();
        }

        return false;
    }

    private void maybeWarmupNextTrack() {
        if (player == null || userPaused) return;
        MediaItem current = player.getCurrentMediaItem();
        if (current == null || current.mediaId.equals(lastWarmedUpForSongId)) return;

        int nextIdx = player.getNextMediaItemIndex();
        if (nextIdx == C.INDEX_UNSET || nextIdx >= player.getMediaItemCount()) return;

        MediaItem nextItem = player.getMediaItemAt(nextIdx);
        if (nextItem.localConfiguration == null || nextItem.localConfiguration.uri == null) return;

        lastWarmedUpForSongId = current.mediaId;
        String nextUrl = nextItem.localConfiguration.uri.toString();
        triggerServerSideWarmup(nextUrl);
    }

    public void triggerServerSideWarmup(String streamUrl) {
        if (streamUrl == null || streamUrl.isEmpty() || userPaused) return;

        new Thread(() -> {
            HttpURLConnection conn = null;
            try {
                Log.d(TAG, "Warming up next track on server: " + streamUrl);
                URL urlObj = new URL(streamUrl);
                conn = (HttpURLConnection) urlObj.openConnection();
                conn.setRequestMethod("GET");
                conn.setRequestProperty("User-Agent", "Streamify");
                conn.setRequestProperty("Range", "bytes=0-1023");
                conn.setConnectTimeout(10000);
                conn.setReadTimeout(10000);

                int code = conn.getResponseCode();
                Log.d(TAG, "Server warmup response code: " + code);
            } catch (Exception e) {
                Log.w(TAG, "Warmup request failed: " + e.getMessage());
            } finally {
                if (conn != null) {
                    try { conn.disconnect(); } catch (Exception ignored) {}
                }
            }
        }).start();
    }

    public void saveQueueToPrefs(JSONArray itemsArray, int startIndex, String contextId, boolean isShuffled, long startPosMs) {
        try {
            if (contextId != null && !contextId.isEmpty()) {
                this.currentContextId = contextId;
            }
            this.currentIsShuffled = isShuffled;

            JSONObject prevCp = readBestSavedCheckpoint(this);
            String prevSavedId = prevCp != null ? prevCp.optString("id", "") : "";
            long prevSavedPos = prevCp != null ? prevCp.optLong("position", 0) : 0;

            if (itemsArray != null && itemsArray.length() > 0) {
                final String queueStr = itemsArray.toString();
                diskExecutor.execute(() -> {
                    Context ctx = getApplicationContext();
                    ctx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                            .edit()
                            .putString("queue_json", queueStr)
                            .commit();
                    writeAtomicSyncedFile(ctx, QUEUE_FILE, QUEUE_BAK_FILE, queueStr);
                });

                int safeIdx = Math.max(0, Math.min(startIndex, itemsArray.length() - 1));
                JSONObject currentObj = itemsArray.optJSONObject(safeIdx);
                if (currentObj != null) {
                    String newId = currentObj.optString("id", "");
                    long effectivePos = 0L;
                    if (startPosMs >= 0) {
                        effectivePos = startPosMs;
                    } else if (newId.equals(prevSavedId) && prevSavedPos >= 1000) {
                        effectivePos = prevSavedPos;
                    }

                    persistCheckpointToDisk(
                            newId,
                            currentObj.optString("url", ""),
                            currentObj.optString("title", ""),
                            currentObj.optString("artist", ""),
                            currentObj.optString("artwork", ""),
                            this.currentContextId,
                            this.currentIsShuffled,
                            safeIdx,
                            effectivePos,
                            0L,
                            this.userPaused,
                            false
                    );
                }
            }
        } catch (Exception e) {
            Log.e(TAG, "Failed to save queue", e);
        }
    }

    private void saveTrackMetadataOnTransition(@NonNull MediaItem item, int reason) {
        JSONObject prevCp = readBestSavedCheckpoint(this);
        String currentSavedId = prevCp != null ? prevCp.optString("id", "") : "";
        long prevSavedPos = prevCp != null ? prevCp.optLong("position", 0) : 0;

        long playerPos = player != null ? player.getCurrentPosition() : 0;
        long posToSave = 0L;

        if (playerPos >= 1000) {
            posToSave = playerPos;
        } else if (item.mediaId.equals(currentSavedId)
                && reason != Player.MEDIA_ITEM_TRANSITION_REASON_AUTO
                && reason != Player.MEDIA_ITEM_TRANSITION_REASON_REPEAT) {
            posToSave = prevSavedPos;
        }

        int currentIdx = player != null ? player.getCurrentMediaItemIndex() : 0;
        long duration = player != null ? player.getDuration() : 0;
        Log.i(TAG, "Track transition -> Saving new track immediately with fsync: " + item.mediaId + " (index=" + currentIdx + ", pos=" + posToSave + ")");
        persistLivePlayerState(item, currentIdx, posToSave, duration, false);
    }

    public void saveCurrentPositionSafely(boolean syncNow) {
        try {
            if (player != null && !isRestoringState) {
                int state = player.getPlaybackState();
                long pos = player.getCurrentPosition();
                MediaItem item = player.getCurrentMediaItem();
                if (item != null && (state == Player.STATE_READY || state == Player.STATE_BUFFERING) && pos >= 1000) {
                    persistLivePlayerState(item, player.getCurrentMediaItemIndex(), pos, player.getDuration(), syncNow);
                }
            }
        } catch (Exception e) {
            Log.e(TAG, "Error saving current position safely", e);
        }
    }

    public void saveExplicitSeekPosition(long posMs) {
        try {
            if (player != null && player.getCurrentMediaItem() != null) {
                persistLivePlayerState(
                        player.getCurrentMediaItem(),
                        player.getCurrentMediaItemIndex(),
                        Math.max(0L, posMs),
                        player.getDuration(),
                        false
                );
            }
        } catch (Exception e) {
            Log.e(TAG, "Error saving explicit seek position", e);
        }
    }

    @OptIn(markerClass = UnstableApi.class)
    private void restoreLastPlayedState() {
        if (player == null || player.getMediaItemCount() > 0) return;

        isRestoringState = true;
        try {
            JSONObject cp = readBestSavedCheckpoint(this);
            if (cp == null) return;

            String lastId = cp.optString("id", "");
            long lastPos = cp.optLong("position", 0);
            String contextId = cp.optString("contextId", "");
            this.currentContextId = contextId;
            this.currentIsShuffled = cp.optBoolean("isShuffled", false);

            JSONArray arr = readBestSavedQueue(this);
            List<MediaItem> restoredItems = new ArrayList<>();
            int restoredIndex = 0;

            if (arr != null && arr.length() > 0) {
                for (int i = 0; i < arr.length(); i++) {
                    JSONObject item = arr.optJSONObject(i);
                    if (item == null) continue;
                    String id = item.optString("id", "");
                    String url = item.optString("url", "");
                    if (id.isEmpty() || url.isEmpty()) continue;

                    Bundle extras = new Bundle();
                    if (!contextId.isEmpty()) {
                        extras.putString("contextId", contextId);
                    }

                    MediaMetadata metadata = new MediaMetadata.Builder()
                            .setTitle(item.optString("title", ""))
                            .setArtist(item.optString("artist", ""))
                            .setArtworkUri(Uri.parse(item.optString("artwork", "")))
                            .setExtras(extras)
                            .build();

                    MediaItem mediaItem = new MediaItem.Builder()
                            .setUri(url)
                            .setMediaId(id)
                            .setMimeType(MimeTypes.AUDIO_MP4)
                            .setMediaMetadata(metadata)
                            .build();
                    restoredItems.add(mediaItem);

                    if (!lastId.isEmpty() && lastId.equals(id)) {
                        restoredIndex = restoredItems.size() - 1;
                    }
                }
            }

            if (restoredItems.isEmpty() && !lastId.isEmpty()) {
                String url = cp.optString("url", "");
                if (!url.isEmpty()) {
                    Bundle extras = new Bundle();
                    if (!contextId.isEmpty()) extras.putString("contextId", contextId);

                    MediaMetadata metadata = new MediaMetadata.Builder()
                            .setTitle(cp.optString("title", "Streamify"))
                            .setArtist(cp.optString("artist", ""))
                            .setArtworkUri(Uri.parse(cp.optString("artwork", "")))
                            .setExtras(extras)
                            .build();

                    MediaItem singleItem = new MediaItem.Builder()
                            .setUri(url)
                            .setMediaId(lastId)
                            .setMimeType(MimeTypes.AUDIO_MP4)
                            .setMediaMetadata(metadata)
                            .build();
                    restoredItems.add(singleItem);
                    restoredIndex = 0;
                }
            }

            if (!restoredItems.isEmpty()) {
                Log.i(TAG, "Restored " + restoredItems.size() + " items from atomic checkpoint at index "
                        + restoredIndex + " (song=" + lastId + ", pos=" + lastPos + "ms)");
                player.setPlayWhenReady(false);
                player.setMediaItems(restoredItems, restoredIndex, Math.max(0L, lastPos));
            }
        } catch (Exception e) {
            Log.e(TAG, "Failed to restore last played state", e);
        } finally {
            isRestoringState = false;
        }
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        saveCurrentPositionSafely(true);
        if (player != null && !player.isPlaying() && player.getPlaybackState() == Player.STATE_ENDED) {
            stopSelf();
        }
    }

    @Override
    public void onDestroy() {
        mainHandler.removeCallbacks(saveRunnable);
        retryHandler.removeCallbacksAndMessages(null);
        saveCurrentPositionSafely(true);
        diskExecutor.shutdown();

        if (connectivityManager != null && networkCallback != null) {
            try {
                connectivityManager.unregisterNetworkCallback(networkCallback);
            } catch (Exception ignored) {}
        }

        if (transitionWakeLock != null && transitionWakeLock.isHeld()) {
            try { transitionWakeLock.release(); } catch (Exception ignored) {}
        }
        setWifiLock(false);

        if (mediaSession != null) {
            mediaSession.release();
            mediaSession = null;
        }
        if (player != null) {
            player.release();
            player = null;
        }
        if (instance == this) {
            instance = null;
        }
        super.onDestroy();
    }

    @Nullable
    @Override
    public MediaSession onGetSession(MediaSession.ControllerInfo controllerInfo) {
        return mediaSession;
    }
}
