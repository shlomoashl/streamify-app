
import { Capacitor, registerPlugin, PluginListenerHandle } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { PlaylistItem, StreamifyMediaPlugin, PlayOptions, PlayQueueOptions } from './types';
import Hls from 'hls.js';
import { YOUTUBE_API_BASE, SERVER_PUBLIC_URL } from './constants';

// Define the plugin registry
const StreamifyMedia = registerPlugin<StreamifyMediaPlugin>('StreamifyMedia');

type AudioEventType = 'timeUpdate' | 'stateChange' | 'ended' | 'error' | 'durationChange' | 'remoteNext' | 'remotePrev' | 'itemTransition';
type ListenerCallback = (data: any) => void;

class AudioService {
    private isNative: boolean;
    private webAudio: HTMLAudioElement | null = null;
    private hls: Hls | null = null;
    private listeners: Map<AudioEventType, Set<ListenerCallback>> = new Map();
    private nativeListeners: PluginListenerHandle[] = [];
    private fallbackToWeb = false; // Flag to force web audio if native fails

    // Web/Windows Queue Management State
    private webQueue: PlaylistItem[] = [];
    private webCurrentIndex: number = 0;

    constructor() {
        this.isNative = Capacitor.isNativePlatform();
        console.log(`[AudioService] Initializing. Native: ${this.isNative}`);
        
        if (this.isNative) {
            this.setupNativeListeners();
        } else {
            this.setupWebAudio();
        }
    }

    private setupWebAudio() {
        if (this.webAudio) return; // Avoid double initialization

        console.log('[AudioService] Setting up Web Audio (HLS/HTML5)');
        this.webAudio = new Audio();
        
        // Basic Event Listeners
        this.webAudio.addEventListener('timeupdate', () => {
            this.emit('timeUpdate', { currentTime: this.webAudio?.currentTime || 0 });
        });

        this.webAudio.addEventListener('durationchange', () => {
            if (this.webAudio?.duration && !isNaN(this.webAudio.duration) && this.webAudio.duration !== Infinity) {
                this.emit('durationChange', { duration: this.webAudio.duration });
            }
        });

        // AUTO-ADVANCE LOGIC FOR WEB/WINDOWS
        this.webAudio.addEventListener('ended', () => {
            console.log('[AudioService] Playback ended');
            
            // Check if we have a queue and a next song
            if (this.webQueue.length > 0 && this.webCurrentIndex < this.webQueue.length - 1) {
                this.webCurrentIndex++;
                const nextSong = this.webQueue[this.webCurrentIndex];
                console.log(`[AudioService] Web Auto-Advance to: ${nextSong.title}`);
                
                // Play next song
                const url = `${YOUTUBE_API_BASE}/get_m3u8/${nextSong.id}`;
                this.playWeb(nextSong, url);
                
                // Notify UI of transition (Simulate Native behavior)
                this.emit('itemTransition', { id: nextSong.id });
                
                // PREFETCH / WARMUP THE NEXT 1 SONG ONLY (Reduced from 3)
                // DELAYED to ensure current song loads first
                setTimeout(() => {
                    if (this.webCurrentIndex + 1 < this.webQueue.length) {
                        const futureSong = this.webQueue[this.webCurrentIndex + 1];
                        this.triggerServerSideWarmup(`${YOUTUBE_API_BASE}/get_m3u8/${futureSong.id}`);
                    }
                }, 3000); // 3 Seconds delay
            } else {
                // Really finished
                this.emit('ended', {});
                this.emit('stateChange', { isPlaying: false });
            }
        });

        this.webAudio.addEventListener('play', () => {
            console.log('[AudioService] Play started');
            this.emit('stateChange', { isPlaying: true });
        });
        
        this.webAudio.addEventListener('pause', () => {
             console.log('[AudioService] Play paused');
             this.emit('stateChange', { isPlaying: false });
        });
        
        this.webAudio.addEventListener('error', (e) => {
             console.error("[AudioService] HTML5 Audio Error:", e, this.webAudio?.error);
             this.emit('error', { error: e });
        });
        
        // Setup MediaSession for Web
        if ('mediaSession' in navigator) {
            navigator.mediaSession.setActionHandler('play', () => this.resume());
            navigator.mediaSession.setActionHandler('pause', () => this.pause());
            
            navigator.mediaSession.setActionHandler('nexttrack', () => {
                // Implement manual next for Media Keys on Windows
                if (this.webQueue.length > 0 && this.webCurrentIndex < this.webQueue.length - 1) {
                    this.webCurrentIndex++;
                    const nextSong = this.webQueue[this.webCurrentIndex];
                    this.playWeb(nextSong, `${YOUTUBE_API_BASE}/get_m3u8/${nextSong.id}`);
                    this.emit('itemTransition', { id: nextSong.id });
                    this.emit('remoteNext', {}); // Also emit remoteNext for UI sync if needed
                }
            });

            navigator.mediaSession.setActionHandler('previoustrack', () => {
                 if (this.webQueue.length > 0 && this.webCurrentIndex > 0) {
                    this.webCurrentIndex--;
                    const prevSong = this.webQueue[this.webCurrentIndex];
                    this.playWeb(prevSong, `${YOUTUBE_API_BASE}/get_m3u8/${prevSong.id}`);
                    this.emit('itemTransition', { id: prevSong.id });
                    this.emit('remotePrev', {});
                }
            });
        }
    }

