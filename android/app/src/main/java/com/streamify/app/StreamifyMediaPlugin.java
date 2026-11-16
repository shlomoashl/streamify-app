package com.streamify.app;

import android.content.ComponentName;
import android.content.Context;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import androidx.annotation.OptIn;
import androidx.core.content.ContextCompat;
import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MediaMetadata;
import androidx.media3.common.MimeTypes;
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

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

class PluginEvents {
    public interface PluginEventListener {
        void onEvent(String action, Object value);
    }

    private static volatile PluginEventListener listener;
    private static final Handler mainHandler = new Handler(Looper.getMainLooper());

    public static void setListener(PluginEventListener newListener) {
        listener = newListener;
    }

    public static void postEvent(String action, Object value) {
        PluginEventListener current = listener;
        if (current != null) {
            mainHandler.post(() -> current.onEvent(action, value));
        }
    }
}

@CapacitorPlugin(name = "StreamifyMedia")
public class StreamifyMediaPlugin extends Plugin {
    private static final String TAG = "StreamifyMedia";

    private MediaController controller;
    private ListenableFuture<MediaController> controllerFuture;
    private final Handler handler = new Handler(Looper.getMainLooper());

    private boolean isSeeking = false;
    private boolean isProgressRunning = false;

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
                        Log.e(TAG, "Error in progressRunnable", e);
                    }
                }
                handler.postDelayed(this, 1000);
            }
        }
    };

    @Override
    public void load() {
        super.load();
        Context context = getContext();

        PluginEvents.setListener((action, value) -> {
            JSObject ret = new JSObject();
            ret.put("action", action);
            if (value != null) {
                ret.put("value", value);
            }
            notifyListeners("onMediaEvent", ret);

            if ("playbackState".equals(action)) {
                boolean active = Boolean.TRUE.equals(value);
                if (active) {
                    startProgressUpdate();
                } else {
                    stopProgressUpdate();
                }
            }
        });

        connectController(context);
    }

    private void connectController(Context context) {
        handler.post(() -> {
            try {
                SessionToken sessionToken = new SessionToken(context, new ComponentName(context, PlaybackService.class));
                controllerFuture = new MediaController.Builder(context, sessionToken).buildAsync();
                controllerFuture.addListener(() -> {
                    try {
                        controller = controllerFuture.get();
                        setupControllerTimelineListener();
                        if (controller.isPlaying()) {
                            startProgressUpdate();
                        }
                    } catch (Exception e) {
                        Log.e(TAG, "Failed to connect MediaController", e);
                    }
                }, ContextCompat.getMainExecutor(context));
            } catch (Exception e) {
                Log.e(TAG, "Error building MediaController", e);
            }
        });
    }

    private void runWithController(PluginCall call, Runnable action) {
        handler.post(() -> {
            if (controller != null) {
                action.run();
                return;
            }
            if (controllerFuture != null) {
                controllerFuture.addListener(() -> {
                    try {
                        if (controller == null) {
                            controller = controllerFuture.get();
                            setupControllerTimelineListener();
                        }
                        action.run();
                    } catch (Exception e) {
                        call.reject("Media Service connection failed: " + e.getMessage());
                    }
                }, ContextCompat.getMainExecutor(getContext()));
            } else {
                connectController(getContext());
                call.reject("Media Service initializing, please retry");
            }
        });
    }

    private void setupControllerTimelineListener() {
        if (controller == null) return;
        controller.addListener(new Player.Listener() {
            @Override
            public void onPlaybackStateChanged(int playbackState) {
                if (isSeeking && playbackState == Player.STATE_READY) {
                    isSeeking = false;
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

    @Override
    protected void handleOnDestroy() {
        super.handleOnDestroy();
        stopProgressUpdate();
        PluginEvents.setListener(null);
        if (controllerFuture != null) {
            MediaController.releaseFuture(controllerFuture);
        }
    }

    @PluginMethod
    public void initialize(PluginCall call) {
        call.resolve();
    }

    @PluginMethod
    public void getLastPlayedInfo(PluginCall call) {
        handler.post(() -> {
            try {
                Context context = getContext();
                SharedPreferences prefs = context.getSharedPreferences(PlaybackService.PREFS_NAME, Context.MODE_PRIVATE);
                JSONObject checkpoint = PlaybackService.readBestSavedCheckpoint(context);

                String id = checkpoint.optString("id", prefs.getString("last_id", null));
                String url = checkpoint.optString("url", prefs.getString("last_url", ""));
                String title = checkpoint.optString("title", prefs.getString("last_title", ""));
                String artist = checkpoint.optString("artist", prefs.getString("last_artist", ""));
                String artwork = checkpoint.optString("artwork", prefs.getString("last_artwork", ""));
                String contextId = checkpoint.has("contextId") && !checkpoint.isNull("contextId")
                        ? checkpoint.optString("contextId", null)
                        : prefs.getString("last_context_id", null);
                boolean isShuffled = checkpoint.optBoolean("isShuffled", prefs.getBoolean("is_shuffled", false));
                int index = checkpoint.optInt("index", 0);
                long savedPosMs = checkpoint.optLong("position", 0L);
                boolean userPaused = checkpoint.optBoolean("userPaused", prefs.getBoolean("user_paused", true));

                // אם הנגן כרגע פעיל בזיכרון, ניקח את הנתונים החיים ממנו
                if (controller != null && controller.getCurrentMediaItem() != null) {
                    MediaItem currentItem = controller.getCurrentMediaItem();
                    if (currentItem.mediaId != null && !currentItem.mediaId.isEmpty()) {
                        id = currentItem.mediaId;
                        index = controller.getCurrentMediaItemIndex();
                        if (currentItem.mediaMetadata != null) {
                            if (currentItem.mediaMetadata.title != null && currentItem.mediaMetadata.title.length() > 0) {
                                title = currentItem.mediaMetadata.title.toString();
                            }
                            if (currentItem.mediaMetadata.artist != null && currentItem.mediaMetadata.artist.length() > 0) {
                                artist = currentItem.mediaMetadata.artist.toString();
                            }
                            if (currentItem.mediaMetadata.artworkUri != null) {
                                artwork = currentItem.mediaMetadata.artworkUri.toString();
                            }
                            if (currentItem.mediaMetadata.extras != null) {
                                String liveCtx = currentItem.mediaMetadata.extras.getString("contextId");
                                if (liveCtx != null && !liveCtx.isEmpty()) {
                                    contextId = liveCtx;
                                }
                            }
                        }
                    }
                }

                if (id != null && !id.isEmpty()) {
                    JSObject ret = new JSObject();
                    ret.put("id", id);
                    ret.put("url", url != null ? url : "");
                    ret.put("title", title != null ? title : "");
                    ret.put("artist", artist != null ? artist : "");
                    ret.put("artwork", artwork != null ? artwork : "");
                    ret.put("contextId", (contextId != null && !contextId.isEmpty()) ? contextId : null);
                    ret.put("isShuffled", isShuffled);
                    ret.put("index", index);

                    if (controller != null && (controller.isPlaying() || controller.getCurrentPosition() > 1000)) {
                        savedPosMs = Math.max(savedPosMs, controller.getCurrentPosition());
                    }
                    ret.put("savedTime", savedPosMs / 1000.0);

                    boolean activelyPlaying = controller != null && controller.isPlaying();
                    ret.put("isPlaying", activelyPlaying);
                    ret.put("isInitialBoot", !PlaybackService.isBootAutoPlayHandled());
                    ret.put("userPaused", userPaused);
                    ret.put("encryptionEnabled", prefs.getBoolean("encryption_enabled", PlaybackService.isEncryptionEnabled()));

                    JSONArray queueArr = PlaybackService.readBestSavedQueue(context);
                    if (queueArr != null && queueArr.length() > 0) {
                        try {
                            ret.put("queue", new JSArray(queueArr.toString()));
                        } catch (Exception ignored) {}
                    }

                    call.resolve(ret);
                } else {
                    call.resolve();
                }
            } catch (Throwable t) {
                Log.e(TAG, "Error in getLastPlayedInfo", t);
                call.resolve();
            }
        });
    }

    @OptIn(markerClass = UnstableApi.class)
    @PluginMethod
    public void play(PluginCall call) {
        String url = call.getString("url");
        if (url == null || url.isEmpty()) {
            call.reject("No URL provided");
            return;
        }

        String id = call.getString("id", "");
        String title = call.getString("title", "");
        String artist = call.getString("artist", "");
        String artwork = call.getString("artwork", "");
        String contextId = call.getString("contextId", "");
        Double startPosition = call.getDouble("startPosition", -1.0);
        long startPosMs = (startPosition != null && startPosition > 0) ? (long) (startPosition * 1000) : 0L;

        runWithController(call, () -> {
            try {
                PlaybackService service = PlaybackService.getInstance();
                if (service != null) {
                    service.setUserPaused(false);
                    PlaybackService.markBootAutoPlayHandled();

                    JSONArray singleArr = new JSONArray();
                    JSONObject obj = new JSONObject();
                    obj.put("id", id);
                    obj.put("url", url);
                    obj.put("title", title);
                    obj.put("artist", artist);
                    obj.put("artwork", artwork);
                    singleArr.put(obj);
                    service.saveQueueToPrefs(singleArr, 0, contextId, false, startPosMs);
                }

                Bundle extras = new Bundle();
                if (contextId != null && !contextId.isEmpty()) {
                    extras.putString("contextId", contextId);
                }

                MediaMetadata metadata = new MediaMetadata.Builder()
                        .setTitle(title)
                        .setArtist(artist)
                        .setArtworkUri(Uri.parse(artwork != null ? artwork : ""))
                        .setExtras(extras)
                        .build();

                MediaItem mediaItem = new MediaItem.Builder()
                        .setUri(url)
                        .setMediaId(id != null ? id : "")
                        .setMimeType(MimeTypes.AUDIO_MP4)
                        .setMediaMetadata(metadata)
                        .build();

                controller.setMediaItems(Collections.singletonList(mediaItem), 0, startPosMs);
                controller.prepare();
                controller.play();

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
        JSArray items = call.getArray("items");
        if (items == null || items.length() == 0) {
            call.reject("No items provided");
            return;
        }

        int startIndex = call.getInt("startIndex", 0);
        String contextId = call.getString("contextId", "");
        boolean isShuffled = Boolean.TRUE.equals(call.getBoolean("isShuffled", false));
        Double startPosition = call.getDouble("startPosition", -1.0);
        long requestedStartPosMs = (startPosition != null && startPosition > 0) ? (long) (startPosition * 1000) : -1L;

        runWithController(call, () -> {
            try {
                PlaybackService service = PlaybackService.getInstance();
                Context context = getContext();
                SharedPreferences prefs = context.getSharedPreferences(PlaybackService.PREFS_NAME, Context.MODE_PRIVATE);
                JSONObject checkpoint = PlaybackService.readBestSavedCheckpoint(context);

                // הגנה קריטית למולטימדיה לרכב:
                // אם מופעל אותו שיר שהיה שמור בזיכרון ולא הועבר startPosition מפורש, נשמור על המיקום השמור!
                long finalStartPosMs = requestedStartPosMs;
                JSONObject targetObj = items.optJSONObject(startIndex);
                String targetId = targetObj != null ? targetObj.optString("id", "") : "";
                String savedId = checkpoint.optString("id", prefs.getString("last_id", ""));
                long savedPosMs = checkpoint.optLong("position", prefs.getLong("last_position", 0));

                if (finalStartPosMs < 0 && !PlaybackService.isBootAutoPlayHandled()
                        && targetId.equals(savedId) && savedPosMs > 1000) {
                    Log.i(TAG, "Preserving saved car position (" + savedPosMs + "ms) for song " + targetId);
                    finalStartPosMs = savedPosMs;
                }

                if (service != null) {
                    service.setUserPaused(false);
                    PlaybackService.markBootAutoPlayHandled();
                    service.saveQueueToPrefs(items, startIndex, contextId, isShuffled, finalStartPosMs);
                }

                List<MediaItem> mediaItems = buildMediaItemList(items, contextId);
                if (mediaItems.isEmpty()) {
                    call.reject("Failed to parse queue items");
                    return;
                }

                int safeIndex = Math.max(0, Math.min(startIndex, mediaItems.size() - 1));
                long seekPos = finalStartPosMs > 0 ? finalStartPosMs : 0L;

                controller.setMediaItems(mediaItems, safeIndex, seekPos);
                controller.prepare();
                controller.play();

                startProgressUpdate();
                call.resolve();
            } catch (Exception e) {
                call.reject("Error playing queue: " + e.getMessage());
            }
        });
    }

    @OptIn(markerClass = UnstableApi.class)
    @PluginMethod
    public void updateQueue(PluginCall call) {
        JSArray items = call.getArray("items");
        if (items == null || items.length() == 0) {
            call.reject("No items provided");
            return;
        }

        int startIndex = call.getInt("startIndex", 0);
        String contextId = call.getString("contextId", "");
        boolean isShuffled = Boolean.TRUE.equals(call.getBoolean("isShuffled", false));

        runWithController(call, () -> {
            try {
                List<MediaItem> mediaItems = buildMediaItemList(items, contextId);
                if (mediaItems.isEmpty()) {
                    call.reject("Failed to parse queue items");
                    return;
                }

                long currentPos = controller.getCurrentPosition();
                Context context = getContext();
                SharedPreferences prefs = context.getSharedPreferences(PlaybackService.PREFS_NAME, Context.MODE_PRIVATE);
                if (currentPos < 1000) {
                    JSONObject checkpoint = PlaybackService.readBestSavedCheckpoint(context);
                    currentPos = checkpoint.optLong("position", prefs.getLong("last_position", 0));
                }

                PlaybackService service = PlaybackService.getInstance();
                boolean shouldPlay = controller.isPlaying() && (service == null || !service.isUserPaused());

                if (service != null) {
                    service.saveQueueToPrefs(items, startIndex, contextId, isShuffled, currentPos);
                }

                int safeIndex = Math.max(0, Math.min(startIndex, mediaItems.size() - 1));
                controller.setMediaItems(mediaItems, safeIndex, Math.max(0L, currentPos));
                controller.prepare();

                // שומרים על מצב ה-Pause של המשתמש! לעולם לא מדליקים אם המשתמש היה ב-Pause
                if (shouldPlay) {
                    controller.play();
                } else {
                    controller.pause();
                }

                call.resolve();
            } catch (Exception e) {
                call.reject("Error updating queue: " + e.getMessage());
            }
        });
    }

    @OptIn(markerClass = UnstableApi.class)
    private List<MediaItem> buildMediaItemList(JSArray items, String contextId) {
        List<MediaItem> mediaItems = new ArrayList<>();
        for (int i = 0; i < items.length(); i++) {
            try {
                JSONObject item = items.getJSONObject(i);
                Bundle extras = new Bundle();
                if (contextId != null && !contextId.isEmpty()) {
                    extras.putString("contextId", contextId);
                }

                MediaMetadata metadata = new MediaMetadata.Builder()
                        .setTitle(item.optString("title", ""))
                        .setArtist(item.optString("artist", ""))
                        .setArtworkUri(Uri.parse(item.optString("artwork", "")))
                        .setExtras(extras)
                        .build();

                MediaItem mediaItem = new MediaItem.Builder()
                        .setUri(item.getString("url"))
                        .setMediaId(item.getString("id"))
                        .setMimeType(MimeTypes.AUDIO_MP4)
                        .setMediaMetadata(metadata)
                        .build();
                mediaItems.add(mediaItem);
            } catch (Exception e) {
                Log.e(TAG, "Error parsing queue item at index " + i, e);
            }
        }
        return mediaItems;
    }

    @OptIn(markerClass = UnstableApi.class)
    @PluginMethod
    public void addToQueue(PluginCall call) {
        String url = call.getString("url");
        if (url == null || url.isEmpty()) {
            call.reject("No URL provided");
            return;
        }

        String id = call.getString("id", "");
        String title = call.getString("title", "");
        String artist = call.getString("artist", "");
        String artwork = call.getString("artwork", "");
        String contextId = call.getString("contextId", "");

        runWithController(call, () -> {
            try {
                Bundle extras = new Bundle();
                if (contextId != null && !contextId.isEmpty()) {
                    extras.putString("contextId", contextId);
                }

                MediaMetadata metadata = new MediaMetadata.Builder()
                        .setTitle(title)
                        .setArtist(artist)
                        .setArtworkUri(Uri.parse(artwork != null ? artwork : ""))
                        .setExtras(extras)
                        .build();

                MediaItem mediaItem = new MediaItem.Builder()
                        .setUri(url)
                        .setMediaId(id != null ? id : "")
                        .setMimeType(MimeTypes.AUDIO_MP4)
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
        runWithController(call, () -> {
            PlaybackService service = PlaybackService.getInstance();
            if (service != null) {
                service.setUserPaused(true);
                PlaybackService.markBootAutoPlayHandled();
            }
            controller.pause();
            stopProgressUpdate();
            call.resolve();
        });
    }

    @PluginMethod
    public void resume(PluginCall call) {
        runWithController(call, () -> {
            PlaybackService service = PlaybackService.getInstance();
            if (service != null) {
                service.setUserPaused(false);
                PlaybackService.markBootAutoPlayHandled();
            }
            if (controller.getPlaybackState() == Player.STATE_IDLE) {
                controller.prepare();
            }
            controller.play();
            startProgressUpdate();
            call.resolve();
        });
    }

    @PluginMethod
    public void seek(PluginCall call) {
        Double position = call.getDouble("position");
        if (position == null) {
            call.reject("Invalid position");
            return;
        }
        runWithController(call, () -> {
            isSeeking = true;
            long seekMs = Math.max(0L, (long) (position * 1000));
            controller.seekTo(seekMs);

            PlaybackService service = PlaybackService.getInstance();
            if (service != null) {
                service.saveExplicitSeekPosition(seekMs);
            }

            JSObject ret = new JSObject();
            ret.put("action", "timeUpdate");
            ret.put("value", position);
            notifyListeners("onMediaEvent", ret);

            call.resolve();
        });
    }

    @PluginMethod
    public void setVolume(PluginCall call) {
        Float volume = call.getFloat("volume");
        if (volume == null) {
            call.resolve();
            return;
        }
        runWithController(call, () -> {
            controller.setVolume(Math.max(0f, Math.min(1f, volume)));
            call.resolve();
        });
    }

    @PluginMethod
    public void getDuration(PluginCall call) {
        runWithController(call, () -> {
            long duration = controller.getDuration();
            JSObject ret = new JSObject();
            ret.put("value", (duration == C.TIME_UNSET || duration < 0) ? 0 : duration / 1000.0);
            call.resolve(ret);
        });
    }

    @PluginMethod
    public void getCurrentTime(PluginCall call) {
        runWithController(call, () -> {
            JSObject ret = new JSObject();
            ret.put("value", controller.getCurrentPosition() / 1000.0);
            call.resolve(ret);
        });
    }

    @PluginMethod
    public void getPlaybackState(PluginCall call) {
        runWithController(call, () -> {
            PlaybackService service = PlaybackService.getInstance();
            boolean userPaused = service != null && service.isUserPaused();
            boolean isPlaying = !userPaused && controller.getPlayWhenReady() &&
                    (controller.getPlaybackState() == Player.STATE_READY || controller.getPlaybackState() == Player.STATE_BUFFERING);
            JSObject ret = new JSObject();
            ret.put("isPlaying", isPlaying);
            ret.put("userPaused", userPaused);
            call.resolve(ret);
        });
    }

    @PluginMethod
    public void warmup(PluginCall call) {
        String url = call.getString("url");
        PlaybackService service = PlaybackService.getInstance();
        if (url != null && service != null && !service.isUserPaused()) {
            service.triggerServerSideWarmup(url);
        }
        call.resolve();
    }

    @PluginMethod
    public void skipToIndex(PluginCall call) {
        int index = call.getInt("index", 0);
        runWithController(call, () -> {
            PlaybackService service = PlaybackService.getInstance();
            if (service != null) {
                service.setUserPaused(false);
                PlaybackService.markBootAutoPlayHandled();
            }
            if (index >= 0 && index < controller.getMediaItemCount()) {
                controller.seekToDefaultPosition(index);
                controller.prepare();
                controller.play();
                startProgressUpdate();
            }
            call.resolve();
        });
    }

    @PluginMethod
    public void setEncryptionMode(PluginCall call) {
        boolean enabled = Boolean.TRUE.equals(call.getBoolean("enabled", true));
        Context context = getContext();
        PlaybackService.setEncryptionEnabledStatic(context, enabled);

        JSObject ret = new JSObject();
        ret.put("enabled", enabled);
        call.resolve(ret);
    }

    @PluginMethod
    public void getEncryptionMode(PluginCall call) {
        Context context = getContext();
        SharedPreferences prefs = context.getSharedPreferences(PlaybackService.PREFS_NAME, Context.MODE_PRIVATE);
        boolean enabled = prefs.getBoolean("encryption_enabled", PlaybackService.isEncryptionEnabled());
        PlaybackService.setEncryptionEnabledStatic(context, enabled);

        JSObject ret = new JSObject();
        ret.put("enabled", enabled);
        call.resolve(ret);
    }
}
