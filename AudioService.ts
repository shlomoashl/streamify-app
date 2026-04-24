
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

    private getStreamUrl(videoId: string): string {
        // פשוט וישיר: האפליקציה תמיד מבקשת את ראוט האודיו הנקי.
        // השרת כבר ידע לטפל ב-Range (הדילוגים והמשכיות השיר) בזכות התיקון ב-Python.
        return `${YOUTUBE_API_BASE}/get_audio/${videoId}`;
    }

    private setupWebAudio() {
        if (this.webAudio) return; // מניעת אתחול כפול

        console.log('[AudioService] Setting up Web Audio (HLS/HTML5)');
        this.webAudio = new Audio();
        
        // מאזיני אירועים בסיסיים
        this.webAudio.addEventListener('timeupdate', () => {
            this.emit('timeUpdate', { currentTime: this.webAudio?.currentTime || 0 });
        });

        this.webAudio.addEventListener('durationchange', () => {
            if (this.webAudio?.duration && !isNaN(this.webAudio.duration) && this.webAudio.duration !== Infinity) {
                this.emit('durationChange', { duration: this.webAudio.duration });
            }
        });

        // לוגיקת מעבר אוטומטי לשיר הבא (עבור Web/Windows)
        this.webAudio.addEventListener('ended', () => {
            console.log('[AudioService] Playback ended');
            
            if (this.webQueue.length > 0 && this.webCurrentIndex < this.webQueue.length - 1) {
                this.webCurrentIndex++;
                const nextSong = this.webQueue[this.webCurrentIndex];
                console.log(`[AudioService] Web Auto-Advance to: ${nextSong.title}`);
                
                // שינוי 1: שימוש ב-getStreamUrl
                const url = this.getStreamUrl(nextSong.id);
                this.playWeb(nextSong, url);
                
                this.emit('itemTransition', { id: nextSong.id });
                
                // הכנה מראש של השיר הבא בתור
                setTimeout(() => {
                    if (this.webCurrentIndex + 1 < this.webQueue.length) {
                        const futureSong = this.webQueue[this.webCurrentIndex + 1];
                        // שינוי 2: שימוש ב-getStreamUrl עבור ה-Warmup
                        this.triggerServerSideWarmup(this.getStreamUrl(futureSong.id));
                    }
                }, 3000);
            } else {
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
        
        // הגדרות MediaSession (שליטה דרך המקלדת/מסך נעילה בווינדוס)
        if ('mediaSession' in navigator) {
            navigator.mediaSession.setActionHandler('play', () => this.resume());
            navigator.mediaSession.setActionHandler('pause', () => this.pause());
            
            navigator.mediaSession.setActionHandler('nexttrack', () => {
                if (this.webQueue.length > 0 && this.webCurrentIndex < this.webQueue.length - 1) {
                    this.webCurrentIndex++;
                    const nextSong = this.webQueue[this.webCurrentIndex];
                    // שינוי 3: שימוש ב-getStreamUrl עבור כפתור "הבא"
                    this.playWeb(nextSong, this.getStreamUrl(nextSong.id));
                    this.emit('itemTransition', { id: nextSong.id });
                    this.emit('remoteNext', {});
                }
            });

            navigator.mediaSession.setActionHandler('previoustrack', () => {
                 if (this.webQueue.length > 0 && this.webCurrentIndex > 0) {
                    this.webCurrentIndex--;
                    const prevSong = this.webQueue[this.webCurrentIndex];
                    // שינוי 4: שימוש ב-getStreamUrl עבור כפתור "הקודם"
                    this.playWeb(prevSong, this.getStreamUrl(prevSong.id));
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
                await Filesystem.stat({
                    path: fileName,
                    directory: Directory.Cache
                });
                console.log(`[AudioService] Preload: File ${fileName} already exists.`);
                return;
            } catch (e) {}

            console.log(`[AudioService] Preloading next song: ${song.title}`);
            
            // 1. Trigger server-side warmup
            const streamUrl = this.getStreamUrl(song.id); // <--- שינוי כאן
            this.triggerServerSideWarmup(streamUrl);

        } catch (error) {
            console.error("[AudioService] Preload failed:", error);
        }
    }

    /**
     * Sends a background request to the server to prepare the m3u8 playlist AND the first segment.
     * This reduces latency when the user eventually switches to this song.
     * Optimized to barely use bandwidth.
     */
    private async triggerServerSideWarmup(streamUrl: string) {
        if (!streamUrl) return;
        
        try {
            // התוספת החשובה: אם זה URL של שמע (אנדרואיד), אל תנסה לפרסס כטקסט
            if (streamUrl.includes('/get_audio/')) {
                console.log(`[AudioService] Warmup: Direct audio ping -> ${streamUrl}`);
                const controller = new AbortController();
                fetch(streamUrl, { signal: controller.signal })
                    .catch(() => { /* Ignore abort error */ });
                setTimeout(() => controller.abort(), 500); 
                return;
            }

            // --- מכאן והלאה הלוגיקה המקורית שלך עבור M3U8 ---
            const response = await fetch(streamUrl);
            if (!response.ok) return;
            
            const text = await response.text();
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
                if (!firstSegmentUrl.startsWith('http')) {
                    const baseUrl = SERVER_PUBLIC_URL.endsWith('/') ? SERVER_PUBLIC_URL.slice(0, -1) : SERVER_PUBLIC_URL;
                    firstSegmentUrl = baseUrl + (firstSegmentUrl.startsWith('/') ? '' : '/') + firstSegmentUrl;
                }

                console.log(`[AudioService] Warmup: Touching segment -> ${firstSegmentUrl}`);

                const controller = new AbortController();
                fetch(firstSegmentUrl, { signal: controller.signal })
                    .then(res => {
                        setTimeout(() => controller.abort(), 500); 
                    })
                    .catch(() => { /* Ignore abort error */ });
            }

        } catch (e) {
            console.warn("[AudioService] Warmup failed (non-fatal):", e);
        }
    }

    public async play(item: PlaylistItem, url: string, contextId?: string) {
        url = this.getStreamUrl(item.id);
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

    // הוספנו את startPosition לפונקציה
    // הורדנו את startPosition מההגדרה
    public async playQueue(items: PlaylistItem[], startIndex: number, contextId?: string) {
        if (!items || items.length === 0) return;
        
        this.webQueue = items;
        this.webCurrentIndex = startIndex;
        
        console.log(`[AudioService] Playing Queue. Size: ${items.length}, Start: ${startIndex}`);

        if (this.isNative && !this.fallbackToWeb) {
            try {
                if (startIndex + 1 < items.length) {
                    this.preloadNext(items[startIndex + 1]);
                }

                const mediaItems = items.map(item => ({
                    id: item.id,
                    url: this.getStreamUrl(item.id),
                    title: item.title,
                    artist: item.author,
                    artwork: item.thumbnail || 'https://via.placeholder.com/500',
                    duration: typeof item.duration === 'number' ? item.duration : 0
                }));
                
                await StreamifyMedia.playQueue({
                    items: mediaItems,
                    startIndex: startIndex,
                    contextId: contextId
                    // הסרנו את שליחת startPosition ל-Native
                } as any);
            } catch (e) {
                console.error("Native playQueue failed", e);
            }
        } else {
            // הבלוק של ה-Web נקי - רק מפעיל את השיר ומכין את הבא
            this.webQueue = [...items];
            this.webCurrentIndex = startIndex;
            
            const song = items[startIndex];
            let url = this.getStreamUrl(song.id); 
            
            this.playWeb(song, url);
            
            setTimeout(() => {
                const nextIndex = startIndex + 1;
                if (nextIndex < items.length) {
                    const nextSong = items[nextIndex];
                    const nextUrl = this.getStreamUrl(nextSong.id); 
                    this.triggerServerSideWarmup(nextUrl);
                }
            }, 3000);
        }
    }

    public async addToQueue(item: PlaylistItem, url: string, contextId?: string) {
        url = this.getStreamUrl(item.id);
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

        // ניקוי מופע HLS קודם אם קיים כדי למנוע זליגות זיכרון והתנגשויות
        if (this.hls) {
            this.hls.destroy();
            this.hls = null;
        }

        // עדכון MediaSession - מאפשר שליטה מהמקלדת, מסך הנעילה ותצוגת מטא-דאטה במערכת ההפעלה
        if ('mediaSession' in navigator) {
            navigator.mediaSession.metadata = new MediaMetadata({
                title: item.title,
                artist: item.author,
                artwork: [{ src: item.thumbnail || '', sizes: '512x512', type: 'image/jpeg' }]
            });
        }

        /**
         * בדיקה האם מדובר בסטרים ישיר של אודיו (m4a).
         * אם ה-URL מכיל את הראוט החדש שלנו, ננגן אותו ישירות דרך נגן ה-HTML5
         * ללא שימוש ב-HLS.js, מה שמאפשר תמיכה מלאה ב-Range Requests (דילוגים והמשכיות).
         */
        if (url.includes('/get_audio/')) {
            console.log('[AudioService] Playing direct audio stream (m4a) natively');
            this.webAudio.src = url;
            this.webAudio.load();
            this.webAudio.onloadedmetadata = () => {
                this.safePlay();
            };
            return; // יציאה מהפונקציה - אין צורך בלוגיקה של HLS
        }

        /**
         * פולבאק ל-HLS: עבור האתר או במקרים בהם נדרש וידאו/סטרים מבוסס מקטעים.
         */
        if (Hls.isSupported()) {
            console.log('[AudioService] Using HLS.js for stream');
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
            
            this.hls.on(Hls.Events.MANIFEST_PARSED, () => {
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
                }
            });

        } else if (this.webAudio.canPlayType('application/vnd.apple.mpegurl')) {
            // תמיכה ב-Native HLS עבור דפדפני Safari
            console.log('[AudioService] Using Native HLS');
            this.webAudio.src = url;
            this.webAudio.onloadedmetadata = () => {
                this.safePlay();
            };
        } else {
            console.error("[AudioService] No supported playback method found for this URL.");
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