    private async setupNativeListeners() {
        try {
            const l1 = await StreamifyMedia.addListener('onMediaEvent', (event: any) => {
                // Log state changes to help debug background/native issues
                if (event.action === 'playbackState' || event.action === 'error' || event.action === 'remoteNext' || event.action === 'itemTransition') {
                    console.log(`[AudioService] Native Event: ${event.action}`, event.value || '');
                }

                switch(event.action) {
                    case 'timeUpdate':
                        this.emit('timeUpdate', { 
                            currentTime: event.value,
                            duration: event.duration
                        });
                        
                        if (event.duration && event.duration > 0) {
                            this.emit('durationChange', { duration: event.duration });
                        }
                        break;
                    case 'durationChange':
                        if (event.value > 0) {
                            this.emit('durationChange', { duration: event.value });
                        }
                        break;
                    case 'playbackState':
                        this.emit('stateChange', { isPlaying: event.value });
                        break;
                    case 'completed':
                        this.emit('ended', {});
                        break;
                    case 'itemTransition':
                         // Native auto-play moved to next song
                         this.emit('itemTransition', { id: event.value });
                         
                         // Preload next song
                         const currentId = event.value;
                         const idx = this.webQueue.findIndex(item => item.id === currentId);
                         if (idx !== -1 && idx + 1 < this.webQueue.length) {
                             this.preloadNext(this.webQueue[idx + 1]);
                         }
                         break;
                    case 'error':
                        console.error('[AudioService] Native Plugin Error:', event.value);
                        this.emit('error', { error: event.value });
                        break;
                    case 'remoteNext':
                        this.emit('remoteNext', {});
                        break;
                    case 'remotePrev':
                        this.emit('remotePrev', {});
                        break;
                }
            });
            this.nativeListeners.push(l1);
        } catch (e) {
            console.warn("Error registering native listeners", e);
        }
    }
    
    private async preloadNext(song: PlaylistItem) {
        if (!this.isNative) return;

        try {
            const fileName = `cache/${song.id}.mp3`;
            try {
                // Check if file already exists
                await Filesystem.stat({
                    path: fileName,
                    directory: Directory.Cache
                });
                console.log(`[AudioService] Preload: File ${fileName} already exists.`);
                return;
            } catch (e) {
                // File doesn't exist, proceed to download
            }

            console.log(`[AudioService] Preloading next song: ${song.title}`);
            
            // 1. Trigger server-side warmup (keep existing logic)
            const m3u8Url = `${YOUTUBE_API_BASE}/get_m3u8/${song.id}`;
            this.triggerServerSideWarmup(m3u8Url);

        } catch (error) {
            console.error("[AudioService] Preload failed:", error);
        }
    }

