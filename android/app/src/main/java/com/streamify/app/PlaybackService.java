package com.streamify.app;

import android.bluetooth.BluetoothHeadset;
import android.bluetooth.BluetoothProfile;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.media.AudioPlaybackConfiguration;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.NetworkRequest;
import android.net.Uri;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.telephony.TelephonyManager;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.annotation.OptIn;
import androidx.media3.common.AudioAttributes;
import androidx.media3.common.C;
import androidx.media3.common.ForwardingPlayer;
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
import java.lang.reflect.Method;
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

    // ניטור שיחות נכנסות/פעילות (סלולר, Bluetooth HFP/SCO/HeadsetClient, VoIP/WhatsApp) + AudioFocus + ניגון מאפליקציה אחרת
    private static final String ACTION_HFP_CLIENT_AUDIO_STATE_CHANGED =
            "android.bluetooth.headsetclient.profile.action.AUDIO_STATE_CHANGED";
    private static final String ACTION_HFP_CLIENT_AG_CALL_CHANGED =
            "android.bluetooth.headsetclient.profile.action.AG_CALL_CHANGED";
    private static final String EXTRA_HFP_CLIENT_CALL =
            "android.bluetooth.headsetclient.extra.CALL";

    private AudioManager audioManager;
    private Object audioModeChangedListener;
    private Object audioPlaybackCallback;
    private Object audioFocusRequestObj;
    private BroadcastReceiver callStateReceiver;

    private volatile boolean telephonyCallActive = false;
    private volatile boolean scoCallActive = false;
    private volatile boolean btHeadsetCallActive = false;
    private volatile boolean btClientCallActive = false;
    private volatile boolean audioModeCallActive = false;
    private volatile boolean playbackConfigCallActive = false;

    private volatile boolean pausedByCall = false;
    private volatile boolean pausedByAudioFocus = false;
    private volatile boolean hasAudioFocus = false;
    private volatile boolean isPausingForCall = false;

    private final AudioManager.OnAudioFocusChangeListener audioFocusChangeListener = focusChange -> {
        mainHandler.post(() -> handleAudioFocusChange(focusChange));
    };

    private final Runnable resumeAfterCallRunnable = new Runnable() {
        @Override
        public void run() {
            if (audioManager != null) {
                audioModeCallActive = isCallAudioMode(audioManager.getMode());
            }
            if (!isAnyCallActive() && (pausedByCall || pausedByAudioFocus) && !userPaused && player != null) {
                pausedByCall = false;
                pausedByAudioFocus = false;
                Log.i(TAG, "📞 Call/Focus interruption ended -> Resuming playback from " + player.getCurrentPosition() + "ms");
                requestAudioFocusIfNeeded();
                player.setVolume(1.0f);
                player.setPlayWhenReady(true);
                player.play();
            }
        }
    };

    private final Runnable otherMediaConflictRunnable = new Runnable() {
        @Override
        public void run() {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O || audioManager == null || player == null) return;
            if (userPaused || isAnyCallActive() || !player.isPlaying()) return;
            try {
                List<AudioPlaybackConfiguration> configs = audioManager.getActivePlaybackConfigurations();
                int activeMediaCount = countActiveMediaPlaybacks(configs);
                if (activeMediaCount >= 2) {
                    Log.i(TAG, "🎬 Another media app is playing simultaneously (activeMediaCount=" + activeMediaCount + ") -> Yielding playback");
                    setUserPaused(true);
                    PluginEvents.postEvent("playbackState", false);
                }
            } catch (Exception e) {
                Log.w(TAG, "Failed checking active playback configurations", e);
            }
        }
    };

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
                checkCallAudioMode();
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
        this.pausedByCall = false;
        this.pausedByAudioFocus = false;
        mainHandler.removeCallbacks(resumeAfterCallRunnable);
        mainHandler.removeCallbacks(otherMediaConflictRunnable);
        if (paused) {
            this.waitingForNetwork = false;
            retryHandler.removeCallbacksAndMessages(null);
            abandonAudioFocus();
            if (player != null) {
                player.setPlayWhenReady(false);
                player.pause();
            }
            saveCurrentPositionSafely(true);
        } else {
            SharedPreferences prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            prefs.edit().putBoolean("user_paused", false).commit();
            requestAudioFocusIfNeeded();
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
        initCallStateMonitor();

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
        // ניהול AudioFocus מתבצע ישירות דרך AudioManager + AudioPlaybackCallback לשליטה מלאה בשיחות ואפליקציות רקע
        player.setAudioAttributes(audioAttributes, false);

        setupPlayerListeners();

        // עטיפת הנגן ב-ForwardingPlayer שחוסם לחלוטין פקודות Play אוטומטיות ממערכת האנדרואיד/רכב
        // כאשר הלקוח לחץ על Pause (userPaused == true)
        ForwardingPlayer guardedSessionPlayer = new ForwardingPlayer(player) {
            @Override
            public void play() {
                if (userPaused || (pausedByCall && isAnyCallActive()) || pausedByAudioFocus) {
                    Log.w(TAG, "Blocked external MediaSession play() (userPaused=" + userPaused + ", pausedByCall=" + pausedByCall + ", pausedByAudioFocus=" + pausedByAudioFocus + ")");
                    super.setPlayWhenReady(false);
                    super.pause();
                    PluginEvents.postEvent("playbackState", false);
                    return;
                }
                requestAudioFocusIfNeeded();
                super.play();
            }

            @Override
            public void setPlayWhenReady(boolean playWhenReady) {
                if (playWhenReady && (userPaused || (pausedByCall && isAnyCallActive()) || pausedByAudioFocus)) {
                    Log.w(TAG, "Blocked external MediaSession setPlayWhenReady(true) (userPaused=" + userPaused + ", pausedByCall=" + pausedByCall + ", pausedByAudioFocus=" + pausedByAudioFocus + ")");
                    super.setPlayWhenReady(false);
                    super.pause();
                    PluginEvents.postEvent("playbackState", false);
                    return;
                }
                if (playWhenReady) {
                    requestAudioFocusIfNeeded();
                }
                super.setPlayWhenReady(playWhenReady);
            }
        };

        mediaSession = new MediaSession.Builder(this, guardedSessionPlayer).build();
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
        return new JSONObject();
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
        return new JSONArray();
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

    private boolean isCallAudioMode(int mode) {
        if (mode == AudioManager.MODE_RINGTONE
                || mode == AudioManager.MODE_IN_CALL
                || mode == AudioManager.MODE_IN_COMMUNICATION) {
            return true;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R && mode == AudioManager.MODE_CALL_SCREENING) {
            return true;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                && (mode == AudioManager.MODE_CALL_REDIRECT || mode == AudioManager.MODE_COMMUNICATION_REDIRECT)) {
            return true;
        }
        return false;
    }

    private boolean isAnyCallActive() {
        return telephonyCallActive
                || scoCallActive
                || btHeadsetCallActive
                || btClientCallActive
                || audioModeCallActive
                || playbackConfigCallActive;
    }

    private void requestAudioFocusIfNeeded() {
        if (audioManager == null) {
            audioManager = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
        }
        if (audioManager == null || hasAudioFocus) return;
        try {
            int result;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                android.media.AudioAttributes sysAttrs = new android.media.AudioAttributes.Builder()
                        .setUsage(android.media.AudioAttributes.USAGE_MEDIA)
                        .setContentType(android.media.AudioAttributes.CONTENT_TYPE_MUSIC)
                        .build();
                AudioFocusRequest req = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                        .setAudioAttributes(sysAttrs)
                        .setAcceptsDelayedFocusGain(true)
                        .setWillPauseWhenDucked(false)
                        .setOnAudioFocusChangeListener(audioFocusChangeListener, mainHandler)
                        .build();
                audioFocusRequestObj = req;
                result = audioManager.requestAudioFocus(req);
            } else {
                result = audioManager.requestAudioFocus(
                        audioFocusChangeListener,
                        AudioManager.STREAM_MUSIC,
                        AudioManager.AUDIOFOCUS_GAIN
                );
            }
            hasAudioFocus = (result == AudioManager.AUDIOFOCUS_REQUEST_GRANTED);
            if (hasAudioFocus && player != null) {
                player.setVolume(1.0f);
            }
        } catch (Exception e) {
            Log.w(TAG, "Failed requesting audio focus", e);
        }
    }

    private void abandonAudioFocus() {
        if (audioManager == null) return;
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                if (audioFocusRequestObj != null) {
                    audioManager.abandonAudioFocusRequest((AudioFocusRequest) audioFocusRequestObj);
                }
            } else {
                audioManager.abandonAudioFocus(audioFocusChangeListener);
            }
        } catch (Exception e) {
            Log.w(TAG, "Failed abandoning audio focus", e);
        } finally {
            hasAudioFocus = false;
        }
    }

    private void handleAudioFocusChange(int focusChange) {
        if (player == null) return;
        switch (focusChange) {
            case AudioManager.AUDIOFOCUS_LOSS:
                // אפליקציה אחרת (כרום/יוטיוב/וידאו וכו') לקחה את השמע — עוצרים ומשחררים לה את ההשמעה
                Log.i(TAG, "🔇 AUDIOFOCUS_LOSS -> Yielding playback to another app");
                hasAudioFocus = false;
                pausedByAudioFocus = false;
                if (!userPaused) {
                    setUserPaused(true);
                    PluginEvents.postEvent("playbackState", false);
                }
                break;

            case AudioManager.AUDIOFOCUS_LOSS_TRANSIENT:
                // הפרעה זמנית (שיחת טלפון/בלוטות'/הודעה קולית) — עוצרים ונמשיך אוטומטית כשהפוקוס יחזור
                Log.i(TAG, "📞 AUDIOFOCUS_LOSS_TRANSIENT -> Pausing playback temporarily");
                hasAudioFocus = false;
                mainHandler.removeCallbacks(resumeAfterCallRunnable);
                if (!userPaused && (player.isPlaying() || player.getPlayWhenReady())) {
                    pausedByAudioFocus = true;
                    saveCurrentPositionSafely(false);
                    isPausingForCall = true;
                    try {
                        player.setPlayWhenReady(false);
                        player.pause();
                    } finally {
                        isPausingForCall = false;
                    }
                    PluginEvents.postEvent("playbackState", false);
                }
                break;

            case AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK:
                // אם יש שיחה פעילה — עוצרים; אחרת (כמו Waze) מנמיכים זמנית
                if (isAnyCallActive()) {
                    handleAudioFocusChange(AudioManager.AUDIOFOCUS_LOSS_TRANSIENT);
                } else {
                    Log.d(TAG, "🔉 AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK -> Ducking volume");
                    player.setVolume(0.25f);
                }
                break;

            case AudioManager.AUDIOFOCUS_GAIN:
                hasAudioFocus = true;
                player.setVolume(1.0f);
                if ((pausedByAudioFocus || pausedByCall) && !userPaused && !isAnyCallActive()) {
                    Log.i(TAG, "🔊 AUDIOFOCUS_GAIN -> Scheduling resume");
                    mainHandler.removeCallbacks(resumeAfterCallRunnable);
                    mainHandler.postDelayed(resumeAfterCallRunnable, 500);
                }
                break;

            default:
                break;
        }
    }

    private int countActiveMediaPlaybacks(List<AudioPlaybackConfiguration> configs) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O || configs == null) return 0;
        int mediaCount = 0;
        for (AudioPlaybackConfiguration cfg : configs) {
            if (cfg == null) continue;
            android.media.AudioAttributes attrs = cfg.getAudioAttributes();
            if (attrs == null) continue;
            int usage = attrs.getUsage();
            if (usage == android.media.AudioAttributes.USAGE_MEDIA
                    || usage == android.media.AudioAttributes.USAGE_GAME) {
                mediaCount++;
            }
        }
        return mediaCount;
    }

    private boolean hasActiveCallPlaybackConfig(List<AudioPlaybackConfiguration> configs) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O || configs == null) return false;
        for (AudioPlaybackConfiguration cfg : configs) {
            if (cfg == null) continue;
            android.media.AudioAttributes attrs = cfg.getAudioAttributes();
            if (attrs == null) continue;
            int usage = attrs.getUsage();
            if (usage == android.media.AudioAttributes.USAGE_VOICE_COMMUNICATION
                    || usage == android.media.AudioAttributes.USAGE_VOICE_COMMUNICATION_SIGNALLING
                    || usage == android.media.AudioAttributes.USAGE_NOTIFICATION_RINGTONE) {
                return true;
            }
        }
        return false;
    }

    private void handleActivePlaybackConfigs(List<AudioPlaybackConfiguration> configs) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O || configs == null) return;
        boolean callConfigNow = hasActiveCallPlaybackConfig(configs);
        if (callConfigNow != playbackConfigCallActive) {
            playbackConfigCallActive = callConfigNow;
            updateCallState("PLAYBACK_CONFIG_CALL:" + callConfigNow);
        }

        if (!callConfigNow && !userPaused && !isAnyCallActive() && player != null && player.isPlaying()) {
            int mediaCount = countActiveMediaPlaybacks(configs);
            if (mediaCount >= 2) {
                mainHandler.removeCallbacks(otherMediaConflictRunnable);
                mainHandler.postDelayed(otherMediaConflictRunnable, 400);
            } else {
                mainHandler.removeCallbacks(otherMediaConflictRunnable);
            }
        }
    }

    private void checkCallAudioMode() {
        if (audioManager == null) return;
        try {
            boolean modeInCall = isCallAudioMode(audioManager.getMode());
            if (modeInCall != audioModeCallActive) {
                audioModeCallActive = modeInCall;
                updateCallState("AUDIO_MODE_POLL:" + audioManager.getMode());
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                handleActivePlaybackConfigs(audioManager.getActivePlaybackConfigurations());
            }
        } catch (Exception ignored) {}
    }

    private void updateCallState(String source) {
        mainHandler.post(() -> {
            boolean callNow = isAnyCallActive();
            if (callNow) {
                mainHandler.removeCallbacks(resumeAfterCallRunnable);
                if (player != null && !userPaused && !pausedByCall
                        && (player.isPlaying() || player.getPlayWhenReady())) {
                    pausedByCall = true;
                    long posMs = player.getCurrentPosition();
                    saveCurrentPositionSafely(false);
                    isPausingForCall = true;
                    try {
                        player.setPlayWhenReady(false);
                        player.pause();
                    } finally {
                        isPausingForCall = false;
                    }
                    PluginEvents.postEvent("playbackState", false);
                    Log.i(TAG, "📞 Call active (" + source + ") -> Paused playback at " + posMs + "ms");
                }
            } else if (pausedByCall && !userPaused) {
                mainHandler.removeCallbacks(resumeAfterCallRunnable);
                Log.i(TAG, "📞 Call ended (" + source + ") -> Scheduling auto-resume in 800ms");
                mainHandler.postDelayed(resumeAfterCallRunnable, 800);
            }
        });
    }

    private void initCallStateMonitor() {
        try {
            audioManager = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
            if (audioManager != null) {
                audioModeCallActive = isCallAudioMode(audioManager.getMode());
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    AudioManager.OnModeChangedListener listener = mode -> {
                        boolean modeInCall = isCallAudioMode(mode);
                        if (modeInCall != audioModeCallActive) {
                            audioModeCallActive = modeInCall;
                            updateCallState("AUDIO_MODE:" + mode);
                        }
                    };
                    audioModeChangedListener = listener;
                    audioManager.addOnModeChangedListener(getMainExecutor(), listener);
                }

                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    AudioManager.AudioPlaybackCallback cb = new AudioManager.AudioPlaybackCallback() {
                        @Override
                        public void onPlaybackConfigChanged(List<AudioPlaybackConfiguration> configs) {
                            mainHandler.post(() -> handleActivePlaybackConfigs(configs));
                        }
                    };
                    audioPlaybackCallback = cb;
                    audioManager.registerAudioPlaybackCallback(cb, mainHandler);
                }
            }

            callStateReceiver = new BroadcastReceiver() {
                @Override
                public void onReceive(Context context, Intent intent) {
                    if (intent == null || intent.getAction() == null) return;
                    String action = intent.getAction();
                    if (TelephonyManager.ACTION_PHONE_STATE_CHANGED.equals(action)) {
                        String state = intent.getStringExtra(TelephonyManager.EXTRA_STATE);
                        if (TelephonyManager.EXTRA_STATE_RINGING.equals(state)
                                || TelephonyManager.EXTRA_STATE_OFFHOOK.equals(state)) {
                            telephonyCallActive = true;
                            updateCallState("PHONE_STATE:" + state);
                        } else if (TelephonyManager.EXTRA_STATE_IDLE.equals(state)) {
                            telephonyCallActive = false;
                            updateCallState("PHONE_STATE:IDLE");
                        }
                    } else if (AudioManager.ACTION_SCO_AUDIO_STATE_UPDATED.equals(action)) {
                        int scoState = intent.getIntExtra(
                                AudioManager.EXTRA_SCO_AUDIO_STATE,
                                AudioManager.SCO_AUDIO_STATE_DISCONNECTED
                        );
                        if (scoState == AudioManager.SCO_AUDIO_STATE_CONNECTED) {
                            scoCallActive = true;
                            updateCallState("SCO_CONNECTED");
                        } else if (scoState == AudioManager.SCO_AUDIO_STATE_DISCONNECTED) {
                            scoCallActive = false;
                            updateCallState("SCO_DISCONNECTED");
                        }
                    } else if (BluetoothHeadset.ACTION_AUDIO_STATE_CHANGED.equals(action)) {
                        int btState = intent.getIntExtra(
                                BluetoothProfile.EXTRA_STATE,
                                BluetoothHeadset.STATE_AUDIO_DISCONNECTED
                        );
                        if (btState == BluetoothHeadset.STATE_AUDIO_CONNECTED
                                || btState == BluetoothHeadset.STATE_AUDIO_CONNECTING) {
                            btHeadsetCallActive = true;
                            updateCallState("BT_HEADSET_AUDIO:" + btState);
                        } else if (btState == BluetoothHeadset.STATE_AUDIO_DISCONNECTED) {
                            btHeadsetCallActive = false;
                            updateCallState("BT_HEADSET_AUDIO_DISCONNECTED");
                        }
                    } else if (ACTION_HFP_CLIENT_AUDIO_STATE_CHANGED.equals(action)) {
                        int hfpState = intent.getIntExtra(BluetoothProfile.EXTRA_STATE, 0);
                        if (hfpState == 1 || hfpState == 2) {
                            btClientCallActive = true;
                            updateCallState("HFP_CLIENT_AUDIO:" + hfpState);
                        } else if (hfpState == 0) {
                            btClientCallActive = false;
                            updateCallState("HFP_CLIENT_AUDIO_DISCONNECTED");
                        }
                    } else if (ACTION_HFP_CLIENT_AG_CALL_CHANGED.equals(action)) {
                        try {
                            Object callObj = intent.getParcelableExtra(EXTRA_HFP_CLIENT_CALL);
                            if (callObj != null) {
                                Method getStateMethod = callObj.getClass().getMethod("getState");
                                Object stateVal = getStateMethod.invoke(callObj);
                                if (stateVal instanceof Integer) {
                                    int callState = (Integer) stateVal;
                                    // 0=ACTIVE, 1=HELD, 2=DIALING, 3=ALERTING, 4=INCOMING, 5=WAITING, 7=TERMINATED
                                    boolean active = (callState >= 0 && callState <= 5);
                                    btClientCallActive = active;
                                    updateCallState("HFP_CLIENT_CALL:" + callState);
                                }
                            }
                        } catch (Exception e) {
                            Log.w(TAG, "Failed parsing HFP Client call state", e);
                        }
                    }
                }
            };

            IntentFilter filter = new IntentFilter();
            filter.addAction(TelephonyManager.ACTION_PHONE_STATE_CHANGED);
            filter.addAction(AudioManager.ACTION_SCO_AUDIO_STATE_UPDATED);
            filter.addAction(BluetoothHeadset.ACTION_AUDIO_STATE_CHANGED);
            filter.addAction(ACTION_HFP_CLIENT_AUDIO_STATE_CHANGED);
            filter.addAction(ACTION_HFP_CLIENT_AG_CALL_CHANGED);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                registerReceiver(callStateReceiver, filter, Context.RECEIVER_EXPORTED);
            } else {
                registerReceiver(callStateReceiver, filter);
            }
        } catch (Exception e) {
            Log.w(TAG, "Failed to initialize call state monitor", e);
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
                // חוק ברזל: אם הלקוח במצב Pause או בשיחה פעילה, שום אירוע חיצוני (כמו פתיחת Google/הגדרות או AudioFocus)
                // לא יכול להדליק את הנגן מעצמו!
                if (playWhenReady && (userPaused || (pausedByCall && isAnyCallActive()) || pausedByAudioFocus)) {
                    Log.w(TAG, "Blocking unexpected playWhenReady=true (reason=" + reason + ", userPaused=" + userPaused + ", pausedByCall=" + pausedByCall + ", pausedByAudioFocus=" + pausedByAudioFocus + ")");
                    isPausingForCall = (pausedByCall || pausedByAudioFocus) && !userPaused;
                    try {
                        player.setPlayWhenReady(false);
                        player.pause();
                    } finally {
                        isPausingForCall = false;
                    }
                    PluginEvents.postEvent("playbackState", false);
                    return;
                }

                if (playWhenReady && !userPaused && !isAnyCallActive()) {
                    requestAudioFocusIfNeeded();
                }

                if (!playWhenReady && !isPausingForCall && (
                        reason == Player.PLAY_WHEN_READY_CHANGE_REASON_USER_REQUEST ||
                        reason == Player.PLAY_WHEN_READY_CHANGE_REASON_AUDIO_BECOMING_NOISY)) {
                    setUserPaused(true);
                } else if (playWhenReady && reason == Player.PLAY_WHEN_READY_CHANGE_REASON_USER_REQUEST) {
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
        mainHandler.removeCallbacks(resumeAfterCallRunnable);
        mainHandler.removeCallbacks(otherMediaConflictRunnable);
        retryHandler.removeCallbacksAndMessages(null);
        saveCurrentPositionSafely(true);
        abandonAudioFocus();
        diskExecutor.shutdown();

        if (callStateReceiver != null) {
            try {
                unregisterReceiver(callStateReceiver);
            } catch (Exception ignored) {}
            callStateReceiver = null;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
                && audioManager != null && audioModeChangedListener != null) {
            try {
                audioManager.removeOnModeChangedListener((AudioManager.OnModeChangedListener) audioModeChangedListener);
            } catch (Exception ignored) {}
            audioModeChangedListener = null;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                && audioManager != null && audioPlaybackCallback != null) {
            try {
                audioManager.unregisterAudioPlaybackCallback((AudioManager.AudioPlaybackCallback) audioPlaybackCallback);
            } catch (Exception ignored) {}
            audioPlaybackCallback = null;
        }

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
