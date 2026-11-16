import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Capacitor } from '@capacitor/core';
import { App as CapacitorApp } from '@capacitor/app';
import {
    User,
    Playlist,
    PlaylistItem,
    YouTubeSearchResult,
    ViewState,
    Folder
} from './types';
import { YOUTUBE_API_BASE } from './constants';
import { LoaderIcon } from './components/Icons';
import Player from './components/Player';
import TitleBar from './components/TitleBar';
import LogViewer from './components/LogViewer';
import { storageService } from './StorageService';
import { audioService } from './AudioService';
import { searchResultToPlaylistItem } from './utils/mediaUtils';
import {
    fetchYouTubeBrowseApi,
    getInitialEncryptionEnabled,
    persistEncryptionEnabled
} from './utils/encryptionUtils';
import {
    BulkImportModal,
    BulkImportModalState,
    ConfirmationModal,
    ConfirmModalState,
    ContextMenuPopup,
    ContextMenuState,
    GlobalLoader,
    InputModal,
    InputModalState,
    ManageUsersModal,
    ManageUsersModalState,
    MoveToFolderModal,
    MoveToFolderModalState,
    PlaylistSelectorModal
} from './components/Modals';
import { DesktopSidebar, LoginScreen, MobileBottomNav } from './components/Navigation';
import { HomeView } from './components/views/HomeView';
import { SearchView } from './components/views/SearchView';
import { StreamifyView } from './components/views/StreamifyView';
import { PlaylistDetailView } from './components/views/PlaylistDetailView';
import {
    checkAndroidUpdateAvailabilitySilently,
    checkInitialUpdateState,
    runInteractiveUpdateCheck
} from './services/UpdateService';
import { usePlayerController } from './hooks/usePlayerController';
import { useLibraryManager } from './hooks/useLibraryManager';
import { useSearchManager } from './hooks/useSearchManager';

