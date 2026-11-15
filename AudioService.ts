import { Capacitor, registerPlugin, PluginListenerHandle } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { PlaylistItem, StreamifyMediaPlugin, PlayOptions, LastPlayedInfo } from './types';
import Hls from 'hls.js';
import { YOUTUBE_API_BASE } from './constants';
import { getInitialEncryptionEnabled } from './utils/encryptionUtils';

const StreamifyMedia = registerPlugin<StreamifyMediaPlugin>('StreamifyMedia');

export type AudioEventType =
    | 'timeUpdate'
    | 'stateChange'
    | 'ended'
    | 'error'
    | 'durationChange'
    | 'remoteNext'
    | 'remotePrev'
    | 'itemTransition'
    | 'songSkipped'
    | 'networkWait'
    | 'networkRestored'
    | 'networkLost';

type ListenerCallback = (data: any) => void;

class AudioService {
    private isNative: boolean;
    private fallbackToWeb = false;

    private webAudio: HTMLAudioElement | null = null;
    private hls: Hls | null = null;
    private listeners: Map<AudioEventType, Set<ListenerCallback>> = new Map();
    private nativeListeners: PluginListenerHandle[] = [];

    // State for Queue & Smart Playback Control
    private webQueue: PlaylistItem[] = [];
    private webCurrentIndex: number = 0;
    private userPaused: boolean = true;
    private waitingForNetwork: boolean = false;
    private lastKnownTime: number = 0;

    // Web/Windows Error & Warmup Management
    private consecutiveWebErrors: number = 0;
    private webErrorRetryTimer: any = null;
    private lastWarmedUpSongId: string | null = null;
    private warmupAbortController: AbortController | null = null;
    private encryptionEnabled: boolean = getInitialEncryptionEnabled();

    constructor() {
        this.isNative = Capacitor.isNativePlatform();
        console.log(`[AudioService] Initializing. Native: ${this.isNative}, Encryption: ${this.encryptionEnabled}`);

        if (this.isNative) {
            this.setupNativeListeners();
            StreamifyMedia.setEncryptionMode({ enabled: this.encryptionEnabled }).catch(() => {});
        } else {
            this.setupWebAudio();
            this.setupWebNetworkListeners();
        }
    }

    public isEncryptionEnabled(): boolean {
        return this.encryptionEnabled;
    }

    public async setEncryptionMode(enabled: boolean): Promise<void> {
        const changed = this.encryptionEnabled !== enabled;
        this.encryptionEnabled = enabled;
        this.lastWarmedUpSongId = null;

        if (this.isNative && !this.fallbackToWeb) {
            try {
                await StreamifyMedia.setEncryptionMode({ enabled });
            } catch (e) {
                console.warn('[AudioService] Failed to set native encryption mode:', e);
            }
        } else if (changed && this.webAudio && this.webQueue.length > 0) {
            const currentSong = this.webQueue[this.webCurrentIndex];
            if (currentSong && this.webAudio.src) {
                const currentPos = this.webAudio.currentTime || this.lastKnownTime || 0;
                const wasPlaying = !this.userPaused && !this.webAudio.paused;
                const newUrl = this.getStreamUrl(currentSong.id);
                if (wasPlaying) {
                    this.playWeb(currentSong, newUrl, currentPos);
                } else {
                    this.webAudio.src = newUrl;
                    this.webAudio.currentTime = currentPos;
                }
            }
        }
    }

    public getStreamUrl(videoId: string): string {
        return `${YOUTUBE_API_BASE}/get_audio/${videoId}?enc=${this.encryptionEnabled ? '1' : '0'}`;
    }

    public isUserPausedState(): boolean {
        return this.userPaused;
    }

    private setupWebNetworkListeners() {
        if (typeof window === 'undefined') return;

        window.addEventListener('online', () => {
            this.emit('networkRestored', {});
            if (this.waitingForNetwork && !this.userPaused && this.webQueue.length > 0) {
                console.log('[AudioService] Web network restored, resuming current song from saved position...');
                this.waitingForNetwork = false;
                const currentSong = this.webQueue[this.webCurrentIndex];
                if (currentSong) {
                    this.playWeb(currentSong, this.getStreamUrl(currentSong.id), this.lastKnownTime);
                }
            }
        });

        window.addEventListener('offline', () => {
            this.emit('networkLost', {});
        });
    }

