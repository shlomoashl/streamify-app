
package com.streamify.app;

import android.content.ComponentName;
import android.content.Context;
import android.content.SharedPreferences;
import android.net.Uri;
import android.net.wifi.WifiManager;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.util.Log;

import androidx.annotation.OptIn;
import androidx.core.content.ContextCompat;
import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MediaMetadata;
import androidx.media3.common.MimeTypes;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.common.Timeline;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.session.MediaController;
import androidx.media3.session.SessionToken;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.common.util.concurrent.ListenableFuture;

import org.json.JSONObject;
import java.util.ArrayList;
import java.util.List;
import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;

// Simple static event bus to communicate from Service to Plugin without external dependencies.
class PluginEvents {
    public interface PluginEventListener {
        void onCommand(String command);
    }
    private static PluginEventListener listener;
    private static final Handler mainHandler = new Handler(Looper.getMainLooper());

    public static void setListener(PluginEventListener newListener) {
        listener = newListener;
    }

    public static void post(String command) {
        if (listener != null) {
            mainHandler.post(() -> listener.onCommand(command));
        }
    }
}

@CapacitorPlugin(name = "StreamifyMedia")
public class StreamifyMediaPlugin extends Plugin {

    private MediaController controller;
    private static final String TAG = "StreamifyMedia";
    private final Handler handler = new Handler(Looper.getMainLooper());
    
    private boolean isSeeking = false;
    private boolean isProgressRunning = false;
    private ListenableFuture<MediaController> controllerFuture;
    
    private PowerManager.WakeLock transitionWakeLock;
    private WifiManager.WifiLock wifiLock;

    // Error Handling State
    private int consecutiveErrorCount = 0;
    private long lastErrorTime = 0;
    private static final int MAX_RETRIES = 3;
    private static final long ERROR_RESET_TIME_MS = 60000; // 1 minute

    private final Runnable progressRunnable = new Runnable() {
        @Override
        public void run() {
            if (controller != null && isProgressRunning) {
                if (!isSeeking) {
                    try {
                        if (controller.isPlaying() || controller.getPlaybackState() == Player.STATE_BUFFERING) {
                            long current = controller.getCurrentPosition();
                            long duration = controller.getDuration();
                            
                            JSObject ret = new JSObject();
                            ret.put("action", "timeUpdate");
                            ret.put("value", current / 1000.0);
                            
                            if (duration != C.TIME_UNSET && duration > 0) {
                                ret.put("duration", duration / 1000.0);
                            }
                            
                            notifyListeners("onMediaEvent", ret);
                        }
                    } catch (Exception e) {
                        Log.e(TAG, "Error in progress loop", e);
                    }
                }
                handler.postDelayed(this, 1000);
            }
        }
    };

    /**
     * NATIVE PREFETCH HELPER - ENHANCED
     * 1. Fetches the M3U8 playlist from the backend.
     * 2. Parses it to find the FIRST segment URL.
     * 3. Fetches a small chunk of that segment to force the stream to start flowing.
     */
    private void triggerServerSideWarmup(String m3u8Url) {
        if (m3u8Url == null || m3u8Url.isEmpty()) return;
        
        new Thread(() -> {
            HttpURLConnection playlistCon = null;
            try {
                Log.d(TAG, "Native Prefetch (Dry Run): Pinging Server -> " + m3u8Url);
                URL urlObj = new URL(m3u8Url);
                playlistCon = (HttpURLConnection) urlObj.openConnection();
                playlistCon.setRequestMethod("GET");
                playlistCon.setRequestProperty("User-Agent", "Streamify"); 
                playlistCon.setConnectTimeout(10000); 
                playlistCon.setReadTimeout(10000);
                
                // עצם הקריאה לשרת (ResponseCode) מעירה את ה-Python וגורמת לו להריץ את yt-dlp ולשמור ב-Cache
                int responseCode = playlistCon.getResponseCode();
                Log.d(TAG, "Prefetch Ping Result: " + responseCode);
                
                // אנחנו לא מורידים את ה-M3U8, לא מנתחים אותו, ולא מושכים את מקטע הווידאו הראשון.
                // חסכנו רוחב פס לגמרי, והשרת מוכן לשיר הבא!
                
            } catch (Exception e) {
                Log.w(TAG, "Native Prefetch warning: " + e.getMessage());
            } finally {
                if (playlistCon != null) try { playlistCon.disconnect(); } catch(Exception ignored){}
            }
        }).start();
    }

