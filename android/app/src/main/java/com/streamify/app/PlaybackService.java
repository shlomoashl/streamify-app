
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

public class PlaybackService extends MediaSessionService {
    private MediaSession mediaSession;
    private Player player;
    private static final String PREFS_NAME = "StreamifyPlaybackState";

    @OptIn(markerClass = UnstableApi.class)
    @Override
    public void onCreate() {
        super.onCreate();
        
        String userAgent = "Streamify Android App";
        
        DefaultHttpDataSource.Factory httpDataSourceFactory = new DefaultHttpDataSource.Factory()
            .setAllowCrossProtocolRedirects(true)
            .setUserAgent(userAgent)
            .setConnectTimeoutMs(30000)
            .setReadTimeoutMs(30000);

        // --- כאן אנחנו מלבישים את המפענח שלנו על תעבורת הרשת ---
        DataSource.Factory xorDataSourceFactory = () -> new XorDataSource(httpDataSourceFactory.createDataSource());

        DefaultMediaSourceFactory mediaSourceFactory = new DefaultMediaSourceFactory(this)
            .setDataSourceFactory(xorDataSourceFactory); // הנגן ימשוך נתונים רק דרך המפענח
            
        androidx.media3.exoplayer.DefaultLoadControl loadControl = new androidx.media3.exoplayer.DefaultLoadControl.Builder()
            .setBufferDurationsMs(10000, 20000, 1500, 2500).build();

        player = new ExoPlayer.Builder(this)
            .setMediaSourceFactory(mediaSourceFactory)
            .setWakeMode(C.WAKE_MODE_NETWORK)
            .setHandleAudioBecomingNoisy(true)
            .build();

        player.addListener(new Player.Listener() {
            @Override
            public void onMediaItemTransition(@Nullable MediaItem mediaItem, int reason) {
                if (mediaItem != null) {
                    saveLastPlayedSong(mediaItem);
                }
            }
        });

        AudioAttributes audioAttributes = new AudioAttributes.Builder()
            .setUsage(C.USAGE_MEDIA)
            .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
            .build();
        player.setAudioAttributes(audioAttributes, true);

        mediaSession = new MediaSession.Builder(this, player).build();
        restoreLastPlayedSong();
    }

    private void saveLastPlayedSong(MediaItem item) {
        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        SharedPreferences.Editor editor = prefs.edit();
        
        if (item.localConfiguration != null) {
            editor.putString("last_url", item.localConfiguration.uri.toString());
        }
        
        editor.putString("last_id", item.mediaId);
        
        if (item.mediaMetadata != null) {
            editor.putString("last_title", item.mediaMetadata.title != null ? item.mediaMetadata.title.toString() : "");
            editor.putString("last_artist", item.mediaMetadata.artist != null ? item.mediaMetadata.artist.toString() : "");
            if (item.mediaMetadata.artworkUri != null) {
                editor.putString("last_artwork", item.mediaMetadata.artworkUri.toString());
            }
            
            // SAVE CONTEXT ID (Playlist ID)
            if (item.mediaMetadata.extras != null && item.mediaMetadata.extras.containsKey("contextId")) {
                editor.putString("last_context_id", item.mediaMetadata.extras.getString("contextId"));
            } else {
                editor.remove("last_context_id");
            }
        }
        
        editor.apply();
    }

    private void restoreLastPlayedSong() {
        try {
            SharedPreferences prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            String url = prefs.getString("last_url", null);
            
            // Only restore if we have a URL and the player is currently empty
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
        // Only stop if playback has actually finished.
        // If playing, keep the service alive.
        if (player != null && !player.isPlaying() && player.getPlaybackState() == Player.STATE_ENDED) {
            stopSelf();
        }
    }

    @Override
    public void onDestroy() {
        if (mediaSession != null) {
            mediaSession.release();
            mediaSession = null;
        }
        if (player != null) {
            player.release();
            player = null;
        }
        super.onDestroy();
    }

    @Nullable
    @Override
    public MediaSession onGetSession(MediaSession.ControllerInfo controllerInfo) {
        return mediaSession;
    }
}
