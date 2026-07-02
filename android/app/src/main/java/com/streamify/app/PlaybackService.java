package com.streamify.app;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Bundle;
import android.util.Log;

import androidx.annotation.Nullable;
import androidx.annotation.OptIn;
import androidx.media3.common.AudioAttributes;
import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MediaMetadata;
import androidx.media3.common.MimeTypes;
import androidx.media3.common.Player;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;
import androidx.media3.session.MediaSession;
import androidx.media3.session.MediaSessionService;
import androidx.media3.datasource.DataSource;

public class PlaybackService extends MediaSessionService {
    private MediaSession mediaSession;
    private Player player;
    private static final String PREFS_NAME = "StreamifyPlaybackState";

    // הלולאה החכמה: שומרת כל 2 שניות, אך ורק אם בוצעה התקדמות בפועל
    private final android.os.Handler saveHandler = new android.os.Handler(android.os.Looper.getMainLooper());
    private final Runnable saveRunnable = new Runnable() {
        private long lastSavedPosition = -1;
        private String lastSavedId = "";

        @Override
        public void run() {
            // הוספנו תנאי player.isPlaying() כדי לא לכתוב לדיסק כשהשיר בהשהייה (Pause)
            if (player != null && player.isPlaying()) {
                MediaItem currentItem = player.getCurrentMediaItem();
                if (currentItem != null) {
                    long currentPos = player.getCurrentPosition();
                    String currentId = currentItem.mediaId != null ? currentItem.mediaId : "";

                    // שמירה מתבצעת רק אם השיר התחלף, או שהזמן התקדם בלפחות שנייה אחת
                    if (!currentId.equals(lastSavedId) || Math.abs(currentPos - lastSavedPosition) >= 1000) {
                        saveEverythingImmediately(currentItem, currentPos);
                        lastSavedId = currentId;
                        lastSavedPosition = currentPos;
                    }
                }
            }
            saveHandler.postDelayed(this, 2000);
        }
    };  

    @OptIn(markerClass = UnstableApi.class)
    @Override
    public void onCreate() {
        super.onCreate();
        
        String userAgent = "Streamify";
        
        DefaultHttpDataSource.Factory httpDataSourceFactory = new DefaultHttpDataSource.Factory()
            .setAllowCrossProtocolRedirects(true)
            .setUserAgent(userAgent)
            .setConnectTimeoutMs(30000)
            .setReadTimeoutMs(30000);

        DataSource.Factory xorDataSourceFactory = () -> new XorDataSource(httpDataSourceFactory.createDataSource());

        DefaultMediaSourceFactory mediaSourceFactory = new DefaultMediaSourceFactory(this)
            .setDataSourceFactory(xorDataSourceFactory);

        androidx.media3.exoplayer.DefaultLoadControl loadControl = new androidx.media3.exoplayer.DefaultLoadControl.Builder()
            .setBufferDurationsMs(30000, 60000, 250, 500)
            .setPrioritizeTimeOverSizeThresholds(true)
            .build();

        player = new ExoPlayer.Builder(this)
            .setMediaSourceFactory(mediaSourceFactory)
            .setLoadControl(loadControl)
            .setWakeMode(C.WAKE_MODE_NETWORK)
            .setHandleAudioBecomingNoisy(true)
            .build();            

        // מחקנו את המאזין onMediaItemTransition - הלולאה עושה הכל!

        AudioAttributes audioAttributes = new AudioAttributes.Builder()
            .setUsage(C.USAGE_MEDIA)
            .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
            .build();
        player.setAudioAttributes(audioAttributes, true);

        mediaSession = new MediaSession.Builder(this, player).build();
        
        restoreLastPlayedSong();
        saveHandler.post(saveRunnable);
    }

    // הפונקציה ששומרת הכל בצורה סינכרונית ובטוחה
    private void saveEverythingImmediately(MediaItem item, long currentPos) {
        SharedPreferences.Editor editor = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit();
        
        // שמירת המיקום המדויק
        editor.putLong("last_position", currentPos);
        editor.putString("last_id", item.mediaId);
        
        String savedUrl = null;
        if (item.localConfiguration != null) {
            savedUrl = item.localConfiguration.uri.toString();
        } else if (item.mediaMetadata != null && item.mediaMetadata.extras != null) {
            savedUrl = item.mediaMetadata.extras.getString("url");
        }
        
        if (savedUrl != null) {
            editor.putString("last_url", savedUrl);
        }
        
        if (item.mediaMetadata != null) {
            editor.putString("last_title", item.mediaMetadata.title != null ? item.mediaMetadata.title.toString() : "");
            editor.putString("last_artist", item.mediaMetadata.artist != null ? item.mediaMetadata.artist.toString() : "");
            if (item.mediaMetadata.artworkUri != null) {
                editor.putString("last_artwork", item.mediaMetadata.artworkUri.toString());
            }
            if (item.mediaMetadata.extras != null && item.mediaMetadata.extras.containsKey("contextId")) {
                editor.putString("last_context_id", item.mediaMetadata.extras.getString("contextId"));
            }
        }
        
        editor.commit(); // כתיבה מיידית לדיסק!
    }

    private void restoreLastPlayedSong() {
        try {
            SharedPreferences prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            String url = prefs.getString("last_url", null);
            
            if (url != null && player != null && player.getMediaItemCount() == 0) {
                String id = prefs.getString("last_id", "");
                String title = prefs.getString("last_title", "Streamify");
                String artist = prefs.getString("last_artist", "");
                String artwork = prefs.getString("last_artwork", "");
                String contextId = prefs.getString("last_context_id", null);

                Bundle extras = new Bundle();
                if (contextId != null) {
                    extras.putString("contextId", contextId);
                }
                extras.putString("url", url);

                MediaMetadata metadata = new MediaMetadata.Builder()
                    .setTitle(title)
                    .setArtist(artist)
                    .setArtworkUri(Uri.parse(artwork))
                    .setExtras(extras)
                    .build();

                MediaItem mediaItem = new MediaItem.Builder()
                    .setUri(url)
                    .setMediaId(id)
                    .setMimeType(MimeTypes.AUDIO_MP4)
                    .setMediaMetadata(metadata)
                    .build();

                player.setMediaItem(mediaItem);
                player.prepare();
            }
        } catch (Exception e) {
            Log.e("PlaybackService", "Failed to restore last played song", e);
        }
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        if (player != null && !player.isPlaying() && player.getPlaybackState() == Player.STATE_ENDED) {
            stopSelf();
        }
    }

    @Override
    public void onDestroy() {
        saveHandler.removeCallbacks(saveRunnable);
        if (player != null) {
            // שמירה סופית
            MediaItem currentItem = player.getCurrentMediaItem();
            if (currentItem != null) {
                saveEverythingImmediately(currentItem, player.getCurrentPosition());
            }
            player.release();
            player = null;
        }
        if (mediaSession != null) {
            mediaSession.release();
            mediaSession = null;
        }
        super.onDestroy();
    }

    @Nullable
    @Override
    public MediaSession onGetSession(MediaSession.ControllerInfo controllerInfo) {
        return mediaSession;
    }
}