    @Override
    public void load() {
        super.load();
        
        Context context = getContext();
        
        // Initialize WakeLock for smooth transitions in background (CPU)
        PowerManager powerManager = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
        if (powerManager != null) {
            transitionWakeLock = powerManager.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Streamify:TransitionWakeLock");
            transitionWakeLock.setReferenceCounted(false);
        }

        // Initialize WifiLock to keep network radio active in background (Network)
        WifiManager wifiManager = (WifiManager) context.getApplicationContext().getSystemService(Context.WIFI_SERVICE);
        if (wifiManager != null) {
            wifiLock = wifiManager.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "Streamify:WifiLock");
            wifiLock.setReferenceCounted(false);
        }
        
        handler.post(() -> {
            SessionToken sessionToken = new SessionToken(context, new ComponentName(context, PlaybackService.class));
            controllerFuture = new MediaController.Builder(context, sessionToken).buildAsync();
            
            controllerFuture.addListener(() -> {
                try {
                    controller = controllerFuture.get();
                    setupControllerListeners();
                } catch (Exception e) {
                    Log.e(TAG, "Failed to connect to MediaSession", e);
                }
            }, ContextCompat.getMainExecutor(context));
        });
        
        // Setup listener for events from our custom event bus
        PluginEvents.setListener(command -> {
            if (command != null) {
                JSObject ret = new JSObject();
                if (command.equals("next")) {
                    ret.put("action", "remoteNext");
                    acquireLocks(); // Keep awake for logic processing
                } else if (command.equals("prev")) {
                    ret.put("action", "remotePrev");
                    acquireLocks();
                }
                notifyListeners("onMediaEvent", ret);
            }
        });
    }

    private void acquireLocks() {
        if (transitionWakeLock != null) {
            // Standard 10s WakeLock to allow processing
            transitionWakeLock.acquire(10000); 
        }
    }
    
    private void setWifiLock(boolean active) {
        if (wifiLock == null) return;
        if (active) {
            if (!wifiLock.isHeld()) {
                wifiLock.acquire();
                Log.d(TAG, "WifiLock acquired");
            }
        } else {
            if (wifiLock.isHeld()) {
                wifiLock.release();
                Log.d(TAG, "WifiLock released");
            }
        }
    }

    @Override
    protected void handleOnDestroy() {
        super.handleOnDestroy();
        PluginEvents.setListener(null);
        if (controller != null) {
            MediaController.releaseFuture(controllerFuture);
        }
        if (transitionWakeLock != null && transitionWakeLock.isHeld()) {
            transitionWakeLock.release();
        }
        setWifiLock(false);
    }

    private void setupControllerListeners() {
        if (controller == null) return;

        controller.addListener(new Player.Listener() {
            @Override
            public void onMediaItemTransition(@androidx.annotation.Nullable MediaItem mediaItem, int reason) {
                 if (mediaItem != null) {
                     // Notify JS
                     JSObject ret = new JSObject();
                     ret.put("action", "itemTransition");
                     ret.put("value", mediaItem.mediaId);
                     notifyListeners("onMediaEvent", ret);
                     
                     // Wake up CPU briefly for the transition logic
                     acquireLocks();
                     
                     // Reset error counter on successful transition
                     consecutiveErrorCount = 0;
                 }
            }

            @Override
            public void onPlaybackStateChanged(int playbackState) {
                if (isSeeking && playbackState == Player.STATE_READY) {
                    isSeeking = false;
                }
                
                JSObject ret = new JSObject();
                ret.put("action", "playbackState");
                
                boolean isPlayingOrBuffering = controller.getPlayWhenReady() && 
                    (playbackState == Player.STATE_READY || playbackState == Player.STATE_BUFFERING);

                // Manage WifiLock based on playback state to ensure streaming continues in background
                setWifiLock(isPlayingOrBuffering);

                if (playbackState == Player.STATE_ENDED) {
                     ret.put("value", false);
                     notifyListeners("onMediaEvent", ret);
                     
                     JSObject ended = new JSObject();
                     ended.put("action", "completed");
                     notifyListeners("onMediaEvent", ended);
                     
                     stopProgressUpdate();
                     acquireLocks();
                } else {
                     ret.put("value", isPlayingOrBuffering);
                     notifyListeners("onMediaEvent", ret);
                     
                     if (isPlayingOrBuffering) {
                         startProgressUpdate();
                     } else {
                         stopProgressUpdate();
                     }
                }
            }

            @Override
            public void onIsPlayingChanged(boolean isPlaying) {
                if (isPlaying) {
                    startProgressUpdate();
                    setWifiLock(true);
                    // Reset error count if we successfully started playing
                    consecutiveErrorCount = 0;
                } else {
                    setWifiLock(false);
                }
            }

            @Override
            public void onTimelineChanged(Timeline timeline, int reason) {
                if (controller != null) {
                    long duration = controller.getDuration();
                    if (duration != C.TIME_UNSET && duration > 0) {
                        JSObject ret = new JSObject();
                        ret.put("action", "durationChange");
                        ret.put("value", duration / 1000.0);
                        notifyListeners("onMediaEvent", ret);
                    }
                }
            }
            
            @Override
            public void onPlayerError(PlaybackException error) {
                 Log.e(TAG, "Player Error: " + error.getMessage(), error);
                 
                 long now = System.currentTimeMillis();
                 if (now - lastErrorTime > ERROR_RESET_TIME_MS) {
                     consecutiveErrorCount = 0;
                 }
                 consecutiveErrorCount++;
                 lastErrorTime = now;

                 boolean isNetworkError = error.errorCode == PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED ||
                                          error.errorCode == PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_TIMEOUT ||
                                          error.errorCode == PlaybackException.ERROR_CODE_IO_UNSPECIFIED; // Often network related

                 // CRITICAL FIX: Stop madness.
                 // 1. If it's a network error, don't skip aggressively, just pause/stop.
                 // 2. If we hit max retries, stop to prevent focus hijacking.
                 
                 boolean shouldRetry = !isNetworkError && consecutiveErrorCount <= MAX_RETRIES && controller != null && controller.hasNextMediaItem();

                 if (shouldRetry) {
                     Log.i(TAG, "Attempting auto-skip to next track due to error (Retry " + consecutiveErrorCount + ")");
                     controller.seekToNextMediaItem();
                     controller.prepare();
                     controller.play();
                     return; // Give it a chance
                 }

                 // Fatal error or max retries reached or Network Error
                 Log.e(TAG, "Stopping playback due to too many errors or network failure.");
                 if (controller != null) {
                     controller.stop(); // This releases audio focus automatically
                 }

                 String errorMsg = "Playback Error: " + error.getErrorCodeName();
                 if (error.getCause() != null) {
                     errorMsg += " (" + error.getCause().getMessage() + ")";
                 }
                 
                 JSObject ret = new JSObject();
                 ret.put("action", "error");
                 ret.put("value", errorMsg);
                 notifyListeners("onMediaEvent", ret);
                 stopProgressUpdate();
                 setWifiLock(false);
            }
        });
    }

    private void startProgressUpdate() {
        if (!isProgressRunning) {
            isProgressRunning = true;
            handler.removeCallbacks(progressRunnable);
            handler.post(progressRunnable);
        }
    }

    private void stopProgressUpdate() {
        isProgressRunning = false;
        handler.removeCallbacks(progressRunnable);
    }

    @PluginMethod
    public void initialize(PluginCall call) {
        call.resolve();
    }

    // --- NEW METHOD: Get Last Played from Native Storage ---
    @PluginMethod
    public void getLastPlayedInfo(PluginCall call) {
        Context context = getContext();
        SharedPreferences prefs = context.getSharedPreferences("StreamifyPlaybackState", Context.MODE_PRIVATE);
        
        String url = prefs.getString("last_url", null);
        String id = prefs.getString("last_id", null);
        
        if (url != null && id != null) {
            JSObject ret = new JSObject();
            ret.put("id", id);
            ret.put("url", url);
            ret.put("title", prefs.getString("last_title", ""));
            ret.put("artist", prefs.getString("last_artist", ""));
            ret.put("artwork", prefs.getString("last_artwork", ""));
            // Return the saved context (playlist ID) so the app can restore the queue
            ret.put("contextId", prefs.getString("last_context_id", null)); 
            call.resolve(ret);
        } else {
            call.resolve(); // Return empty if nothing saved
        }
    }

    @OptIn(markerClass = UnstableApi.class)
    @PluginMethod
    public void play(PluginCall call) {
        if (controller == null) {
            call.reject("Media Service not connected yet");
            return;
        }

        String url = call.getString("url");
        String title = call.getString("title", "");
        String artist = call.getString("artist", "");
        String artwork = call.getString("artwork", "");
        String contextId = call.getString("contextId", "");
        
        if (url == null) {
            call.reject("No URL provided");
            return;
        }
        
        handler.post(() -> {
            try {
                stopProgressUpdate();
                controller.stop(); 
                controller.clearMediaItems();
                
                JSObject resetTime = new JSObject();
                resetTime.put("action", "timeUpdate");
                resetTime.put("value", 0);
                notifyListeners("onMediaEvent", resetTime);

                Bundle extras = new Bundle();
                if (!contextId.isEmpty()) {
                    extras.putString("contextId", contextId);
                }

                MediaMetadata metadata = new MediaMetadata.Builder()
                    .setTitle(title)
                    .setArtist(artist)
                    .setArtworkUri(Uri.parse(artwork))
                    .setExtras(extras)
                    .build();

                MediaItem mediaItem = new MediaItem.Builder()
                    .setUri(url)
                    .setMediaId(call.getString("id", ""))
                    // .setMimeType(MimeTypes.AUDIO_MP4)
                    .setMimeType(MimeTypes.AUDIO_WEBM)
                    .setMediaMetadata(metadata)
                    .build();

                controller.setMediaItem(mediaItem);
                controller.prepare();
                controller.play();
                
                JSObject ret = new JSObject();
                ret.put("action", "playbackState");
                ret.put("value", true);
                notifyListeners("onMediaEvent", ret);

                startProgressUpdate();
                
                call.resolve();
            } catch (Exception e) {
                call.reject("Error playing audio: " + e.getMessage());
            }
        });
    }

    @OptIn(markerClass = UnstableApi.class)
    @PluginMethod
    public void playQueue(PluginCall call) {
        if (controller == null) {
            call.reject("Media Service not connected yet");
            return;
        }

        JSArray items = call.getArray("items");
        Integer startIndex = call.getInt("startIndex", 0);
        String contextId = call.getString("contextId", ""); // Get queue context ID

        if (items == null || items.length() == 0) {
            call.reject("No items provided");
            return;
        }

        handler.post(() -> {
            try {
                stopProgressUpdate();
                controller.stop();
                controller.clearMediaItems();

                List<MediaItem> mediaItems = new ArrayList<>();
                for (int i = 0; i < items.length(); i++) {
                     try {
                         JSONObject item = items.getJSONObject(i);
                         
                         Bundle extras = new Bundle();
                         if (!contextId.isEmpty()) {
                             extras.putString("contextId", contextId);
                         }

                         MediaMetadata metadata = new MediaMetadata.Builder()
                            .setTitle(item.optString("title"))
                            .setArtist(item.optString("artist"))
                            .setArtworkUri(Uri.parse(item.optString("artwork")))
                            .setExtras(extras) // Store context for every item
                            .build();

                         MediaItem mediaItem = new MediaItem.Builder()
                            .setUri(item.getString("url"))
                            .setMediaId(item.getString("id"))
                            // .setMimeType(MimeTypes.AUDIO_MP4)
                            .setMimeType(MimeTypes.AUDIO_WEBM)
                            .setMediaMetadata(metadata)
                            .build();
                         mediaItems.add(mediaItem);
                     } catch (Exception e) {
                         Log.e(TAG, "Error parsing queue item at index " + i, e);
                     }
                }

                if (mediaItems.isEmpty()) {
                    call.reject("Failed to parse any items");
                    return;
                }

                controller.setMediaItems(mediaItems, startIndex, C.TIME_UNSET);
                controller.prepare();
                controller.play();

                JSObject ret = new JSObject();
                ret.put("action", "playbackState");
                ret.put("value", true);
                notifyListeners("onMediaEvent", ret);

                startProgressUpdate();
                call.resolve();
            } catch (Exception e) {
                call.reject("Error playing queue: " + e.getMessage());
            }
        });
    }

    @OptIn(markerClass = UnstableApi.class)
    @PluginMethod
    public void addToQueue(PluginCall call) {
        if (controller == null) {
            call.reject("Media Service not connected yet");
            return;
        }

        String url = call.getString("url");
        String title = call.getString("title", "");
        String artist = call.getString("artist", "");
        String artwork = call.getString("artwork", "");
        String contextId = call.getString("contextId", "");
        
        if (url == null) {
            call.reject("No URL provided");
            return;
        }
        
        handler.post(() -> {
            try {
                Bundle extras = new Bundle();
                if (!contextId.isEmpty()) {
                    extras.putString("contextId", contextId);
                }

                MediaMetadata metadata = new MediaMetadata.Builder()
                    .setTitle(title)
                    .setArtist(artist)
                    .setArtworkUri(Uri.parse(artwork))
                    .setExtras(extras)
                    .build();

                MediaItem mediaItem = new MediaItem.Builder()
                    .setUri(url)
                    .setMediaId(call.getString("id", ""))
                    // .setMimeType(MimeTypes.AUDIO_MP4)
                    .setMimeType(MimeTypes.AUDIO_WEBM)
                    .setMediaMetadata(metadata)
                    .build();

                controller.addMediaItem(mediaItem);
                call.resolve();
            } catch (Exception e) {
                call.reject("Error adding to queue: " + e.getMessage());
            }
        });
    }

    @PluginMethod
    public void pause(PluginCall call) {
        handler.post(() -> {
            if (controller != null) {
                controller.pause();
                call.resolve();
            } else {
                call.reject("Service not connected");
            }
        });
    }

    @PluginMethod
    public void resume(PluginCall call) {
        handler.post(() -> {
            if (controller != null) {
                controller.play();
                call.resolve();
            } else {
                call.reject("Service not connected");
            }
        });
    }

    @PluginMethod
    public void seek(PluginCall call) {
        Double position = call.getDouble("position");
        if (position != null && controller != null) {
            handler.post(() -> {
                isSeeking = true;
                long seekMs = (long) (position * 1000);
                controller.seekTo(seekMs);
                
                JSObject ret = new JSObject();
                ret.put("action", "timeUpdate");
                ret.put("value", position);
                notifyListeners("onMediaEvent", ret);
                
                call.resolve();
            });
        } else {
            call.reject("Invalid position or service not connected");
        }
    }

    @PluginMethod
    public void setVolume(PluginCall call) {
        Float volume = call.getFloat("volume");
        if (volume != null && controller != null) {
            handler.post(() -> {
                controller.setVolume(volume);
                call.resolve();
            });
        }
    }
    
    @PluginMethod
    public void getDuration(PluginCall call) {
        handler.post(() -> {
            if (controller != null) {
                long duration = controller.getDuration();
                JSObject ret = new JSObject();
                ret.put("value", (duration == C.TIME_UNSET) ? 0 : duration / 1000.0);
                call.resolve(ret);
            } else {
                call.reject("Service not connected");
            }
        });
    }
    
    @PluginMethod
    public void getCurrentTime(PluginCall call) {
         handler.post(() -> {
            if (controller != null) {
                JSObject ret = new JSObject();
                ret.put("value", controller.getCurrentPosition() / 1000.0);
                call.resolve(ret);
            } else {
                call.reject("Service not connected");
            }
        });
    }

    @PluginMethod
    public void getPlaybackState(PluginCall call) {
        handler.post(() -> {
             if (controller != null) {
                JSObject ret = new JSObject();
                ret.put("isPlaying", controller.getPlayWhenReady() && 
                    (controller.getPlaybackState() == Player.STATE_READY || controller.getPlaybackState() == Player.STATE_BUFFERING));
                call.resolve(ret);
             } else {
                 call.reject("Service not connected");
             }
        });
    }

    @PluginMethod
    public void warmup(PluginCall call) {
        String url = call.getString("url");
        if (url != null) {
            // משתמשים בפונקציה הקיימת triggerServerSideWarmup כדי להעיר את השרת
            triggerServerSideWarmup(url);
        }
        call.resolve();
    }

    @PluginMethod
    public void skipToIndex(PluginCall call) {
        handler.post(() -> {
            if (controller != null) {
                Integer index = call.getInt("index", 0);
                controller.seekToDefaultPosition(index);
                controller.play();
                call.resolve();
            } else {
                call.reject("Player not initialized");
            }
        });
    }
}
