import { useState, useEffect, useRef, useCallback } from 'react';
import { Capacitor } from '@capacitor/core';
import { App as CapacitorApp } from '@capacitor/app';
import { Network } from '@capacitor/network';
import { Playlist, PlaylistItem, PlayerState, User } from '../types';
import { audioService } from '../AudioService';
import { storageService } from '../StorageService';
import { shuffleArray } from '../utils/mediaUtils';

export const usePlayerController = (params: {
    currentUser: User | null;
    isAppReady: boolean;
    stateLoadedRef: React.MutableRefObject<boolean>;
    setNetworkError: (msg: string | null) => void;
    onNetworkRestoredSyncLibrary: () => void;
    onSongSkippedAutoHeal?: (songId: string) => void;
}) => {
    const {
        currentUser,
        isAppReady,
        stateLoadedRef,
        setNetworkError,
        onNetworkRestoredSyncLibrary,
        onSongSkippedAutoHeal
    } = params;

    const [playingPlaylistId, setPlayingPlaylistId] = useState<string | null>(null);
    const savedShuffle = localStorage.getItem('streamify_shuffle') === 'true';
    const [playerState, setPlayerState] = useState<PlayerState>({
        isOpen: false,
        isPlaying: false,
        currentSong: null,
        queue: [],
        currentIndex: 0,
        isShuffled: savedShuffle,
        isExpanded: false
    });

    const [isOnline, setIsOnline] = useState(navigator.onLine);
    const prevOnlineStatus = useRef(isOnline);

    const audioInitializedRef = useRef(false);
    const autoPlayStartedRef = useRef(false);
    const [initialSavedTime, setInitialSavedTime] = useState<number>(0);
    const currentTimeRef = useRef<number>(0);
    const initialSeekTimeRef = useRef<number>(0);
    const lastSavedSongIdRef = useRef<string | null>(null);
    const latestPlayerStateRef = useRef(playerState);
    const latestPlaylistIdRef = useRef(playingPlaylistId);

    useEffect(() => {
        latestPlayerStateRef.current = playerState;
        latestPlaylistIdRef.current = playingPlaylistId;
    }, [playerState, playingPlaylistId]);

    const saveStateToStorage = useCallback(
        (state: PlayerState, currentPlaylistId: string | null, currentTimeVal?: number) => {
            if (!stateLoadedRef.current || !state.currentSong) return;

            const effectiveTime =
                currentTimeVal !== undefined && currentTimeVal > 0
                    ? currentTimeVal
                    : currentTimeRef.current > 0
                    ? currentTimeRef.current
                    : initialSeekTimeRef.current;

            const stateToSave = {
                ...state,
                savedTime: effectiveTime,
                playingPlaylistId: currentPlaylistId
            };
            delete (stateToSave as any).originalQueue;
            storageService.saveData('streamify_player_state', stateToSave);
        },
        [stateLoadedRef]
    );

    const restoreInitialPlayerState = useCallback(
        async (savedPlaylists: Playlist[]) => {
            const savedPlayerState = await storageService.loadData<any>(
                'streamify_player_state',
                null
            );
            const savedIsShuffled =
                savedPlayerState?.isShuffled ??
                localStorage.getItem('streamify_shuffle') === 'true';

            if (savedPlayerState?.savedTime && savedPlayerState.savedTime > 0) {
                initialSeekTimeRef.current = savedPlayerState.savedTime;
                currentTimeRef.current = savedPlayerState.savedTime;
                setInitialSavedTime(savedPlayerState.savedTime);
            }

            let nativeStateLoaded = false;
            if (Capacitor.isNativePlatform()) {
                try {
                    const lastNative = await audioService.getLastPlayedInfo();
                    if (lastNative && lastNative.id) {
                        const restoredTime =
                            lastNative.savedTime && lastNative.savedTime > 0
                                ? lastNative.savedTime
                                : savedPlayerState?.savedTime || 0;
                        if (restoredTime > 0) {
                            initialSeekTimeRef.current = restoredTime;
                            currentTimeRef.current = restoredTime;
                            setInitialSavedTime(restoredTime);
                        }

                        const effectiveShuffled =
                            lastNative.isShuffled !== undefined
                                ? lastNative.isShuffled
                                : savedIsShuffled;

                        let nativeSong: PlaylistItem = {
                            id: lastNative.id,
                            title: lastNative.title || 'Unknown',
                            author: lastNative.artist || 'Unknown',
                            thumbnail: lastNative.artwork || '',
                            duration: 0,
                            addedBy: 'system',
                            addedAt: new Date().toISOString()
                        };

                        let restoredQueue: PlaylistItem[] = [];
                        let restoredIndex = 0;
                        const restoredPlaylistId: string | null =
                            lastNative.contextId ||
                            savedPlayerState?.playingPlaylistId ||
                            null;
                        let originalQueueForState: PlaylistItem[] | undefined =
                            savedPlayerState?.originalQueue;

                        if (
                            lastNative.queue &&
                            Array.isArray(lastNative.queue) &&
                            lastNative.queue.length > 0
                        ) {
                            restoredQueue = lastNative.queue.map((item: any) => ({
                                id: item.id,
                                title: item.title || 'Unknown',
                                author: item.artist || 'Unknown',
                                thumbnail: item.artwork || '',
                                duration: Number(item.duration) || 0,
                                addedBy: 'system',
                                addedAt: new Date().toISOString()
                            }));
                        }

                        if (restoredPlaylistId) {
                            const playlist = savedPlaylists.find(
                                (p) => p.id === restoredPlaylistId
                            );
                            if (playlist && playlist.songs.length > 0) {
                                if (restoredQueue.length === 0) {
                                    const baseQueue = playlist.songs;
                                    if (
                                        savedPlayerState &&
                                        savedPlayerState.playingPlaylistId ===
                                            restoredPlaylistId &&
                                        savedPlayerState.queue?.length > 0
                                    ) {
                                        restoredQueue = savedPlayerState.queue;
                                    } else {
                                        restoredQueue = effectiveShuffled
                                            ? shuffleArray([...baseQueue])
                                            : baseQueue;
                                    }
                                } else {
                                    const songMap = new Map(
                                        playlist.songs.map((s) => [s.id, s])
                                    );
                                    restoredQueue = restoredQueue.map(
                                        (qItem) => songMap.get(qItem.id) || qItem
                                    );
                                }
                                if (effectiveShuffled && !originalQueueForState) {
                                    originalQueueForState = [...playlist.songs];
                                }
                            } else if (
                                restoredQueue.length === 0 &&
                                savedPlayerState?.queue?.length > 0
                            ) {
                                restoredQueue = savedPlayerState.queue;
                            }
                        } else if (
                            restoredQueue.length === 0 &&
                            savedPlayerState?.queue?.length > 0
                        ) {
                            restoredQueue = savedPlayerState.queue;
                        }

                        if (restoredQueue.length === 0) {
                            restoredQueue = [nativeSong];
                        }

                        const songIndex = restoredQueue.findIndex(
                            (s) => s.id === lastNative.id
                        );
                        if (songIndex !== -1) {
                            restoredIndex = songIndex;
                            nativeSong = { ...restoredQueue[songIndex], id: lastNative.id };
                        } else {
                            restoredQueue = [nativeSong];
                            restoredIndex = 0;
                        }

                        const isAlreadyPlaying = Boolean(lastNative.isPlaying);
                        if (isAlreadyPlaying) {
                            audioInitializedRef.current = true;
                            autoPlayStartedRef.current = true;
                        } else if (lastNative.isInitialBoot === false) {
                            autoPlayStartedRef.current = true;
                        }

                        lastSavedSongIdRef.current = nativeSong.id;
                        setPlayingPlaylistId(restoredPlaylistId);
                        const syncedPlayerState: PlayerState = {
                            isOpen: true,
                            isPlaying: isAlreadyPlaying,
                            currentSong: nativeSong,
                            queue: restoredQueue,
                            currentIndex: restoredIndex,
                            isShuffled: effectiveShuffled,
                            isExpanded: false,
                            originalQueue: originalQueueForState
                        };
                        setPlayerState(syncedPlayerState);

                        const stateToPersist = {
                            ...syncedPlayerState,
                            playingPlaylistId: restoredPlaylistId,
                            savedTime: restoredTime
                        };
                        delete (stateToPersist as any).originalQueue;
                        storageService.saveData('streamify_player_state', stateToPersist);
                        nativeStateLoaded = true;
                    }
                } catch (e) {
                    console.warn('Failed to get native last played info:', e);
                }
            }

            if (!nativeStateLoaded && savedPlayerState) {
                const fallbackPlaylistId = savedPlayerState.playingPlaylistId || null;
                let fallbackOriginalQueue = savedPlayerState.originalQueue;
                if (savedIsShuffled && !fallbackOriginalQueue && fallbackPlaylistId) {
                    const pl = savedPlaylists.find((p) => p.id === fallbackPlaylistId);
                    if (pl && pl.songs.length > 0) {
                        fallbackOriginalQueue = [...pl.songs];
                    }
                }
                lastSavedSongIdRef.current = savedPlayerState.currentSong?.id || null;
                setPlayingPlaylistId(fallbackPlaylistId);
                setPlayerState({
                    ...savedPlayerState,
                    originalQueue: fallbackOriginalQueue,
                    isPlaying: false,
                    isOpen: !!savedPlayerState.currentSong
                });
            }
        },
        []
    );

    // Save when song, index, or shuffle changes
    useEffect(() => {
        if (!stateLoadedRef.current || !playerState.currentSong) return;

        const isNewSong =
            lastSavedSongIdRef.current !== null &&
            lastSavedSongIdRef.current !== playerState.currentSong.id;
        lastSavedSongIdRef.current = playerState.currentSong.id;

        if (isNewSong) {
            currentTimeRef.current = 0;
            initialSeekTimeRef.current = 0;
            setInitialSavedTime(0);
            const stateToSave = { ...playerState, savedTime: 0, playingPlaylistId };
            delete (stateToSave as any).originalQueue;
            storageService.saveData('streamify_player_state', stateToSave);
        } else {
            saveStateToStorage(playerState, playingPlaylistId);
        }
    }, [
        playerState.currentSong?.id,
        playerState.currentIndex,
        playerState.isShuffled,
        playingPlaylistId,
        saveStateToStorage,
        stateLoadedRef
    ]);

    // Periodic 4-second save for Windows/Web and foreground sync
    useEffect(() => {
        const interval = setInterval(() => {
            if (
                playerState.isPlaying &&
                stateLoadedRef.current &&
                playerState.currentSong &&
                currentTimeRef.current > 1
            ) {
                saveStateToStorage(playerState, playingPlaylistId, currentTimeRef.current);
            }
        }, 4000);
        return () => clearInterval(interval);
    }, [playerState, playingPlaylistId, saveStateToStorage, stateLoadedRef]);

    // Fast-Track Autoplay on Initial Car Boot
    useEffect(() => {
        if (
            currentUser &&
            isAppReady &&
            isOnline &&
            playerState.currentSong &&
            !audioInitializedRef.current &&
            !autoPlayStartedRef.current
        ) {
            autoPlayStartedRef.current = true;
            const timer = setTimeout(async () => {
                if (audioInitializedRef.current) return;
                if (!playerState.currentSong || playerState.queue.length === 0) return;
                try {
                    const startPos =
                        initialSeekTimeRef.current > 0
                            ? initialSeekTimeRef.current
                            : undefined;
                    setPlayerState((prev) => ({ ...prev, isPlaying: true }));

                    await audioService.playQueue(
                        playerState.queue,
                        playerState.currentIndex,
                        playingPlaylistId || undefined,
                        startPos,
                        playerState.isShuffled
                    );

                    initialSeekTimeRef.current = 0;
                    audioInitializedRef.current = true;
                } catch (e) {
                    console.error('Auto-play failed:', e);
                    setPlayerState((prev) => ({ ...prev, isPlaying: false }));
                }
            }, 1000);
            return () => clearTimeout(timer);
        }
    }, [currentUser, isAppReady, isOnline, playerState.currentSong, playingPlaylistId]);

    useEffect(() => {
        if (isOnline && !prevOnlineStatus.current) {
            setNetworkError(null);
            if (currentUser) onNetworkRestoredSyncLibrary();
        }
        prevOnlineStatus.current = isOnline;
    }, [isOnline, currentUser, onNetworkRestoredSyncLibrary, setNetworkError]);

    const handlePlaySong = (
        song: PlaylistItem,
        queue: PlaylistItem[],
        index: number,
        isPlaylistStartAction: boolean = false,
        playlistId: string | null = null
    ) => {
        audioInitializedRef.current = true;
        initialSeekTimeRef.current = 0;
        currentTimeRef.current = 0;
        setInitialSavedTime(0);

        let finalQueue = [...queue];
        let finalIndex = index;
        let finalOriginalQueue: PlaylistItem[] | undefined = undefined;

        if (playerState.isShuffled || (isPlaylistStartAction && playerState.isShuffled)) {
            finalOriginalQueue = [...queue];
            const shuffledQueue = shuffleArray([...queue]);
            const clickedSongIdx = shuffledQueue.findIndex((s) => s.id === song.id);
            if (clickedSongIdx > 0) {
                const [item] = shuffledQueue.splice(clickedSongIdx, 1);
                shuffledQueue.unshift(item);
            }
            finalQueue = shuffledQueue;
            finalIndex = 0;
        }

        lastSavedSongIdRef.current = song.id;
        setPlayingPlaylistId(playlistId);
        setPlayerState((prev) => {
            const newState: PlayerState = {
                ...prev,
                isOpen: true,
                isPlaying: true,
                currentSong: song,
                queue: finalQueue,
                currentIndex: finalIndex,
                isShuffled: prev.isShuffled,
                originalQueue:
                    playerState.isShuffled || isPlaylistStartAction
                        ? finalOriginalQueue
                        : undefined,
                isExpanded: false
            };

            const stateToSave = { ...newState, savedTime: 0, playingPlaylistId: playlistId };
            delete (stateToSave as any).originalQueue;
            storageService.saveData('streamify_player_state', stateToSave);
            return newState;
        });

        audioService.playQueue(
            finalQueue,
            finalIndex,
            playlistId || undefined,
            0,
            playerState.isShuffled
        );
    };

    const handleNext = useCallback(() => {
        audioInitializedRef.current = true;
        initialSeekTimeRef.current = 0;
        currentTimeRef.current = 0;
        setInitialSavedTime(0);
        setPlayerState((prev) => {
            if (!prev.queue || prev.queue.length === 0) return prev;
            const nextIdx = (prev.currentIndex + 1) % prev.queue.length;
            const nextSong = prev.queue[nextIdx];
            audioService.skipTo(nextIdx);
            return { ...prev, currentIndex: nextIdx, currentSong: nextSong, isPlaying: true };
        });
    }, []);

    const handlePrev = useCallback(() => {
        audioInitializedRef.current = true;
        initialSeekTimeRef.current = 0;
        currentTimeRef.current = 0;
        setInitialSavedTime(0);
        setPlayerState((prev) => {
            if (!prev.queue || prev.queue.length === 0) return prev;
            const prevIdx = (prev.currentIndex - 1 + prev.queue.length) % prev.queue.length;
            const prevSong = prev.queue[prevIdx];
            audioService.skipTo(prevIdx);
            return { ...prev, currentIndex: prevIdx, currentSong: prevSong, isPlaying: true };
        });
    }, []);

    const toggleShuffle = () => {
        setPlayerState((prev) => {
            if (!prev.currentSong || !prev.queue || prev.queue.length < 2) {
                const simpleNewState = !prev.isShuffled;
                localStorage.setItem('streamify_shuffle', String(simpleNewState));
                return { ...prev, isShuffled: simpleNewState };
            }

            const isEnablingShuffle = !prev.isShuffled;
            let newState: PlayerState;

            if (isEnablingShuffle) {
                const originalQueue = prev.originalQueue || prev.queue;
                const shuffledQueue = shuffleArray([...originalQueue]);
                const newIndex = shuffledQueue.findIndex(
                    (s) => s.id === prev.currentSong!.id
                );
                if (newIndex > 0) {
                    const current = shuffledQueue.splice(newIndex, 1)[0];
                    shuffledQueue.unshift(current);
                }
                newState = {
                    ...prev,
                    isShuffled: true,
                    queue: shuffledQueue,
                    currentIndex: 0,
                    originalQueue
                };
            } else {
                const originalOrderQueue = prev.originalQueue || prev.queue;
                const newIndex = originalOrderQueue.findIndex(
                    (s) => s.id === prev.currentSong!.id
                );
                newState = {
                    ...prev,
                    isShuffled: false,
                    queue: originalOrderQueue,
                    currentIndex: newIndex !== -1 ? newIndex : 0,
                    originalQueue: undefined
                };
            }

            localStorage.setItem('streamify_shuffle', String(newState.isShuffled));
            audioService.updateQueue(
                newState.queue,
                newState.currentIndex,
                playingPlaylistId || undefined,
                newState.isShuffled
            );
            saveStateToStorage(newState, playingPlaylistId, currentTimeRef.current);
            return newState;
        });
    };

    const togglePlayPause = () => {
        autoPlayStartedRef.current = true;
        if (playerState.isPlaying) {
            audioService.pause();
            setPlayerState((p) => ({ ...p, isPlaying: false }));
            saveStateToStorage(playerState, playingPlaylistId, currentTimeRef.current);
        } else {
            if (!audioInitializedRef.current && playerState.currentSong) {
                const startPos =
                    initialSeekTimeRef.current > 0
                        ? initialSeekTimeRef.current
                        : currentTimeRef.current > 0
                        ? currentTimeRef.current
                        : undefined;

                audioService.playQueue(
                    playerState.queue,
                    playerState.currentIndex,
                    playingPlaylistId || undefined,
                    startPos,
                    playerState.isShuffled
                );

                initialSeekTimeRef.current = 0;
                audioInitializedRef.current = true;
                setPlayerState((p) => ({ ...p, isPlaying: true }));
            } else {
                audioService.resume();
                setPlayerState((p) => ({ ...p, isPlaying: true }));
            }
        }
    };

    const handleSeek = (time: number) => {
        currentTimeRef.current = time;
        audioService.seek(time);
        saveStateToStorage(
            latestPlayerStateRef.current,
            latestPlaylistIdRef.current,
            time
        );
    };

    const handlersRef = useRef({ handleNext, handlePrev, onSongSkippedAutoHeal });
    useEffect(() => {
        handlersRef.current = { handleNext, handlePrev, onSongSkippedAutoHeal };
    }, [handleNext, handlePrev, onSongSkippedAutoHeal]);

    useEffect(() => {
        const networkListener = Network.addListener('networkStatusChange', (status) => {
            setIsOnline(status.connected);
            if (status.connected) {
                setNetworkError(null);
            } else {
                setNetworkError('אין חיבור לאינטרנט');
            }
        });

        const appStateListener = CapacitorApp.addListener(
            'appStateChange',
            async ({ isActive }) => {
                if (
                    !isActive &&
                    stateLoadedRef.current &&
                    latestPlayerStateRef.current.currentSong
                ) {
                    saveStateToStorage(
                        latestPlayerStateRef.current,
                        latestPlaylistIdRef.current,
                        currentTimeRef.current
                    );
                }

                if (isActive && Capacitor.isNativePlatform()) {
                    try {
                        const nativeInfo = await audioService.getLastPlayedInfo();
                        if (nativeInfo && nativeInfo.id) {
                            if (nativeInfo.savedTime && nativeInfo.savedTime > 0) {
                                currentTimeRef.current = nativeInfo.savedTime;
                                setInitialSavedTime(nativeInfo.savedTime);
                            }
                            setPlayerState((prev) => {
                                const idx = prev.queue.findIndex(
                                    (s) => s.id === nativeInfo.id
                                );
                                const updatedSong =
                                    idx !== -1 ? prev.queue[idx] : prev.currentSong;
                                const updatedIndex =
                                    idx !== -1 ? idx : prev.currentIndex;
                                const nextState = {
                                    ...prev,
                                    currentSong: updatedSong,
                                    currentIndex: updatedIndex,
                                    isPlaying: Boolean(nativeInfo.isPlaying)
                                };
                                if (updatedSong) {
                                    lastSavedSongIdRef.current = updatedSong.id;
                                    saveStateToStorage(
                                        nextState,
                                        latestPlaylistIdRef.current,
                                        nativeInfo.savedTime || currentTimeRef.current
                                    );
                                }
                                return nextState;
                            });
                        }
                    } catch {}
                }
            }
        );

        const timeListener = audioService.addListener('timeUpdate', (data: any) => {
            if (typeof data.currentTime === 'number' && data.currentTime > 0) {
                currentTimeRef.current = data.currentTime;
            }
        });

        const stateListener = audioService.addListener('stateChange', (data: any) => {
            setPlayerState((prev) => ({ ...prev, isPlaying: Boolean(data.isPlaying) }));
        });

        const endListener = audioService.addListener('ended', () => {
            setPlayerState((prev) => ({ ...prev, isPlaying: false }));
        });

        const transitionListener = audioService.addListener(
            'itemTransition',
            (data: any) => {
                setPlayerState((prev) => {
                    const newIdx = prev.queue.findIndex((s) => s.id === data.id);
                    if (newIdx === -1) return prev;
                    const newSong = prev.queue[newIdx];
                    const isSameSong = prev.currentSong?.id === newSong.id;
                    if (!isSameSong) {
                        currentTimeRef.current = 0;
                        initialSeekTimeRef.current = 0;
                        setInitialSavedTime(0);
                    }
                    const nextState = {
                        ...prev,
                        currentIndex: newIdx,
                        currentSong: newSong,
                        isPlaying: !audioService.isUserPausedState()
                    };
                    lastSavedSongIdRef.current = newSong.id;
                    saveStateToStorage(nextState, latestPlaylistIdRef.current, 0);
                    return nextState;
                });
            }
        );

        const networkWaitListener = audioService.addListener(
            'networkWait',
            (data: any) => {
                setNetworkError(data?.message || 'ממתין לחיבור רשת...');
            }
        );

        const networkRestoredListener = audioService.addListener(
            'networkRestored',
            () => {
                setNetworkError(null);
            }
        );

        const errorListener = audioService.addListener('error', (data: any) => {
            setPlayerState((prev) => ({ ...prev, isPlaying: false }));
            setNetworkError(data?.error || 'שגיאה בטעינת השירים - הניגון נעצר');
            setTimeout(() => setNetworkError(null), 5000);
        });

        const songSkippedListener = audioService.addListener('songSkipped', (data: any) => {
            if (data?.id && handlersRef.current.onSongSkippedAutoHeal) {
                handlersRef.current.onSongSkippedAutoHeal(data.id);
            }
        });

        if ('mediaSession' in navigator && !Capacitor.isNativePlatform()) {
            navigator.mediaSession.setActionHandler('nexttrack', () =>
                handlersRef.current.handleNext()
            );
            navigator.mediaSession.setActionHandler('previoustrack', () =>
                handlersRef.current.handlePrev()
            );
        }

        return () => {
            stateListener.remove();
            endListener.remove();
            errorListener.remove();
            songSkippedListener.remove();
            transitionListener.remove();
            networkWaitListener.remove();
            networkRestoredListener.remove();
            audioService.cleanup();
            timeListener.remove();

            networkListener.then((l) => l.remove());
            appStateListener.then((l) => l.remove());
        };
    }, [saveStateToStorage, setNetworkError, stateLoadedRef]);

    return {
        playerState,
        setPlayerState,
        playingPlaylistId,
        setPlayingPlaylistId,
        initialSavedTime,
        isOnline,
        restoreInitialPlayerState,
        handlePlaySong,
        handleNext,
        handlePrev,
        toggleShuffle,
        togglePlayPause,
        handleSeek
    };
};