    private setupWebAudio() {
        if (this.webAudio) return;

        console.log('[AudioService] Setting up Web Audio (HTML5/HLS)');
        this.webAudio = new Audio();

        this.webAudio.addEventListener('timeupdate', () => {
            const currentTime = this.webAudio?.currentTime || 0;
            if (currentTime > 0) {
                this.lastKnownTime = currentTime;
            }
            this.emit('timeUpdate', { currentTime });

            // איפוס מונה שגיאות וחימום השיר הבא רק אחרי 5 שניות של ניגון יציב
            if (currentTime >= 5 && !this.userPaused) {
                this.consecutiveWebErrors = 0;
                this.waitingForNetwork = false;
                this.maybeWarmupNextWebSong();
            }
        });

        this.webAudio.addEventListener('durationchange', () => {
            if (this.webAudio?.duration && !isNaN(this.webAudio.duration) && this.webAudio.duration !== Infinity) {
                this.emit('durationChange', { duration: this.webAudio.duration });
            }
        });

        this.webAudio.addEventListener('ended', () => {
            if (this.userPaused) return;
            console.log('[AudioService] Web playback ended - moving to next');

            if (this.webQueue.length > 0) {
                const nextIndex = (this.webCurrentIndex + 1) % this.webQueue.length;
                if (this.webCurrentIndex < this.webQueue.length - 1) {
                    this.skipTo(nextIndex);
                    this.emit('itemTransition', { id: this.webQueue[nextIndex].id });
                } else {
                    this.emit('ended', {});
                    this.emit('stateChange', { isPlaying: false });
                }
            } else {
                this.emit('ended', {});
                this.emit('stateChange', { isPlaying: false });
            }
        });

        this.webAudio.addEventListener('play', () => {
            if (this.userPaused) {
                // אם המשתמש לחץ Pause, חוסמים כל הפעלה אוטומטית בדפדפן
                this.webAudio?.pause();
                return;
            }
            this.emit('stateChange', { isPlaying: true });
        });

        this.webAudio.addEventListener('pause', () => {
            this.emit('stateChange', { isPlaying: false });
        });

        this.webAudio.addEventListener('error', (e) => {
            console.error('[AudioService] HTML5 Audio Error:', e, this.webAudio?.error);
            this.handleWebPlaybackError();
        });

        if ('mediaSession' in navigator) {
            navigator.mediaSession.setActionHandler('play', () => this.resume());
            navigator.mediaSession.setActionHandler('pause', () => this.pause());
            navigator.mediaSession.setActionHandler('nexttrack', () => {
                if (this.webQueue.length > 0) {
                    const nextIdx = (this.webCurrentIndex + 1) % this.webQueue.length;
                    this.skipTo(nextIdx);
                    this.emit('itemTransition', { id: this.webQueue[nextIdx].id });
                    this.emit('remoteNext', {});
                }
            });
            navigator.mediaSession.setActionHandler('previoustrack', () => {
                if (this.webQueue.length > 0) {
                    const prevIdx = (this.webCurrentIndex - 1 + this.webQueue.length) % this.webQueue.length;
                    this.skipTo(prevIdx);
                    this.emit('itemTransition', { id: this.webQueue[prevIdx].id });
                    this.emit('remotePrev', {});
                }
            });
        }
    }