    /**
     * Sends a background request to the server to prepare the m3u8 playlist AND the first segment.
     * This reduces latency when the user eventually switches to this song.
     * Optimized to barely use bandwidth.
     */
    private async triggerServerSideWarmup(m3u8Url: string) {
        if (!m3u8Url) return;
        
        try {
            // 1. Fetch M3U8 Manifest
            // This tells the backend to run yt-dlp and generate the manifest
            const response = await fetch(m3u8Url);
            if (!response.ok) return;
            
            const text = await response.text();

            // 2. Parse Manifest to find first segment URL
            // The backend returns a list of URLs (some might be relative proxies)
            const lines = text.split('\n');
            let firstSegmentUrl = '';
            
            for (const line of lines) {
                const trimmed = line.trim();
                if (trimmed && !trimmed.startsWith('#')) {
                    firstSegmentUrl = trimmed;
                    break;
                }
            }

            if (firstSegmentUrl) {
                // Ensure absolute URL if it's relative
                if (!firstSegmentUrl.startsWith('http')) {
                    // FIX: Use SERVER_PUBLIC_URL for relative paths from backend, not window.location.origin
                    // This ensures it works on Windows app / Android where origin is local.
                    const baseUrl = SERVER_PUBLIC_URL.endsWith('/') ? SERVER_PUBLIC_URL.slice(0, -1) : SERVER_PUBLIC_URL;
                    firstSegmentUrl = baseUrl + (firstSegmentUrl.startsWith('/') ? '' : '/') + firstSegmentUrl;
                }

                console.log(`[AudioService] Warmup: Touching segment -> ${firstSegmentUrl}`);

                // 3. Touch the segment to trigger backend streaming
                // We use AbortController to kill the connection immediately after it starts.
                // We just want the server to start the pipe, we don't need the data yet.
                const controller = new AbortController();
                fetch(firstSegmentUrl, { signal: controller.signal })
                    .then(res => {
                        // Wait a tiny fraction to ensure server received request and started pipe
                        setTimeout(() => {
                            controller.abort();
                        }, 500); 
                    })
                    .catch(() => { /* Ignore abort error */ });
            }

        } catch (e) {
            console.warn("[AudioService] Warmup failed (non-fatal):", e);
        }
    }

    public async play(item: PlaylistItem, url: string, contextId?: string) {
        console.log(`[AudioService] Play request for "${item.title}" (ID: ${item.id})`);

        if (!this.isNative || this.fallbackToWeb) {
            if (!this.webAudio) this.setupWebAudio();
            
            this.playWeb(item, url);
            return;
        }

        if (this.isNative) {
            try {
                let playUrl = url;
                
                // Check for local cached file
                try {
                    const fileName = `cache/${item.id}.mp3`;
                    const stat = await Filesystem.stat({
                        path: fileName,
                        directory: Directory.Cache
                    });
                    if (stat) {
                        const uriResult = await Filesystem.getUri({
                            path: fileName,
                            directory: Directory.Cache
                        });
                        playUrl = Capacitor.convertFileSrc(uriResult.uri);
                        console.log(`[AudioService] Playing from local cache: ${playUrl}`);
                    }
                } catch (e) {
                    // Local file not found, fallback to remote URL
                }

                await StreamifyMedia.play({
                    url: playUrl,
                    id: item.id,
                    title: item.title,
                    artist: item.author,
                    artwork: item.thumbnail || 'https://via.placeholder.com/500',
                    duration: item.duration,
                    autoPlay: true,
                    contextId: contextId // Pass context ID to Native
                } as PlayOptions);
            } catch (e: any) {
                console.error("Native play failed", e);
                if (e.code === 'UNIMPLEMENTED' || e.message?.includes('UNIMPLEMENTED') || e.toString().includes('implemented')) {
                    console.warn("[AudioService] Native plugin missing/unimplemented. Falling back to Web Audio.");
                    this.fallbackToWeb = true;
                    this.setupWebAudio();
                    this.playWeb(item, url);
                }
            }
        }
    }