const App: React.FC = () => {
    const isDesktop = !Capacitor.isNativePlatform();
    const SECRET_ENTRY_CODE = import.meta.env.VITE_APP_ENTRY_CODE || '1234321';

    // Core User & Navigation State
    const [currentUser, setCurrentUser] = useState<User | null>(null);
    const [activeTab, setActiveTab] = useState<ViewState>('home');
    const [prevTab, setPrevTab] = useState<ViewState>('home');
    const [isAppReady, setIsAppReady] = useState(false);
    const [isEncryptionEnabled, setIsEncryptionEnabled] = useState<boolean>(() =>
        getInitialEncryptionEnabled()
    );
    const stateLoadedRef = useRef(false);

    useEffect(() => {
        if (activeTab !== 'playlist') setPrevTab(activeTab);
    }, [activeTab]);

    // UI & Modals State
    const [playlistViewMode, setPlaylistViewMode] = useState<'grid' | 'list'>('grid');
    const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
    const [expandedHomeFolders, setExpandedHomeFolders] = useState<Set<string>>(new Set());
    const [showLogs, setShowLogs] = useState(false);
    const [globalLoading, setGlobalLoading] = useState<string | null>(null);
    const [updateStatusMsg, setUpdateStatusMsg] = useState<string>('');
    const [updateAvailable, setUpdateAvailable] = useState(false);
    const [networkError, setNetworkError] = useState<string | null>(null);
    const [emailInput, setEmailInput] = useState('');
    const [entryCodeInput, setEntryCodeInput] = useState('');

    const [confirmModal, setConfirmModal] = useState<ConfirmModalState>({
        isOpen: false,
        title: '',
        onConfirm: () => {}
    });
    const [inputModal, setInputModal] = useState<InputModalState>({
        isOpen: false,
        title: '',
        defaultValue: '',
        onConfirm: () => {}
    });
    const [inputModalValue, setInputModalValue] = useState('');
    const [bulkImportState, setBulkImportState] = useState<BulkImportModalState>({
        isOpen: false,
        item: null,
        tracks: [],
        mode: 'select_action'
    });
    const [manageUsersState, setManageUsersState] = useState<ManageUsersModalState>({
        isOpen: false,
        playlist: null
    });
    const [showPlaylistSelector, setShowPlaylistSelector] = useState(false);
    const [songsToAdd, setSongsToAdd] = useState<PlaylistItem[]>([]);
    const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
    const [moveToFolderState, setMoveToFolderState] = useState<MoveToFolderModalState>({
        visible: false,
        playlistId: null
    });

    // Ref to forward fetchLibrary and autoHealSkippedSong into usePlayerController
    const fetchLibraryRef = useRef<() => void>(() => {});
    const autoHealSkippedSongRef = useRef<(songId: string) => void>(() => {});
    const onNetworkRestoredSyncLibrary = useCallback(() => {
        fetchLibraryRef.current();
    }, []);
    const onSongSkippedAutoHeal = useCallback((songId: string) => {
        autoHealSkippedSongRef.current(songId);
    }, []);

    // 1. Player & Native Checkpoint Controller Hook
    const {
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
    } = usePlayerController({
        currentUser,
        isAppReady,
        stateLoadedRef,
        setNetworkError,
        onNetworkRestoredSyncLibrary,
        onSongSkippedAutoHeal
    });

    // Forward setIsSearching ref for useLibraryManager
    const setIsSearchingRef = useRef<(val: boolean) => void>(() => {});
    const setIsSearchingProxy = useCallback((val: boolean) => {
        setIsSearchingRef.current(val);
    }, []);

    // 2. Library, Playlists & Recommendations Hook
    const {
        playlists,
        setPlaylists,
        folders,
        setFolders,
        likedSongsPlaylist,
        setLikedSongsPlaylist,
        selectedPlaylist,
        setSelectedPlaylist,
        streamifyCategory,
        handleSelectStreamifyCategory,
        hydrateStreamifyCache,
        streamifyResults,
        setStreamifyResults,
        isLoadingStreamify,
        streamifyDisplayLimit,
        setStreamifyDisplayLimit,
        playlistDisplayLimit,
        setPlaylistDisplayLimit,
        repairProgress,
        cancelRepairPlaylist,
        autoHealSkippedSong,
        fetchLibrary,
        loadStreamifyRecommendations,
        loadExternalPlaylist,
        apiCreatePlaylist,
        apiSaveExternalPlaylist,
        apiCreateFolder,
        apiSharePlaylist,
        apiUnsharePlaylist,
        apiDeletePlaylist,
        apiDeleteFolder,
        apiMovePlaylistToFolder,
        apiRenameItem,
        apiAddSongsToPlaylist,
        apiRemoveSong,
        repairPlaylistSongs,
        handleToggleLike
    } = useLibraryManager({
        currentUser,
        isEncryptionEnabled,
        activeTab,
        setActiveTab,
        playingPlaylistId,
        setPlayingPlaylistId,
        setGlobalLoading,
        setNetworkError,
        setConfirmModal,
        manageUsersState,
        setManageUsersState,
        setBulkImportState,
        setMoveToFolderState,
        setShowPlaylistSelector,
        setSongsToAdd,
        setIsSearching: setIsSearchingProxy
    });

    useEffect(() => {
        fetchLibraryRef.current = fetchLibrary;
    }, [fetchLibrary]);

    useEffect(() => {
        autoHealSkippedSongRef.current = autoHealSkippedSong;
    }, [autoHealSkippedSong]);

    // 3. Search, Voice Search & Spotify Import Hook
    const {
        searchQuery,
        setSearchQuery,
        searchResults,
        isSearching,
        setIsSearching,
        searchSuggestions,
        showSuggestions,
        setShowSuggestions,
        focusedSuggestionIndex,
        setFocusedSuggestionIndex,
        searchHistory,
        setSearchHistory,
        ytMusicFilter,
        setYtMusicFilter,
        isListening,
        playlistSearchQuery,
        setPlaylistSearchQuery,
        playlistSearchResults,
        isPlaylistSearching,
        addToSearchHistory,
        removeSearchHistoryItem,
        clearSearchHistory,
        handleSpotifyImport,
        performSearch,
        handleVoiceSearch,
        handleAddToPlaylistClick
    } = useSearchManager({
        isEncryptionEnabled,
        selectedPlaylistId: selectedPlaylist?.id,
        setSelectedPlaylist,
        setActiveTab,
        setGlobalLoading,
        setConfirmModal,
        setBulkImportState,
        setShowPlaylistSelector,
        setSongsToAdd,
        apiAddSongsToPlaylist
    });

    useEffect(() => {
        setIsSearchingRef.current = setIsSearching;
    }, [setIsSearching]);

    // Infinite Scroll Observers
    const observerTarget = useRef<HTMLDivElement>(null);
    const streamifyObserverTarget = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const observer = new IntersectionObserver(
            (entries) => {
                entries.forEach((entry) => {
                    if (entry.isIntersecting) {
                        if (
                            entry.target === observerTarget.current &&
                            selectedPlaylist &&
                            playlistDisplayLimit < selectedPlaylist.songs.length
                        ) {
                            setPlaylistDisplayLimit((prev) => prev + 30);
                        }
                        if (
                            entry.target === streamifyObserverTarget.current &&
                            streamifyDisplayLimit < streamifyResults.length
                        ) {
                            setStreamifyDisplayLimit((prev) => prev + 20);
                        }
                    }
                });
            },
            { threshold: 0.1 }
        );

        if (observerTarget.current) observer.observe(observerTarget.current);
        if (streamifyObserverTarget.current) observer.observe(streamifyObserverTarget.current);
        return () => observer.disconnect();
    }, [selectedPlaylist, playlistDisplayLimit, streamifyDisplayLimit, streamifyResults.length]);

    useEffect(() => {
        if (selectedPlaylist && !selectedPlaylist.id.startsWith('temp-')) {
            storageService.saveData('streamify_last_playlist', selectedPlaylist);
        }
        setPlaylistDisplayLimit(30);
    }, [selectedPlaylist?.id]);

    useEffect(() => {
        if (stateLoadedRef.current) {
            storageService.saveData('streamify_playlist_view_mode', playlistViewMode);
        }
    }, [playlistViewMode]);

    // Android Hardware Back Button Handler
    const appStateRef = useRef({
        confirmModalOpen: confirmModal.isOpen,
        inputModalOpen: inputModal.isOpen,
        bulkImportOpen: bulkImportState.isOpen,
        manageUsersOpen: manageUsersState.isOpen,
        playlistSelectorOpen: showPlaylistSelector,
        moveToFolderOpen: moveToFolderState.visible,
        contextMenuOpen: !!contextMenu,
        showLogs,
        playerExpanded: playerState.isExpanded,
        activeTab,
        prevTab
    });

    useEffect(() => {
        appStateRef.current = {
            confirmModalOpen: confirmModal.isOpen,
            inputModalOpen: inputModal.isOpen,
            bulkImportOpen: bulkImportState.isOpen,
            manageUsersOpen: manageUsersState.isOpen,
            playlistSelectorOpen: showPlaylistSelector,
            moveToFolderOpen: moveToFolderState.visible,
            contextMenuOpen: !!contextMenu,
            showLogs,
            playerExpanded: playerState.isExpanded,
            activeTab,
            prevTab
        };
    }, [
        confirmModal.isOpen,
        inputModal.isOpen,
        bulkImportState.isOpen,
        manageUsersState.isOpen,
        showPlaylistSelector,
        moveToFolderState.visible,
        contextMenu,
        showLogs,
        playerState.isExpanded,
        activeTab,
        prevTab
    ]);

    useEffect(() => {
        if (!Capacitor.isNativePlatform()) return;
        const handleBackButton = () => {
            const s = appStateRef.current;
            if (s.confirmModalOpen) return setConfirmModal((p) => ({ ...p, isOpen: false }));
            if (s.inputModalOpen) return setInputModal((p) => ({ ...p, isOpen: false }));
            if (s.bulkImportOpen) return setBulkImportState((p) => ({ ...p, isOpen: false }));
            if (s.manageUsersOpen) return setManageUsersState({ isOpen: false, playlist: null });
            if (s.playlistSelectorOpen) return setShowPlaylistSelector(false);
            if (s.moveToFolderOpen) return setMoveToFolderState({ visible: false, playlistId: null });
            if (s.contextMenuOpen) return setContextMenu(null);
            if (s.showLogs) return setShowLogs(false);
            if (s.playerExpanded) return setPlayerState((p) => ({ ...p, isExpanded: false }));
            if (s.activeTab === 'playlist') return setActiveTab(s.prevTab);
            if (s.activeTab === 'search' || s.activeTab === 'library' || s.activeTab === 'streamify') {
                return setActiveTab('home');
            }
            if (s.activeTab === 'home') CapacitorApp.exitApp();
        };

        const listenerPromise = CapacitorApp.addListener('backButton', handleBackButton);
        return () => {
            listenerPromise.then((l) => l.remove());
        };
    }, []);

    // Updates & Initial Boot Data Load
    useEffect(() => {
        checkInitialUpdateState(setUpdateAvailable);
    }, []);

    useEffect(() => {
        if (isAppReady) checkAndroidUpdateAvailabilitySilently(setUpdateAvailable);
    }, [isAppReady]);

    useEffect(() => {
        const initApp = async () => {
            try {
                const savedEnc = await storageService.loadData<boolean>(
                    'streamify_encryption_enabled',
                    getInitialEncryptionEnabled()
                );
                const normalizedEnc = Boolean(savedEnc);
                setIsEncryptionEnabled(normalizedEnc);
                persistEncryptionEnabled(normalizedEnc);
                audioService.setEncryptionMode(normalizedEnc).catch(() => {});

                const savedEmail = await storageService.loadData<string>('streamify_user_email', '');
                if (savedEmail) {
                    setCurrentUser({ email: savedEmail, permissions: [], playlistPermission: 'edit' });
                }

                const savedPlaylists = await storageService.loadData<Playlist[]>('streamify_cache_playlists', []);
                const savedFolders = await storageService.loadData<Folder[]>('streamify_cache_folders', []);
                const savedLiked = await storageService.loadData<Playlist | null>('streamify_cache_liked', null);
                const savedStreamifyByCat = await storageService.loadData<Record<string, YouTubeSearchResult[]> | null>(
                    'streamify_recommended_by_category',
                    null
                );
                const savedStreamify = await storageService.loadData<YouTubeSearchResult[]>('streamify_recommended', []);
                hydrateStreamifyCache(savedStreamifyByCat, savedStreamify);

                setPlaylists(savedPlaylists);
                setFolders(savedFolders);
                setLikedSongsPlaylist(savedLiked);

                const savedViewMode = await storageService.loadData<string>('streamify_playlist_view_mode', 'grid');
                setPlaylistViewMode(savedViewMode === 'list' || savedViewMode === 'grid' ? savedViewMode : 'grid');

                const savedHistory = await storageService.loadData<string[]>('streamify_search_history', []);
                setSearchHistory(savedHistory || []);

                await Promise.race([
                    restoreInitialPlayerState(savedPlaylists),
                    new Promise((resolve) => setTimeout(resolve, 2500))
                ]);
                stateLoadedRef.current = true;

                const lastPlaylist = await storageService.loadData<Playlist | null>('streamify_last_playlist', null);
                if (lastPlaylist) setSelectedPlaylist(lastPlaylist);
                setIsAppReady(true);
            } catch (e) {
                console.error('Initialization failed:', e);
                stateLoadedRef.current = true;
                setIsAppReady(true);
            }
        };
        initApp();
    }, [restoreInitialPlayerState]);

    // Context Menu & Action Handlers
    const handleOpenContextMenu = (e: React.MouseEvent | React.TouchEvent, item: Playlist | Folder) => {
        e.preventDefault();
        e.stopPropagation();
        const coords = 'touches' in e ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : { x: e.clientX, y: e.clientY };
        const x = coords.x + 192 > window.innerWidth ? coords.x - 192 : coords.x;
        const y = coords.y + 100 > window.innerHeight ? coords.y - 100 : coords.y;
        setContextMenu({ x, y, item });
    };

    const closeContextMenu = useCallback(() => setContextMenu(null), []);
    useEffect(() => {
        if (contextMenu) {
            window.addEventListener('click', closeContextMenu, { once: true });
            return () => window.removeEventListener('click', closeContextMenu);
        }
    }, [contextMenu, closeContextMenu]);

    const handleToggleEncryption = useCallback(() => {
        setIsEncryptionEnabled((prev) => {
            const nextVal = !prev;
            persistEncryptionEnabled(nextVal);
            audioService.setEncryptionMode(nextVal);
            return nextVal;
        });
    }, []);

    const handlePlaylistPlay = (playlist: Playlist) => {
        if (playingPlaylistId === playlist.id && playlist.songs.length > 0) {
            togglePlayPause();
            return;
        }
        if (playlist.externalId && playlist.songs.length === 0) {
            setSelectedPlaylist(playlist);
            setActiveTab('playlist');
            loadExternalPlaylist(playlist);
            return;
        }
        if (playlist.songs.length > 0) {
            const startIdx = playerState.isShuffled ? Math.floor(Math.random() * playlist.songs.length) : 0;
            handlePlaySong(playlist.songs[startIdx], playlist.songs, startIdx, true, playlist.id);
        }
    };

    const handleResultClick = async (result: YouTubeSearchResult) => {
        addToSearchHistory(searchQuery);
        if (!result.type || result.type === 'song' || result.type === 'video') {
            if (playerState.currentSong?.id === result.id) return togglePlayPause();
            const songQueue = searchResults
                .filter((r) => !r.type || r.type === 'song' || r.type === 'video')
                .map((r) => searchResultToPlaylistItem(r, 'search'));
            const clickedIdx = songQueue.findIndex((s) => s.id === result.id);
            if (clickedIdx !== -1) handlePlaySong(songQueue[clickedIdx], songQueue, clickedIdx, false, 'temp-search');
            return;
        }
        if (result.type === 'spotify_playlist') return handleSpotifyImport(result.id);

        setIsSearching(true);
        setGlobalLoading('טוען...');
        try {
            const data = await fetchYouTubeBrowseApi(
                YOUTUBE_API_BASE,
                result.id,
                result.type,
                isEncryptionEnabled
            );
            if (data.success && data.results) {
                const tracks: PlaylistItem[] = data.results.map((r: any) => searchResultToPlaylistItem(r, 'temp'));
                setSelectedPlaylist({
                    id: `temp-${result.id}`,
                    name: result.title,
                    creator: result.author || '',
                    isPublic: false,
                    songs: tracks
                });
                setActiveTab('playlist');
            }
        } catch {
            setConfirmModal({
                isOpen: true,
                title: 'שגיאה',
                message: 'שגיאה בטעינת התוכן',
                onConfirm: () => setConfirmModal((p) => ({ ...p, isOpen: false })),
                isAlertOnly: true
            });
        } finally {
            setIsSearching(false);
            setGlobalLoading(null);
        }
    };

    const handleDirectPlay = async (e: React.MouseEvent, result: YouTubeSearchResult) => {
        e.stopPropagation();
        const isSong = !result.type || result.type === 'song' || result.type === 'video';
        const isCurrentlyActive = isSong ? playerState.currentSong?.id === result.id : playingPlaylistId === `temp-${result.id}`;
        if (isCurrentlyActive) return togglePlayPause();

        if (isSong) {
            const songQueue = searchResults
                .filter((r) => !r.type || r.type === 'song' || r.type === 'video')
                .map((r) => searchResultToPlaylistItem(r, 'search'));
            const clickedIdx = songQueue.findIndex((s) => s.id === result.id);
            if (clickedIdx !== -1) handlePlaySong(songQueue[clickedIdx], songQueue, clickedIdx, false, 'temp-search');
            return;
        }
        if (result.type === 'spotify_playlist') return handleSpotifyImport(result.id);

        setGlobalLoading('מתחיל לנגן...');
        try {
            const data = await fetchYouTubeBrowseApi(
                YOUTUBE_API_BASE,
                result.id,
                result.type,
                isEncryptionEnabled
            );
            if (data.success && data.results && data.results.length > 0) {
                const tracks = data.results.map((r: any) => searchResultToPlaylistItem(r, 'temp'));
                const tempId = `temp-${result.id}`;
                const startIdx = playerState.isShuffled ? Math.floor(Math.random() * tracks.length) : 0;
                handlePlaySong(tracks[startIdx], tracks, startIdx, true, tempId);
            }
        } catch {
            setConfirmModal({
                isOpen: true,
                title: 'שגיאה',
                message: 'שגיאה בנגינה',
                onConfirm: () => setConfirmModal((p) => ({ ...p, isOpen: false })),
                isAlertOnly: true
            });
        } finally {
            setGlobalLoading(null);
        }
    };

    const handleLogin = (e: React.FormEvent) => {
        e.preventDefault();
        if (emailInput.includes('@') && entryCodeInput === SECRET_ENTRY_CODE) {
            storageService.saveData('streamify_user_email', emailInput);
            setCurrentUser({ email: emailInput, permissions: [], playlistPermission: 'edit' });
        } else {
            alert('אימייל לא תקין או קוד כניסה שגוי');
        }
    };

    const handleLogout = () => {
        setConfirmModal({
            isOpen: true,
            title: 'התנתקות',
            message: 'האם להתנתק?',
            onConfirm: () => {
                setConfirmModal((p) => ({ ...p, isOpen: false }));
                storageService.clearAll();
                persistEncryptionEnabled(isEncryptionEnabled);
                setCurrentUser(null);
                setPlaylists([]);
                setPlayingPlaylistId(null);
                setPlayerState((p) => ({ ...p, isPlaying: false, currentSong: null }));
                setActiveTab('home');
            }
        });
    };

    if (!isAppReady) {
        return (
            <div className="h-screen w-full flex items-center justify-center bg-black text-white">
                <LoaderIcon className="w-12 h-12 animate-spin text-spotify-primary" />
            </div>
        );
    }

    if (!currentUser) {
        return (
            <LoginScreen
                emailInput={emailInput}
                entryCodeInput={entryCodeInput}
                onEmailChange={setEmailInput}
                onEntryCodeChange={setEntryCodeInput}
                onSubmit={handleLogin}
            />
        );
    }

    return (
        <div className={`flex flex-col h-screen bg-spotify-base text-white overflow-hidden font-sans ${isDesktop ? 'pt-8' : ''}`}>
            <TitleBar />
            {showLogs && <LogViewer onClose={() => setShowLogs(false)} />}

            <GlobalLoader globalLoading={globalLoading} updateStatusMsg={updateStatusMsg} />
            <ConfirmationModal modal={confirmModal} onClose={() => setConfirmModal((p) => ({ ...p, isOpen: false }))} />
            <InputModal
                modal={inputModal}
                value={inputModalValue}
                onChange={setInputModalValue}
                onClose={() => {
                    setInputModal((p) => ({ ...p, isOpen: false }));
                    setInputModalValue('');
                }}
            />
            <BulkImportModal
                state={bulkImportState}
                inputValue={inputModalValue}
                onInputChange={setInputModalValue}
                onSetState={setBulkImportState}
                onClose={() => setBulkImportState((p) => ({ ...p, isOpen: false }))}
                onAddSongsToPlaylist={apiAddSongsToPlaylist}
                onCreatePlaylist={apiCreatePlaylist}
                onSaveExternalPlaylist={apiSaveExternalPlaylist}
                onOpenPlaylistSelector={(tracks) => {
                    setSongsToAdd(tracks);
                    setShowPlaylistSelector(true);
                }}
            />
            <ManageUsersModal
                state={manageUsersState}
                onClose={() => setManageUsersState({ isOpen: false, playlist: null })}
                onUnshare={apiUnsharePlaylist}
                onConfirmPrompt={setConfirmModal}
            />
            <PlaylistSelectorModal
                isOpen={showPlaylistSelector}
                playlists={playlists}
                songsToAdd={songsToAdd}
                onClose={() => setShowPlaylistSelector(false)}
                onAddSongsToPlaylist={apiAddSongsToPlaylist}
                onPromptNewPlaylist={() => {
                    setInputModal({
                        isOpen: true,
                        title: 'שם הפלייליסט:',
                        defaultValue: '',
                        onConfirm: (val) => {
                            apiCreatePlaylist(val).then((newP) => {
                                if (newP) apiAddSongsToPlaylist(newP.id, songsToAdd, newP);
                            });
                        }
                    });
                    setInputModalValue('');
                }}
            />
            <MoveToFolderModal
                state={moveToFolderState}
                folders={folders}
                onClose={() => setMoveToFolderState({ visible: false, playlistId: null })}
                onMove={apiMovePlaylistToFolder}
            />
            <ContextMenuPopup
                contextMenu={contextMenu}
                currentUser={currentUser}
                onClose={closeContextMenu}
                onRenamePrompt={(item, type) => {
                    setInputModal({
                        isOpen: true,
                        title: 'שם חדש:',
                        defaultValue: item.name,
                        onConfirm: (val) => {
                            if (val) apiRenameItem(item.id, val, type);
                        }
                    });
                    setInputModalValue(item.name);
                }}
                onSharePrompt={(pl) => {
                    setInputModal({
                        isOpen: true,
                        title: 'הכנס אימייל לשיתוף:',
                        defaultValue: '',
                        onConfirm: (val) => apiSharePlaylist(pl.id, val)
                    });
                    setInputModalValue('');
                }}
                onManageUsers={(pl) => setManageUsersState({ isOpen: true, playlist: pl })}
                onDelete={(item, isFolder) => (isFolder ? apiDeleteFolder(item.id) : apiDeletePlaylist(item.id))}
                onRepairPlaylist={repairPlaylistSongs}
                onMoveToFolder={(playlistId) => setMoveToFolderState({ visible: true, playlistId })}
            />

            {!isOnline && (
                <div className="fixed top-0 w-full bg-red-600 text-white text-center text-xs py-1 z-[80]">
                    אין חיבור לאינטרנט
                </div>
            )}
            {networkError && (
                <div className="fixed top-0 w-full bg-yellow-600 text-white text-center text-xs py-1 z-[80]">
                    {networkError}
                </div>
            )}
            {repairProgress && (
                <div className="fixed bottom-[112px] left-4 right-4 md:left-6 md:right-auto md:max-w-md bg-neutral-900/95 border border-spotify-primary/40 text-white px-4 py-2.5 rounded-xl shadow-2xl z-[75] flex items-center justify-between gap-3 backdrop-blur-md">
                    <div className="flex items-center gap-3 min-w-0">
                        <LoaderIcon className="w-4 h-4 animate-spin text-spotify-primary flex-shrink-0" />
                        <div className="text-xs truncate">
                            <span className="font-bold text-spotify-primary">סורק ברקע: </span>
                            <span className="font-medium">{repairProgress.playlistName}</span>
                            <span className="text-gray-300">
                                {' '}
                                ({repairProgress.nextIndex}/{repairProgress.total}
                                {repairProgress.fixedCount > 0
                                    ? ` • תוקנו: ${repairProgress.fixedCount}`
                                    : ''}
                                )
                            </span>
                        </div>
                    </div>
                    <button
                        onClick={cancelRepairPlaylist}
                        className="text-xs text-gray-400 hover:text-red-400 font-bold px-2 py-1 rounded hover:bg-white/10 flex-shrink-0"
                        title="עצור סריקה"
                    >
                        עצור
                    </button>
                </div>
            )}

            <div className="flex flex-1 overflow-hidden relative">
                <DesktopSidebar
                    activeTab={activeTab}
                    likedSongsPlaylist={likedSongsPlaylist}
                    selectedPlaylist={selectedPlaylist}
                    folders={folders}
                    playlists={playlists}
                    expandedFolders={expandedFolders}
                    onSelectTab={setActiveTab}
                    onSelectPlaylist={(pl) => {
                        setSelectedPlaylist(pl);
                        setActiveTab('playlist');
                    }}
                    onToggleFolder={(folderId) => {
                        const newSet = new Set(expandedFolders);
                        newSet.has(folderId) ? newSet.delete(folderId) : newSet.add(folderId);
                        setExpandedFolders(newSet);
                    }}
                    onContextMenu={handleOpenContextMenu}
                    onPromptNewFolder={() => {
                        setInputModal({
                            isOpen: true,
                            title: 'שם התיקייה:',
                            defaultValue: '',
                            onConfirm: (val) => apiCreateFolder(val)
                        });
                        setInputModalValue('');
                    }}
                    onPromptNewPlaylist={() => {
                        setInputModal({
                            isOpen: true,
                            title: 'שם הפלייליסט:',
                            defaultValue: '',
                            onConfirm: (val) => apiCreatePlaylist(val)
                        });
                        setInputModalValue('');
                    }}
                    onPromptRestartServer={() =>
                        setConfirmModal({
                            isOpen: true,
                            title: 'אתחול שרת',
                            message: 'האם אתה בטוח שברצונך לאתחל את השרת? המוזיקה תפסיק.',
                            onConfirm: async () => {
                                try {
                                    await fetch(`${YOUTUBE_API_BASE}/restart`, { method: 'POST' });
                                    setConfirmModal((p) => ({ ...p, isOpen: false }));
                                    alert('השרת מבצע אתחול...');
                                } catch {
                                    alert('שגיאה בביצוע אתחול');
                                }
                            }
                        })
                    }
                    onLogout={handleLogout}
                />

                <main
                    className={`flex-1 relative no-scrollbar bg-gradient-to-b from-spotify-elevated to-spotify-base ${
                        activeTab === 'search' || activeTab === 'streamify'
                            ? 'overflow-hidden flex flex-col'
                            : 'overflow-y-auto'
                    }`}
                >
                    {(activeTab === 'home' || activeTab === 'library') && (
                        <HomeView
                            folders={folders}
                            playlists={playlists}
                            expandedHomeFolders={expandedHomeFolders}
                            playlistViewMode={playlistViewMode}
                            playingPlaylistId={playingPlaylistId}
                            isPlaying={playerState.isPlaying}
                            updateAvailable={updateAvailable}
                            isEncryptionEnabled={isEncryptionEnabled}
                            onToggleEncryption={handleToggleEncryption}
                            onToggleHomeFolder={(folderId) => {
                                const newSet = new Set(expandedHomeFolders);
                                newSet.has(folderId) ? newSet.delete(folderId) : newSet.add(folderId);
                                setExpandedHomeFolders(newSet);
                            }}
                            onToggleViewMode={() =>
                                setPlaylistViewMode(playlistViewMode === 'grid' ? 'list' : 'grid')
                            }
                            onSelectPlaylist={(pl) => {
                                setSelectedPlaylist(pl);
                                setActiveTab('playlist');
                            }}
                            onPlaylistPlay={handlePlaylistPlay}
                            onContextMenu={handleOpenContextMenu}
                            onCheckUpdates={() =>
                                runInteractiveUpdateCheck({
                                    setGlobalLoading,
                                    setUpdateStatusMsg,
                                    setUpdateAvailable,
                                    setConfirmModal
                                })
                            }
                            onShowLogs={() => setShowLogs(true)}
                            onLogout={handleLogout}
                        />
                    )}

                    {activeTab === 'search' && (
                        <SearchView
                            isEncryptionEnabled={isEncryptionEnabled}
                            searchQuery={searchQuery}
                            searchResults={searchResults}
                            isSearching={isSearching}
                            searchSuggestions={searchSuggestions}
                            showSuggestions={showSuggestions}
                            focusedSuggestionIndex={focusedSuggestionIndex}
                            searchHistory={searchHistory}
                            ytMusicFilter={ytMusicFilter}
                            isListening={isListening}
                            currentSongId={playerState.currentSong?.id}
                            playingPlaylistId={playingPlaylistId}
                            isPlaying={playerState.isPlaying}
                            likedSongsPlaylist={likedSongsPlaylist}
                            onSearchQueryChange={setSearchQuery}
                            onSetShowSuggestions={setShowSuggestions}
                            onSetFocusedSuggestionIndex={setFocusedSuggestionIndex}
                            onPerformSearch={performSearch}
                            onVoiceSearch={handleVoiceSearch}
                            onFilterChange={setYtMusicFilter}
                            onClearSearchHistory={clearSearchHistory}
                            onRemoveSearchHistoryItem={removeSearchHistoryItem}
                            onResultClick={handleResultClick}
                            onDirectPlay={handleDirectPlay}
                            onToggleLike={handleToggleLike}
                            onAddToPlaylistClick={handleAddToPlaylistClick}
                        />
                    )}

                    {activeTab === 'streamify' && (
                        <StreamifyView
                            isEncryptionEnabled={isEncryptionEnabled}
                            activeCategory={streamifyCategory}
                            streamifyResults={streamifyResults}
                            streamifyDisplayLimit={streamifyDisplayLimit}
                            isLoadingStreamify={isLoadingStreamify}
                            playingPlaylistId={playingPlaylistId}
                            isPlaying={playerState.isPlaying}
                            observerRef={streamifyObserverTarget}
                            onSelectCategory={handleSelectStreamifyCategory}
                            onRefresh={() => loadStreamifyRecommendations(true, streamifyCategory)}
                            onResultClick={handleResultClick}
                            onDirectPlay={handleDirectPlay}
                        />
                    )}

                    {activeTab === 'playlist' && selectedPlaylist && (
                        <PlaylistDetailView
                            selectedPlaylist={selectedPlaylist}
                            playlistDisplayLimit={playlistDisplayLimit}
                            isShuffled={playerState.isShuffled}
                            playingPlaylistId={playingPlaylistId}
                            isPlaying={playerState.isPlaying}
                            currentSongId={playerState.currentSong?.id}
                            likedSongsPlaylist={likedSongsPlaylist}
                            playlistSearchQuery={playlistSearchQuery}
                            playlistSearchResults={playlistSearchResults}
                            isPlaylistSearching={isPlaylistSearching}
                            observerRef={observerTarget}
                            onBack={() => {
                                setSelectedPlaylist(null);
                                setActiveTab(prevTab);
                            }}
                            onPromptRename={() => {
                                setInputModal({
                                    isOpen: true,
                                    title: 'שם חדש:',
                                    defaultValue: selectedPlaylist.name,
                                    onConfirm: (val) => {
                                        if (val) apiRenameItem(selectedPlaylist.id, val, 'playlist');
                                    }
                                });
                                setInputModalValue(selectedPlaylist.name);
                            }}
                            onToggleShuffle={toggleShuffle}
                            onPlaylistPlay={handlePlaylistPlay}
                            onAddAllTempSongs={(songs) => {
                                setSongsToAdd(songs);
                                setShowPlaylistSelector(true);
                            }}
                            onPlaySong={handlePlaySong}
                            onRemoveSongConfirm={(song) => {
                                if (!selectedPlaylist || selectedPlaylist.id.startsWith('temp-')) return;
                                setConfirmModal({
                                    isOpen: true,
                                    title: 'הסרת שיר',
                                    message: `האם להסיר את "${song.title}"?`,
                                    onConfirm: () => {
                                        setConfirmModal((p) => ({ ...p, isOpen: false }));
                                        apiRemoveSong(selectedPlaylist.id, song.id);
                                    }
                                });
                            }}
                            onToggleLike={handleToggleLike}
                            onOpenSelectorForSong={(song) => {
                                setSongsToAdd([song]);
                                setShowPlaylistSelector(true);
                            }}
                            onPlaylistSearchChange={setPlaylistSearchQuery}
                            onAddToPlaylistClick={handleAddToPlaylistClick}
                        />
                    )}
                </main>
            </div>

            <Player
                playerState={playerState}
                initialTime={initialSavedTime}
                onPlayPause={togglePlayPause}
                onNext={handleNext}
                onPrev={handlePrev}
                onShuffle={toggleShuffle}
                onToggleExpand={() => setPlayerState((p) => ({ ...p, isExpanded: !p.isExpanded }))}
                onSeek={handleSeek}
                onRemoveCurrentSong={() => {
                    if (!playerState.currentSong || !playingPlaylistId || playingPlaylistId.startsWith('temp-')) return;
                    const song = playerState.currentSong;
                    const playlistId = playingPlaylistId;
                    setConfirmModal({
                        isOpen: true,
                        title: 'הסרת שיר',
                        message: `האם להסיר את "${song.title}" מרשימת ההשמעה?`,
                        onConfirm: () => {
                            setConfirmModal((p) => ({ ...p, isOpen: false }));
                            apiRemoveSong(playlistId, song.id);
                        }
                    });
                }}
            />

            <MobileBottomNav activeTab={activeTab} onSelectTab={setActiveTab} />
        </div>
    );
};

export default App;