    private handleWebPlaybackError() {
        if (this.webErrorRetryTimer) {
            clearTimeout(this.webErrorRetryTimer);
            this.webErrorRetryTimer = null;
        }

        // חוק ברזל: אם המשתמש לחץ Pause, לא מנסים שוב ולא מדלגים שיר!
        if (this.userPaused) {
            this.emit('stateChange', { isPlaying: false });
            return;
        }

        // אם אין אינטרנט: לא מדלגים שיר! ממתינים לחזרת הרשת
        if (!navigator.onLine) {
            console.warn('[AudioService] Web error while offline. Waiting for network...');
            this.waitingForNetwork = true;
            this.emit('networkWait', { message: 'ממתין לחיבור רשת...' });
            this.emit('stateChange', { isPlaying: false });
            return;
        }

        // שגיאה בשיר ספציפי כשיש אינטרנט: מדלגים עד 3 פעמים ברצף בלבד
        this.consecutiveWebErrors++;
        console.warn(`[AudioService] Web track error (${this.consecutiveWebErrors}/3)`);

        if (this.consecutiveWebErrors <= 3 && this.webQueue.length > 1) {
            const failedSong = this.webQueue[this.webCurrentIndex];
            if (failedSong) {
                this.emit('songSkipped', { id: failedSong.id });
            }
            this.webErrorRetryTimer = setTimeout(() => {
                if (!this.userPaused && this.webQueue.length > 0) {
                    const nextIdx = (this.webCurrentIndex + 1) % this.webQueue.length;
                    this.webCurrentIndex = nextIdx;
                    const nextSong = this.webQueue[nextIdx];
                    this.playWeb(nextSong, this.getStreamUrl(nextSong.id));
                    this.emit('itemTransition', { id: nextSong.id });
                }
            }, 1200);
        } else {
            console.error('[AudioService] Max consecutive web errors reached. Stopping playback.');
            this.userPaused = true;
            this.consecutiveWebErrors = 0;
            this.webAudio?.pause();
            this.emit('stateChange', { isPlaying: false });
            this.emit('error', { error: 'מספר שירים נכשלו בטעינה ברצף. הניגון נעצר.' });
        }
    }

    private maybeWarmupNextWebSong() {
        if (this.isNative && !this.fallbackToWeb) return;
        if (this.userPaused || !this.webQueue || this.webQueue.length <= 1) return;

        const currentSong = this.webQueue[this.webCurrentIndex];
        if (!currentSong || this.lastWarmedUpSongId === currentSong.id) return;

        const nextIdx = this.webCurrentIndex + 1;
        if (nextIdx >= this.webQueue.length) return;

        this.lastWarmedUpSongId = currentSong.id;
        const nextSong = this.webQueue[nextIdx];
        const nextUrl = this.getStreamUrl(nextSong.id);

        if (this.warmupAbortController) {
            this.warmupAbortController.abort();
        }
        this.warmupAbortController = new AbortController();

        fetch(nextUrl, {
            method: 'GET',
            headers: { Range: 'bytes=0-1023' },
            signal: this.warmupAbortController.signal
        }).catch(() => {});
    }