    public async playQueue(items: PlaylistItem[], startIndex: number, contextId?: string) {
        if (!items || items.length === 0) return;
        
        // Update local queue state for both Native and Web to support preloading
        this.webQueue = items;
        this.webCurrentIndex = startIndex;
        
        console.log(`[AudioService] Playing Queue. Size: ${items.length}, Start: ${startIndex}, Context: ${contextId}`);

        if (this.isNative && !this.fallbackToWeb) {
            try {
                // Preload next song immediately
                if (startIndex + 1 < items.length) {
                    this.preloadNext(items[startIndex + 1]);
                }

                const mediaItems = items.map(item => ({
                    id: item.id,
                    url: `${YOUTUBE_API_BASE}/get_m3u8/${item.id}`,
                    title: item.title,
                    artist: item.author,
                    artwork: item.thumbnail || 'https://via.placeholder.com/500',
                    duration: typeof item.duration === 'number' ? item.duration : 0
                }));
                
                await StreamifyMedia.playQueue({
                    items: mediaItems,
                    startIndex: startIndex,
                    contextId: contextId // Pass context ID to Native
                } as PlayQueueOptions);
            } catch (e) {
                console.error("Native playQueue failed", e);
            }
        } else {
            // Web / Windows Fallback Logic
            
            // 1. Update Internal State
            this.webQueue = [...items];
            this.webCurrentIndex = startIndex;
            
            const song = items[startIndex];
            const url = `${YOUTUBE_API_BASE}/get_m3u8/${song.id}`;
            
            // 2. Play Current Song (IMMEDIATELY)
            this.playWeb(song, url);
            
            // 3. PREFETCH / WARMUP NEXT 1 SONG ONLY (Reduced from 3)
            // CRITICAL: We wait 3 seconds before starting the warmup requests
            // This ensures the current song has fully negotiated, buffered, and started playing
            // without network contention.
            setTimeout(() => {
                const nextIndex = startIndex + 1;
                if (nextIndex < items.length) {
                    const nextSong = items[nextIndex];
                    const nextUrl = `${YOUTUBE_API_BASE}/get_m3u8/${nextSong.id}`;
                    this.triggerServerSideWarmup(nextUrl);
                }
            }, 3000);
        }
    }

    public async addToQueue(item: PlaylistItem, url: string, contextId?: string) {
        if (this.isNative && !this.fallbackToWeb) {
            console.log(`[AudioService] Queueing next: "${item.title}"`);
            try {
                await StreamifyMedia.addToQueue({
                    url: url,
                    id: item.id,
                    title: item.title,
                    artist: item.author,
                    artwork: item.thumbnail || 'https://via.placeholder.com/500',
                    duration: item.duration,
                    contextId: contextId // Pass context ID to Native
                } as PlayOptions);
            } catch (e) {
                console.error("Failed to add to native queue", e);
            }
        } else {
            // Web Fallback: Add to internal array
            this.webQueue.push(item);
        }
    }

    // New helper to handle Autoplay Policy errors gracefully
    private safePlay() {
        if (!this.webAudio) return;
        
        const playPromise = this.webAudio.play();
        if (playPromise !== undefined) {
            playPromise.catch(error => {
                if (error.name === 'NotAllowedError') {
                    console.warn("[AudioService] Autoplay blocked by policy. Waiting for user interaction.");
                    // We don't throw, just log warning. The UI will show paused state.
                    this.emit('stateChange', { isPlaying: false });
                } else {
                    console.error("[AudioService] Playback failed:", error);
                }
            });
        }
    }

