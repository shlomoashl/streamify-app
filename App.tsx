
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { KeepAwake } from '@capacitor-community/keep-awake';
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
    TerminalIcon, PodcastIcon, GridIcon, ListIcon, LoaderIcon, ShareIcon, UsersIcon, TrashIcon, XIcon, EditIcon, ClockIcon, RefreshCcwIcon
} from './components/Icons';
import Player from './components/Player';
import TitleBar from './components/TitleBar';
import { audioService } from './AudioService';
import { logger } from './Logger';
import LogViewer from './components/LogViewer';
import { storageService } from './StorageService';

// Import Plugin definition for direct usage if needed
const StreamifyMedia = registerPlugin<StreamifyMediaPlugin>('StreamifyMedia');

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
    const [playlists, setPlaylists] = useState<Playlist[]>([]);
    const [folders, setFolders] = useState<Folder[]>([]);
    const [likedSongsPlaylist, setLikedSongsPlaylist] = useState<Playlist | null>(null);
    
    // UI States
    const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
    const [expandedHomeFolders, setExpandedHomeFolders] = useState<Set<string>>(new Set());
    const [showLogs, setShowLogs] = useState(false);
    const [globalLoading, setGlobalLoading] = useState<string | null>(null);
    const [isAppReady, setIsAppReady] = useState(false); // To prevent UI flashing before async load
    const wasPlayingRef = useRef(false); // Track playback state across network/app interruptions

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
    }, [selectedPlaylist, playlistDisplayLimit]);
    
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

    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState<YouTubeSearchResult[]>([]);
    const [isSearching, setIsSearching] = useState(false);
    const [searchHistory, setSearchHistory] = useState<string[]>([]);
    
    // AbortController for canceling previous searches
    const searchAbortController = useRef<AbortController | null>(null);

    const [ytMusicFilter, setYtMusicFilter] = useState<'songs' | 'albums' | 'artists' | 'playlists' | 'podcasts'>('songs');
    
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
                                // Find playlist in loaded cache
                                const playlist = savedPlaylists.find(p => p.id === lastNative.contextId);
                                if (playlist && playlist.songs.length > 0) {
                                    restoredPlaylistId = playlist.id;
                                    
                                    // 1. קודם כל לוקחים את התור הרגיל מהספרייה (כדי שיהיה מעודכן)
                                    let baseQueue = playlist.songs;
                                    
                                    // 2. בודקים אם יש לנו תור שמור (ובעיקר תור מקורי) ב-State הישן
                                    if (savedPlayerState && savedPlayerState.playingPlaylistId === restoredPlaylistId) {
                                        console.log("Restoring queue context from saved state. Shuffle was:", savedIsShuffled);
                                        
                                        if (savedIsShuffled && savedPlayerState.originalQueue && savedPlayerState.queue) {
                                            // אם ה-Shuffle היה דלוק ויש לנו את התור המעורבב שמור, נשתמש בו
                                            // זה קריטי כדי שהשירים לא יתערבבו מחדש בכל פתיחה של האפליקציה
                                            restoredQueue = savedPlayerState.queue;
                                            originalQueueForState = savedPlayerState.originalQueue;
                                        } else {
                                            // אם לא היה Shuffle, או שאין מידע תקין, פשוט ניקח את התור הרגיל
                                            restoredQueue = baseQueue;
                                        }
                                    } else {
                                        // מנגנון גיבוי: אם אין State שמור אבל ה-Shuffle הכללי מופעל
                                        restoredQueue = baseQueue;
                                        if (savedIsShuffled) {
                                            originalQueueForState = [...baseQueue];
                                            restoredQueue = shuffleArray([...baseQueue]);
                                        }
                                    }
                                    
                                    // 3. מחפשים את השיר הנוכחי (מה-Native) בתוך התור ששחזרנו
                                    const songIndex = restoredQueue.findIndex(s => s.id === lastNative.id);
                                    if (songIndex !== -1) {
                                        restoredIndex = songIndex;
                                        
                                        // Update song metadata from playlist to be sure we have full details
                                        const foundSong = restoredQueue[songIndex];
                                        nativeSong.title = foundSong.title;
                                        nativeSong.author = foundSong.author;
                                        nativeSong.thumbnail = foundSong.thumbnail;
                                        nativeSong.duration = foundSong.duration;
                                        nativeSong.addedBy = foundSong.addedBy;
                                        
                                        console.log(`Context restored: Playlist "${playlist.name}", Index ${songIndex}, Queue Size: ${restoredQueue.length}, Shuffled: ${savedIsShuffled}`);
                                    } else {
                                        // גיבוי לגיבוי: אם השיר לא נמצא בתור (אולי הפלייליסט השתנה)
                                        console.warn("Song not found in restored playlist context. Falling back to single song queue.");
                                        restoredQueue = [nativeSong];
                                        originalQueueForState = undefined;
                                        // כאן אנחנו לא יכולים לדעת באמת אם ה-Shuffle רלוונטי
                                    }
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
                        if (savedPlayerState.currentSong?.duration) {
                            setDuration(savedPlayerState.currentSong.duration);
                        }
                    }
                }
                
                // Mark state as loaded to allow saving updates
                stateLoadedRef.current = true;

                // Last selected playlist
                const lastPlaylist = await storageService.loadData<Playlist | null>('streamify_last_playlist', null);
                if (lastPlaylist) setSelectedPlaylist(lastPlaylist);

                setIsAppReady(true);
            } catch (e) {
                console.error("Initialization failed:", e);
                stateLoadedRef.current = true; // Allow saving even if load failed, to recover eventually
                setIsAppReady(true); 
            }
        };
        initApp();
    }, []);

    // --- Helper Functions to Update Local & Cache ---

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

    const triggerAutoPlay = async () => {
        if (audioInitializedRef.current) return;
        if (!playerState.currentSong) return;
        console.log(`Auto-play attempt...`);
        try {
            setPlayerState(prev => ({ ...prev, isPlaying: true }));
            await audioService.playQueue(playerState.queue, playerState.currentIndex, playingPlaylistId || undefined);
            audioInitializedRef.current = true;
            
            // משיכת המיקום השמור ודילוג אליו
            const savedPosition = parseFloat(localStorage.getItem('last_played_position') || '0');
            if (savedPosition > 3) {
                // נותנים לנגן חצי שנייה להתחיל לנגן לפני הדילוג החכם
                setTimeout(() => {
                    audioService.seek(savedPosition);
                }, 500);
            }
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

    const saveStateToStorage = (state: PlayerState, currentPlaylistId: string | null, currentTimeVal: number) => {
        if (!stateLoadedRef.current) return; // Don't save if we haven't loaded initial state yet
        
        const stateToSave = { ...state, savedTime: 0, playingPlaylistId: currentPlaylistId };
        delete (stateToSave as any).originalQueue;
        storageService.saveData('streamify_player_state', stateToSave);
    };

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

    // --- Search Logic Optimized ---
    useEffect(() => { 
        // OPTIMIZATION: Cancel previous request *immediately* when typing starts
        if (searchAbortController.current) {
            searchAbortController.current.abort();
        }

        const handler = setTimeout(() => { 
            if (searchQuery.trim()) {
                performSearch(searchQuery, false);
            } else { 
                setSearchResults([]); 
                setIsSearching(false);
            } 
        }, 800); // OPTIMIZATION: Increased debounce from 500 to 800

        return () => clearTimeout(handler); 
    }, [searchQuery, ytMusicFilter]);

    useEffect(() => { const handler = setTimeout(() => { if (playlistSearchQuery.trim()) performSearch(playlistSearchQuery, true); else setPlaylistSearchResults([]); }, 500); return () => clearTimeout(handler); }, [playlistSearchQuery]);
    
    const performSearch = async (term: string, isPlaylistContext: boolean) => {
        const spotifyMatch = term.match(/open\.spotify\.com\/playlist\/([a-zA-Z0-9]+)/); 
        if (spotifyMatch && !isPlaylistContext) { handleSpotifyImport(spotifyMatch[1]); return; }
        
        const setLoading = isPlaylistContext ? setIsPlaylistSearching : setIsSearching; 
        const setResults = isPlaylistContext ? setPlaylistSearchResults : setSearchResults;
        setLoading(true);

        if (!isPlaylistContext) {
            // Save search history on execution
            addToSearchHistory(term);
            
            if (searchAbortController.current) {
                searchAbortController.current.abort();
            }
            searchAbortController.current = new AbortController();
        }

        try {
            const searchEngine = isPlaylistContext ? 'youtubemusic_songs' : `youtubemusic_${ytMusicFilter}`;
            const params = new URLSearchParams({ action: 'search_and_download_video', query: term, search_engine: searchEngine });
            
            const res = await fetch(`${YOUTUBE_API_BASE}?${params.toString()}`, {
                signal: !isPlaylistContext ? searchAbortController.current?.signal : undefined
            }); 
            
            const data: YouTubeDownloadResponse = await res.json();
            const finalResults = data.success && data.results ? data.results : [];
            setResults(finalResults);
        } catch (e: any) { 
            if (e.name !== 'AbortError') {
                setResults([]); 
            } else {
                // Aborted, do nothing (keep loading state if a new request took over, or handled by next effect)
                return;
            }
        } finally { 
            if (isPlaylistContext) {
                setLoading(false);
            } else {
                 if (searchAbortController.current && !searchAbortController.current.signal.aborted) {
                     setLoading(false); 
                 }
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
        localStorage.setItem('last_played_position', '0');
        // PASS PLAYLIST ID AS CONTEXT
        audioService.playQueue(finalQueue, finalIndex, playlistId || undefined);
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
        setPlayerState(prev => { 
            if (!prev.queue || prev.queue.length === 0) return prev; 
            const nextIdx = (prev.currentIndex + 1) % prev.queue.length; 
            const nextSong = prev.queue[nextIdx];
            // Pass current playlist ID context
            audioService.playQueue(prev.queue, nextIdx, playingPlaylistId || undefined);
            return { ...prev, currentIndex: nextIdx, currentSong: nextSong, isPlaying: true }; 
        }); 
    }, [playingPlaylistId]);

    const handlePrev = useCallback(() => { 
        audioInitializedRef.current = true;
        setPlayerState(prev => { 
            if (!prev.queue || prev.queue.length === 0) return prev; 
            const prevIdx = (prev.currentIndex - 1 + prev.queue.length) % prev.queue.length; 
            const prevSong = prev.queue[prevIdx];
            audioService.playQueue(prev.queue, prevIdx, playingPlaylistId || undefined);
            return { ...prev, currentIndex: prevIdx, currentSong: prevSong, isPlaying: true }; 
        }); 
    }, [playingPlaylistId]);

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
            
            localStorage.setItem('streamify_shuffle', String(newState.isShuffled)); // שומר לזיכרון!
            audioService.playQueue(newState.queue, newState.currentIndex, playingPlaylistId || undefined);
            saveStateToStorage(newState, playingPlaylistId, 0);
            return newState;
        });
    };
    
    const togglePlayPause = () => {
        if (playerState.isPlaying) { 
            audioService.pause(); 
            setPlayerState(p => ({ ...p, isPlaying: false })); 
            saveStateToStorage(playerState, playingPlaylistId, 0);
        } else {
            // Fallback: If player has a song but native wasn't initialized (e.g. app restart without auto-play)
            // we must re-send the queue to native so it knows what to play next
            if (!audioInitializedRef.current && playerState.currentSong) { 
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
        });

        const stateListener = audioService.addListener('stateChange', (data: any) => { setPlayerState(prev => ({ ...prev, isPlaying: data.isPlaying })); });
        const endListener = audioService.addListener('ended', () => { setPlayerState(prev => ({ ...prev, isPlaying: false })); });
        // שומר את המיקום כל 5 שניות לזיכרון המקומי
        const timeListener = audioService.addListener('timeUpdate', (data: any) => {
            if (data.currentTime > 0 && Math.floor(data.currentTime) % 5 === 0) {
                localStorage.setItem('last_played_position', data.currentTime.toString());
            }
        });        
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
            timeListener.remove();
            audioService.cleanup(); 
            
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
        // Feature: Add to History when result is clicked (Redundant if saved on search, but keeps history robust)
        addToSearchHistory(searchQuery);

        if (!result.type || result.type === 'song' || result.type === 'video') { const songQueue = searchResults.filter(r => !r.type || r.type === 'song' || r.type === 'video').map(r => searchResultToPlaylistItem(r, 'search')); const clickedSongIndex = songQueue.findIndex(s => s.id === result.id); if (clickedSongIndex !== -1) handlePlaySong(songQueue[clickedSongIndex], songQueue, clickedSongIndex, false); return; }
        if (result.type === 'spotify_playlist') { handleSpotifyImport(result.id); return; }
        
        // Handle generic container click (album/playlist/artist)
        setIsSearching(true); setGlobalLoading("טוען...");
        try { 
            const res = await fetch(`${YOUTUBE_API_BASE}/ytmusic-browse/${result.id}?type=${result.type}`); const data = await res.json();
            if (data.success && data.results) { const tracks: PlaylistItem[] = data.results.map((r: any) => searchResultToPlaylistItem(r, 'temp')); const tempPlaylist: Playlist = { id: `temp-${result.id}`, name: result.title, creator: result.author || '', isPublic: false, songs: tracks }; setSelectedPlaylist(tempPlaylist); setActiveTab('playlist'); } 
        } catch { setConfirmModal({ isOpen: true, title: "שגיאה", message: "שגיאה בטעינת התוכן", onConfirm: () => setConfirmModal(prev => ({...prev, isOpen: false})), isAlertOnly: true }); }
        finally { setIsSearching(false); setGlobalLoading(null); }
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
                    <div onClick={() => setActiveTab('home')} className="flex items-center gap-2 text-xl font-bold mb-2 cursor-pointer hover:text-green-500 transition-colors"><MusicIcon /> Streamify</div>
                    <div className="space-y-1">
                        <button onClick={() => setActiveTab('home')} className={`flex items-center gap-4 py-2 px-4 rounded-lg transition-colors w-full text-right ${activeTab==='home'?'bg-white/20 text-white':'text-gray-400 hover:bg-white/10 hover:text-white'}`}> <HomeIcon /> <span className="font-medium text-lg">בית</span> </button>
                        <button onClick={() => setActiveTab('search')} className={`flex items-center gap-4 py-2 px-4 rounded-lg transition-colors w-full text-right ${activeTab==='search'?'bg-white/20 text-white':'text-gray-400 hover:bg-white/10 hover:text-white'}`}> <SearchIcon /> <span className="font-medium text-lg">חיפוש</span> </button>
                        {likedSongsPlaylist && <button onClick={() => {setSelectedPlaylist(likedSongsPlaylist); setActiveTab('playlist');}} className={`flex items-center gap-4 py-2 px-4 rounded-lg transition-colors w-full text-right ${activeTab === 'playlist' && selectedPlaylist?.id === likedSongsPlaylist.id ? 'bg-white/20 text-white' : 'text-gray-400 hover:bg-white/10 hover:text-white'}`}> <HeartIcon filled className="text-spotify-primary"/> <span className="font-medium text-lg">שירים שאהבתם</span> </button>}
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
                                        <div className="flex gap-2 md:hidden">
                                            <button onClick={() => setShowLogs(true)} className="p-3 bg-white/10 rounded-full text-white hover:bg-white/20" title="לוגים"> <TerminalIcon className="w-5 h-5" /> </button>
                                            <button onClick={handleLogout} className="p-3 bg-white/10 rounded-full text-white hover:bg-white/20" title="התנתק"> <LogOutIcon className="w-5 h-5" /> </button>
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
                            <div className="p-4 pt-[max(2.5rem,env(safe-area-inset-top))] md:pt-4 bg-spotify-base z-20 shadow-md flex-shrink-0 border-b border-white/5">
                                <div className="relative flex items-center gap-4">
                                    <div className="relative flex-1"> <SearchIcon className="absolute left-3 top-3 text-gray-400" /> <input className="w-full bg-white/10 rounded-full py-3 pr-4 pl-10 text-white focus:outline-none focus:ring-1 focus:ring-spotify-primary" placeholder="חיפוש שירים, אלבומים..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} /> </div>
                                </div>
                                <div className="flex gap-2 mt-3 overflow-x-auto no-scrollbar pb-1"> {['songs', 'albums', 'playlists', 'artists', 'podcasts'].map(f => ( <button key={f} onClick={() => setYtMusicFilter(f as any)} className={`px-4 py-1 rounded-full text-xs border whitespace-nowrap transition-colors ${ytMusicFilter === f ? 'bg-white text-black border-white' : 'border-white/20 hover:border-white text-white'}`}> {filterMap[f] || f} </button> ))} </div>
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
                                                <div key={i} className="flex items-center justify-between p-3 rounded-lg hover:bg-white/10 group cursor-pointer" onClick={() => { setSearchQuery(term); performSearch(term, false); }}>
                                                    <div className="flex items-center gap-4 min-w-0">
                                                        <div className="text-gray-400"><ClockIcon className="w-5 h-5"/></div>
                                                        <span className="truncate">{term}</span>
                                                    </div>
                                                    <button onClick={(e) => { e.stopPropagation(); removeSearchHistoryItem(term); }} className="text-gray-400 hover:text-white p-2">
                                                        <XIcon className="w-4 h-4"/>
                                                    </button>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                ) : isSearching ? (
                                    <div className="text-center mt-10 opacity-50">טוען...</div>
                                ) : (
                                    searchResults.map((res, i) => (
                                    <div key={res.id + i} className="flex items-center gap-3 p-2 hover:bg-white/10 rounded group">
                                        <div onClick={() => handleResultClick(res)} className="flex-1 flex items-center gap-3 min-w-0 cursor-pointer">
                                            <div className="w-12 h-12 bg-neutral-800 rounded flex items-center justify-center text-gray-200 flex-shrink-0">{renderSearchIcon(res.type)}</div>
                                            <div className="min-w-0 flex-1">
                                                <div className="font-medium truncate">{res.title}</div>
                                                <div className="text-xs text-gray-400 truncate flex items-center">
                                                    <span className="flex-shrink-0"> {res.type ? (filterMap[res.type + 's'] || res.type).replace(/s$/, '') : 'שיר'} </span>
                                                    <span className="mx-1 flex-shrink-0">•</span>
                                                    <span dir="auto" className="truncate text-right"> {res.author} </span>
                                                    
                                                    {/* NEW: Duration/Item Count for all types */}
                                                    {res.duration && res.duration !== 'N/A' && res.duration !== 0 && (
                                                        <>
                                                            <span className="mx-1 flex-shrink-0">•</span>
                                                            <span>{typeof res.duration === 'number' ? formatDuration(res.duration) : res.duration}</span>
                                                        </>
                                                    )}
                                                    {res.itemCount && (
                                                        <>
                                                            <span className="mx-1 flex-shrink-0">•</span>
                                                            <span>{res.itemCount} {['album','playlist'].includes(res.type||'') ? 'פריטים' : ''}</span>
                                                        </>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                        {(!res.type || res.type === 'song' || res.type === 'video') && <button onClick={() => handleToggleLike(res)} className={`p-2 ${likedSongsPlaylist?.songs.some(s => s.id === res.id) ? 'text-spotify-primary' : 'text-gray-400 hover:text-white'}`}> <HeartIcon filled={likedSongsPlaylist?.songs.some(s => s.id === res.id)} /> </button>}
                                        <button onClick={(e) => handleAddToPlaylistClick(e, res)} className="p-2 text-gray-400 hover:text-white"> <PlusIcon /> </button>
                                    </div>
                                )))}                                
                            </div>
                        </>
                    )}

                    {activeTab === 'playlist' && selectedPlaylist && (
                        <div>
                            <div className="sticky top-0 z-10 p-4 pt-[max(2.5rem,env(safe-area-inset-top))] md:pt-4 bg-spotify-base/95 backdrop-blur flex items-center gap-4 border-b border-white/5">
                                {selectedPlaylist.id.startsWith('temp-') && ( <button onClick={() => { setSelectedPlaylist(null); setActiveTab('search'); }} className="p-2 bg-black/40 rounded-full hover:bg-white/20"> <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg> </button> )}
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
                                        {isPlaylistSearching && <div className="text-center mt-4 opacity-50">מחפש...</div>}
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
            <Player playerState={playerState} onPlayPause={togglePlayPause} onNext={handleNext} onPrev={handlePrev} onShuffle={toggleShuffle} onToggleExpand={() => setPlayerState(p => ({...p, isExpanded: !p.isExpanded}))} onSeek={handleSeek} />
            <div className="md:hidden w-full flex-shrink-0 bg-neutral-900 border-t border-white/10 flex justify-around p-2 z-50 text-[10px]">
                <button onClick={() => setActiveTab('home')} className={`flex flex-col items-center p-2 ${activeTab==='home'?'text-white':'text-gray-500'}`}> <HomeIcon className="mb-1" /> בית </button>
                <button onClick={() => setActiveTab('search')} className={`flex flex-col items-center p-2 ${activeTab==='search'?'text-white':'text-gray-500'}`}> <SearchIcon className="mb-1" /> חיפוש </button>
                <button onClick={() => setActiveTab('library')} className={`flex flex-col items-center p-2 ${activeTab==='library'?'text-white':'text-gray-500'}`}> <LibraryIcon className="mb-1" /> ספרייה </button>
            </div>
        </div>
    );
};

export default App;