    private async setupNativeListeners() {
        try {
            const l1 = await StreamifyMedia.addListener('onMediaEvent', (event: any) => {
                switch (event.action) {
                    case 'timeUpdate':
                        if (typeof event.value === 'number' && event.value > 0) {
                            this.lastKnownTime = event.value;
                        }
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
                        this.emit('stateChange', { isPlaying: Boolean(event.value) });
                        break;
                    case 'completed':
                        this.emit('ended', {});
                        break;
                    case 'itemTransition': {
                        const currentId = event.value;
                        const idx = this.webQueue.findIndex(item => item.id === currentId);
                        if (idx !== -1) {
                            this.webCurrentIndex = idx;
                        }
                        this.emit('itemTransition', { id: currentId });
                        break;
                    }
                    case 'songSkipped':
                        this.emit('songSkipped', { id: event.value });
                        break;
                    case 'networkWait':
                        this.emit('networkWait', { message: event.value });
                        break;
                    case 'networkRestored':
                        this.emit('networkRestored', {});
                        break;
                    case 'networkLost':
                        this.emit('networkLost', {});
                        break;
                    case 'error':
                        console.error('[AudioService] Native Plugin Error:', event.value);
                        this.userPaused = true;
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
            console.warn('[AudioService] Error registering native listeners', e);
        }
    }

    public async getLastPlayedInfo(): Promise<LastPlayedInfo | null> {
        if (!this.isNative || this.fallbackToWeb) return null;
        try {
            const info = await StreamifyMedia.getLastPlayedInfo();
            if (info && info.id) {
                this.userPaused = Boolean(info.userPaused);
                return info;
            }
            return null;
        } catch (e) {
            console.warn('[AudioService] getLastPlayedInfo failed:', e);
            return null;
        }
    }

    public async play(item: PlaylistItem, url?: string, contextId?: string, startPosition?: number) {
        this.userPaused = false;
        this.waitingForNetwork = false;
        const streamUrl = url || this.getStreamUrl(item.id);

        if (!this.isNative || this.fallbackToWeb) {
            if (!this.webAudio) this.setupWebAudio();
            this.playWeb(item, streamUrl, startPosition);
            return;
        }

        try {
            let playUrl = streamUrl;
            try {
                const fileName = `cache/${item.id}.mp3`;
                const stat = await Filesystem.stat({ path: fileName, directory: Directory.Cache });
                if (stat) {
                    const uriResult = await Filesystem.getUri({ path: fileName, directory: Directory.Cache });
                    playUrl = Capacitor.convertFileSrc(uriResult.uri);
                }
            } catch {}

            await StreamifyMedia.play({
                url: playUrl,
                id: item.id,
                title: item.title,
                artist: item.author,
                artwork: item.thumbnail || 'https://via.placeholder.com/500',
                duration: item.duration,
                autoPlay: true,
                contextId,
                startPosition
            } as PlayOptions);
        } catch (e: any) {
            console.error('[AudioService] Native play failed', e);
            if (e.code === 'UNIMPLEMENTED' || e.message?.includes('UNIMPLEMENTED')) {
                this.fallbackToWeb = true;
                this.setupWebAudio();
                this.playWeb(item, streamUrl, startPosition);
            }
        }
    }

    public async playQueue(
        items: PlaylistItem[],
        startIndex: number,
        contextId?: string,
        startPosition?: number,
        isShuffled?: boolean
    ) {
        if (!items || items.length === 0) return;

        this.userPaused = false;
        this.waitingForNetwork = false;
        this.webQueue = [...items];
        this.webCurrentIndex = Math.max(0, Math.min(startIndex, items.length - 1));

        if (this.isNative && !this.fallbackToWeb) {
            try {
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
                    startIndex: this.webCurrentIndex,
                    contextId,
                    isShuffled: Boolean(isShuffled),
                    startPosition
                });
            } catch (e) {
                console.error('[AudioService] Native playQueue failed', e);
            }
        } else {
            if (!this.webAudio) this.setupWebAudio();
            const song = items[this.webCurrentIndex];
            const url = this.getStreamUrl(song.id);
            this.playWeb(song, url, startPosition);
        }
    }

    public async updateQueue(queue: PlaylistItem[], index: number, contextId?: string, isShuffled?: boolean) {
        if (!queue || queue.length === 0) return;

        this.webQueue = [...queue];
        this.webCurrentIndex = Math.max(0, Math.min(index, queue.length - 1));
        this.lastWarmedUpSongId = null;

        if (this.isNative && !this.fallbackToWeb) {
            try {
                const mediaItems = queue.map(item => ({
                    id: item.id,
                    url: this.getStreamUrl(item.id),
                    title: item.title,
                    artist: item.author,
                    artwork: item.thumbnail || 'https://via.placeholder.com/500',
                    duration: typeof item.duration === 'number' ? item.duration : 0
                }));

                await StreamifyMedia.updateQueue({
                    items: mediaItems,
                    startIndex: this.webCurrentIndex,
                    contextId,
                    isShuffled: Boolean(isShuffled)
                });
            } catch (e) {
                console.error('[AudioService] Native updateQueue failed', e);
            }
        } else if (!this.userPaused) {
            this.maybeWarmupNextWebSong();
        }
    }

    public async skipTo(index: number) {
        if (!this.webQueue || index < 0 || index >= this.webQueue.length) return;

        this.userPaused = false;
        this.waitingForNetwork = false;
        this.webCurrentIndex = index;
        this.lastKnownTime = 0;
        const song = this.webQueue[index];

        if (this.isNative && !this.fallbackToWeb) {
            try {
                await StreamifyMedia.skipToIndex({ index });
            } catch (e) {
                console.error('[AudioService] Native skip failed', e);
            }
        } else {
            this.playWeb(song, this.getStreamUrl(song.id), 0);
        }
    }

    public async addToQueue(item: PlaylistItem, url?: string, contextId?: string) {
        const streamUrl = url || this.getStreamUrl(item.id);
        this.webQueue.push(item);

        if (this.isNative && !this.fallbackToWeb) {
            try {
                await StreamifyMedia.addToQueue({
                    url: streamUrl,
                    id: item.id,
                    title: item.title,
                    artist: item.author,
                    artwork: item.thumbnail || 'https://via.placeholder.com/500',
                    duration: item.duration,
                    contextId
                });
            } catch (e) {
                console.error('[AudioService] Failed to add to native queue', e);
            }
        }
    }

    private safePlay() {
        if (!this.webAudio || this.userPaused) return;

        const playPromise = this.webAudio.play();
        if (playPromise !== undefined) {
            playPromise.catch(error => {
                if (error.name === 'NotAllowedError') {
                    console.warn('[AudioService] Autoplay blocked by policy. Waiting for user interaction.');
                    this.emit('stateChange', { isPlaying: false });
                } else if (!this.userPaused) {
                    console.error('[AudioService] Web playback failed:', error);
                }
            });
        }
    }

    private playWeb(item: PlaylistItem, url: string, startPosition?: number) {
        if (!this.webAudio) this.setupWebAudio();
        if (!this.webAudio) return;

        if (this.webErrorRetryTimer) {
            clearTimeout(this.webErrorRetryTimer);
            this.webErrorRetryTimer = null;
        }

        if (this.warmupAbortController) {
            this.warmupAbortController.abort();
            this.warmupAbortController = null;
        }

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
            navigator.mediaSession.playbackState = 'playing';
        }

        if (url.includes('/get_audio/')) {
            this.webAudio.src = url;
            this.webAudio.load();
            this.webAudio.onloadedmetadata = () => {
                if (this.webAudio && startPosition && startPosition > 0) {
                    this.webAudio.currentTime = startPosition;
                }
                this.safePlay();
            };
            return;
        }

        if (Hls.isSupported()) {
            this.hls = new Hls({
                enableWorker: true,
                lowLatencyMode: true,
                debug: false
            });

            this.hls.loadSource(url);
            this.hls.attachMedia(this.webAudio);

            this.hls.on(Hls.Events.MANIFEST_PARSED, () => {
                if (this.webAudio && startPosition && startPosition > 0) {
                    this.webAudio.currentTime = startPosition;
                }
                this.safePlay();
            });

            this.hls.on(Hls.Events.LEVEL_LOADED, (_event, data) => {
                if (data.details.totalduration) {
                    this.emit('durationChange', { duration: data.details.totalduration });
                }
            });

            this.hls.on(Hls.Events.ERROR, (_event, data) => {
                if (data.fatal) {
                    this.hls?.destroy();
                    this.handleWebPlaybackError();
                }
            });
        } else if (this.webAudio.canPlayType('application/vnd.apple.mpegurl')) {
            this.webAudio.src = url;
            this.webAudio.onloadedmetadata = () => {
                if (this.webAudio && startPosition && startPosition > 0) {
                    this.webAudio.currentTime = startPosition;
                }
                this.safePlay();
            };
        }
    }

