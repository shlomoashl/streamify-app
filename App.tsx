
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { SpeechRecognition } from '@capacitor-community/speech-recognition';
import { KeepAwake } from '@capacitor-community/keep-awake';
import { CapacitorUpdater } from '@capgo/capacitor-updater';
import { Network } from '@capacitor/network';
import { App as CapacitorApp } from '@capacitor/app';
import { 
    User, Playlist, PlaylistItem, YouTubeSearchResult, 
    PlayerState, ViewState, YouTubeDownloadResponse, Folder, LibraryData, StreamifyMediaPlugin, LastPlayedInfo
} from './types';
import { LIBRARY_API_BASE, YOUTUBE_API_BASE, SPOTIFY_WS_URL, SERVER_PUBLIC_URL } from './constants';
import { 
    HomeIcon, SearchIcon, LibraryIcon, PlusIcon, PlayIcon, PauseIcon, MusicIcon, 
    ShuffleIcon, LogOutIcon, SpotifyIcon, AlbumIcon, ArtistIcon, PlaylistIcon,
    HeartIcon, FolderIcon, FolderPlusIcon, ChevronDownIcon, ChevronLeftIcon,
    TerminalIcon, PodcastIcon, GridIcon, ListIcon, LoaderIcon, ShareIcon, UsersIcon, TrashIcon, XIcon, EditIcon, ClockIcon, RefreshCcwIcon, MicIcon
} from './components/Icons';
import Player from './components/Player';
import TitleBar from './components/TitleBar';
import { audioService } from './AudioService';
import { logger } from './Logger';
import LogViewer from './components/LogViewer';
import { storageService } from './StorageService';

const StreamifyMedia = registerPlugin<StreamifyMediaPlugin>('StreamifyMedia');
// --- קבועים והגדרות מערכת ---
const STREAMIFY_KEYWORDS = [
    'אברהם פריד', 
    'יעקב שוואקי', 
    'מרדכי בן דוד', 
    'נפתלי קמפה', 
    'brian tyler', 
    'ישי ריבו', 
    'שמוליק סוכות',
    'קובי ברומר',
    'חיים ישראל',
    'בנצי שטיין',
    'יידל ורדיגר',
    'משה פלד',
    'פיני איינהורן',
    'ארי היל',
    'עקיבא',
    'הראל טל',
    'שירים חסידיים', 
    'פלייליסט חסידי'
];
// --- Utilities ---

const parseDurationToSeconds = (dur: string | number): number => {
    if (typeof dur === 'number') return dur;
    if (!dur) return 0;
    const parts = dur.split(':').map(Number);
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    return 0;
};

const formatDuration = (seconds: number) => {
    if (!seconds || isNaN(seconds)) return "0:00";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
};

// Better Shuffle Algorithm (Fisher-Yates)
// Spotify-Style Balanced Shuffle Algorithm
const shuffleArray = (array: PlaylistItem[]): PlaylistItem[] => {
    if (array.length <= 2) return [...array]; // No need to balance tiny lists

    // 1. Group songs by Author/Artist
    const authorGroups = new Map<string, PlaylistItem[]>();
    for (const song of array) {
        const author = song.author || 'Unknown';
        if (!authorGroups.has(author)) {
            authorGroups.set(author, []);
        }
        authorGroups.get(author)!.push(song);
    }

    // 2. Shuffle songs within each group (using Fisher-Yates)
    for (const [author, songs] of authorGroups.entries()) {
        for (let i = songs.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [songs[i], songs[j]] = [songs[j], songs[i]];
        }
    }

    // 3. Build a sorted array of groups (largest groups first)
    const groups = Array.from(authorGroups.values()).sort((a, b) => b.length - a.length);
    const result: PlaylistItem[] = new Array(array.length);
    let resultIndex = 0;

    // 4. Distribute songs evenly across the result array
    for (const group of groups) {
        // Calculate the spacing required to spread this group's songs as far apart as possible
        const spacing = array.length / group.length; 
        
        for (let i = 0; i < group.length; i++) {
            // Find the next available empty slot, starting from the calculated spread position
            let targetIndex = Math.floor(i * spacing) + (resultIndex % Math.floor(spacing || 1)); // Add slight offset per group
            
            // Wrap around and find actual empty slot
            while (result[targetIndex % array.length] !== undefined) {
                targetIndex++;
            }
            
            result[targetIndex % array.length] = group[i];
        }
        resultIndex++;
    }

    // 5. Final fallback pass: Filter out any undefined (shouldn't happen with correct logic, but safe)
    return result.filter(item => item !== undefined);
};

const searchResultToPlaylistItem = (result: YouTubeSearchResult, source: string = 'search'): PlaylistItem => ({
    id: result.id, // משתמשים ב-ID המקורי בלבד
    title: result.title,
    author: result.author || result.channel || '',
    duration: parseDurationToSeconds(result.duration),
    thumbnail: result.thumbnail || result.thumbnail_url || '',
    addedBy: source,
    addedAt: new Date().toISOString()
});

// --- Independent Components ---

interface PlaylistComponentProps {
    playlist: Playlist;
    onSelect: (playlist: Playlist) => void;
    onTogglePlay: (playlist: Playlist) => void;
    isPlaying: boolean;
    onContextMenu: (e: React.MouseEvent | React.TouchEvent, playlist: Playlist) => void;
}

const PlaylistSquare: React.FC<PlaylistComponentProps> = React.memo(({ playlist, onSelect, onTogglePlay, isPlaying, onContextMenu }) => {
    const longPressTimer = useRef<any>(null);
    const isLongPress = useRef(false);

    const handleTouchStart = () => {
        isLongPress.current = false;
        longPressTimer.current = setTimeout(() => { isLongPress.current = true; }, 500);
    };

    const handleTouchEnd = () => clearTimeout(longPressTimer.current);

    return (
        <div
            onClick={() => { if (!isLongPress.current) onSelect(playlist); }}
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
            onTouchMove={handleTouchEnd}
            onContextMenu={(e) => {
                e.preventDefault();
                clearTimeout(longPressTimer.current);
                onContextMenu(e, playlist);
            }}
            className="bg-white/5 p-3 rounded hover:bg-white/10 cursor-pointer transition active:scale-95 group select-none relative"
        >
            <div className="relative">
                <div className="aspect-square bg-neutral-800 rounded mb-2 flex items-center justify-center text-gray-200 pointer-events-none">
                    {playlist.externalType === 'artist' ? <ArtistIcon className="w-10 h-10"/> :
                     playlist.externalType === 'album' ? <AlbumIcon className="w-10 h-10"/> :
                     playlist.externalType === 'podcast' ? <PodcastIcon className="w-10 h-10"/> :
                     <PlaylistIcon className="w-10 h-10" />}
                </div>
            </div>
            <div className="flex items-center justify-between gap-2">
                <div className="font-bold truncate text-sm pointer-events-none flex-1">
                    {playlist.name}
                    {playlist.externalId && <span className="text-[10px] text-green-500 block">חיצוני</span>}
                </div>
                {(playlist.songs.length > 0 || playlist.externalId) && (
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            onTogglePlay(playlist);
                        }}
                        className={`p-2 rounded-full shadow-lg transition-transform duration-200 ease-in-out hover:scale-110 flex-shrink-0 ${isPlaying ? 'bg-spotify-primary text-black' : 'bg-spotify-primary text-black'}`}
                    >
                        {isPlaying ? <PauseIcon className="w-4 h-4" fill /> : <PlayIcon className="w-4 h-4" fill />}
                    </button>
                )}
            </div>
        </div>
    );
});

const PlaylistRow: React.FC<PlaylistComponentProps> = React.memo(({ playlist, onSelect, onTogglePlay, isPlaying, onContextMenu }) => {
    const longPressTimer = useRef<any>(null);
    const isLongPress = useRef(false);

    const handleTouchStart = () => {
        isLongPress.current = false;
        longPressTimer.current = setTimeout(() => { isLongPress.current = true; }, 500);
    };

    const handleTouchEnd = () => clearTimeout(longPressTimer.current);

    return (
        <div
            onClick={() => { if (!isLongPress.current) onSelect(playlist); }}
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
            onTouchMove={handleTouchEnd}
            onContextMenu={(e) => {
                e.preventDefault();
                clearTimeout(longPressTimer.current);
                onContextMenu(e, playlist);
            }}
            className="bg-white/5 p-2 rounded hover:bg-white/10 cursor-pointer transition flex items-center gap-3 group select-none"
        >
            <div className="w-10 h-10 bg-neutral-800 rounded flex-shrink-0 flex items-center justify-center text-gray-200 pointer-events-none">
                {playlist.externalType === 'artist' ? <ArtistIcon className="w-5 h-5"/> :
                 playlist.externalType === 'album' ? <AlbumIcon className="w-5 h-5"/> :
                 playlist.externalType === 'podcast' ? <PodcastIcon className="w-5 h-5"/> :
                 <PlaylistIcon className="w-5 h-5" />}
            </div>
            <div className="min-w-0 flex-1">
                <div className="font-bold truncate text-sm pointer-events-none">{playlist.name}</div>
                {playlist.externalId && <div className="text-[10px] text-green-500">נשמר מהרשת</div>}
            </div>
            {(playlist.songs.length > 0 || playlist.externalId) && (
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        onTogglePlay(playlist);
                    }}
                    className={`p-2 rounded-full shadow-lg transition-transform duration-200 ease-in-out hover:scale-110 mr-2 ${isPlaying ? 'bg-spotify-primary text-black' : 'bg-spotify-primary text-black'}`}
                >
                    {isPlaying ? <PauseIcon className="w-5 h-5" fill /> : <PlayIcon className="w-5 h-5" fill />}
                </button>
            )}
        </div>
    );
});

// --- Main Component ---