    private async playWeb(item: PlaylistItem, url: string) {
        if (!this.webAudio) return;

        if (this.hls) {
            this.hls.destroy();
            this.hls = null;
        }

        if ('mediaSession' in navigator) {
            navigator.mediaSession.metadata = new MediaMetadata({
                title: item.title,
                artist: item.author,
                artwork: [{ src: item.thumbnail || '', sizes: '512x512', type: 'image/jpeg' }]
            });
        }

        if (Hls.isSupported()) {
            console.log('[AudioService] Using HLS.js');
            this.hls = new Hls({
                enableWorker: true,
                lowLatencyMode: true,
                debug: false,
                manifestLoadTimeout: 15000,
                levelLoadTimeout: 15000,
                fragLoadTimeout: 15000,
                fragLoadMaxRetry: 2,
                fragLoadRetryDelay: 500,
                fragLoadBackoffFactor: 1.2,
            });            
            this.hls.loadSource(url);
            this.hls.attachMedia(this.webAudio);
            
            this.hls.on(Hls.Events.MANIFEST_PARSED, (event, data) => {
                console.log('[AudioService] HLS Manifest parsed, starting playback');
                this.safePlay();
            });
            
            this.hls.on(Hls.Events.LEVEL_LOADED, (event, data) => {
                if (data.details.totalduration) {
                    this.emit('durationChange', { duration: data.details.totalduration });
                }
            });

            this.hls.on(Hls.Events.ERROR, (event, data) => {
                if (data.fatal) {
                    switch (data.type) {
                        case Hls.ErrorTypes.NETWORK_ERROR:
                            console.log("[AudioService] HLS Network error, trying to recover...");
                            this.hls?.startLoad();
                            break;
                        case Hls.ErrorTypes.MEDIA_ERROR:
                            console.log("[AudioService] HLS Media error, trying to recover...");
                            this.hls?.recoverMediaError();
                            break;
                        default:
                            console.error("[AudioService] HLS Fatal error, destroying...", data);
                            this.hls?.destroy();
                            break;
                    }
                } else {
                    console.warn("[AudioService] HLS Non-fatal error:", data.type);
                }
            });

        } else if (this.webAudio.canPlayType('application/vnd.apple.mpegurl')) {
            console.log('[AudioService] Using Native HLS (Safari)');
            this.webAudio.src = url;
            this.webAudio.onloadedmetadata = () => {
                this.safePlay();
            };
        } else {
            console.error("HLS is not supported in this browser.");
        }
    }

    public async pause() {
        if (this.isNative && !this.fallbackToWeb) {
            await StreamifyMedia.pause();
        } else {
            this.webAudio?.pause();
        }
    }

    public async resume() {
        if (this.isNative && !this.fallbackToWeb) {
            await StreamifyMedia.resume();
        } else {
            this.safePlay();
        }
    }

    public async seek(seconds: number) {
        if (this.isNative && !this.fallbackToWeb) {
            await StreamifyMedia.seek({ position: seconds });
        } else if (this.webAudio) {
            this.webAudio.currentTime = seconds;
        }
    }

    public async setVolume(volume: number) {
        // volume is 0.0 to 1.0
        if (this.isNative && !this.fallbackToWeb) {
            await StreamifyMedia.setVolume({ volume });
        } else if (this.webAudio) {
            this.webAudio.volume = volume;
        }
    }

    public async cleanup() {
        if (this.isNative) {
            this.nativeListeners.forEach(l => l.remove());
        }
        
        if (this.hls) {
            this.hls.destroy();
            this.hls = null;
        }
        if (this.webAudio) {
            this.webAudio.pause();
            this.webAudio.src = '';
        }
    }

    public addListener(event: AudioEventType, callback: ListenerCallback) {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, new Set());
        }
        this.listeners.get(event)?.add(callback);

        return {
            remove: () => {
                this.listeners.get(event)?.delete(callback);
            }
        };
    }

    private emit(event: AudioEventType, data: any) {
        this.listeners.get(event)?.forEach(cb => cb(data));
    }
}

export const audioService = new AudioService();