    public async pause() {
        this.userPaused = true;
        this.waitingForNetwork = false;

        if (this.webErrorRetryTimer) {
            clearTimeout(this.webErrorRetryTimer);
            this.webErrorRetryTimer = null;
        }
        if (this.warmupAbortController) {
            this.warmupAbortController.abort();
            this.warmupAbortController = null;
        }

        if (this.isNative && !this.fallbackToWeb) {
            await StreamifyMedia.pause();
        } else {
            this.webAudio?.pause();
            if ('mediaSession' in navigator) {
                navigator.mediaSession.playbackState = 'paused';
            }
        }
    }

    public async resume() {
        this.userPaused = false;
        if (this.isNative && !this.fallbackToWeb) {
            await StreamifyMedia.resume();
        } else {
            this.safePlay();
            if ('mediaSession' in navigator) {
                navigator.mediaSession.playbackState = 'playing';
            }
        }
    }

    public async seek(seconds: number) {
        this.lastKnownTime = seconds;
        if (this.isNative && !this.fallbackToWeb) {
            await StreamifyMedia.seek({ position: seconds });
        } else if (this.webAudio) {
            this.webAudio.currentTime = seconds;
        }
    }

    public async setVolume(volume: number) {
        if (this.isNative && !this.fallbackToWeb) {
            await StreamifyMedia.setVolume({ volume });
        } else if (this.webAudio) {
            this.webAudio.volume = volume;
        }
    }

    public async cleanup() {
        if (this.webErrorRetryTimer) {
            clearTimeout(this.webErrorRetryTimer);
        }
        if (this.warmupAbortController) {
            this.warmupAbortController.abort();
        }
        if (this.isNative) {
            this.nativeListeners.forEach(l => l.remove());
            this.nativeListeners = [];
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