const App: React.FC = () => {
    const isDesktop = !Capacitor.isNativePlatform();
    const SECRET_ENTRY_CODE = import.meta.env.VITE_APP_ENTRY_CODE || '1234321';

    // Init state with empty/default, then load async
    const [currentUser, setCurrentUser] = useState<User | null>(null);
    const [activeTab, setActiveTab] = useState<ViewState>('home');
    const [prevTab, setPrevTab] = useState<ViewState>('home');

    // מאזין חכם שמזהה החלפת טאבים וזוכר תמיד את הטאב האחרון (שהוא לא פלייליסט)
    useEffect(() => {
        if (activeTab !== 'playlist') {
            setPrevTab(activeTab);
        }
    }, [activeTab]);
    const [streamifyResults, setStreamifyResults] = useState<YouTubeSearchResult[]>([]);
    const [isLoadingStreamify, setIsLoadingStreamify] = useState(false);
    const [playlists, setPlaylists] = useState<Playlist[]>([]);
    const [folders, setFolders] = useState<Folder[]>([]);
    const [likedSongsPlaylist, setLikedSongsPlaylist] = useState<Playlist | null>(null);
    
    // UI States
    const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
    const [expandedHomeFolders, setExpandedHomeFolders] = useState<Set<string>>(new Set());
    const [showLogs, setShowLogs] = useState(false);
    const [globalLoading, setGlobalLoading] = useState<string | null>(null);
    const [isAppReady, setIsAppReady] = useState(false); // To prevent UI flashing before async load
    const [updateAvailable, setUpdateAvailable] = useState(false);
    const wasPlayingRef = useRef(false); // Track playback state across network/app interruptions
    const [isListening, setIsListening] = useState(false);
    const [confirmModal, setConfirmModal] = useState<{
        isOpen: boolean;
        title: string;
        message?: string;
        onConfirm: () => void;
        isAlertOnly?: boolean;
    }>({ isOpen: false, title: '', onConfirm: () => {} });

    const [libraryLoaded, setLibraryLoaded] = useState(false);
    const stateLoadedRef = useRef(false); // Ref to track if initial player state has been loaded
    
    const [playingPlaylistId, setPlayingPlaylistId] = useState<string | null>(null);

    const [inputModal, setInputModal] = useState<{
        isOpen: boolean;
        title: string;
        defaultValue: string;
        onConfirm: (val: string) => void;
    }>({ isOpen: false, title: '', defaultValue: '', onConfirm: () => {} });
    const [inputModalValue, setInputModalValue] = useState('');
    
    const [bulkImportState, setBulkImportState] = useState<{
        isOpen: boolean;
        item: YouTubeSearchResult | null;
        tracks: PlaylistItem[];
        targetPlaylistId?: string;
        mode: 'select_action' | 'input_name' | 'confirm_simple';
    }>({ isOpen: false, item: null, tracks: [], mode: 'select_action' });

    const [manageUsersState, setManageUsersState] = useState<{
        isOpen: boolean;
        playlist: Playlist | null;
    }>({ isOpen: false, playlist: null });

    const [selectedPlaylist, setSelectedPlaylist] = useState<Playlist | null>(null);
    const [playlistDisplayLimit, setPlaylistDisplayLimit] = useState(30);
    const observerTarget = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const observer = new IntersectionObserver(
            (entries) => {
                // ברגע שהלקוח גלל למטה ורואה את האלמנט השקוף - נטען עוד 30 שירים
                if (entries[0].isIntersecting && selectedPlaylist && playlistDisplayLimit < selectedPlaylist.songs.length) {
                    setPlaylistDisplayLimit(prev => prev + 30);
                }
            },
            { threshold: 0.1 }
        );

        if (observerTarget.current) {
            observer.observe(observerTarget.current);
        }

        return () => observer.disconnect();
    }, [selectedPlaylist, playlistDisplayLimit]); // הוספנו מגבלת תצוגה
    
    const [playlistViewMode, setPlaylistViewMode] = useState<'grid' | 'list'>('grid');

    const savedShuffle = localStorage.getItem('streamify_shuffle') === 'true';
    const [playerState, setPlayerState] = useState<PlayerState>({
        isOpen: false,
        isPlaying: false,
        currentSong: null,
        queue: [],
        currentIndex: 0,
        isShuffled: savedShuffle, // לוקח מהזיכרון
        isExpanded: false
    });

    const audioInitializedRef = useRef(false);
    const skipLockRef = useRef(false);
    // --- ניהול זמן לדילוג שקט (Resume Playback) ---
    const currentTimeRef = useRef<number>(0);
    const unmuteSafetyTimerRef = useRef<any>(null);
    const initialSeekTimeRef = useRef<number>(0);
    const latestPlayerStateRef = useRef(playerState);
    const latestPlaylistIdRef = useRef(playingPlaylistId);

    // שומר עותק מעודכן של הסטייט עבור מאזיני הרקע (כמו סגירת אפליקציה)
    useEffect(() => {
        latestPlayerStateRef.current = playerState;
        latestPlaylistIdRef.current = playingPlaylistId;
    }, [playerState, playingPlaylistId]);

    const silenceTimeoutRef = useRef<any>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState<YouTubeSearchResult[]>([]);
    const [isSearching, setIsSearching] = useState(false);
    const [searchSuggestions, setSearchSuggestions] = useState<string[]>([]);
    const [showSuggestions, setShowSuggestions] = useState(false);
    const [focusedSuggestionIndex, setFocusedSuggestionIndex] = useState<number>(-1);
    const [searchHistory, setSearchHistory] = useState<string[]>([]);
    
    // AbortController for canceling previous searches
    const searchAbortController = useRef<AbortController | null>(null);
    const searchTimeoutRef = useRef<any>(null);

    const [ytMusicFilter, setYtMusicFilter] = useState<'all' | 'songs' | 'albums' | 'artists' | 'playlists' | 'podcasts'>('all');
    
    const [playlistSearchQuery, setPlaylistSearchQuery] = useState('');
    const [playlistSearchResults, setPlaylistSearchResults] = useState<YouTubeSearchResult[]>([]);
    const [isPlaylistSearching, setIsPlaylistSearching] = useState(false);

    const [showPlaylistSelector, setShowPlaylistSelector] = useState(false);
    const [songsToAdd, setSongsToAdd] = useState<PlaylistItem[]>([]);
    
    const [emailInput, setEmailInput] = useState('');
    const [entryCodeInput, setEntryCodeInput] = useState('');
    const [networkError, setNetworkError] = useState<string | null>(null);
    const [isOnline, setIsOnline] = useState(navigator.onLine);
    const prevOnlineStatus = useRef(isOnline);

    const [contextMenu, setContextMenu] = useState<{ x: number, y: number, item: Playlist | Folder } | null>(null);
    const [moveToFolderState, setMoveToFolderState] = useState<{ visible: boolean, playlistId: string | null }>({ visible: false, playlistId: null });

    const longPressTimer = useRef<any>(null);
    const isLongPressRef = useRef(false);
    const wasPlayingBeforeOffline = useRef(false);
    
    const spotifyWsRef = useRef<WebSocket | null>(null);
    const autoPlayStartedRef = useRef(false);
    // ==========================================
    // מנהל כפתור החזור המרכזי (Android / Multimedia)
    // ==========================================
    
    // 1. אוגר את כל המצבים הנוכחיים באפליקציה כדי שהמאזין יקבל את המידע העדכני ביותר
    const appStateRef = useRef({
        confirmModalOpen: confirmModal.isOpen,
        inputModalOpen: inputModal.isOpen,
        bulkImportOpen: bulkImportState.isOpen,
        manageUsersOpen: manageUsersState.isOpen,
        playlistSelectorOpen: showPlaylistSelector,
        moveToFolderOpen: moveToFolderState.visible,
        contextMenuOpen: !!contextMenu,
        showLogs: showLogs,
        playerExpanded: playerState.isExpanded,
        activeTab: activeTab,
        selectedPlaylist: selectedPlaylist,
        prevTab: prevTab
    });

    // 2. מעדכן את האוגר בכל פעם שמשהו משתנה במסך
    useEffect(() => {
        appStateRef.current = {
            confirmModalOpen: confirmModal.isOpen,
            inputModalOpen: inputModal.isOpen,
            bulkImportOpen: bulkImportState.isOpen,
            manageUsersOpen: manageUsersState.isOpen,
            playlistSelectorOpen: showPlaylistSelector,
            moveToFolderOpen: moveToFolderState.visible,
            contextMenuOpen: !!contextMenu,
            showLogs: showLogs,
            playerExpanded: playerState.isExpanded,
            activeTab: activeTab,
            selectedPlaylist: selectedPlaylist,
            prevTab: prevTab
        };
    }, [
        confirmModal.isOpen, inputModal.isOpen, bulkImportState.isOpen, manageUsersState.isOpen, 
        showPlaylistSelector, moveToFolderState.visible, contextMenu, showLogs, 
        playerState.isExpanded, activeTab, selectedPlaylist
    ]);

    // 3. המאזין עצמו לכפתור החזור הפיזי
    useEffect(() => {
        if (!Capacitor.isNativePlatform()) return;

        const handleBackButton = () => {
            const state = appStateRef.current;

            // עדיפות 1: סגירת מודלים וחלונות קופצים
            if (state.confirmModalOpen) { setConfirmModal(prev => ({...prev, isOpen: false})); return; }
            if (state.inputModalOpen) { setInputModal(prev => ({...prev, isOpen: false})); return; }
            if (state.bulkImportOpen) { setBulkImportState(prev => ({...prev, isOpen: false})); return; }
            if (state.manageUsersOpen) { setManageUsersState({isOpen: false, playlist: null}); return; }
            if (state.playlistSelectorOpen) { setShowPlaylistSelector(false); return; }
            if (state.moveToFolderOpen) { setMoveToFolderState({visible: false, playlistId: null}); return; }

            // עדיפות 2: סגירת תפריטים ולוגים
            if (state.contextMenuOpen) { setContextMenu(null); return; }
            if (state.showLogs) { setShowLogs(false); return; }

            // עדיפות 3: מזעור הנגן אם הוא פתוח על מסך מלא
            if (state.playerExpanded) { setPlayerState(prev => ({...prev, isExpanded: false})); return; }

            // עדיפות 4: ניווט טאבים (דפים)
            // עדיפות 4: ניווט טאבים (דפים) - חוזר בדיוק למקום ממנו הגעת
            if (state.activeTab === 'playlist') {
                setActiveTab(state.prevTab);
                return;
            }

            if (state.activeTab === 'search' || state.activeTab === 'library' || state.activeTab === 'streamify') {
                setActiveTab('home');
                return;
            }

            // עדיפות 5: יציאה מהאפליקציה (אם אנחנו בדף הבית ושום דבר אחר לא פתוח)
            if (state.activeTab === 'home') {
                CapacitorApp.exitApp();
            }
        };

        // רישום המאזין
        const listenerPromise = CapacitorApp.addListener('backButton', handleBackButton);

        // ניקוי המאזין בסגירה כדי למנוע דליפות זיכרון
        return () => {
            listenerPromise.then(listener => listener.remove());
        };
    }, []);

    // בודק בשקט מול הגיטהאב אם יש עדכון חדש זמין
    useEffect(() => {
        const checkUpdateAvailability = async () => {
            if (!Capacitor.isNativePlatform()) return; // רלוונטי רק לאנדרואיד
            try {
                const res = await fetch(`https://api.github.com/repos/shlomoashl/streamify-app/releases/tags/latest-build?t=${new Date().getTime()}`);
                if (!res.ok) return;
                
                const data = await res.json();
                const updateAsset = data.assets?.find((a: any) => a.name === 'update.zip');
                
                if (updateAsset) {
                    // לוקח את תאריך העלאת הקובץ לגיטהאב והופך אותו למספר
                    const serverDate = new Date(updateAsset.updated_at).getTime();
                    // בודק מתי הלקוח עדכן בפעם האחרונה
                    const localDateStr = localStorage.getItem('streamify_app_version_date');
                    const localDate = localDateStr ? parseInt(localDateStr, 10) : 0;
                    
                    // אם הקובץ בענן חדש יותר ממה שיש ללקוח - מדליק את החיווי!
                    if (serverDate > localDate) {
                        setUpdateAvailable(true);
                    }
                }
            } catch (e) {
                console.error("Failed to check for updates silently", e);
            }
        };

        if (isAppReady) {
            checkUpdateAvailability();
        }
    }, [isAppReady]);    
    // --- LOAD INITIAL DATA (ASYNC) ---
    useEffect(() => {
        const initApp = async () => {
            try {
                // User
                const savedEmail = await storageService.loadData<string>('streamify_user_email', '');
                if (savedEmail) {
                    setCurrentUser({ email: savedEmail, permissions: [], playlistPermission: 'edit' });
                }

                // Library
                const savedPlaylists = await storageService.loadData<Playlist[]>('streamify_cache_playlists', []);
                const savedFolders = await storageService.loadData<Folder[]>('streamify_cache_folders', []);
                const savedLiked = await storageService.loadData<Playlist | null>('streamify_cache_liked', null);
                const savedStreamify = await storageService.loadData<any>('streamify_recommended', []);
                if (savedStreamify) setStreamifyResults(savedStreamify);
                
                setPlaylists(savedPlaylists);
                setFolders(savedFolders);
                setLikedSongsPlaylist(savedLiked);

                // Settings
                const savedViewMode = await storageService.loadData<string>('streamify_playlist_view_mode', 'grid');
                setPlaylistViewMode((savedViewMode === 'list' || savedViewMode === 'grid') ? savedViewMode : 'grid');

                // Search History - LOAD
                const savedHistory = await storageService.loadData<string[]>('streamify_search_history', []);
                setSearchHistory(savedHistory || []);

                // Load saved player state early to get shuffle preference
                const savedPlayerState = await storageService.loadData<any>('streamify_player_state', null);
                const savedIsShuffled = savedPlayerState?.isShuffled || false;
                // משיכת השנייה המדויקת שבה הלקוח עצר
                if (savedPlayerState?.savedTime) {
                    initialSeekTimeRef.current = savedPlayerState.savedTime;
                }

                // Player State - HYBRID STRATEGY
                // 1. Try to get real-time state from Native (if available) - this is the "Source of Truth" for what actually played last
                let nativeStateLoaded = false;
                if (Capacitor.isNativePlatform()) {
                    try {
                        const lastNative = await StreamifyMedia.getLastPlayedInfo() as LastPlayedInfo;
                        if (lastNative && lastNative.id) {
                            console.log("Restoring state from Native Service:", lastNative);
                            const nativeSong: PlaylistItem = {
                                id: lastNative.id,
                                title: lastNative.title || 'Unknown',
                                author: lastNative.artist || 'Unknown',
                                thumbnail: lastNative.artwork || '',
                                duration: 0, // Duration updates automatically when loaded
                                addedBy: 'system',
                                addedAt: new Date().toISOString()
                            };
                            
                            // CONTEXT RESTORATION LOGIC
                            // FIXED: Restore the FULL queue from the saved playlist if contextId is present
                            let restoredQueue = [nativeSong];
                            let restoredIndex = 0;
                            let restoredPlaylistId: string | null = null;
                            let originalQueueForState: PlaylistItem[] | undefined = undefined;

                            if (lastNative.contextId) {
                                restoredPlaylistId = lastNative.contextId;
                                
                                // 1. מחפשים קודם בספרייה השמורה (עבור פלייליסטים קבועים)
                                const playlist = savedPlaylists.find(p => p.id === lastNative.contextId);
                                
                                if (playlist && playlist.songs.length > 0) {
                                    console.log("Restoring queue from Saved Library:", playlist.name);
                                    let baseQueue = playlist.songs;
                                    
                                    if (savedPlayerState && savedPlayerState.playingPlaylistId === restoredPlaylistId) {
                                        if (savedIsShuffled && savedPlayerState.originalQueue && savedPlayerState.queue) {
                                            restoredQueue = savedPlayerState.queue;
                                            originalQueueForState = savedPlayerState.originalQueue;
                                        } else {
                                            restoredQueue = baseQueue;
                                        }
                                    } else {
                                        restoredQueue = baseQueue;
                                        if (savedIsShuffled) {
                                            originalQueueForState = [...baseQueue];
                                            restoredQueue = shuffleArray([...baseQueue]);
                                        }
                                    }
                                } 
                                // 2. פתרון באג 2: אם זה חיפוש (ID שמתחיל ב-temp), משחזרים מה-JS Cache
                                else if (savedPlayerState && savedPlayerState.queue && savedPlayerState.queue.length > 0) {
                                    console.log("Restoring context for Search/Temp playlist from JS Cache");
                                    restoredQueue = savedPlayerState.queue;
                                    originalQueueForState = savedPlayerState.originalQueue;
                                }
                                
                                // 3. פתרון באג 1: מציאת השיר המלא בתוך התור ששוחזר
                                const songIndex = restoredQueue.findIndex(s => s.id === lastNative.id);
                                if (songIndex !== -1) {
                                    restoredIndex = songIndex;
                                    
                                    // אנחנו לוקחים את השיר המלא מהתור ולא רק את ה-ID מה-Native
                                    const fullSongData = restoredQueue[songIndex];
                                    nativeSong = {
                                        ...fullSongData,
                                        id: lastNative.id // מוודאים שה-ID נשמר
                                    };
                                    
                                    console.log(`Successfully restored full metadata for: ${nativeSong.title}`);
                                } else {
                                    // פולבק אם השיר לא נמצא בתור
                                    restoredQueue = [nativeSong];
                                }
                            }

                            
                            setPlayingPlaylistId(restoredPlaylistId);
                            setPlayerState({
                                isOpen: true,
                                isPlaying: false, // Start paused
                                currentSong: nativeSong,
                                queue: restoredQueue,
                                currentIndex: restoredIndex,
                                isShuffled: savedIsShuffled, // <-- משתמשים במשתנה שחילצנו בתחילת הפונקציה!
                                isExpanded: false,
                                originalQueue: originalQueueForState
                            });
                            nativeStateLoaded = true;
                        }
                    } catch (e) {
                        console.warn("Failed to get native last played info:", e);
                    }
                }

                // 2. Fallback to JS Cache if native didn't provide info
                if (!nativeStateLoaded) {
                    if (savedPlayerState) {
                        setPlayingPlaylistId(savedPlayerState.playingPlaylistId || null);
                        setPlayerState({ 
                            ...savedPlayerState, 
                            isPlaying: false, 
                            isOpen: !!savedPlayerState.currentSong 
                        });
                        // if (savedPlayerState.currentSong?.duration) {
                        //     setDuration(savedPlayerState.currentSong.duration);
                        // }
                    }
                }
                
                // Mark state as loaded to allow saving updates
                stateLoadedRef.current = true;

                // Last selected playlist
                const lastPlaylist = await storageService.loadData<Playlist | null>('streamify_last_playlist', null);
                if (lastPlaylist) setSelectedPlaylist(lastPlaylist);

                setIsAppReady(true);
                if (Capacitor.isNativePlatform()) {
                    CapacitorUpdater.notifyAppReady();
                }                
            } catch (e) {
                console.error("Initialization failed:", e);
                stateLoadedRef.current = true; // Allow saving even if load failed, to recover eventually
                setIsAppReady(true); 
                if (Capacitor.isNativePlatform()) {
                    CapacitorUpdater.notifyAppReady();
                }                
טט            }
        };
        initApp();
    }, []);

    // --- Helper Functions to Update Local & Cache ---
    const loadStreamifyRecommendations = async (forceRefresh = false) => {
        // אם לא ביקשנו רענון חובה ויש כבר נתונים (מהזיכרון) - אל תחפש שוב
        if (!forceRefresh && streamifyResults.length > 0) return;
        
        setIsLoadingStreamify(true);
        
        try {
            // שימוש ברשימה הגלובלית שמוגדרת למעלה בראש הקובץ
            const fetchPromises = STREAMIFY_KEYWORDS.map(async (kw) => {
                const params = new URLSearchParams({ action: 'search_and_download_video', query: kw + ' mix', search_engine: 'youtubemusic_playlists' });
                const res = await fetch(`${YOUTUBE_API_BASE}?${params.toString()}`);
                const data = await res.json();
                
                if (data.success && data.results) {
                    return data.results.slice(0, 5); // לוקח רק את ה-5 הראשונים מכל מילה
                }
                return [];
            });

            // ממתין שכל התשובות יחזרו במקביל
            const resultsArrays = await Promise.all(fetchPromises);
            
            // הופך את כל הרשימות הקטנות לרשימה אחת ארוכה משוטחת
            let allResults = resultsArrays.flat();
            
            // מערבב את הרשימה (Shuffle)
            for (let i = allResults.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [allResults[i], allResults[j]] = [allResults[j], allResults[i]];
            }
            
            setStreamifyResults(allResults);
            storageService.saveData('streamify_recommended', allResults); // שומר לזיכרון
        } catch (e) {
            console.error("Failed to load streamify recommendations", e);
        } finally {
            setIsLoadingStreamify(false);
        }
    };

    // יפעיל את הטעינה כשלוחצים על הטאב אם הוא ריק
    useEffect(() => {
        if (activeTab === 'streamify') {
            loadStreamifyRecommendations();
        }
    }, [activeTab]);

    const updatePlaylistsLocally = (newPlaylists: Playlist[]) => {
        setPlaylists(newPlaylists);
        storageService.saveData('streamify_cache_playlists', newPlaylists);
        
        // Also update selected playlist if active
        if (selectedPlaylist) {
            const updated = newPlaylists.find(p => p.id === selectedPlaylist.id);
            if (updated) setSelectedPlaylist(updated);
        }

        // Also update liked playlist
        if (currentUser) {
            const liked = newPlaylists.find(p => p.isLikedSongs && p.creator === currentUser.email);
            if (liked) {
                setLikedSongsPlaylist(liked);
                storageService.saveData('streamify_cache_liked', liked);
            }
        }
    };

    const updateFoldersLocally = (newFolders: Folder[]) => {
        setFolders(newFolders);
        storageService.saveData('streamify_cache_folders', newFolders);
    };

    const addToSearchHistory = (term: string) => {
        if (!term || !term.trim()) return;
        const trimmed = term.trim();
        setSearchHistory(prev => {
            const filtered = prev.filter(t => t !== trimmed);
            const newHistory = [trimmed, ...filtered].slice(0, 15); // Keep last 15 items
            storageService.saveData('streamify_search_history', newHistory);
            return newHistory;
        });
    };
    
    const removeSearchHistoryItem = (term: string) => {
        setSearchHistory(prev => {
            const newHistory = prev.filter(t => t !== term);
            storageService.saveData('streamify_search_history', newHistory);
            return newHistory;
        });
    };
    
    const clearSearchHistory = () => {
        setSearchHistory([]);
        storageService.saveData('streamify_search_history', []);
    };

    // --- Initialization & Hooks ---

    useEffect(() => {
        // Save view mode whenever it changes
        if (stateLoadedRef.current) {
            storageService.saveData('streamify_playlist_view_mode', playlistViewMode);
        }
    }, [playlistViewMode]);

    // שמירה אוטומטית של מצב הנגן לזיכרון המקומי בכל פעם שהשיר, התור או השאפל משתנים
    const saveStateToStorage = (state: PlayerState, currentPlaylistId: string | null, currentTimeVal: number) => {
        if (!stateLoadedRef.current) return;
        
        // כאן אנחנו כבר לא שמים 0, אלא את הזמן האמיתי שנשלח
        const stateToSave = { ...state, savedTime: currentTimeVal, playingPlaylistId: currentPlaylistId };
        delete (stateToSave as any).originalQueue;
        storageService.saveData('streamify_player_state', stateToSave);
    };

    // 1. שמירה בעת החלפת שיר (מאפס את הזמן)
    useEffect(() => {
        if (stateLoadedRef.current && playerState.currentSong) {
            saveStateToStorage(playerState, playingPlaylistId, 0);
        }
    }, [playerState.currentSong?.id, playerState.currentIndex, playerState.isShuffled, playingPlaylistId]);

    // 2. שמירה מחזורית כל 10 שניות למניעת איבוד התקדמות
    useEffect(() => {
        const interval = setInterval(() => {
            if (playerState.isPlaying && stateLoadedRef.current && playerState.currentSong) {
                saveStateToStorage(playerState, playingPlaylistId, currentTimeRef.current);
            }
        }, 10000);
        return () => clearInterval(interval);
    }, [playerState, playingPlaylistId]);

    const triggerAutoPlay = async () => {
        if (audioInitializedRef.current) return;
        if (!playerState.currentSong) return;
        console.log(`Auto-play attempt...`);
        try {
            // אם אנחנו יודעים שהולך להיות דילוג, משתיקים את הנגן מראש ומפעילים טיימר ביטחון
            if (initialSeekTimeRef.current > 0) {
                audioService.setVolume(0);
                unmuteSafetyTimerRef.current = setTimeout(() => audioService.setVolume(1), 3500);
            }

            setPlayerState(prev => ({ ...prev, isPlaying: true }));
            await audioService.playQueue(playerState.queue, playerState.currentIndex, playingPlaylistId || undefined);
            
            audioInitializedRef.current = true;
        } catch (e) {
            console.error(`Auto-play failed:`, e);
            setPlayerState(prev => ({ ...prev, isPlaying: false }));
        }
    };

    useEffect(() => {
        // Fast-Track Autoplay: לא מחכים יותר לסנכרון הספרייה הכבד!
        // מתחילים לנגן מיד ברגע שיש חיבור רשת בסיסי (isOnline) ויש שיר בזיכרון.
        if (currentUser && isAppReady && isOnline && playerState.currentSong && !audioInitializedRef.current && !autoPlayStartedRef.current) {
            autoPlayStartedRef.current = true;
            console.log("Fast Auto-play: Starting immediately based on cached state + Network!");
            
            // נותנים השהייה של שנייה אחת בלבד כדי לתת לחיבור ה-4G של האוטו להתייצב 
            // לפני שמושכים את השיר מיוטיוב
            const timer = setTimeout(() => { triggerAutoPlay(); }, 1000);
            return () => clearTimeout(timer);
        }
    }, [currentUser, isAppReady, isOnline, playerState.currentSong]);


    useEffect(() => {
        if (isOnline && !prevOnlineStatus.current) {
            console.log("Network connection restored. Syncing library...");
            setNetworkError(null);
            if (currentUser) fetchLibrary(); // רק מסנכרן ספרייה, הניגון מנוהל ב-Capacitor
        }
        prevOnlineStatus.current = isOnline;
    }, [isOnline, currentUser]);

    useEffect(() => {
        if (selectedPlaylist && !selectedPlaylist.id.startsWith('temp-')) {
            storageService.saveData('streamify_last_playlist', selectedPlaylist);
        }
        setPlaylistSearchQuery('');
        setPlaylistSearchResults([]);
        setPlaylistDisplayLimit(30); // מאפסים את הרשימה ל-30 בכל פעם שנכנסים לפלייליסט
    }, [selectedPlaylist?.id]);


    // --- GRANULAR API FUNCTIONS ---

    const fetchLibrary = async (isSilentRetry = false) => {
        if (!currentUser) return;
        try {
            // New Endpoint: /api/library/sync
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000);
            const res = await fetch(`${LIBRARY_API_BASE}/sync?t=${Date.now()}`, { signal: controller.signal });
            clearTimeout(timeoutId);
            
            if (!res.ok) throw new Error("Network response not ok");
            const data: LibraryData = await res.json();
            
            const allPlaylists = data.playlists || [];
            const allFolders = data.folders || [];

            const userPlaylists = allPlaylists.filter(p => p.creator === currentUser.email || p.allowedUsers?.includes(currentUser.email));
            const userFolders = allFolders.filter(f => f.creator === currentUser.email);

            let likedPlaylist = userPlaylists.find(p => p.isLikedSongs && p.creator === currentUser.email);
            
            // Generate local liked playlist if missing (and assume backend will sync eventually)
            if (!likedPlaylist) {
                likedPlaylist = {
                    id: `liked_songs_${currentUser.email.replace(/[@.]/g, '_')}`,
                    name: 'שירים שאהבתם',
                    creator: currentUser.email,
                    isPublic: false,
                    songs: [],
                    isLikedSongs: true,
                };
                userPlaylists.push(likedPlaylist);
            }

            // Sync with local Storage (Cache)
            setPlaylists(userPlaylists);
            setFolders(userFolders);
            setLikedSongsPlaylist(likedPlaylist);
            
            storageService.saveData('streamify_cache_playlists', userPlaylists);
            storageService.saveData('streamify_cache_folders', userFolders);
            storageService.saveData('streamify_cache_liked', likedPlaylist);
            
            setNetworkError(null);
            setLibraryLoaded(true);
        } catch(e) {
            setNetworkError('שגיאה בטעינת נתונים - מנסה להתחבר מחדש...');
        } 
    };

    useEffect(() => { if (currentUser) fetchLibrary(); }, [currentUser]);

    const apiCreatePlaylist = async (name: string): Promise<Playlist | null> => {
        if (!currentUser || !name.trim()) return null;
        setGlobalLoading("יוצר פלייליסט...");
        
        const tempId = crypto.randomUUID();
        const newPlaylist: Playlist = {
            id: tempId, name: name, creator: currentUser.email,
            isPublic: false, songs: []
        };

        // Optimistic Update using functional update to be safe
        setPlaylists(prev => {
            const updated = [...prev, newPlaylist];
            storageService.saveData('streamify_cache_playlists', updated);
            return updated;
        });
        
        setShowPlaylistSelector(false);

        try {
            const res = await fetch(`${LIBRARY_API_BASE}/playlist/create`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, creator: currentUser.email, id: tempId })
            });
            if (!res.ok) throw new Error("Create failed");
            return newPlaylist;
        } catch (e) {
            // Revert
            setPlaylists(prev => {
                const updated = prev.filter(p => p.id !== tempId);
                storageService.saveData('streamify_cache_playlists', updated);
                return updated;
            });
            setConfirmModal({ isOpen: true, title: "שגיאה", message: "נכשל ביצירת פלייליסט", onConfirm: () => setConfirmModal(prev => ({...prev, isOpen: false})), isAlertOnly: true });
            return null;
        } finally {
            setGlobalLoading(null);
        }
    };
    
    // NEW: Save External Playlist (Reference)
    const apiSaveExternalPlaylist = async (item: YouTubeSearchResult) => {
        if (!currentUser || !item) return;
        setGlobalLoading("שומר קיצור דרך...");
        
        const typeMapping: any = {
            'playlist': 'playlist',
            'album': 'album',
            'artist': 'artist',
            'podcast': 'podcast',
            'spotify_playlist': 'spotify_playlist'
        };
        
        const externalType = typeMapping[item.type || 'playlist'] || 'playlist';
        
        const newPlaylist: Playlist = {
            id: crypto.randomUUID(), // Temp ID
            name: item.title,
            creator: currentUser.email,
            isPublic: false,
            songs: [], // Empty initially, loaded on demand
            externalId: item.id,
            externalType: externalType
        };

        // Optimistic Update
        setPlaylists(prev => {
            const updated = [...prev, newPlaylist];
            storageService.saveData('streamify_cache_playlists', updated);
            return updated;
        });

        setBulkImportState(prev => ({ ...prev, isOpen: false }));

        try {
            const res = await fetch(`${LIBRARY_API_BASE}/playlist/save_external`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    name: item.title, 
                    creator: currentUser.email, 
                    externalId: item.id,
                    externalType: externalType
                })
            });
            
            if (!res.ok) throw new Error("Save external failed");
            // Reload to get real ID
            fetchLibrary();
            
        } catch (e) {
             setPlaylists(prev => {
                const updated = prev.filter(p => p.name !== item.title || p.externalId !== item.id);
                storageService.saveData('streamify_cache_playlists', updated);
                return updated;
            });
            setConfirmModal({ isOpen: true, title: "שגיאה", message: "נכשל בשמירה", onConfirm: () => setConfirmModal(prev => ({...prev, isOpen: false})), isAlertOnly: true });
        } finally {
            setGlobalLoading(null);
        }
    };

    const apiCreateFolder = async (name: string) => {
        if (!currentUser || !name.trim()) return;
        setGlobalLoading("יוצר תיקייה...");
        const tempId = crypto.randomUUID();
        const newFolder: Folder = { id: tempId, name, creator: currentUser.email, playlistIds: [] };

        updateFoldersLocally([...folders, newFolder]);

        try {
            const res = await fetch(`${LIBRARY_API_BASE}/folder/create`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, creator: currentUser.email, id: tempId })
            });
            if (!res.ok) throw new Error("Create folder failed");
        } catch (e) {
            updateFoldersLocally(folders.filter(f => f.id !== tempId));
        } finally {
            setGlobalLoading(null);
        }
    };

    const apiSharePlaylist = async (playlistId: string, targetEmail: string) => {
        if (!currentUser || !targetEmail.trim().includes('@')) return;
        setGlobalLoading("משתף...");
        
        try {
            const res = await fetch(`${LIBRARY_API_BASE}/playlist/share`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: playlistId, email: targetEmail, action: 'add' })
            });
            if (!res.ok) throw new Error("Share failed");

            // Optimistic Update
            const updated = playlists.map(p => p.id === playlistId ? { ...p, allowedUsers: [...(p.allowedUsers || []), targetEmail] } : p);
            updatePlaylistsLocally(updated);
            
            setConfirmModal({ isOpen: true, title: "הצלחה", message: `הפלייליסט שותף עם ${targetEmail}`, onConfirm: () => setConfirmModal(prev => ({...prev, isOpen: false})), isAlertOnly: true });
        } catch (e) {
             setConfirmModal({ isOpen: true, title: "שגיאה", message: "נכשל בשיתוף", onConfirm: () => setConfirmModal(prev => ({...prev, isOpen: false})), isAlertOnly: true });
        } finally {
            setGlobalLoading(null);
        }
    };

    const apiUnsharePlaylist = async (playlistId: string, emailToRemove: string) => {
        if (!currentUser) return;
        setGlobalLoading("מסיר...");
        try {
            const res = await fetch(`${LIBRARY_API_BASE}/playlist/share`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: playlistId, email: emailToRemove, action: 'remove' })
            });
            if (!res.ok) throw new Error("Unshare failed");

             const updated = playlists.map(p => {
                 if (p.id === playlistId) {
                     const newP = { ...p, allowedUsers: (p.allowedUsers || []).filter(e => e !== emailToRemove) };
                     if (manageUsersState.isOpen && manageUsersState.playlist?.id === playlistId) {
                         setManageUsersState(prev => ({ ...prev, playlist: newP }));
                     }
                     return newP;
                 }
                 return p;
             });
             updatePlaylistsLocally(updated);

        } catch (e) {
            setConfirmModal({ isOpen: true, title: "שגיאה", message: "נכשל בהסרה", onConfirm: () => setConfirmModal(prev => ({...prev, isOpen: false})), isAlertOnly: true });
        } finally {
            setGlobalLoading(null);
        }
    };

    const apiDeletePlaylist = async (playlistId: string) => {
        const pl = playlists.find(p => p.id === playlistId);
        if (!pl || pl.isLikedSongs) return;

        setConfirmModal({
            isOpen: true, title: "מחיקת פלייליסט", message: `האם למחוק את "${pl.name}"?`,
            onConfirm: async () => {
                setConfirmModal(prev => ({...prev, isOpen: false}));
                setGlobalLoading("מוחק...");
                
                // Optimistic
                const oldPlaylists = [...playlists];
                const oldFolders = [...folders];

                const updatedPlaylists = playlists.filter(p => p.id !== playlistId);
                const updatedFolders = folders.map(f => ({ ...f, playlistIds: f.playlistIds.filter(id => id !== playlistId) }));

                updatePlaylistsLocally(updatedPlaylists);
                updateFoldersLocally(updatedFolders);
                
                if (selectedPlaylist?.id === playlistId) { setSelectedPlaylist(null); setActiveTab('home'); }
                if (playingPlaylistId === playlistId) setPlayingPlaylistId(null);

                try {
                    const res = await fetch(`${LIBRARY_API_BASE}/playlist/delete`, {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ id: playlistId })
                    });
                    if (!res.ok) throw new Error("Delete failed");
                } catch(e) {
                    updatePlaylistsLocally(oldPlaylists);
                    updateFoldersLocally(oldFolders);
                    setConfirmModal({ isOpen: true, title: "שגיאה", message: "נכשל במחיקה", onConfirm: () => setConfirmModal(prev => ({...prev, isOpen: false})), isAlertOnly: true });
                } finally {
                    setGlobalLoading(null);
                }
            }
        });
    };

    const apiDeleteFolder = async (folderId: string) => {
        const folder = folders.find(f => f.id === folderId);
        if (!folder) return;
        setConfirmModal({
            isOpen: true, title: "מחיקת תיקייה", message: `האם למחוק את "${folder.name}"?`,
            onConfirm: async () => {
                setConfirmModal(prev => ({...prev, isOpen: false}));
                setGlobalLoading("מוחק...");
                
                const oldFolders = [...folders];
                updateFoldersLocally(folders.filter(f => f.id !== folderId));

                try {
                     const res = await fetch(`${LIBRARY_API_BASE}/folder/delete`, {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ id: folderId })
                    });
                    if (!res.ok) throw new Error("Delete failed");
                } catch (e) {
                    updateFoldersLocally(oldFolders);
                } finally {
                    setGlobalLoading(null);
                }
            }
        });
    };
    
    const apiMovePlaylistToFolder = async (playlistId: string, targetFolderId: string | null) => {
        setGlobalLoading("מעביר...");
        
        const oldFolders = [...folders];
        
        let updatedFolders = folders.map(f => ({
            ...f, playlistIds: f.playlistIds.filter(id => id !== playlistId)
        }));
        if (targetFolderId) {
            updatedFolders = updatedFolders.map(f => f.id === targetFolderId ? { ...f, playlistIds: [...f.playlistIds, playlistId] } : f);
        }
        
        updateFoldersLocally(updatedFolders);
        setMoveToFolderState({ visible: false, playlistId: null });

        try {
            const res = await fetch(`${LIBRARY_API_BASE}/folder/content`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ playlistId, targetFolderId })
            });
            if (!res.ok) throw new Error("Move failed");
        } catch (e) {
            updateFoldersLocally(oldFolders);
        } finally {
            setGlobalLoading(null);
        }
    };

    const apiRenameItem = async (itemId: string, newName: string, itemType: 'playlist' | 'folder') => {
        if (!currentUser || !newName.trim()) return;
        setGlobalLoading("משנה שם...");

        try {
            // Optimistic
            if (itemType === 'playlist') {
                updatePlaylistsLocally(playlists.map(p => p.id === itemId ? {...p, name: newName} : p));
            } else {
                updateFoldersLocally(folders.map(f => f.id === itemId ? {...f, name: newName} : f));
            }

            if (itemType === 'playlist') {
                 const res = await fetch(`${LIBRARY_API_BASE}/playlist/rename`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id: itemId, name: newName })
                });
                if(!res.ok) throw new Error("Rename failed");
            }
        } catch (e) {
            setNetworkError("שגיאה בשינוי השם");
        } finally {
            setGlobalLoading(null);
        }
    };


    const apiAddSongsToPlaylist = async (playlistId: string, newSongs: PlaylistItem[], playlistOverride?: Playlist) => {
        if (!currentUser || newSongs.length === 0) return;
        setGlobalLoading("מוסיף שירים...");
        
        let playlist = playlistOverride || playlists.find(p => p.id === playlistId);
        
        if (!playlist) {
            setGlobalLoading(null);
            return;
        }
        
        const existingIds = new Set(playlist.songs.map(s => s.id));
        const songsToAdd = newSongs.filter(s => !existingIds.has(s.id));
        if (songsToAdd.length === 0) {
            setGlobalLoading(null);
            setShowPlaylistSelector(false);
            return;
        }

        const updatedPlaylist = { ...playlist, songs: [...playlist.songs, ...songsToAdd] };
        
        setPlaylists(prev => {
            const pIndex = prev.findIndex(p => p.id === playlistId);
            let newAllPlaylists;
            if (pIndex > -1) {
                newAllPlaylists = [...prev];
                newAllPlaylists[pIndex] = updatedPlaylist;
            } else {
                 newAllPlaylists = [...prev, updatedPlaylist];
            }
            storageService.saveData('streamify_cache_playlists', newAllPlaylists);
            return newAllPlaylists;
        });

        // FIX: Update selectedPlaylist immediately if it's the one currently open
        if (selectedPlaylist && selectedPlaylist.id === playlistId) {
            setSelectedPlaylist(updatedPlaylist);
        }
        if (updatedPlaylist.isLikedSongs) {
            setLikedSongsPlaylist(updatedPlaylist);
            storageService.saveData('streamify_cache_liked', updatedPlaylist);
        }        
        setShowPlaylistSelector(false);
        setSongsToAdd([]);

        try {
            const res = await fetch(`${LIBRARY_API_BASE}/songs/add`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ playlistId, songs: songsToAdd, user: currentUser.email })
            });
            if (!res.ok) throw new Error("Add songs failed");
        } catch(e) {
            setConfirmModal({ isOpen: true, title: "שגיאה", message: "נכשל בהוספת שירים", onConfirm: () => setConfirmModal(prev => ({...prev, isOpen: false})), isAlertOnly: true });
        } finally {
            setGlobalLoading(null);
        }
    };


    const apiRemoveSong = async (playlistId: string, songId: string) => {
        if (!currentUser) return;
        setGlobalLoading("מסיר...");

        const oldPlaylists = [...playlists];
        const updated = playlists.map(p => p.id === playlistId ? { ...p, songs: p.songs.filter(s => s.id !== songId) } : p);
        updatePlaylistsLocally(updated);

        try {
             const res = await fetch(`${LIBRARY_API_BASE}/songs/remove`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ playlistId, songId })
            });
            if (!res.ok) throw new Error("Remove song failed");
        } catch (e) {
             updatePlaylistsLocally(oldPlaylists);
        } finally {
            setGlobalLoading(null);
        }
    };

    const updateMBDPlaylist = async (playlist: Playlist) => {
        const artistName = "Mordechai Ben David";
        // סינון השירים ששייכים לאמן המבוקש
        const songsToFix = playlist.songs.filter(s => 
            s.author.toLowerCase().includes(artistName.toLowerCase())
        );

        if (songsToFix.length === 0) {
            alert(`לא נמצאו שירים של ${artistName} בפלייליסט הזה.`);
            return;
        }

        setConfirmModal({
            isOpen: true,
            title: "עדכון שירים",
            message: `נמצאו ${songsToFix.length} שירים של ${artistName}. האפליקציה תחפש להם קישורים חדשים ותעדכן אותם. להמשיך?`,
            onConfirm: async () => {
                setConfirmModal(prev => ({ ...prev, isOpen: false }));
                setGlobalLoading(`מתחיל עדכון עבור ${artistName}...`);

                let successCount = 0;

                for (let i = 0; i < songsToFix.length; i++) {
                    const oldSong = songsToFix[i];
                    setGlobalLoading(`מעדכן: ${oldSong.title} (${i + 1}/${songsToFix.length})`);

                    try {
                        const query = encodeURIComponent(`${oldSong.title} ${artistName} audio`);
                        const res = await fetch(`${YOUTUBE_API_BASE}?action=search_and_download_video&query=${query}&search_engine=youtubemusic_songs`);
                        const data = await res.json();

                        if (data.success && data.results && data.results.length > 0) {
                            const bestMatch = data.results[0];

                            if (bestMatch.id !== oldSong.id) {
                                await apiRemoveSong(playlist.id, oldSong.id);
                                
                                const newSongItem: PlaylistItem = {
                                    ...oldSong,
                                    id: bestMatch.id,
                                    thumbnail: bestMatch.thumbnail_url || oldSong.thumbnail,
                                    addedAt: new Date().toISOString()
                                };
                                await apiAddSongsToPlaylist(playlist.id, [newSongItem]);
                                successCount++;
                            }
                        }
                    } catch (e) {
                        console.error(`שגיאה בעדכון השיר ${oldSong.title}:`, e);
                    }
                    await new Promise(resolve => setTimeout(resolve, 600));
                }

                setGlobalLoading(null);
                setConfirmModal({
                    isOpen: true,
                    title: "העדכון הסתיים",
                    message: `מתוך ${songsToFix.length} שירים, ${successCount} עודכנו בהצלחה.`,
                    onConfirm: () => setConfirmModal(prev => ({ ...prev, isOpen: false })),
                    isAlertOnly: true
                });
            }
        });
    };
    // --- Common Handlers ---

    const handleToggleLike = (songResult: YouTubeSearchResult | PlaylistItem) => {
        if (!likedSongsPlaylist) return;
        const songItem = 'addedBy' in songResult ? songResult as PlaylistItem : searchResultToPlaylistItem(songResult);
        const isLiked = likedSongsPlaylist.songs.some(s => s.id === songItem.id);
        if (isLiked) {
            apiRemoveSong(likedSongsPlaylist.id, songItem.id);
        } else {
            apiAddSongsToPlaylist(likedSongsPlaylist.id, [songItem]);
        }
    };

    const handleOpenContextMenu = (e: React.MouseEvent | React.TouchEvent, item: Playlist | Folder) => {
        e.preventDefault(); e.stopPropagation();
        const getCoords = (ev: React.MouseEvent | React.TouchEvent) => 'touches' in ev ? { x: ev.touches[0].clientX, y: ev.touches[0].clientY } : { x: ev.clientX, y: ev.clientY };
        let { x, y } = getCoords(e);
        const menuWidth = 192; const menuHeight = 100;
        if (x + menuWidth > window.innerWidth) x = x - menuWidth;
        if (y + menuHeight > window.innerHeight) y = y - menuHeight;
        setContextMenu({ x, y, item });
    };
    
    const closeContextMenu = useCallback(() => setContextMenu(null), []);
    useEffect(() => { if (contextMenu) { window.addEventListener('click', closeContextMenu, { once: true }); return () => window.removeEventListener('click', closeContextMenu); } }, [contextMenu, closeContextMenu]);

    const handleRemoveSongWithConfirmation = (song: PlaylistItem) => {
        if (!selectedPlaylist || selectedPlaylist.id.startsWith('temp-')) return;
        setConfirmModal({
            isOpen: true, title: "הסרת שיר", message: `האם להסיר את "${song.title}"?`,
            onConfirm: () => { setConfirmModal(prev => ({...prev, isOpen: false})); apiRemoveSong(selectedPlaylist.id, song.id); }
        });
    };

    // --- Spotify Import Logic ---
    const handleSpotifyImport = (playlistId: string) => {
        const tempPlaylist: Playlist = { id: `temp-spotify-${playlistId}`, name: 'טוען פלייליסט ספוטיפיי...', creator: 'Spotify', isPublic: false, songs: [] };
        setSelectedPlaylist(tempPlaylist); setActiveTab('playlist'); setIsSearching(false);
        if (spotifyWsRef.current) spotifyWsRef.current.close();
        try {
            const ws = new WebSocket(SPOTIFY_WS_URL); spotifyWsRef.current = ws;
            ws.onopen = () => ws.send(JSON.stringify({ type: 'start', playlist_id: playlistId }));
            ws.onmessage = (event) => {
                const message = JSON.parse(event.data);
                if (message.type === 'track') {
                    const data = message.data;
                    if (!data.id) return;
                    const newSong: PlaylistItem = { id: data.id, title: data.title, author: data.author || '', duration: parseDurationToSeconds(data.duration), thumbnail: data.thumbnail_url || '', addedBy: 'spotify_import', addedAt: new Date().toISOString() };
                    setSelectedPlaylist(prev => (!prev || !prev.id.startsWith('temp-')) ? prev : { ...prev, name: 'טעינה מספוטיפיי...', songs: [...prev.songs, newSong] });
                } else if (message.type === 'end') { ws.close(); setSelectedPlaylist(prev => prev ? { ...prev, name: 'Spotify Imported Playlist' } : null);
                } else if (message.type === 'error') { 
                    setConfirmModal({ isOpen: true, title: "שגיאה", message: "שגיאה בייבוא מספוטיפיי: " + message.message, onConfirm: () => setConfirmModal(prev => ({...prev, isOpen: false})), isAlertOnly: true });
                    ws.close(); setSelectedPlaylist(null); setActiveTab('search'); 
                }
            };
        } catch (e) { console.error("Failed to connect WS", e); }
    };
    
    // --- LOAD EXTERNAL PLAYLIST (Fetch Reference Content) ---
    const loadExternalPlaylist = async (playlist: Playlist) => {
        if (!playlist.externalId || !playlist.externalType) return;
        
        setIsSearching(true); 
        setGlobalLoading("טוען תוכן מהרשת...");
        
        try {
             const res = await fetch(`${YOUTUBE_API_BASE}/ytmusic-browse/${playlist.externalId}?type=${playlist.externalType}`); 
             const data = await res.json();
             
             if (data.success && data.results) { 
                 const tracks: PlaylistItem[] = data.results.map((r: any) => searchResultToPlaylistItem(r, 'external_fetch')); 
                 // Update the selected playlist IN MEMORY with the fetched songs
                 setSelectedPlaylist(prev => prev && prev.id === playlist.id ? { ...prev, songs: tracks } : prev); 
             } else {
                 setConfirmModal({ isOpen: true, title: "שגיאה", message: "לא נמצא תוכן או שגיאה בטעינה.", onConfirm: () => setConfirmModal(prev => ({...prev, isOpen: false})), isAlertOnly: true });
             }
        } catch { 
             setConfirmModal({ isOpen: true, title: "שגיאה", message: "שגיאת רשת בטעינת התוכן", onConfirm: () => setConfirmModal(prev => ({...prev, isOpen: false})), isAlertOnly: true }); 
        } finally { 
             setIsSearching(false); 
             setGlobalLoading(null); 
        }
    };

    useEffect(() => {
        const fetchSuggestions = async () => {
            if (!searchQuery.trim()) {
                setSearchSuggestions([]);
                return;
            }
            try {
                const res = await fetch(`${YOUTUBE_API_BASE}/suggestions?q=${encodeURIComponent(searchQuery)}`);
                const data = await res.json();
                setSearchSuggestions(data || []);
            } catch (e) {
                console.error("Suggestions error", e);
            }
        };

        const handler = setTimeout(fetchSuggestions, 200); // 200ms זה זמן מעולה להצעות
        return () => clearTimeout(handler);
    }, [searchQuery]);    
    
    // --- Search Logic: Handles clearing results ---
    useEffect(() => { 
        if (!searchQuery.trim()) {
            if (searchAbortController.current) {
                searchAbortController.current.abort();
            }
            setSearchResults([]); 
            setIsSearching(false);
        }
    }, [searchQuery]);

    // טריגר לחיפוש אוטומטי כשמחליפים קטגוריה (פילטר), בתנאי שיש טקסט לחיפוש
    useEffect(() => {
        if (searchQuery.trim()) {
            performSearch(searchQuery, false);
        }
    }, [ytMusicFilter]);

    useEffect(() => { 
        const handler = setTimeout(() => { 
            if (playlistSearchQuery.trim()) performSearch(playlistSearchQuery, true); 
            else setPlaylistSearchResults([]); 
        }, 500); 
        return () => clearTimeout(handler); 
    }, [playlistSearchQuery]);

    const handleVoiceSearch = async () => {
        // אם אנחנו כבר מאזינים ולחצו שוב על המיקרופון - עצירה מיידית
        if (isListening) {
            if (silenceTimeoutRef.current) clearTimeout(silenceTimeoutRef.current);
            setIsListening(false);
            SpeechRecognition.removeAllListeners();
            SpeechRecognition.stop().catch(() => {});
            if (searchQuery.trim()) performSearch(searchQuery, false);
            return;
        }

        try {
            const { available } = await SpeechRecognition.available();
            if (!available) {
                alert("חיפוש קולי לא נתמך במכשיר זה.");
                return;
            }

            const permissions = await SpeechRecognition.checkPermissions();
            if (permissions.speechRecognition !== 'granted') {
                const requested = await SpeechRecognition.requestPermissions();
                if (requested.speechRecognition !== 'granted') {
                    alert("חובה לאשר גישה למיקרופון כדי להשתמש בחיפוש קולי.");
                    return;
                }
            }

            setIsListening(true);
            setSearchQuery(""); 
            
            await SpeechRecognition.removeAllListeners();

            let hasFinished = false;

            // פונקציית העזר שמסיימת את תהליך ההאזנה
            const finalizeSearch = (text: string) => {
                if (hasFinished) return;
                hasFinished = true;
                
                if (silenceTimeoutRef.current) clearTimeout(silenceTimeoutRef.current);
                
                setIsListening(false);
                SpeechRecognition.removeAllListeners();
                SpeechRecognition.stop().catch(() => {});
                
                if (text && text.trim()) {
                    performSearch(text, false);
                }
            };

            // מאזין שמקבל את המילים תוך כדי הדיבור
            SpeechRecognition.addListener('partialResults', (data: any) => {
                if (data.matches && data.matches.length > 0) {
                    const transcript = data.matches[0];
                    setSearchQuery(transcript); // מציג את הטקסט למשתמש בזמן אמת

                    if (silenceTimeoutRef.current) clearTimeout(silenceTimeoutRef.current);

                    // ברגע שזוהתה מילה, אנחנו נותנים ללקוח 1.5 שניות של שקט לפני שסוגרים ומחפשים
                    silenceTimeoutRef.current = setTimeout(() => {
                        finalizeSearch(transcript);
                    }, 1500); 
                }
            });

            // טיימר ביטחון התחלתי: אם הלקוח לחץ אבל לא הוציא מילה במשך 5 שניות - סוגרים את המיקרופון
            silenceTimeoutRef.current = setTimeout(() => {
                finalizeSearch("");
            }, 5000);

            // מתחילים האזנה. הסרנו את התנאים שהיו כאן, כי אנחנו סומכים על ה-addListener והטיימר בלבד
            await SpeechRecognition.start({
                language: "he-IL",
                maxResults: 1,
                partialResults: true,
                popup: false 
            });

        } catch (e) {
            console.error("Voice search ended or error:", e);
            if (silenceTimeoutRef.current) clearTimeout(silenceTimeoutRef.current);
            setIsListening(false);
            SpeechRecognition.removeAllListeners();
        }
    };

    const performSearch = async (term: string, isPlaylistContext: boolean) => {
        const spotifyMatch = term.match(/open\.spotify\.com\/playlist\/([a-zA-Z0-9]+)/); 
        if (spotifyMatch && !isPlaylistContext) { handleSpotifyImport(spotifyMatch[1]); return; }
        
        const setLoading = isPlaylistContext ? setIsPlaylistSearching : setIsSearching; 
        const setResults = isPlaylistContext ? setPlaylistSearchResults : setSearchResults;
        setLoading(true);

        let currentSignal: AbortSignal | undefined;

        if (!isPlaylistContext) {
            addToSearchHistory(term);
            if (searchAbortController.current) {
                searchAbortController.current.abort();
            }
            searchAbortController.current = new AbortController();
            currentSignal = searchAbortController.current.signal;
        }

        try {
            const searchEngine = isPlaylistContext ? 'youtubemusic_songs' : `youtubemusic_${ytMusicFilter}`;
            const params = new URLSearchParams({ action: 'search_and_download_video', query: term, search_engine: searchEngine });
            
            const res = await fetch(`${YOUTUBE_API_BASE}?${params.toString()}`, {
                signal: currentSignal
            }); 
            
            const data: YouTubeDownloadResponse = await res.json();
            
            // מניעת עדכון UI אם הבקשה בוטלה עקב חיפוש חדש
            if (currentSignal?.aborted) return;

            const finalResults = data.success && data.results ? 
                data.results.filter((r: any) => r.id && String(r.id).toLowerCase() !== 'null' && String(r.id).toLowerCase() !== 'undefined' && String(r.id).trim() !== '') 
                : [];
            setResults(finalResults);
        } catch (e: any) { 
            if (currentSignal?.aborted || e.name === 'AbortError') return;
            setResults([]); 
        } finally { 
            // מכבה את הטעינה אך ורק אם מדובר בבקשה העדכנית ביותר שלא בוטלה
            if (!currentSignal?.aborted) {
                setLoading(false); 
            }
        }
    };

    const handleLogin = (e: React.FormEvent) => { 
        e.preventDefault(); 
        // עדכון התנאי שיבדוק גם את האימייל וגם את הקוד הסודי
        if (emailInput.includes('@') && entryCodeInput === SECRET_ENTRY_CODE) { 
            storageService.saveData('streamify_user_email', emailInput);
            setCurrentUser({ email: emailInput, permissions: [], playlistPermission: 'edit' }); 
        } else {
            alert('אימייל לא תקין או קוד כניסה שגוי');
        }
    };

    const checkForInternalUpdates = async () => {
        if (!Capacitor.isNativePlatform()) {
            setConfirmModal({
                isOpen: true, title: "עדכון גרסה", 
                message: "עדכון פנימי נתמך באנדרואיד בלבד. במחשב זה אוטומטי.",
                onConfirm: () => setConfirmModal(prev => ({...prev, isOpen: false})), isAlertOnly: true
            });
            return;
        }

        setGlobalLoading("מוריד עדכון פנימי...");
        try {
            // מביא את התאריך החדש כדי לשמור אותו בזיכרון של הטלפון
            const res = await fetch(`https://api.github.com/repos/shlomoashl/streamify-app/releases/tags/latest-build?t=${new Date().getTime()}`);
            const data = await res.json();
            const updateAsset = data.assets?.find((a: any) => a.name === 'update.zip');
            const newVersionDate = updateAsset ? new Date(updateAsset.updated_at).getTime() : new Date().getTime();

            const downloadUrl = "https://github.com/shlomoashl/streamify-app/releases/download/latest-build/update.zip";
            
            const result = await CapacitorUpdater.download({
                url: downloadUrl,
                version: newVersionDate.toString(), 
            });
            
            setGlobalLoading("מתקין ומרענן...");
            // שומרים את תאריך העדכון ומכבים את נורית ההתראה
            localStorage.setItem('streamify_app_version_date', newVersionDate.toString());
            setUpdateAvailable(false); 
            
            await CapacitorUpdater.set(result); 
        } catch (e) {
            console.error('Update failed', e);
            setConfirmModal({
                isOpen: true, title: "שגיאה", message: "נכשל בהורדת העדכון.",
                onConfirm: () => setConfirmModal(prev => ({...prev, isOpen: false})), isAlertOnly: true
            });
        } finally {
            setGlobalLoading(null);
        }
    };

    const handleLogout = () => { 
        setConfirmModal({
            isOpen: true, title: "התנתקות", message: "האם להתנתק?",
            onConfirm: () => {
                setConfirmModal(prev => ({...prev, isOpen: false}));
                storageService.clearAll();
                setCurrentUser(null); setPlaylists([]); setPlayingPlaylistId(null); setPlayerState(prev => ({...prev, isPlaying: false, currentSong: null})); setActiveTab('home'); 
            }
        });
    };
    
    // --- Audio Control ---
    
    const handlePlaySong = (song: PlaylistItem, queue: PlaylistItem[], index: number, isPlaylistStartAction: boolean = false, playlistId: string | null = null) => {
        audioInitializedRef.current = true;
        initialSeekTimeRef.current = 0;
        let finalQueue = [...queue]; let finalIndex = index; let finalOriginalQueue: PlaylistItem[] | undefined = undefined;
    
        // If shuffling is active, or we are starting a playlist in shuffle mode
        if (playerState.isShuffled || (isPlaylistStartAction && playerState.isShuffled)) {
            finalOriginalQueue = [...queue]; 
            
            // Create a FRESH shuffle every time
            let shuffledQueue = shuffleArray([...queue]);
            
            // If the user clicked a specific song, move it to the front
            // If they just clicked "Play Playlist", we might want a random start (handled in handlePlaylistPlay)
            const clickedSongIdx = shuffledQueue.findIndex(s => s.id === song.id);
            if (clickedSongIdx > 0) { 
                const [item] = shuffledQueue.splice(clickedSongIdx, 1); 
                shuffledQueue.unshift(item); 
            } else if (clickedSongIdx === -1 && shuffledQueue.length > 0) {
                // If for some reason song isn't found, just ensure queue isn't empty
                // (Should not happen if logic is correct)
            }
            
            finalQueue = shuffledQueue; 
            finalIndex = 0;
        }
        setPlayingPlaylistId(playlistId);
        setPlayerState(prev => ({ ...prev, isOpen: true, isPlaying: true, currentSong: song, queue: finalQueue, currentIndex: finalIndex, isShuffled: prev.isShuffled, originalQueue: (playerState.isShuffled || isPlaylistStartAction) ? finalOriginalQueue : undefined, isExpanded: window.innerWidth < 768 }));    

        // PASS PLAYLIST ID AS CONTEXT
        audioService.playQueue(finalQueue, finalIndex, playlistId || undefined);
    };

    const handleRemoveCurrentSongClick = () => {
        if (!playerState.currentSong || !playingPlaylistId || playingPlaylistId.startsWith('temp-')) {
            return;
        }
        
        const song = playerState.currentSong;
        const playlistId = playingPlaylistId;

        setConfirmModal({
            isOpen: true, 
            title: "הסרת שיר", 
            message: `האם להסיר את "${song.title}" מרשימת ההשמעה?`,
            onConfirm: () => { 
                setConfirmModal(prev => ({...prev, isOpen: false})); 
                apiRemoveSong(playlistId, song.id); 
            }
        });
    };

    const handlePlaylistPlay = (playlist: Playlist) => {
        if (playingPlaylistId === playlist.id && playlist.songs.length > 0) {
             togglePlayPause();
             return;
        }
        
        // Handle External Playlist Play
        if (playlist.externalId && playlist.songs.length === 0) {
            setSelectedPlaylist(playlist);
            setActiveTab('playlist');
            loadExternalPlaylist(playlist).then(() => {
                // Auto play after load? Maybe complex to sync state. 
                // Let the user click play inside.
            });
            return;
        }

        if (playlist.songs.length > 0) {
             // If shuffling is enabled, pick a RANDOM song to start with, not the first one
             if (playerState.isShuffled) {
                 const randomStartIdx = Math.floor(Math.random() * playlist.songs.length);
                 const randomStartSong = playlist.songs[randomStartIdx];
                 handlePlaySong(randomStartSong, playlist.songs, randomStartIdx, true, playlist.id);
             } else {
                 handlePlaySong(playlist.songs[0], playlist.songs, 0, true, playlist.id);
             }
        }
    };

    const handleNext = useCallback(() => { 
        audioInitializedRef.current = true;
        initialSeekTimeRef.current = 0;
        setPlayerState(prev => { 
            if (!prev.queue || prev.queue.length === 0) return prev; 
            const nextIdx = (prev.currentIndex + 1) % prev.queue.length; 
            const nextSong = prev.queue[nextIdx];
            
            // התיקון: משתמשים בפונקציית הדילוג המהירה במקום לשלוח את כל התור מחדש
            audioService.skipTo(nextIdx);
            
            return { ...prev, currentIndex: nextIdx, currentSong: nextSong, isPlaying: true }; 
        }); 
    }, []);

    const handlePrev = useCallback(() => { 
        audioInitializedRef.current = true;
        initialSeekTimeRef.current = 0;
        setPlayerState(prev => { 
            if (!prev.queue || prev.queue.length === 0) return prev; 
            const prevIdx = (prev.currentIndex - 1 + prev.queue.length) % prev.queue.length; 
            const prevSong = prev.queue[prevIdx];
            
            // התיקון: משתמשים בפונקציית הדילוג המהירה
            audioService.skipTo(prevIdx);
            
            return { ...prev, currentIndex: prevIdx, currentSong: prevSong, isPlaying: true }; 
        }); 
    }, []);

    const toggleShuffle = () => {
        setPlayerState(prev => {
            if (!prev.currentSong || !prev.queue || prev.queue.length < 2) {
                const simpleNewState = !prev.isShuffled;
                localStorage.setItem('streamify_shuffle', String(simpleNewState));
                return { ...prev, isShuffled: simpleNewState };
            }
            
            const isEnablingShuffle = !prev.isShuffled;
            let newState: PlayerState;
    
            if (isEnablingShuffle) {
                const originalQueue = prev.originalQueue || prev.queue;
                let shuffledQueue = shuffleArray([...originalQueue]);
                const newIndex = shuffledQueue.findIndex(s => s.id === prev.currentSong!.id);
                if (newIndex > 0) { 
                    const current = shuffledQueue.splice(newIndex, 1)[0]; 
                    shuffledQueue.unshift(current); 
                }
                newState = { ...prev, isShuffled: true, queue: shuffledQueue, currentIndex: 0, originalQueue: originalQueue };
            } else {
                const originalOrderQueue = prev.originalQueue || prev.queue;
                const newIndex = originalOrderQueue.findIndex(s => s.id === prev.currentSong!.id);
                newState = { ...prev, isShuffled: false, queue: originalOrderQueue, currentIndex: newIndex !== -1 ? newIndex : 0, originalQueue: undefined };
            }
            
            localStorage.setItem('streamify_shuffle', String(newState.isShuffled));
            
            // התיקון: במקום לקרוא ל-playQueue שעושה Restart לשיר,
            // נבדוק אם קיימת פונקציית עדכון שקטה ונקרא לה.
            if (audioService.updateQueue) {
                audioService.updateQueue(newState.queue, newState.currentIndex, playingPlaylistId || undefined);
            }
            
            saveStateToStorage(newState, playingPlaylistId, 0);
            return newState;
        });
    };
    
    const togglePlayPause = () => {
        if (playerState.isPlaying) { 
            audioService.pause(); 
            setPlayerState(p => ({ ...p, isPlaying: false })); 
            saveStateToStorage(playerState, playingPlaylistId, currentTimeRef.current);
        } else {
            if (!audioInitializedRef.current && playerState.currentSong) { 
                // בדיקת השתקה לפני הפעלה
                if (initialSeekTimeRef.current > 0) {
                    audioService.setVolume(0);
                    unmuteSafetyTimerRef.current = setTimeout(() => audioService.setVolume(1), 3500);
                }

                audioService.playQueue(playerState.queue, playerState.currentIndex, playingPlaylistId || undefined); 
                
                audioInitializedRef.current = true; 
                setPlayerState(p => ({ ...p, isPlaying: true }));                 
            } else { 
                audioService.resume(); 
                setPlayerState(p => ({ ...p, isPlaying: true })); 
            }
        }
    };

    const handleSeek = (time: number) => { audioService.seek(time); };
    const handlersRef = useRef({ handleNext, handlePrev });
    useEffect(() => { handlersRef.current = { handleNext, handlePrev }; }, [handleNext, handlePrev]);
    
    useEffect(() => {
        // Network Listener for Auto-Resume
        const networkListener = Network.addListener('networkStatusChange', status => {
            setIsOnline(status.connected);
            
            if (status.connected) {
                setNetworkError(null);
                // הערה: משיכת הספרייה מנוהלת כעת ב-useEffect הקודם בצורה בטוחה
                
                if (wasPlayingRef.current) {
                    console.log("[App] Network restored, resuming playback after short stabilization delay...");
                    setTimeout(() => {
                        audioService.resume();
                        setPlayerState(prev => ({ ...prev, isPlaying: true }));
                        wasPlayingRef.current = false;
                    }, 1000); 
                }
            } else {
                setNetworkError("אין חיבור לאינטרנט");
                setPlayerState(prev => {
                    if (prev.isPlaying) {
                        wasPlayingRef.current = true;
                        audioService.pause();
                        return { ...prev, isPlaying: false };
                    }
                    return prev;
                });
            }
        });

        // App State Listener (Focus)
        const appStateListener = CapacitorApp.addListener('appStateChange', ({ isActive }) => {
            console.log(`[App] App State Changed. Active: ${isActive}`);
            // ברגע שהאפליקציה יורדת לרקע או נסגרת, אנחנו מיד שומרים את מיקום השיר!
            if (!isActive && stateLoadedRef.current && latestPlayerStateRef.current.currentSong) {
                saveStateToStorage(latestPlayerStateRef.current, latestPlaylistIdRef.current, currentTimeRef.current);
            }
        });
        const timeListener = audioService.addListener('timeUpdate', (data: any) => { 
            currentTimeRef.current = data.currentTime; 
            
            // --- דילוג חכם ושקט (Silent Seek) ---
            if (initialSeekTimeRef.current > 0 && data.currentTime > 0.1) {
                const targetTime = initialSeekTimeRef.current;
                initialSeekTimeRef.current = 0; // איפוס מיידי 
                
                console.log(`[App] Media loaded. Seeking silently to ${targetTime}s`);
                audioService.seek(targetTime);

                // נותנים לדילוג 150 מילישניות להתבצע בשקט, ואז מדליקים את הסאונד
                setTimeout(() => {
                    audioService.setVolume(1); // החזרת הקול לפעולה מלאה (במובייל זה המקסימום הפנימי של האפליקציה)
                    if (unmuteSafetyTimerRef.current) {
                        clearTimeout(unmuteSafetyTimerRef.current); // מבטלים את טיימר החירום כי הצלחנו
                    }
                }, 150);
            }
        });
        const stateListener = audioService.addListener('stateChange', (data: any) => { setPlayerState(prev => ({ ...prev, isPlaying: data.isPlaying })); });
        const endListener = audioService.addListener('ended', () => { setPlayerState(prev => ({ ...prev, isPlaying: false })); });
        const transitionListener = audioService.addListener('itemTransition', (data: any) => {
             setPlayerState(prev => {
                 const newIdx = prev.queue.findIndex(s => s.id === data.id);
                 if (newIdx === -1) return prev;
                 const newSong = prev.queue[newIdx];
                 return { ...prev, currentIndex: newIdx, currentSong: newSong, isPlaying: true };
             });
        });
        const errorListener = audioService.addListener('error', (data: any) => {
            if (navigator.onLine && !skipLockRef.current) { skipLockRef.current = true; setTimeout(() => { handlersRef.current.handleNext(); skipLockRef.current = false; }, 1500); }
            else if (!navigator.onLine) { setPlayerState(prev => ({ ...prev, isPlaying: false })); setNetworkError("שגיאת רשת"); }
        });
        
        if ('mediaSession' in navigator && !Capacitor.isNativePlatform()) {
             navigator.mediaSession.setActionHandler('nexttrack', () => handlersRef.current.handleNext());
             navigator.mediaSession.setActionHandler('previoustrack', () => handlersRef.current.handlePrev());
        }

        return () => { 
            stateListener.remove(); 
            endListener.remove(); 
            errorListener.remove(); 
            transitionListener.remove(); 
            audioService.cleanup(); 
            timeListener.remove();
            
            // ניקוי המאזינים החדשים - קריטי למניעת קריסות באנדרואיד!
            networkListener.then(l => l.remove());
            appStateListener.then(l => l.remove());
        };
    }, []);

    
    const handleAddToPlaylistClick = async (e: React.MouseEvent, item: PlaylistItem | YouTubeSearchResult, targetPlaylistId?: string) => {
        e.stopPropagation();
        const itemAsResult = item as YouTubeSearchResult;
        if (itemAsResult.type && ['album', 'playlist', 'podcast', 'artist'].includes(itemAsResult.type)) {
            const setLoading = isPlaylistSearching ? setIsPlaylistSearching : setIsSearching;
            setLoading(true); setGlobalLoading("טוען שירים...");
            try {
                const res = await fetch(`${YOUTUBE_API_BASE}/ytmusic-browse/${item.id}?type=${itemAsResult.type}`);
                const data = await res.json();
                if (data.success && data.results && data.results.length > 0) {
                    const tracks = data.results.map((r: any) => searchResultToPlaylistItem(r, 'bulk_import'));
                    setBulkImportState({ isOpen: true, item: itemAsResult, tracks: tracks, targetPlaylistId: targetPlaylistId, mode: targetPlaylistId ? 'confirm_simple' : 'select_action' });
                } else setConfirmModal({ isOpen: true, title: "שגיאה", message: "לא נמצאו שירים.", onConfirm: () => setConfirmModal(prev => ({...prev, isOpen: false})), isAlertOnly: true });
            } catch (err) { setConfirmModal({ isOpen: true, title: "שגיאה", message: "שגיאה בייבוא שירים.", onConfirm: () => setConfirmModal(prev => ({...prev, isOpen: false})), isAlertOnly: true }); }
            finally { setLoading(false); setGlobalLoading(null); }
            return;
        }
        if (targetPlaylistId) { apiAddSongsToPlaylist(targetPlaylistId, [searchResultToPlaylistItem(itemAsResult)]); return; }
        if (itemAsResult.type === 'spotify_playlist') { handleSpotifyImport(itemAsResult.id); return; }
        setSongsToAdd([searchResultToPlaylistItem(itemAsResult)]); setShowPlaylistSelector(true);
    };

    const handleResultClick = async (result: YouTubeSearchResult) => {
        addToSearchHistory(searchQuery);

        // 1. טיפול בשירים וסרטונים
        if (!result.type || result.type === 'song' || result.type === 'video') { 
            // אם השיר כבר מנגן - לחיצה תעצור/תפעיל אותו (UX)
            if (playerState.currentSong?.id === result.id) {
                togglePlayPause();
                return;
            }

            const songQueue = searchResults.filter(r => !r.type || r.type === 'song' || r.type === 'video').map(r => searchResultToPlaylistItem(r, 'search')); 
            const clickedSongIndex = songQueue.findIndex(s => s.id === result.id); 
            
            // המפתח לתיקון: אנחנו שולחים 'temp-search' כזהות הפלייליסט
            if (clickedSongIndex !== -1) handlePlaySong(songQueue[clickedSongIndex], songQueue, clickedSongIndex, false, 'temp-search'); 
            return; 
        }

        if (result.type === 'spotify_playlist') { handleSpotifyImport(result.id); return; }
        
        // 2. טיפול באמנים/אלבומים וכו'
        setIsSearching(true); 
        setGlobalLoading("טוען...");
        try { 
            const browseType = result.type;
            const cleanBase = YOUTUBE_API_BASE.replace(/\/$/, "");
            const finalUrl = `${cleanBase}/ytmusic-browse/${result.id}?type=${browseType}`;
            const res = await fetch(finalUrl); 
            const data = await res.json();

            if (data.success && data.results) { 
                const tracks: PlaylistItem[] = data.results.map((r: any) => searchResultToPlaylistItem(r, 'temp')); 
                const tempPlaylist: Playlist = { 
                    id: `temp-${result.id}`, 
                    name: result.title, 
                    creator: result.author || '', 
                    isPublic: false, 
                    songs: tracks 
                }; 
                setSelectedPlaylist(tempPlaylist); 
                setActiveTab('playlist'); 
            }
        } catch (err) { 
            setConfirmModal({ isOpen: true, title: "שגיאה", message: "שגיאה בטעינת התוכן", onConfirm: () => setConfirmModal(prev => ({...prev, isOpen: false})), isAlertOnly: true }); 
        } finally { 
            setIsSearching(false); 
            setGlobalLoading(null); 
        }
    };

    const handleDirectPlay = async (e: React.MouseEvent, result: YouTubeSearchResult) => {
        e.stopPropagation(); 
        
        const isSong = !result.type || result.type === 'song' || result.type === 'video';
        // בודק אם הפריט הזה (שיר או אלבום) כבר מנגן כרגע
        const isCurrentlyActive = isSong 
            ? playerState.currentSong?.id === result.id 
            : playingPlaylistId === `temp-${result.id}`;

        if (isCurrentlyActive) {
            togglePlayPause();
            return;
        }
        
        if (isSong) {
            const songQueue = searchResults.filter(r => !r.type || r.type === 'song' || r.type === 'video').map(r => searchResultToPlaylistItem(r, 'search'));
            const clickedSongIndex = songQueue.findIndex(s => s.id === result.id);
            // שולחים 'temp-search' כדי שהתור יישמר בזיכרון המכשיר
            if (clickedSongIndex !== -1) handlePlaySong(songQueue[clickedSongIndex], songQueue, clickedSongIndex, false, 'temp-search');
            return;
        }

        if (result.type === 'spotify_playlist') { handleSpotifyImport(result.id); return; }
        
        setGlobalLoading("מתחיל לנגן...");
        try {
            const cleanBase = YOUTUBE_API_BASE.replace(/\/$/, "");
            const finalUrl = `${cleanBase}/ytmusic-browse/${result.id}?type=${result.type}`;
            const res = await fetch(finalUrl);
            const data = await res.json();

            if (data.success && data.results && data.results.length > 0) {
                const tracks = data.results.map((r: any) => searchResultToPlaylistItem(r, 'temp'));
                const tempPlaylistId = `temp-${result.id}`;
                if (playerState.isShuffled) {
                    const randomStartIdx = Math.floor(Math.random() * tracks.length);
                    handlePlaySong(tracks[randomStartIdx], tracks, randomStartIdx, true, tempPlaylistId);
                } else {
                    handlePlaySong(tracks[0], tracks, 0, true, tempPlaylistId);
                }
            }
        } catch (err) {
            setConfirmModal({ isOpen: true, title: "שגיאה", message: "שגיאה בנגינה", onConfirm: () => setConfirmModal(prev => ({...prev, isOpen: false})), isAlertOnly: true });
        } finally {
            setGlobalLoading(null);
        }
    };

    // Check if we need to load external content when opening a playlist
    useEffect(() => {
        if (activeTab === 'playlist' && selectedPlaylist && selectedPlaylist.externalId && selectedPlaylist.songs.length === 0) {
            loadExternalPlaylist(selectedPlaylist);
        }
    }, [activeTab, selectedPlaylist?.id]);


    if (!isAppReady) {
        return (
            <div className="h-screen w-full flex items-center justify-center bg-black text-white">
                <LoaderIcon className="w-12 h-12 animate-spin text-spotify-primary" />
            </div>
        );
    }

    if (!currentUser) { 
        return ( 
            <div className="h-screen w-full flex items-center justify-center bg-black p-4 text-white"> 
                <div className="w-full max-w-md bg-spotify-elevated p-8 rounded-xl text-center shadow-2xl border border-white/5"> 
                    <MusicIcon className="w-16 h-16 mx-auto mb-4 text-spotify-primary" /> 
                    <h1 className="text-2xl font-bold mb-6">ברוכים הבאים ל-Streamify</h1> 
                    <form onSubmit={handleLogin} className="space-y-4"> 
                        <input 
                            type="email" 
                            placeholder="אימייל" 
                            value={emailInput} 
                            onChange={e => setEmailInput(e.target.value)} 
                            className="w-full p-3 rounded bg-white/10 text-white border border-transparent focus:border-spotify-primary focus:outline-none transition-all text-right" 
                            required 
                        /> 
                        <input 
                            type="password" 
                            placeholder="קוד כניסה סודי" 
                            value={entryCodeInput} 
                            onChange={e => setEntryCodeInput(e.target.value)} 
                            className="w-full p-3 rounded bg-white/10 text-white border border-transparent focus:border-spotify-primary focus:outline-none transition-all text-right" 
                            required 
                        /> 
                        <button className="w-full bg-spotify-primary text-black font-bold p-3 rounded-full hover:scale-105 active:scale-95 transition-transform mt-2">
                            כניסה למערכת
                        </button> 
                    </form> 
                </div> 
            </div> 
        ); 
    }
    // --- RENDER ---
    // (Render functions are mostly identical but with updated handlers)

    const renderLoader = () => {
        if (!globalLoading) return null;
        return (
            <div className="fixed inset-0 bg-black/80 z-[150] flex flex-col items-center justify-center p-4 animate-fade-in" onClick={e => e.stopPropagation()}>
                <LoaderIcon className="w-12 h-12 text-spotify-primary animate-spin mb-4" />
                <div className="text-white font-bold text-lg animate-pulse">{globalLoading}</div>
            </div>
        );
    };

    const renderConfirmationModal = () => {
        if (!confirmModal.isOpen) return null;
        return (
            <div className="fixed inset-0 bg-black/80 z-[140] flex items-center justify-center p-4 animate-fade-in" onClick={() => !confirmModal.isAlertOnly && setConfirmModal(prev => ({...prev, isOpen: false}))}>
                <div className="bg-spotify-elevated p-6 rounded-xl w-full max-w-sm border border-white/10 text-center" onClick={e => e.stopPropagation()}>
                    <h3 className="text-xl font-bold mb-2 text-white">{confirmModal.title}</h3>
                    {confirmModal.message && <p className="text-gray-300 mb-6 text-sm leading-relaxed">{confirmModal.message}</p>}
                    <div className="flex gap-3 justify-center">
                        {!confirmModal.isAlertOnly && <button onClick={() => setConfirmModal(prev => ({...prev, isOpen: false}))} className="px-6 py-2 rounded-full font-bold bg-white/10 hover:bg-white/20 text-white">ביטול</button>}
                        <button onClick={confirmModal.onConfirm} className="px-6 py-2 bg-spotify-primary text-black rounded-full font-bold hover:scale-105 shadow-lg">{confirmModal.isAlertOnly ? 'אישור' : 'כן, אני בטוח'}</button>
                    </div>
                </div>
            </div>
        );
    };

    const renderInputModal = () => {
        if (!inputModal.isOpen) return null;
        const close = () => { setInputModal(prev => ({ ...prev, isOpen: false })); setInputModalValue(''); };
        return (
            <div className="fixed inset-0 bg-black/80 z-[120] flex items-center justify-center p-4 animate-fade-in" onClick={close}>
                <div className="bg-spotify-elevated p-6 rounded-xl w-full max-w-sm border border-white/10" onClick={e => e.stopPropagation()}>
                    <h3 className="text-lg font-bold mb-4 text-white text-center">{inputModal.title}</h3>
                    <form onSubmit={(e) => { e.preventDefault(); if (inputModalValue.trim()) { inputModal.onConfirm(inputModalValue); close(); } }}>
                        <input autoFocus type="text" value={inputModalValue} onChange={(e) => setInputModalValue(e.target.value)} className="w-full bg-white/10 border border-white/10 rounded-lg p-3 text-white focus:outline-none focus:border-spotify-primary mb-6 text-right" />
                        <div className="flex gap-3 justify-end"> <button type="button" onClick={close} className="px-4 py-2 rounded-full font-bold hover:text-white text-gray-400">ביטול</button> <button type="submit" className="px-6 py-2 bg-spotify-primary text-black rounded-full font-bold hover:scale-105">אישור</button> </div>
                    </form>
                </div>
            </div>
        );
    };
    
    const renderManageUsersModal = () => {
        if (!manageUsersState.isOpen || !manageUsersState.playlist) return null;
        const close = () => setManageUsersState({ isOpen: false, playlist: null });
        return (
            <div className="fixed inset-0 bg-black/80 z-[130] flex items-center justify-center p-4 animate-fade-in" onClick={close}>
                <div className="bg-spotify-elevated p-6 rounded-xl w-full max-w-sm border border-white/10" onClick={e => e.stopPropagation()}>
                    <div className="flex justify-between items-center mb-4"> <button onClick={close} className="text-gray-400 hover:text-white"><XIcon className="w-6 h-6"/></button> <h3 className="text-xl font-bold text-white text-center">משתמשים משותפים</h3> </div>
                    <div className="space-y-2 max-h-60 overflow-y-auto no-scrollbar">
                        {(manageUsersState.playlist.allowedUsers || []).length === 0 ? <div className="text-center text-gray-500 py-4">לא שותף עם אף אחד</div> : manageUsersState.playlist.allowedUsers!.map((email) => (
                            <div key={email} className="flex items-center justify-between p-3 bg-white/5 rounded-lg hover:bg-white/10">
                                <span className="text-sm truncate mr-2 flex-1 text-right" dir="ltr">{email}</span>
                                <button onClick={() => { setConfirmModal({ isOpen: true, title: "הסרת משתמש", message: `האם להסיר את השיתוף עם ${email}?`, onConfirm: () => { setConfirmModal(prev => ({...prev, isOpen: false})); apiUnsharePlaylist(manageUsersState.playlist!.id, email); } }); }} className="text-red-400 hover:text-red-600 p-2 rounded-full hover:bg-white/10"> <TrashIcon className="w-5 h-5" /> </button>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        );
    };

    const renderBulkImportModal = () => {
        if (!bulkImportState.isOpen || !bulkImportState.item) return null;
        const close = () => setBulkImportState(prev => ({ ...prev, isOpen: false }));
        const item = bulkImportState.item;
        return (
            <div className="fixed inset-0 bg-black/80 z-[120] flex items-center justify-center p-4 animate-fade-in" onClick={close}>
                <div className="bg-spotify-elevated p-6 rounded-xl w-full max-w-md border border-white/10 text-center" onClick={e => e.stopPropagation()}>
                    <div className="mb-6">
                        <div className="w-24 h-24 mx-auto bg-neutral-800 rounded-lg mb-4 flex items-center justify-center"> {item.thumbnail || item.thumbnail_url ? <img src={item.thumbnail || item.thumbnail_url} className="w-full h-full object-cover rounded-lg" /> : <AlbumIcon className="w-10 h-10 text-gray-500" />} </div>
                        <h3 className="text-lg font-bold text-white truncate px-4">{item.title}</h3>
                        <p className="text-gray-400 text-sm mt-1">{bulkImportState.tracks.length} שירים ייובאו</p>
                    </div>
                    {bulkImportState.mode === 'confirm_simple' && (
                        <div> <p className="mb-6 text-gray-300">להוסיף את השירים?</p> <div className="flex gap-3 justify-center"> <button onClick={close} className="px-6 py-2 rounded-full font-bold bg-white/10">ביטול</button> <button onClick={() => { if (bulkImportState.targetPlaylistId) apiAddSongsToPlaylist(bulkImportState.targetPlaylistId, bulkImportState.tracks); close(); }} className="px-6 py-2 bg-spotify-primary text-black rounded-full font-bold">אישור</button> </div> </div>
                    )}
                    {bulkImportState.mode === 'select_action' && (
                        <div className="space-y-3">
                            <button onClick={() => { setSongsToAdd(bulkImportState.tracks); setShowPlaylistSelector(true); close(); }} className="w-full py-3 bg-white/10 hover:bg-white/20 rounded-lg font-bold border border-white/5">הוסף לפלייליסט קיים</button>
                            <button onClick={() => { setInputModalValue(item.title); setBulkImportState(prev => ({ ...prev, mode: 'input_name' })); }} className="w-full py-3 bg-white/10 hover:bg-white/20 text-white rounded-lg font-bold border border-white/5">צור פלייליסט חדש (ייבוא מלא)</button>
                            <button onClick={() => { apiSaveExternalPlaylist(item); }} className="w-full py-3 bg-spotify-primary text-black rounded-lg font-bold shadow-lg hover:scale-105 transition-transform">שמור לספרייה (קיצור דרך)</button>
                            <button onClick={close} className="w-full py-2 text-gray-400 mt-2">ביטול</button>
                        </div>
                    )}
                    {bulkImportState.mode === 'input_name' && (
                        <form onSubmit={async (e) => { e.preventDefault(); if (!inputModalValue.trim()) return; const newPlaylist = await apiCreatePlaylist(inputModalValue); if (newPlaylist) await apiAddSongsToPlaylist(newPlaylist.id, bulkImportState.tracks, newPlaylist); close(); }}> <input autoFocus type="text" value={inputModalValue} onChange={(e) => setInputModalValue(e.target.value)} className="w-full bg-white/10 border border-white/10 rounded-lg p-3 text-white focus:outline-none focus:border-spotify-primary mb-6 text-right" /> <div className="flex gap-3 justify-center"> <button type="button" onClick={() => setBulkImportState(prev => ({ ...prev, mode: 'select_action' }))} className="px-6 py-2 rounded-full font-bold bg-white/10">חזרה</button> <button type="submit" className="px-6 py-2 bg-spotify-primary text-black rounded-full font-bold">צור והוסף</button> </div> </form>
                    )}
                </div>
            </div>
        );
    };

    const renderPlaylistSelector = () => {
        if (!showPlaylistSelector) return null;
        const availablePlaylists = playlists.filter(p => !p.isLikedSongs && !p.externalId); // Only local playlists
        return (
            <div className="fixed inset-0 bg-black/80 z-[60] flex items-center justify-center p-4 animate-fade-in" onClick={() => setShowPlaylistSelector(false)}>
                <div className="bg-spotify-elevated p-6 rounded-xl w-full max-w-sm" onClick={e => e.stopPropagation()}>
                    <h3 className="text-xl font-bold mb-4 text-center">הוסף {songsToAdd.length} שירים ל...</h3>
                    <div className="space-y-2 max-h-60 overflow-y-auto no-scrollbar">
                        <div onClick={() => { setInputModal({ isOpen: true, title: "שם הפלייליסט:", defaultValue: "", onConfirm: (val) => { apiCreatePlaylist(val).then(newP => { if(newP) apiAddSongsToPlaylist(newP.id, songsToAdd, newP); }); } }); setInputModalValue(""); }} className="p-3 bg-white/10 rounded flex items-center gap-3 cursor-pointer"> <PlusIcon /> <span>פלייליסט חדש</span> </div>
                        {availablePlaylists.map(p => ( <button key={p.id} onClick={() => apiAddSongsToPlaylist(p.id, songsToAdd)} className="w-full text-right p-3 hover:bg-white/10 rounded flex items-center gap-3"> <MusicIcon className="text-gray-500" /> <span className="truncate">{p.name}</span> </button> ))}
                    </div>
                </div>
            </div>
        );
    };

    const renderMoveToFolderModal = () => {
        if (!moveToFolderState.visible) return null;
        return (
            <div className="fixed inset-0 bg-black/80 z-[110] flex items-center justify-center p-4" onClick={() => setMoveToFolderState({ visible: false, playlistId: null })}>
                <div className="bg-spotify-elevated p-6 rounded-xl w-full max-w-sm" onClick={e => e.stopPropagation()}>
                    <h3 className="text-xl font-bold mb-4 text-center">העבר לתיקייה</h3>
                    <div className="space-y-2 max-h-60 overflow-y-auto no-scrollbar">
                        <button onClick={() => apiMovePlaylistToFolder(moveToFolderState.playlistId!, null)} className="w-full text-right p-3 hover:bg-white/10 rounded flex items-center gap-3"> <LibraryIcon className="w-5 h-5" /> <span>הסר מתיקייה</span> </button>
                        {folders.map(f => ( <button key={f.id} onClick={() => apiMovePlaylistToFolder(moveToFolderState.playlistId!, f.id)} className="w-full text-right p-3 hover:bg-white/10 rounded flex items-center gap-3"> <FolderIcon className="w-5 h-5" /> <span className="truncate">{f.name}</span> </button> ))}
                    </div>
                </div>
            </div>
        );
    };
    
    const renderContextMenu = () => {
        if (!contextMenu) return null;
        const { x, y, item } = contextMenu;
        const isFolder = 'playlistIds' in item;
        const isExternal = !isFolder && !!(item as Playlist).externalId;

        return (
            <div style={{ top: y, left: x }} className="fixed bg-spotify-elevated rounded-lg shadow-2xl p-2 z-[100] text-sm flex flex-col items-start gap-1 w-48" onClick={e => e.stopPropagation()}>
                {isFolder && <button className="w-full text-right p-2 hover:bg-white/10 rounded flex items-center gap-2" onClick={() => { setInputModal({ isOpen: true, title: "שם חדש:", defaultValue: (item as Folder).name, onConfirm: (val) => { if (val) apiRenameItem(item.id, val, 'folder'); } }); setInputModalValue((item as Folder).name); closeContextMenu(); }}> <EditIcon className="w-4 h-4" /> <span>שנה שם</span> </button>}
                
                {!isFolder && (item as Playlist).creator === currentUser?.email && (
                    <>
                        <button className="w-full text-right p-2 hover:bg-white/10 rounded flex items-center gap-2" onClick={() => { setInputModal({ isOpen: true, title: "שם חדש:", defaultValue: (item as Playlist).name, onConfirm: (val) => { if(val) apiRenameItem(item.id, val, 'playlist'); } }); setInputModalValue((item as Playlist).name); closeContextMenu(); }}> <EditIcon className="w-4 h-4" /> <span>שנה שם</span> </button>
                        {!isExternal && <button className="w-full text-right p-2 hover:bg-white/10 rounded flex items-center gap-2" onClick={() => { setInputModal({ isOpen: true, title: "הכנס אימייל לשיתוף:", defaultValue: "", onConfirm: (val) => apiSharePlaylist(item.id, val) }); setInputModalValue(""); closeContextMenu(); }}> <ShareIcon className="w-4 h-4" /> <span>שתף פלייליסט</span> </button>}
                        {!isExternal && (item as Playlist).allowedUsers && (item as Playlist).allowedUsers!.length > 0 && <button className="w-full text-right p-2 hover:bg-white/10 rounded flex items-center gap-2" onClick={() => { setManageUsersState({ isOpen: true, playlist: item as Playlist }); closeContextMenu(); }}> <UsersIcon className="w-4 h-4" /> <span>נהל משתמשים</span> </button>}
                    </>
                )}
                <button className="w-full text-right p-2 hover:bg-white/10 rounded flex items-center gap-2" onClick={() => { isFolder ? apiDeleteFolder(item.id) : apiDeletePlaylist(item.id); closeContextMenu(); }}> <TrashIcon className="w-4 h-4" /> <span>מחק</span> </button>
                {!isFolder && !isExternal && (item as Playlist).creator === currentUser?.email && (
                    <button 
                        className="w-full text-right p-2 hover:bg-white/10 rounded flex items-center gap-2 text-yellow-400" 
                        onClick={() => { 
                            updateMBDPlaylist(item as Playlist); 
                            closeContextMenu(); 
                        }}
                    >
                        <RefreshCcwIcon className="w-4 h-4" />
                        <span>תקן שירים של MBD</span>
                    </button>
                )}                
                {!isFolder && <button className="w-full text-right p-2 hover:bg-white/10 rounded flex items-center gap-2" onClick={() => { setMoveToFolderState({ visible: true, playlistId: item.id }); closeContextMenu(); }}> <FolderIcon className="w-4 h-4" /> <span>העבר לתיקייה</span> </button>}
            </div>
        );
    };

    const filterMap: Record<string, string> = { 'songs': 'שירים', 'albums': 'אלבומים', 'artists': 'אמנים', 'playlists': 'פלייליסטים', 'podcasts': 'פודקאסטים' };
    const renderSearchIcon = (type?: YouTubeSearchResult['type']) => {
        const commonClass = "w-6 h-6";
        switch (type) { case 'album': return <AlbumIcon className={commonClass} />; case 'artist': return <ArtistIcon className={commonClass} />; case 'playlist': return <PlaylistIcon className={commonClass} />; case 'podcast': return <PodcastIcon className={commonClass} />; case 'spotify_playlist': return <SpotifyIcon className="text-green-500 w-8 h-8" />; case 'song': case 'video': default: return <MusicIcon className={commonClass} />; }
    };

    const renderLibraryItems = () => {
        return (
            <>
                {folders.map(folder => (
                    <div key={folder.id}>
                        <div onClick={() => { const newSet = new Set(expandedFolders); newSet.has(folder.id) ? newSet.delete(folder.id) : newSet.add(folder.id); setExpandedFolders(newSet); }} onContextMenu={(e) => handleOpenContextMenu(e, folder)} className="flex items-center gap-3 py-2 px-3 rounded-lg cursor-pointer text-gray-400 hover:text-white hover:bg-white/10">
                            <FolderIcon className="w-5 h-5" /> <span className="truncate flex-1">{folder.name}</span> {expandedFolders.has(folder.id) ? <ChevronDownIcon className="w-4 h-4"/> : <ChevronLeftIcon className="w-4 h-4"/>}
                        </div>
                        {expandedFolders.has(folder.id) && (
                            <div className="pr-4 border-r-2 border-spotify-elevated my-2 space-y-px">
                                {folder.playlistIds.map(pid => {
                                    const playlist = playlists.find(p => p.id === pid); if (!playlist) return null;
                                    return ( <div key={pid} onClick={() => { setSelectedPlaylist(playlist); setActiveTab('playlist'); }} onContextMenu={(e) => handleOpenContextMenu(e, playlist)} className={`py-2 px-2 rounded-lg cursor-pointer truncate text-base ${selectedPlaylist?.id === pid ? 'bg-white/20 text-white' : 'text-gray-400 hover:bg-white/10 hover:text-white'}`}> {playlist.name} </div> );
                                })}
                            </div>
                        )}
                    </div>
                ))}
            </>
        )
    }

    // --- Main Layout Render ---
    return (
        <div className={`flex flex-col h-screen bg-spotify-base text-white overflow-hidden font-sans ${isDesktop ? 'pt-8' : ''}`}>
             <TitleBar />
             {showLogs && <LogViewer onClose={() => setShowLogs(false)} />}
             {renderLoader()} {renderConfirmationModal()} {renderInputModal()} {renderBulkImportModal()} {renderManageUsersModal()} {renderPlaylistSelector()} {renderMoveToFolderModal()} {renderContextMenu()}
            
            {!isOnline && <div className="fixed top-0 w-full bg-red-600 text-white text-center text-xs py-1 z-[80]">אין חיבור לאינטרנט</div>}
            {networkError && <div className="fixed top-0 w-full bg-yellow-600 text-white text-center text-xs py-1 z-[80]">{networkError}</div>}

            <div className="flex flex-1 overflow-hidden relative">
                <nav className="hidden md:flex flex-col w-64 bg-black px-4 pt-4 pb-2 h-full">
                    {/* ביטלנו פה את הלוגו החריג כדי שייכנס לתוך הרשימה */}
                    <div className="space-y-1 mt-4">
                        <button onClick={() => setActiveTab('streamify')} className={`flex items-center gap-4 py-2 px-4 rounded-lg transition-colors w-full text-right ${activeTab==='streamify'?'bg-white/20 text-white':'text-gray-400 hover:bg-white/10 hover:text-white'}`}> 
                            <MusicIcon className="w-6 h-6" /> <span className="font-medium text-lg">Streamify</span> 
                        </button>
                        <button onClick={() => setActiveTab('home')} className={`flex items-center gap-4 py-2 px-4 rounded-lg transition-colors w-full text-right ${activeTab==='home'?'bg-white/20 text-white':'text-gray-400 hover:bg-white/10 hover:text-white'}`}> 
                            <HomeIcon /> <span className="font-medium text-lg">בית</span> 
                        </button>
                        <button onClick={() => setActiveTab('search')} className={`flex items-center gap-4 py-2 px-4 rounded-lg transition-colors w-full text-right ${activeTab==='search'?'bg-white/20 text-white':'text-gray-400 hover:bg-white/10 hover:text-white'}`}> 
                            <SearchIcon /> <span className="font-medium text-lg">חיפוש</span> 
                        </button>
                        {likedSongsPlaylist && (
                            <button onClick={() => {setSelectedPlaylist(likedSongsPlaylist); setActiveTab('playlist');}} className={`flex items-center gap-4 py-2 px-4 rounded-lg transition-colors w-full text-right ${activeTab === 'playlist' && selectedPlaylist?.id === likedSongsPlaylist.id ? 'bg-white/20 text-white' : 'text-gray-400 hover:bg-white/10 hover:text-white'}`}> 
                                <HeartIcon filled className="text-spotify-primary"/> <span className="font-medium text-lg">שירים שאהבתם</span> 
                            </button>
                        )}
                    </div>                                    
                    <div className="border-t border-white/20 mt-2 pt-2 flex-1 min-h-0 overflow-y-auto no-scrollbar">
                        <div className="flex justify-start items-center text-sm font-bold text-gray-400 mb-2 px-1">
                            <div className="flex flex-col gap-1 w-full">
                                <button onClick={() => { setInputModal({ isOpen: true, title: "שם התיקייה:", defaultValue: "", onConfirm: (val) => apiCreateFolder(val) }); setInputModalValue(""); }} className="flex items-center gap-3 w-full text-left p-2 rounded text-gray-400 hover:text-white hover:bg-white/10"> <FolderPlusIcon className="w-5 h-5" /> <span className="font-semibold text-sm">תיקייה חדשה</span> </button>
                                <button onClick={() => { setInputModal({ isOpen: true, title: "שם הפלייליסט:", defaultValue: "", onConfirm: (val) => apiCreatePlaylist(val) }); setInputModalValue(""); }} className="flex items-center gap-3 w-full text-left p-2 rounded text-gray-400 hover:text-white hover:bg-white/10"> <PlusIcon className="w-5 h-5" /> <span className="font-semibold text-sm">פלייליסט חדש</span> </button>
                            </div>
                        </div>
                        <div className="border-t border-white/20 my-2"></div>
                        <div className="space-y-1">{renderLibraryItems()}</div>
                    </div>
                    <div className="flex flex-col mt-2 space-y-0">
                        <button onClick={() => setConfirmModal({
                            isOpen: true,
                            title: "אתחול שרת",
                            message: "האם אתה בטוח שברצונך לאתחל את השרת? המוזיקה תפסיק.",
                            onConfirm: async () => {
                                try {
                                    await fetch(`${YOUTUBE_API_BASE}/restart`, { method: 'POST' });
                                    setConfirmModal(prev => ({ ...prev, isOpen: false }));
                                    alert("השרת מבצע אתחול...");
                                } catch (e) {
                                    alert("שגיאה בביצוע אתחול");
                                }
                            }
                        })} className="p-3 text-sm text-gray-500 hover:text-white flex items-center gap-3 hover:bg-white/10 rounded-lg transition-colors"> 
                            <RefreshCcwIcon className="w-5 h-5" /> <span>אתחול שרת</span> 
                        </button>
                        <button onClick={handleLogout} className="p-3 text-sm text-gray-500 hover:text-white flex items-center gap-3 hover:bg-white/10 rounded-lg transition-colors"> <LogOutIcon className="w-5 h-5" /> <span>התנתק</span> </button>
                    </div>
                </nav>

                <main className={`flex-1 relative no-scrollbar bg-gradient-to-b from-spotify-elevated to-spotify-base ${activeTab === 'search' ? 'overflow-hidden flex flex-col' : 'overflow-y-auto'}`}>
                    {(activeTab === 'home' || activeTab === 'library') && (() => {
                        const playlistInFolderIds = new Set(folders.flatMap(f => f.playlistIds));
                        const topLevelPlaylists = playlists.filter(p => !p.isLikedSongs && !playlistInFolderIds.has(p.id));

                        return (
                            <>
                        <div className="sticky top-0 z-10 p-4 pt-[max(2.5rem,env(safe-area-inset-top))] md:pt-4 bg-spotify-elevated/95 backdrop-blur-sm shadow-md">
                                    <div className="flex justify-between items-center">
                                        <h1 className="text-2xl font-bold">שלום</h1>
                                        <div className="flex items-center gap-3">
                                 
                                            {Capacitor.isNativePlatform() && (
                                                <div className="relative">
                                                    <button
                                                        onClick={checkForInternalUpdates}
                                                        className={`flex items-center gap-2 px-3 py-1.5 hover:scale-105 active:scale-95 rounded-full transition-all font-bold text-sm shadow-lg ${updateAvailable ? 'bg-green-500 text-white' : 'bg-spotify-primary text-black'}`}
                                                        title="בדוק עדכון לאפליקציה"
                                                    >
                                                        {/* הטקסט מתחלף אם יש עדכון */}
                                                        <span>{updateAvailable ? 'עדכון זמין!' : 'עדכון'}</span>
                                                        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                                                            <polyline points="7 10 12 15 17 10"></polyline>
                                                            <line x1="12" y1="15" x2="12" y2="3"></line>
                                                        </svg>
                                                    </button>
                                                    
                                                    {/* הנקודה האדומה המהבהבת (מופיעה רק כשיש עדכון באמת) */}
                                                    {updateAvailable && (
                                                        <span className="absolute -top-1 -right-1 flex h-3 w-3">
                                                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                                                            <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500 shadow-md border border-white"></span>
                                                        </span>
                                                    )}
                                                </div>
                                            )}

                                            {/* כפתורי הלוגים וההתנתקות למובייל */}
                                            <div className="flex gap-2 md:hidden">
                                                <button onClick={() => setShowLogs(true)} className="p-3 bg-white/10 rounded-full text-white hover:bg-white/20" title="לוגים"> <TerminalIcon className="w-5 h-5" /> </button>
                                                <button onClick={handleLogout} className="p-3 bg-white/10 rounded-full text-white hover:bg-white/20" title="התנתק"> <LogOutIcon className="w-5 h-5" /> </button>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                
                                <div className="p-4">
                                    {folders.length > 0 && (
                                        <div className="mb-8">
                                            <h2 className="text-xl font-bold mb-4 px-2">תיקיות</h2>
                                            <div className="flex flex-col gap-2">
                                                {folders.map(folder => {
                                                    const isExpanded = expandedHomeFolders.has(folder.id);
                                                    const folderPlaylists = folder.playlistIds.map(pid => playlists.find(p => p.id === pid)).filter(Boolean) as Playlist[];

                                                    return (
                                                        <div key={folder.id}>
                                                            <div onClick={() => { const newSet = new Set(expandedHomeFolders); isExpanded ? newSet.delete(folder.id) : newSet.add(folder.id); setExpandedHomeFolders(newSet); }} onContextMenu={(e) => handleOpenContextMenu(e, folder)} className="bg-white/5 p-2 rounded-lg flex items-center gap-3 cursor-pointer hover:bg-white/10 transition">
                                                                <div className="w-10 h-10 bg-neutral-800 rounded flex-shrink-0 flex items-center justify-center text-gray-200"> <FolderIcon className="w-5 h-5"/> </div>
                                                                <div className="min-w-0 flex-1"> <div className="font-bold truncate text-sm">{folder.name}</div> </div>
                                                                <div className="text-gray-400"> {isExpanded ? <ChevronDownIcon className="w-5 h-5"/> : <ChevronLeftIcon className="w-5 h-5"/>} </div>
                                                            </div>
                                                            {isExpanded && (
                                                                <div className="mt-2 pt-2 pl-4 border-t border-white/10">
                                                                    {playlistViewMode === 'grid' ? (
                                                                        <div className="grid grid-cols-3 md:grid-cols-5 gap-3 md:gap-4 select-none">
                                                                            {folderPlaylists.map(p => ( <PlaylistSquare key={p.id} playlist={p} onSelect={(pl) => { setSelectedPlaylist(pl); setActiveTab('playlist'); }} onTogglePlay={handlePlaylistPlay} isPlaying={playingPlaylistId === p.id && playerState.isPlaying} onContextMenu={handleOpenContextMenu} /> ))}
                                                                        </div>
                                                                    ) : (
                                                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                                                            {folderPlaylists.map(p => ( <PlaylistRow key={p.id} playlist={p} onSelect={(pl) => { setSelectedPlaylist(pl); setActiveTab('playlist'); }} onTogglePlay={handlePlaylistPlay} isPlaying={playingPlaylistId === p.id && playerState.isPlaying} onContextMenu={handleOpenContextMenu} /> ))}
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            )}
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    )}

                                    {topLevelPlaylists.length > 0 && (
                                        <div>
                                            <div className="flex justify-between items-center mb-4 px-2">
                                                <h2 className="text-xl font-bold">פלייליסטים</h2>
                                                <button onClick={() => setPlaylistViewMode(playlistViewMode === 'grid' ? 'list' : 'grid')} className="p-2 rounded-full hover:bg-white/10 text-gray-400 hover:text-white"> {playlistViewMode === 'grid' ? <ListIcon className="w-5 h-5" /> : <GridIcon className="w-5 h-5" />} </button>
                                            </div>
                                            {playlistViewMode === 'grid' ? (
                                                <div className="grid grid-cols-3 md:grid-cols-5 gap-3 md:gap-4 select-none">
                                                    {topLevelPlaylists.map(p => ( <PlaylistSquare key={p.id} playlist={p} onSelect={(pl) => { setSelectedPlaylist(pl); setActiveTab('playlist'); }} onTogglePlay={handlePlaylistPlay} isPlaying={playingPlaylistId === p.id && playerState.isPlaying} onContextMenu={handleOpenContextMenu} /> ))}
                                                </div>
                                            ) : (
                                                <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                                                    {topLevelPlaylists.map(p => ( <PlaylistRow key={p.id} playlist={p} onSelect={(pl) => { setSelectedPlaylist(pl); setActiveTab('playlist'); }} onTogglePlay={handlePlaylistPlay} isPlaying={playingPlaylistId === p.id && playerState.isPlaying} onContextMenu={handleOpenContextMenu} /> ))}
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </>
                        );
                    })()}

                    {activeTab === 'search' && (
                        <>
                            <div className="relative z-50 p-4 pt-[max(2.5rem,env(safe-area-inset-top))] md:pt-4 bg-spotify-base shadow-md flex-shrink-0 border-b border-white/5">
                                <div className="relative flex items-center gap-4">
                                    <div className="relative flex-1"> 
                                        <SearchIcon className="absolute left-3 top-3 text-gray-400" /> 
                                        <input 
                                            className="w-full bg-white/10 rounded-full py-3 pr-12 pl-10 text-white focus:outline-none focus:ring-1 focus:ring-spotify-primary" 
                                            placeholder="חיפוש שירים, אלבומים..." 
                                            value={searchQuery} 
                                            onChange={e => {
                                                setSearchQuery(e.target.value);
                                                setShowSuggestions(true);
                                                setFocusedSuggestionIndex(-1); // איפוס האינדקס בעת הקלדה
                                            }} 
                                            onFocus={() => setShowSuggestions(true)}
                                            onBlur={() => setTimeout(() => {
                                                setShowSuggestions(false);
                                                setFocusedSuggestionIndex(-1);
                                            }, 250)}
                                            onKeyDown={(e) => {
                                                // ניווט עם החיצים למטה ולמעלה
                                                if (showSuggestions && searchSuggestions.length > 0) {
                                                    if (e.key === 'ArrowDown') {
                                                        e.preventDefault(); // מונע מסמן הטקסט לזוז
                                                        setFocusedSuggestionIndex(prev => 
                                                            prev < searchSuggestions.length - 1 ? prev + 1 : prev
                                                        );
                                                        return;
                                                    }
                                                    if (e.key === 'ArrowUp') {
                                                        e.preventDefault();
                                                        setFocusedSuggestionIndex(prev => prev > -1 ? prev - 1 : -1);
                                                        return;
                                                    }
                                                }

                                                // לחיצה על אנטר
                                                if (e.key === 'Enter') {
                                                    e.preventDefault();
                                                    setShowSuggestions(false);
                                                    
                                                    // אם המשתמש בחר הצעה בעזרת החיצים
                                                    if (focusedSuggestionIndex >= 0 && focusedSuggestionIndex < searchSuggestions.length) {
                                                        const selectedSuggestion = searchSuggestions[focusedSuggestionIndex];
                                                        setSearchQuery(selectedSuggestion);
                                                        performSearch(selectedSuggestion, false);
                                                    } 
                                                    // אם לא בחר כלום וסתם לחץ אנטר על מה שהקליד
                                                    else if (searchQuery.trim()) {
                                                        performSearch(searchQuery, false);
                                                    }
                                                    
                                                    setFocusedSuggestionIndex(-1);
                                                    (e.target as HTMLInputElement).blur();
                                                }
                                            }}
                                        />
                                        {/* כפתור חיפוש קולי */}
                                        <button 
                                            onClick={handleVoiceSearch}
                                            className={`absolute right-2 top-1.5 p-1.5 rounded-full transition-all duration-300 z-10
                                                ${isListening ? 'bg-red-500/20 text-red-500 animate-pulse scale-110' : 'text-gray-400 hover:text-white hover:bg-white/10'}`}
                                            title="חיפוש קולי"
                                        >
                                            <MicIcon className="w-6 h-6" />
                                        </button>

                                        {/* תפריט השלמה אוטומטית */}
                                        {showSuggestions && searchSuggestions.length > 0 && (
                                            <div className="absolute top-[110%] left-0 right-0 bg-[#282828] border border-white/10 rounded-xl shadow-2xl z-[100] overflow-hidden">
                                                {searchSuggestions.map((suggestion, idx) => (
                                                    <div
                                                        key={idx}
                                                        className={`flex items-center gap-4 p-3 cursor-pointer border-b border-white/5 last:border-0 transition-colors
                                                            ${focusedSuggestionIndex === idx ? 'bg-white/20' : 'hover:bg-white/10'}`}
                                                        onMouseEnter={() => setFocusedSuggestionIndex(idx)} // סנכרון עם העכבר
                                                        onClick={() => {
                                                            setSearchQuery(suggestion);
                                                            setShowSuggestions(false);
                                                            setFocusedSuggestionIndex(-1);
                                                            performSearch(suggestion, false);
                                                        }}
                                                    >
                                                        <SearchIcon className="w-4 h-4 text-gray-500" />
                                                        <span className="text-sm font-medium text-white text-right flex-1" dir="rtl">{suggestion}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                </div>
                                <div className="flex gap-2 mt-3 overflow-x-auto no-scrollbar pb-1"> 
                                    {['all', 'songs', 'albums', 'playlists', 'artists', 'podcasts'].map(f => ( 
                                        <button 
                                            key={f} 
                                            onClick={() => setYtMusicFilter(f as any)} 
                                            className={`px-4 py-1 rounded-full text-xs border whitespace-nowrap transition-colors ${ytMusicFilter === f ? 'bg-white text-black border-white' : 'border-white/20 hover:border-white text-white'}`}
                                        > 
                                            {f === 'all' ? 'הכל' : (filterMap[f] || f)} 
                                        </button> 
                                    ))} 
                                </div>                                
                            </div>
                            <div className="flex-1 p-4 overflow-y-auto no-scrollbar">
                                {!searchQuery.trim() && searchHistory.length > 0 ? (
                                    <div className="mt-2">
                                        <div className="flex justify-between items-center mb-4 px-2">
                                            <h3 className="font-bold text-lg">חיפושים אחרונים</h3>
                                            <button onClick={clearSearchHistory} className="text-xs font-bold text-gray-400 hover:text-white">נקה הכל</button>
                                        </div>
                                        <div className="space-y-1">
                                            {searchHistory.map((term, i) => (
                                                <div key={i} className="flex items-center justify-between p-3 rounded-lg hover:bg-white/10 group cursor-pointer" 
                                                    onClick={() => { 
                                                        setSearchQuery(term); 
                                                        performSearch(term, false); // <-- הוספנו את טריגר החיפוש
                                                    }}>
                                                    <div className="flex items-center gap-4 min-w-0">
                                                        <div className="text-gray-400"><ClockIcon className="w-5 h-5"/></div>
                                                        <span className="truncate">{term}</span>
                                                    </div>
                                                    <button onClick={(e) => { e.stopPropagation(); removeSearchHistoryItem(term); }} className="text-gray-400 hover:text-white p-2 z-10">
                                                        <XIcon className="w-4 h-4"/>
                                                    </button>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                ) : isSearching ? (
                                    <div className="flex justify-center items-center mt-10">
                                        <LoaderIcon className="w-8 h-8 animate-spin text-spotify-primary" />
                                    </div>
                                ) : (
                                    <>
                                        {/* === בלוק התוצאה המובילה והשירים (עטופים יחד כדי למנוע רווחים) === */}
                                        <div className="flex flex-col gap-1">
                                            
                                            {/* --- התוצאה המובילה (Top Result) --- */}
                                            {ytMusicFilter === 'all' && searchResults.length > 0 && (
                                                <section>
                                                    <h2 className="text-xl font-bold text-white mb-4 px-1">התוצאה הטובה ביותר</h2>
                                                    
                                                    {/* items-stretch מוודא שהקלף והשירים באותו גובה בדיוק */}
                                                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-6 gap-y-4 lg:gap-y-0 items-stretch" dir="rtl">
                                                        
                                                        {/* קופסת התוצאה המובילה */}
                                                        {(() => {
                                                            const topResult = searchResults[0];
                                                            const topType = topResult.type || 'song';
                                                            const isSong = topType === 'song' || topType === 'video';
                                                            
                                                            // מחשבים האם התוצאה הספציפית הזו מנגנת כרגע
                                                            const isSelected = isSong ? playerState.currentSong?.id === topResult.id : playingPlaylistId === `temp-${topResult.id}`;
                                                            const isPlaying = isSelected && playerState.isPlaying;
                                                            
                                                            return (
                                                                <div 
                                                                    onClick={() => handleResultClick(topResult)}
                                                                    className="lg:col-span-1 h-full bg-gradient-to-br from-[#282828] to-[#121212] hover:from-[#383838] p-6 rounded-2xl cursor-pointer transition-all group relative flex flex-col justify-center border border-white/10 shadow-2xl"
                                                                >
                                                                    <div className={`w-32 h-32 mb-5 mx-auto lg:mx-0 flex items-center justify-center relative
                                                                        ${topType === 'artist' ? 'rounded-full border-2 border-white/5 shadow-xl bg-[#282828]' : ''}
                                                                        ${topType === 'album' ? 'rounded-full border-[2px] border-[#555] shadow-xl bg-gradient-to-tr from-[#222] via-[#333] to-[#222]' : ''}
                                                                        ${topType === 'podcast' ? 'rounded-2xl shadow-xl bg-[#222222]' : ''}
                                                                        ${topType === 'playlist' || topType === 'spotify_playlist' ? 'rounded-xl shadow-xl bg-[#282828]' : ''}
                                                                        ${topType === 'song' || topType === 'video' ? 'rounded-xl shadow-xl bg-[#282828] overflow-hidden' : ''}
                                                                    `}>
                                                                        {topType === 'artist' && <ArtistIcon className="w-16 h-16 text-gray-500" />}
                                                                        
                                                                        {topType === 'album' && (
                                                                            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                                                                <div className="w-10 h-10 rounded-full border border-white/20 flex items-center justify-center bg-[#111] shadow-[0_0_10px_rgba(0,0,0,0.5)]">
                                                                                    <div className="w-4 h-4 bg-[#181818] rounded-full shadow-[inset_0_2px_4px_rgba(0,0,0,0.8)]"></div>
                                                                                </div>
                                                                            </div>
                                                                        )}

                                                                        {topType === 'podcast' && <PodcastIcon className="w-16 h-16 text-gray-500" />}
                                                                        {(topType === 'playlist' || topType === 'spotify_playlist') && <PlaylistIcon className="w-16 h-16 text-gray-500" />}
                                                                        {(topType === 'song' || topType === 'video') && (
                                                                            topResult.thumbnail_url ? <img src={topResult.thumbnail_url} className="w-full h-full object-cover" /> : <MusicIcon className="w-16 h-16 text-gray-500" />
                                                                        )}
                                                                    </div>
                                                                    
                                                                    {/* כותרת מוארת אם מנגן */}
                                                                    <h3 className={`text-3xl font-black truncate mb-2 ${isSelected ? 'text-spotify-primary' : 'text-white'}`}>
                                                                        {topResult.title}
                                                                    </h3>
                                                                    <div className="flex items-center gap-2">
                                                                        <span className="bg-spotify-primary/20 text-spotify-primary px-3 py-1 rounded-full text-[12px] font-bold tracking-wide">
                                                                            {topType === 'artist' ? 'אמן' : topType === 'playlist' || topType === 'spotify_playlist' ? 'פלייליסט' : topType === 'album' ? 'אלבום' : 'שיר'}
                                                                        </span>
                                                                        {topType !== 'artist' && <span className="text-gray-400 text-sm font-medium truncate">{topResult.author || topResult.channel}</span>}
                                                                    </div>
                                                                    
                                                                    {/* כפתור הפליי המתחלף */}
                                                                    <div className="absolute bottom-6 left-6 scale-110 z-20">
                                                                        <button 
                                                                            onClick={(e) => handleDirectPlay(e, topResult)}
                                                                            className="w-14 h-14 bg-spotify-primary rounded-full flex items-center justify-center text-black shadow-xl hover:scale-110 active:scale-95 transition-all"
                                                                        >
                                                                            {isPlaying ? <PauseIcon className="w-7 h-7" fill /> : <PlayIcon className="w-7 h-7 ml-1" fill />}
                                                                        </button>
                                                                    </div>
                                                                </div>
                                                            );
                                                        })()}                                                       {/* רשימת 4 השירים הבאים */}
                                                        <div className="lg:col-span-1 flex flex-col gap-1 bg-transparent">
                                                            {searchResults
                                                                .filter(r => !r.type || r.type === 'song' || r.type === 'video')
                                                                .filter(r => r.id !== searchResults[0].id)
                                                                .slice(0, 4)
                                                                .map((res) => {
                                                                    const isPlaying = playerState.currentSong?.id === res.id;
                                                                    const isLiked = likedSongsPlaylist?.songs.some(s => s.id === res.id);
                                                                    
                                                                    return (
                                                                        <div key={res.id} onClick={() => handleResultClick(res)} 
                                                                            className={`flex items-center gap-3 p-3 hover:bg-white/5 rounded-xl group cursor-pointer transition-all ${isPlaying ? 'bg-white/10' : ''}`}>
                                                                            <div className="w-11 h-11 bg-[#282828] rounded flex items-center justify-center text-gray-400 flex-shrink-0 overflow-hidden relative">
                                                                                {res.thumbnail_url ? (
                                                                                    <img src={res.thumbnail_url} className="w-full h-full object-cover" />
                                                                                ) : (
                                                                                    <MusicIcon className={`w-5 h-5 ${isPlaying ? 'text-spotify-primary' : ''}`} />
                                                                                )}
                                                                            </div>
                                                                            <div className="flex-1 min-w-0 text-right">
                                                                                <div className={`text-[14px] font-bold truncate ${isPlaying ? 'text-spotify-primary' : 'text-white'}`}>{res.title}</div>
                                                                                <div className="text-[12px] text-gray-400 truncate">{res.author}</div>
                                                                            </div>
                                                                            <div className="flex items-center gap-1">
                                                                                <button onClick={(e) => { e.stopPropagation(); handleToggleLike(res); }} className={`p-2 transition-all ${isLiked ? 'text-[#ff4b4b]' : 'text-gray-400 hover:text-white active:scale-95'}`}>
                                                                                    <HeartIcon className="w-4 h-4" filled={isLiked} />
                                                                                </button>
                                                                                <button onClick={(e) => { e.stopPropagation(); handleAddToPlaylistClick(e, res); }} className="p-2 text-gray-400 hover:text-white transition-all active:scale-95">
                                                                                    <PlusIcon className="w-4 h-4" />
                                                                                </button>
                                                                            </div>
                                                                        </div>
                                                                    );
                                                                })}
                                                        </div>
                                                    </div>
                                                </section>
                                            )}

                                            {/* שירים נוספים (תצוגת רשימה) - ללא כפילות! */}
                                            {(() => {
                                                const songsToDisplay = searchResults
                                                    .filter(r => !r.type || r.type === 'song' || r.type === 'video')
                                                    .filter((r) => {
                                                        if (ytMusicFilter !== 'all') return true;
                                                        const topResultId = searchResults[0]?.id;
                                                        if (r.id === topResultId) return false;
                                                        const allSongsWithoutTop = searchResults.filter(s => !s.type || s.type === 'song' || s.type === 'video').filter(s => s.id !== topResultId);
                                                        const idx = allSongsWithoutTop.findIndex(s => s.id === r.id);
                                                        return idx >= 4;
                                                    });

                                                if (songsToDisplay.length === 0) return null;

                                                return (
                                                    <section>
                                                        {ytMusicFilter !== 'all' && <h2 className="text-xl font-bold text-white mb-4 px-1">שירים</h2>}
                                                        
                                                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-6 gap-y-1">
                                                            {songsToDisplay.map((res) => {
                                                                const isPlaying = playerState.currentSong?.id === res.id;
                                                                const isLiked = likedSongsPlaylist?.songs.some(s => s.id === res.id);
                                                                return (
                                                                    <div key={res.id} onClick={() => handleResultClick(res)} 
                                                                        className={`flex items-center gap-3 p-3 hover:bg-white/5 rounded-xl group cursor-pointer transition-all ${isPlaying ? 'bg-white/10' : ''}`}>
                                                                        <div className="w-11 h-11 bg-[#282828] rounded flex items-center justify-center text-gray-400 flex-shrink-0 overflow-hidden">
                                                                            {res.thumbnail_url ? <img src={res.thumbnail_url} className="w-full h-full object-cover" /> : <MusicIcon className="w-5 h-5" />}
                                                                        </div>
                                                                        <div className="flex-1 min-w-0 text-right" dir="rtl">
                                                                            <div className={`text-[14px] font-bold truncate ${isPlaying ? 'text-spotify-primary' : 'text-white'}`}>{res.title}</div>
                                                                            <div className="text-[12px] text-gray-400 truncate">{res.author}</div>
                                                                        </div>
                                                                        <div className="flex items-center gap-1">
                                                                            <button onClick={(e) => { e.stopPropagation(); handleToggleLike(res); }} className={`p-2 transition-all ${isLiked ? 'text-[#ff4b4b]' : 'text-gray-400 hover:text-white active:scale-95'}`}>
                                                                                <HeartIcon className="w-4 h-4" filled={isLiked} />
                                                                            </button>
                                                                            <button onClick={(e) => { e.stopPropagation(); handleAddToPlaylistClick(e, res); }} className="p-2 text-gray-400 hover:text-white transition-all active:scale-95">
                                                                                <PlusIcon className="w-4 h-4" />
                                                                            </button>
                                                                        </div>
                                                                    </div>
                                                                );
                                                            })}
                                                        </div>
                                                    </section>
                                                );
                                            })()}
                                        </div>
                                        {/* === סוף הבלוק שעטפנו יחד === */}

                                        {/* קומפוננטת רינדור עם עיצוב וקטורי שונה לכל סוג */}
                                        {(() => {
                                            const renderGridSection = (title, type, items) => {
                                                if (items.length === 0) return null;
                                                
                                                const styles = {
                                                    artist: { card: "items-center text-center", bg: "bg-transparent hover:bg-white/5", titleColor: "text-white" },
                                                    album: { card: "items-center text-center", bg: "bg-transparent hover:bg-white/5", titleColor: "text-white" },
                                                    playlist: { card: "text-right", bg: "bg-[#181818] hover:bg-[#282828]", titleColor: "group-hover:text-spotify-primary text-white" },
                                                    podcast: { card: "text-right", bg: "bg-[#252525] hover:bg-[#303030]", titleColor: "text-white" }
                                                };

                                                const s = styles[type] || styles.album;
                                                
                                                return (
                                                    <section className="mb-8">
                                                        <h2 className="text-xl font-bold text-white mb-4 px-1">{title}</h2>
                                                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 md:gap-6 px-1">
                                                            {items.map((res) => {
                                                                // בדיקה אם האלבום/פלייליסט הזה מנגן עכשיו
                                                                const isPlaying = playingPlaylistId === `temp-${res.id}` && playerState.isPlaying;

                                                                return (
                                                                    <div key={res.id} onClick={() => handleResultClick(res)} 
                                                                        className={`flex flex-col p-4 ${s.bg} ${s.card} rounded-2xl cursor-pointer transition-all relative group border border-transparent hover:border-white/10`} dir="rtl">
                                                                        
                                                                        <div className={`relative w-full aspect-square mb-4 flex items-center justify-center
                                                                            ${type === 'artist' ? 'rounded-full border-2 border-white/5 shadow-xl bg-[#282828]' : ''}
                                                                            ${type === 'album' ? 'rounded-full border-[2px] border-[#555] shadow-2xl bg-gradient-to-tr from-[#222] via-[#333] to-[#222]' : ''}
                                                                            ${type === 'podcast' ? 'rounded-2xl shadow-lg bg-[#222222]' : ''}
                                                                            ${type === 'playlist' || type === 'spotify_playlist' ? 'rounded-xl shadow-lg bg-[#282828]' : ''}
                                                                        `}>
                                                                            {/* ... תוכן האייקונים (אין שינוי) ... */}
                                                                            {type === 'artist' && <ArtistIcon className="w-2/5 h-2/5 text-gray-500" />}
                                                                            
                                                                            {type === 'album' && (
                                                                                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                                                                    <div className="w-[35%] h-[35%] rounded-full border border-white/20 flex items-center justify-center bg-[#111] shadow-[0_0_10px_rgba(0,0,0,0.5)]">
                                                                                        <div className="w-[30%] h-[30%] bg-[#181818] rounded-full shadow-[inset_0_2px_4px_rgba(0,0,0,0.8)]"></div>
                                                                                    </div>
                                                                                </div>
                                                                            )}

                                                                            {type === 'podcast' && <PodcastIcon className="w-2/5 h-2/5 text-gray-500" />}
                                                                            {(type === 'playlist' || type === 'spotify_playlist') && <PlaylistIcon className="w-2/5 h-2/5 text-gray-500" />}
                                                                            
                                                                            {/* כפתור Play/Pause צף מתחלף */}
                                                                            {type !== 'artist' && (
                                                                                <button 
                                                                                    onClick={(e) => handleDirectPlay(e, res)}
                                                                                    // עדכנו את המחלקה הבאה: מחקנו את 'lg:opacity-0 group-hover:opacity-100' והשארנו רק 'opacity-100'
                                                                                    className="absolute bg-spotify-primary rounded-full flex items-center justify-center text-black shadow-[0_4px_12px_rgba(0,0,0,0.6)] hover:scale-110 active:scale-95 transition-transform z-20 w-8 h-8 md:w-10 md:h-10 bottom-2 left-2 opacity-100"
                                                                                >
                                                                                    {isPlaying ? <PauseIcon className="w-4 h-4 md:w-5 md:h-5" fill /> : <PlayIcon className="w-4 h-4 md:w-5 md:h-5 ml-0.5" fill />}
                                                                                </button>
                                                                            )}
                                                                        </div>
                                                                        
                                                                        <div className={`text-[15px] font-bold truncate w-full px-1 ${s.titleColor || ''}`}>{res.title}</div>
                                                                        <div className="text-[12px] text-gray-400 truncate w-full px-1 mt-1 font-medium">
                                                                            {type === 'artist' ? 'אמן' : (res.author || (type === 'playlist' ? 'פלייליסט' : ''))}
                                                                        </div>
                                                                    </div>
                                                                );
                                                            })}
                                                        </div>
                                                    </section>
                                                );
                                            };

                                            return (
                                                <>
                                                    {renderGridSection('פלייליסטים', 'playlist', searchResults.filter(r => r.type === 'playlist' || r.type === 'spotify_playlist'))}
                                                    {renderGridSection('אמנים', 'artist', searchResults.filter(r => r.type === 'artist'))}
                                                    {renderGridSection('אלבומים', 'album', searchResults.filter(r => r.type === 'album'))}
                                                    {renderGridSection('פודקאסטים', 'podcast', searchResults.filter(r => r.type === 'podcast'))}
                                                </>
                                            );
                                        })()}
                                    </>
                                )}                            
                            </div>                                                          
                        </>
                    )}
                    {activeTab === 'streamify' && (
                        <div className="flex-1 p-4 overflow-y-auto no-scrollbar pt-[max(2.5rem,env(safe-area-inset-top))] md:pt-4">
                            <div className="flex justify-between items-center mb-6 px-1">
                                <h1 className="text-2xl font-bold">מומלצים עבורך (Streamify)</h1>
                                <button 
                                    onClick={() => loadStreamifyRecommendations(true)} 
                                    className="p-2 bg-white/10 hover:bg-white/20 rounded-full flex items-center transition text-gray-400 hover:text-white"
                                    title="רענן פלייליסטים מחדש"
                                >
                                    <RefreshCcwIcon className={`w-5 h-5 ${isLoadingStreamify ? 'animate-spin' : ''}`} />
                                </button>
                            </div>

                            {isLoadingStreamify && streamifyResults.length === 0 ? (
                                <div className="flex justify-center items-center mt-10">
                                    <LoaderIcon className="w-8 h-8 animate-spin text-spotify-primary" />
                                </div>
                            ) : (
                                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 md:gap-6 px-1">
                                    {streamifyResults.map((res, idx) => {
                                        const isPlaying = playingPlaylistId === `temp-${res.id}` && playerState.isPlaying;
                                        return (
                                            <div key={`${res.id}-${idx}`} onClick={() => handleResultClick(res)} 
                                                className="flex flex-col p-4 bg-[#181818] hover:bg-[#282828] text-right rounded-2xl cursor-pointer transition-all relative group border border-transparent hover:border-white/10" dir="rtl">
                                                
                                                <div className="relative w-full aspect-square mb-4 flex items-center justify-center rounded-xl shadow-lg bg-[#282828] overflow-hidden">
                                                    {res.thumbnail_url ? <img src={res.thumbnail_url} className="w-full h-full object-cover" /> : <PlaylistIcon className="w-2/5 h-2/5 text-gray-500" />}
                                                    
                                                    <button 
                                                        onClick={(e) => handleDirectPlay(e, res)}
                                                        className="absolute bg-spotify-primary rounded-full flex items-center justify-center text-black shadow-[0_4px_12px_rgba(0,0,0,0.6)] hover:scale-110 active:scale-95 transition-transform z-20 w-8 h-8 md:w-10 md:h-10 bottom-2 left-2 opacity-100"
                                                    >
                                                        {isPlaying ? <PauseIcon className="w-4 h-4 md:w-5 md:h-5" fill /> : <PlayIcon className="w-4 h-4 md:w-5 md:h-5 ml-0.5" fill />}
                                                    </button>
                                                </div>
                                                
                                                <div className="text-[15px] font-bold truncate w-full px-1 group-hover:text-spotify-primary text-white">{res.title}</div>
                                                <div className="text-[12px] text-gray-400 truncate w-full px-1 mt-1 font-medium">{res.author || 'פלייליסט'}</div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    )}
                    {activeTab === 'playlist' && selectedPlaylist && (
                        <div>
                            <div className="sticky top-0 z-10 p-4 pt-[max(2.5rem,env(safe-area-inset-top))] md:pt-4 bg-spotify-base/95 backdrop-blur flex items-center gap-4 border-b border-white/5">
                                <button onClick={() => { setSelectedPlaylist(null); setActiveTab(prevTab); }} className="p-2 bg-black/40 rounded-full hover:bg-white/20"> <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg> </button>
                                <h1 className={`font-bold text-xl truncate ${!selectedPlaylist.isLikedSongs && !selectedPlaylist.id.startsWith('temp-') ? 'cursor-pointer' : ''}`} onClick={() => { if (selectedPlaylist.isLikedSongs || selectedPlaylist.id.startsWith('temp-') || selectedPlaylist.externalId) return; setInputModal({ isOpen: true, title: "שם חדש:", defaultValue: selectedPlaylist.name, onConfirm: (val) => { if(val) apiRenameItem(selectedPlaylist.id, val, 'playlist'); } }); setInputModalValue(selectedPlaylist.name); }}> {selectedPlaylist.name} </h1>
                            </div>
                            <div className="p-6 flex flex-col items-center text-center bg-gradient-to-b from-white/5 to-transparent">
                                <div className="w-40 h-40 bg-neutral-800 shadow-2xl rounded-lg flex items-center justify-center text-gray-200 mb-4">
                                    {selectedPlaylist.isLikedSongs ? <HeartIcon className="w-20 h-20 text-spotify-primary" filled/> : 
                                     selectedPlaylist.externalType === 'album' ? <AlbumIcon className="w-20 h-20"/> :
                                     selectedPlaylist.externalType === 'artist' ? <ArtistIcon className="w-20 h-20"/> :
                                     selectedPlaylist.externalType === 'podcast' ? <PodcastIcon className="w-20 h-20"/> :
                                     <MusicIcon className="w-20 h-20"/>}
                                </div>
                                <h2 className={`text-2xl font-bold mb-1 ${!selectedPlaylist.isLikedSongs && !selectedPlaylist.id.startsWith('temp-') && !selectedPlaylist.externalId ? 'cursor-pointer' : ''}`} onClick={() => { if (selectedPlaylist.isLikedSongs || selectedPlaylist.id.startsWith('temp-') || selectedPlaylist.externalId) return; setInputModal({ isOpen: true, title: "שם חדש:", defaultValue: selectedPlaylist.name, onConfirm: (val) => { if(val) apiRenameItem(selectedPlaylist.id, val, 'playlist'); } }); setInputModalValue(selectedPlaylist.name); }}> {selectedPlaylist.name} </h2>
                                <p className="text-gray-400 text-sm">
                                    {selectedPlaylist.songs.length > 0 ? `${selectedPlaylist.songs.length} שירים` : selectedPlaylist.externalId ? 'נטען מהרשת...' : 'ריק'}
                                </p>
                            </div>
                            <div className="p-4">
                                <div className="flex justify-center gap-6 mb-8 items-center">
                                    <button onClick={toggleShuffle} className={`p-4 rounded-full bg-white/10 ${playerState.isShuffled ? 'text-spotify-primary' : 'text-white'}`}> <ShuffleIcon className="w-8 h-8" active={playerState.isShuffled} /> </button>
                                    <button onClick={() => handlePlaylistPlay(selectedPlaylist)} className="bg-spotify-primary text-black p-4 rounded-full shadow-lg transform hover:scale-105 transition-transform" disabled={selectedPlaylist.songs.length === 0 && !selectedPlaylist.externalId}> {playingPlaylistId === selectedPlaylist.id && playerState.isPlaying ? <PauseIcon className="w-8 h-8" fill /> : <PlayIcon className="w-8 h-8" fill />} </button>
                                    {selectedPlaylist.id.startsWith('temp-') && selectedPlaylist.songs.length > 0 && ( <button onClick={() => { setSongsToAdd(selectedPlaylist.songs); setShowPlaylistSelector(true); }} className="bg-white/10 text-white p-4 rounded-full" title="הוסף הכל"> <PlusIcon className="w-8 h-8" /> </button> )}
                                </div>

                                <div className="space-y-1">
                                    {selectedPlaylist.songs.slice(0, playlistDisplayLimit).map((song, idx) => (
                                        <div key={song.id + idx} onClick={() => { if (!isLongPressRef.current) handlePlaySong(song, selectedPlaylist.songs, idx, false, selectedPlaylist.id); }} onTouchStart={() => { isLongPressRef.current = false; longPressTimer.current = setTimeout(() => { isLongPressRef.current = true; }, 500); }} onTouchEnd={() => clearTimeout(longPressTimer.current)} onTouchMove={() => clearTimeout(longPressTimer.current)} onContextMenu={(e) => { e.preventDefault(); clearTimeout(longPressTimer.current); handleRemoveSongWithConfirmation(song); }} className="flex items-center gap-3 p-2 rounded hover:bg-white/10 cursor-pointer">
                                            <div className="w-8 text-center text-sm text-gray-400">{playerState.currentSong?.id && song.id && playerState.currentSong.id === song.id && playerState.isPlaying ? <MusicIcon className="w-4 h-4 text-spotify-primary animate-pulse inline" /> : idx + 1}</div>
                                            <div className="flex-1 min-w-0"> <div className={`font-medium truncate ${playerState.currentSong?.id && song.id && playerState.currentSong.id === song.id ? 'text-spotify-primary' : ''}`}>{song.title}</div> <div className="text-xs text-gray-400 truncate">{song.author}</div> </div>
                                            <div className="text-xs text-gray-500 font-mono">{formatDuration(song.duration)}</div>
                                            <div className="flex items-center"> <button onClick={(e) => { e.stopPropagation(); handleToggleLike(song); }} className={`p-2 ${likedSongsPlaylist?.songs.some(s => s.id === song.id) ? 'text-spotify-primary' : 'text-gray-400 hover:text-white'}`}> <HeartIcon filled={likedSongsPlaylist?.songs.some(s => s.id === song.id)} /> </button> {!selectedPlaylist.isLikedSongs && !selectedPlaylist.externalId && <button onClick={(e) => {e.stopPropagation(); setSongsToAdd([song]); setShowPlaylistSelector(true);}} className="p-2 text-gray-400 hover:text-white"> <PlusIcon /> </button>} </div>
                                        </div>
                                    ))}
                                    
                                    {/* אלמנט הגשש (Trigger) - נטען אוטומטית כשמגיעים אליו */}
                                    {selectedPlaylist.songs.length > playlistDisplayLimit && (
                                        <div ref={observerTarget} className="h-16 w-full flex items-center justify-center">
                                            <span className="text-gray-500 text-sm animate-pulse">טוען...</span>
                                        </div>
                                    )}
                                </div>

                                {!selectedPlaylist.id.startsWith('temp-') && !selectedPlaylist.isLikedSongs && !selectedPlaylist.externalId && (
                                    <div className="my-8">
                                        <div className="relative"> <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" /> <input type="text" placeholder="חיפוש שירים להוספה..." value={playlistSearchQuery} onChange={e => setPlaylistSearchQuery(e.target.value)} className="w-full bg-white/10 rounded-full py-2 pr-4 pl-10 text-white placeholder-gray-400" /> </div>
                                        {isPlaylistSearching && (
                                            <div className="flex justify-center items-center mt-4">
                                                <LoaderIcon className="w-6 h-6 animate-spin text-spotify-primary" />
                                            </div>
                                        )}                                        
                                        {playlistSearchResults.length > 0 && (
                                            <div className="mt-2 space-y-1 max-h-60 overflow-y-auto no-scrollbar">
                                                {playlistSearchResults.filter(r => !r.type || r.type === 'song' || r.type === 'video').map(res => (
                                                    <div key={res.id} className="flex items-center gap-3 p-2 hover:bg-white/10 rounded group">
                                                        <div className="w-10 h-10 bg-neutral-800 rounded flex items-center justify-center text-gray-200 flex-shrink-0"> <MusicIcon className="w-5 h-5"/> </div>
                                                        <div className="min-w-0 flex-1"> <div className="font-medium truncate text-sm">{res.title}</div> <div className="text-xs text-gray-400 truncate">{res.author}</div> </div>
                                                        <button onClick={(e) => handleAddToPlaylistClick(e, res, selectedPlaylist.id)} className="p-2 text-gray-400 hover:text-white"> <PlusIcon /> </button>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </main>
            </div>
            <Player 
                playerState={playerState} 
                onPlayPause={togglePlayPause} 
                onNext={handleNext} 
                onPrev={handlePrev} 
                onShuffle={toggleShuffle} 
                onToggleExpand={() => setPlayerState(p => ({...p, isExpanded: !p.isExpanded}))} 
                onSeek={handleSeek} 
                onRemoveCurrentSong={handleRemoveCurrentSongClick} 
            />            
            <div className="md:hidden w-full flex-shrink-0 bg-neutral-900 border-t border-white/10 flex justify-around p-2 z-50 text-[10px]">
                <button onClick={() => setActiveTab('streamify')} className={`flex flex-col items-center p-2 ${activeTab==='streamify'?'text-white':'text-gray-500'}`}> 
                    <MusicIcon className="mb-1" /> Streamify 
                </button>
                <button onClick={() => setActiveTab('home')} className={`flex flex-col items-center p-2 ${activeTab==='home'?'text-white':'text-gray-500'}`}> 
                    <HomeIcon className="mb-1" /> בית 
                </button>
                <button onClick={() => setActiveTab('search')} className={`flex flex-col items-center p-2 ${activeTab==='search'?'text-white':'text-gray-500'}`}> 
                    <SearchIcon className="mb-1" /> חיפוש 
                </button>
                <button onClick={() => setActiveTab('library')} className={`flex flex-col items-center p-2 ${activeTab==='library'?'text-white':'text-gray-500'}`}> 
                    <LibraryIcon className="mb-1" /> ספרייה 
                </button>
            </div>
        </div>
    );
};

export default App;
