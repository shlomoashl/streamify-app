import { useState, useCallback, useEffect, useRef } from 'react';
import {
    Folder,
    LibraryData,
    Playlist,
    PlaylistItem,
    User,
    ViewState,
    YouTubeSearchResult
} from '../types';
import { LIBRARY_API_BASE, YOUTUBE_API_BASE } from '../constants';
import { storageService } from '../StorageService';
import { STREAMIFY_KEYWORDS, searchResultToPlaylistItem } from '../utils/mediaUtils';
import {
    checkVideosBatchApi,
    fetchStreamifyExploreApi,
    fetchYouTubeBrowseApi,
    fetchYouTubeSearchApi,
    verifyAndFindReplacementApi
} from '../utils/encryptionUtils';
import {
    BulkImportModalState,
    ConfirmModalState,
    ManageUsersModalState,
    MoveToFolderModalState
} from '../components/Modals';
import { StreamifyCategory } from '../components/views/StreamifyView';

export interface RepairJobCheckpoint {
    playlistId: string;
    playlistName: string;
    nextIndex: number;
    total: number;
    fixedCount: number;
    updatedAt: number;
}

export const useLibraryManager = (params: {
    isEncryptionEnabled: boolean;
    currentUser: User | null;
    activeTab: ViewState;
    setActiveTab: (tab: ViewState) => void;
    playingPlaylistId: string | null;
    setPlayingPlaylistId: (id: string | null) => void;
    setGlobalLoading: (msg: string | null) => void;
    setNetworkError: (msg: string | null) => void;
    setConfirmModal: React.Dispatch<React.SetStateAction<ConfirmModalState>>;
    manageUsersState: ManageUsersModalState;
    setManageUsersState: React.Dispatch<React.SetStateAction<ManageUsersModalState>>;
    setBulkImportState: React.Dispatch<React.SetStateAction<BulkImportModalState>>;
    setMoveToFolderState: React.Dispatch<React.SetStateAction<MoveToFolderModalState>>;
    setShowPlaylistSelector: (show: boolean) => void;
    setSongsToAdd: (songs: PlaylistItem[]) => void;
    setIsSearching: (searching: boolean) => void;
}) => {
    const {
        isEncryptionEnabled,
        currentUser,
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
        setIsSearching
    } = params;

    const [playlists, setPlaylists] = useState<Playlist[]>([]);
    const [folders, setFolders] = useState<Folder[]>([]);
    const [likedSongsPlaylist, setLikedSongsPlaylist] = useState<Playlist | null>(null);
    const [selectedPlaylist, setSelectedPlaylist] = useState<Playlist | null>(null);
    const [streamifyCategory, setStreamifyCategory] = useState<StreamifyCategory>('all');
    const [streamifyResults, setStreamifyResults] = useState<YouTubeSearchResult[]>([]);
    const [isLoadingStreamify, setIsLoadingStreamify] = useState(false);
    const [streamifyDisplayLimit, setStreamifyDisplayLimit] = useState(20);
    const [playlistDisplayLimit, setPlaylistDisplayLimit] = useState(30);
    const [repairProgress, setRepairProgress] = useState<RepairJobCheckpoint | null>(null);

    const streamifyCategoryCacheRef = useRef<Map<StreamifyCategory, YouTubeSearchResult[]>>(
        new Map()
    );
    const playlistsRef = useRef<Playlist[]>(playlists);
    useEffect(() => {
        playlistsRef.current = playlists;
    }, [playlists]);

    const repairRunningRef = useRef(false);
    const repairCancelledRef = useRef(false);
    const autoRetryResumedRef = useRef(false);
    const autoHealedInSessionRef = useRef<Set<string>>(new Set());

    const updatePlaylistsLocally = useCallback(
        (newPlaylists: Playlist[]) => {
            setPlaylists(newPlaylists);
            storageService.saveData('streamify_cache_playlists', newPlaylists);

            if (selectedPlaylist) {
                const updated = newPlaylists.find((p) => p.id === selectedPlaylist.id);
                if (updated) setSelectedPlaylist(updated);
            }

            if (currentUser) {
                const liked = newPlaylists.find(
                    (p) => p.isLikedSongs && p.creator === currentUser.email
                );
                if (liked) {
                    setLikedSongsPlaylist(liked);
                    storageService.saveData('streamify_cache_liked', liked);
                }
            }
        },
        [selectedPlaylist, currentUser]
    );

    const updateFoldersLocally = useCallback((newFolders: Folder[]) => {
        setFolders(newFolders);
        storageService.saveData('streamify_cache_folders', newFolders);
    }, []);

    const fetchLibrary = useCallback(async () => {
        if (!currentUser) return;
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000);
            const res = await fetch(`${LIBRARY_API_BASE}/sync?t=${Date.now()}`, {
                signal: controller.signal
            });
            clearTimeout(timeoutId);

            if (!res.ok) throw new Error('Network response not ok');
            const data: LibraryData = await res.json();

            const allPlaylists = data.playlists || [];
            const allFolders = data.folders || [];

            const userPlaylists = allPlaylists.filter(
                (p) =>
                    p.creator === currentUser.email ||
                    p.allowedUsers?.includes(currentUser.email)
            );
            const userFolders = allFolders.filter((f) => f.creator === currentUser.email);

            let likedPlaylist = userPlaylists.find(
                (p) => p.isLikedSongs && p.creator === currentUser.email
            );
            if (!likedPlaylist) {
                likedPlaylist = {
                    id: `liked_songs_${currentUser.email.replace(/[@.]/g, '_')}`,
                    name: 'שירים שאהבתם',
                    creator: currentUser.email,
                    isPublic: false,
                    songs: [],
                    isLikedSongs: true
                };
                userPlaylists.push(likedPlaylist);
            }

            setPlaylists(userPlaylists);
            setFolders(userFolders);
            setLikedSongsPlaylist(likedPlaylist);

            storageService.saveData('streamify_cache_playlists', userPlaylists);
            storageService.saveData('streamify_cache_folders', userFolders);
            storageService.saveData('streamify_cache_liked', likedPlaylist);

            setNetworkError(null);
        } catch {
            setNetworkError('שגיאה בטעינת נתונים - מנסה להתחבר מחדש...');
        }
    }, [currentUser, setNetworkError]);

    useEffect(() => {
        if (currentUser) fetchLibrary();
    }, [currentUser, fetchLibrary]);

    const persistCategoryCacheToStorage = useCallback(
        (cat: StreamifyCategory, results: YouTubeSearchResult[]) => {
            streamifyCategoryCacheRef.current.set(cat, results);
            const allCategoriesObj: Record<string, YouTubeSearchResult[]> = {};
            streamifyCategoryCacheRef.current.forEach((val, key) => {
                if (Array.isArray(val) && val.length > 0) {
                    allCategoriesObj[key] = val;
                }
            });
            storageService.saveData('streamify_recommended_by_category', allCategoriesObj);
            if (cat === 'all') {
                storageService.saveData('streamify_recommended', results);
            }
        },
        []
    );

    const hydrateStreamifyCache = useCallback(
        (
            savedByCategory?: Record<string, YouTubeSearchResult[]> | null,
            fallbackAll?: YouTubeSearchResult[] | null
        ) => {
            if (savedByCategory && typeof savedByCategory === 'object') {
                Object.entries(savedByCategory).forEach(([k, v]) => {
                    if (Array.isArray(v) && v.length > 0) {
                        streamifyCategoryCacheRef.current.set(k as StreamifyCategory, v);
                    }
                });
            }
            if (
                Array.isArray(fallbackAll) &&
                fallbackAll.length > 0 &&
                !streamifyCategoryCacheRef.current.has('all')
            ) {
                streamifyCategoryCacheRef.current.set('all', fallbackAll);
            }
            const initialAll = streamifyCategoryCacheRef.current.get('all');
            if (initialAll && initialAll.length > 0) {
                setStreamifyResults(initialAll);
            }
        },
        []
    );

    const loadStreamifyRecommendations = useCallback(
        async (forceRefresh = false, targetCategory?: StreamifyCategory) => {
            const cat = targetCategory || streamifyCategory;
            const cachedCat = streamifyCategoryCacheRef.current.get(cat);
            if (!forceRefresh && cachedCat && cachedCat.length > 0) {
                setStreamifyResults(cachedCat);
                return;
            }

            setIsLoadingStreamify(true);
            setStreamifyDisplayLimit(24);

            try {
                // 1. ניסיון ראשי: ראוט ה-Explore החדש שמסנן רק פלייליסטים גדולים ומובילים מ-YouTube Music
                try {
                    const exploreData = await fetchStreamifyExploreApi(
                        YOUTUBE_API_BASE,
                        cat,
                        isEncryptionEnabled,
                        forceRefresh
                    );
                    if (
                        exploreData &&
                        exploreData.success &&
                        Array.isArray(exploreData.results) &&
                        exploreData.results.length > 0
                    ) {
                        persistCategoryCacheToStorage(cat, exploreData.results);
                        setStreamifyResults(exploreData.results);
                        return;
                    }
                } catch (exploreErr) {
                    console.warn(
                        'streamify-explore fallback to filtered search:',
                        exploreErr
                    );
                }

                // 2. גיבוי עם סינון איכות קשיח (>= 15 שירים) במקרה שהשרת טרם עודכן
                const categoryQueries: Record<StreamifyCategory, string[]> = {
                    all: STREAMIFY_KEYWORDS.slice(0, 10),
                    chasidic: [
                        'להיטים חסידיים גדולים',
                        'מוזיקה חסידית חדשה',
                        'פלייליסט חסידי מקפיץ',
                        'אברהם פריד מיטב השירים',
                        'שמוליק סוכות ארי היל'
                    ],
                    religious_israeli: [
                        'מוזיקה יהודית מתחדשת',
                        'ישי ריבו חנן בן ארי עקיבא',
                        'שירים דתיים מומלצים',
                        'פלייליסט יהודי ישראלי'
                    ],
                    global_hits: [
                        'Global Top Hits Playlist',
                        'Biggest Pop Hits Playlist',
                        'Best International Hits Playlist'
                    ],
                    instrumental: [
                        'Instrumental Relaxing Piano & Violin',
                        'Epic Cinematic Soundtrack Playlist',
                        'ניגונים ללא מילים מרגיע'
                    ],
                    chill_focus: [
                        'Chill Relaxing Music Playlist',
                        'Acoustic Chill Hits',
                        'שירים שקטים ומרגיעים'
                    ],
                    energetic: [
                        'Upbeat Driving Music Playlist',
                        'פלייליסט מקפיץ לנסיעה',
                        'Workout & High Energy Hits'
                    ],
                    world_ethnic: [
                        'World Music Best Playlists',
                        'Mediterranean & Acoustic World Hits',
                        'מוזיקת עולם אתנית'
                    ]
                };

                const queries = categoryQueries[cat] || categoryQueries.all;
                const fetchPromises = queries.map(async (kw) => {
                    const data = await fetchYouTubeSearchApi(
                        YOUTUBE_API_BASE,
                        kw,
                        'youtubemusic_playlists',
                        isEncryptionEnabled
                    );

                    if (data.success && data.results) {
                        return data.results.filter((r: any) => {
                            if (!r.id || !r.title) return false;
                            const isOfficial =
                                String(r.id).toLowerCase().includes('rdclak5uy_') ||
                                String(r.author || '')
                                    .toLowerCase()
                                    .includes('youtube music');
                            if (isOfficial) return true;
                            const countMatch = String(r.itemCount || '').match(/(\d+)/);
                            const count = countMatch ? parseInt(countMatch[1], 10) : 20;
                            return count >= 15;
                        });
                    }
                    return [];
                });

                const resultsArrays = await Promise.all(fetchPromises);
                const allResults = resultsArrays.flat();
                const uniqueResults = Array.from(
                    new Map(allResults.map((item) => [item.id, item])).values()
                ) as YouTubeSearchResult[];

                if (forceRefresh) {
                    for (let i = uniqueResults.length - 1; i > 0; i--) {
                        const j = Math.floor(Math.random() * (i + 1));
                        [uniqueResults[i], uniqueResults[j]] = [
                            uniqueResults[j],
                            uniqueResults[i]
                        ];
                    }
                }

                persistCategoryCacheToStorage(cat, uniqueResults);
                setStreamifyResults(uniqueResults);
            } catch (e) {
                console.error('Failed to load streamify recommendations', e);
            } finally {
                setIsLoadingStreamify(false);
            }
        },
        [isEncryptionEnabled, persistCategoryCacheToStorage, streamifyCategory]
    );

    const handleSelectStreamifyCategory = useCallback(
        (cat: StreamifyCategory) => {
            setStreamifyCategory(cat);
            setStreamifyDisplayLimit(24);
            const cachedCat = streamifyCategoryCacheRef.current.get(cat);
            if (cachedCat && cachedCat.length > 0) {
                setStreamifyResults(cachedCat);
                return;
            }
            setStreamifyResults([]);
            loadStreamifyRecommendations(false, cat);
        },
        [loadStreamifyRecommendations]
    );

    // בכניסה לטאב Streamify: אם הקטגוריה הנוכחית כבר שמורה בזיכרון - נציג אותה מיד בלי לחפש מחדש!
    // רק אם מעולם לא נטענה הקטגוריה הזו, נבצע טעינה ראשונית פעם אחת בלבד.
    useEffect(() => {
        if (activeTab === 'streamify') {
            const cachedCat = streamifyCategoryCacheRef.current.get(streamifyCategory);
            if (cachedCat && cachedCat.length > 0) {
                if (streamifyResults !== cachedCat) {
                    setStreamifyResults(cachedCat);
                }
            } else if (!isLoadingStreamify) {
                loadStreamifyRecommendations(false, streamifyCategory);
            }
        }
    }, [activeTab, streamifyCategory, isLoadingStreamify, loadStreamifyRecommendations]);

    const loadExternalPlaylist = useCallback(
        async (playlist: Playlist) => {
            if (!playlist.externalId || !playlist.externalType) return;

            setIsSearching(true);
            setGlobalLoading('טוען תוכן מהרשת...');

            try {
                const data = await fetchYouTubeBrowseApi(
                    YOUTUBE_API_BASE,
                    playlist.externalId,
                    playlist.externalType,
                    isEncryptionEnabled
                );

                if (data.success && data.results) {
                    const tracks: PlaylistItem[] = data.results.map((r: any) =>
                        searchResultToPlaylistItem(r, 'external_fetch')
                    );
                    setSelectedPlaylist((prev) =>
                        prev && prev.id === playlist.id ? { ...prev, songs: tracks } : prev
                    );
                } else {
                    setConfirmModal({
                        isOpen: true,
                        title: 'שגיאה',
                        message: 'לא נמצא תוכן או שגיאה בטעינה.',
                        onConfirm: () =>
                            setConfirmModal((prev) => ({ ...prev, isOpen: false })),
                        isAlertOnly: true
                    });
                }
            } catch {
                setConfirmModal({
                    isOpen: true,
                    title: 'שגיאה',
                    message: 'שגיאת רשת בטעינת התוכן',
                    onConfirm: () => setConfirmModal((prev) => ({ ...prev, isOpen: false })),
                    isAlertOnly: true
                });
            } finally {
                setIsSearching(false);
                setGlobalLoading(null);
            }
        },
        [isEncryptionEnabled, setConfirmModal, setGlobalLoading, setIsSearching]
    );

    useEffect(() => {
        if (
            activeTab === 'playlist' &&
            selectedPlaylist &&
            selectedPlaylist.externalId &&
            selectedPlaylist.songs.length === 0
        ) {
            loadExternalPlaylist(selectedPlaylist);
        }
    }, [activeTab, selectedPlaylist?.id, loadExternalPlaylist]);

    const apiCreatePlaylist = async (name: string): Promise<Playlist | null> => {
        if (!currentUser || !name.trim()) return null;
        setGlobalLoading('יוצר פלייליסט...');

        const tempId = crypto.randomUUID();
        const newPlaylist: Playlist = {
            id: tempId,
            name,
            creator: currentUser.email,
            isPublic: false,
            songs: []
        };

        setPlaylists((prev) => {
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
            if (!res.ok) throw new Error('Create failed');
            return newPlaylist;
        } catch {
            setPlaylists((prev) => {
                const updated = prev.filter((p) => p.id !== tempId);
                storageService.saveData('streamify_cache_playlists', updated);
                return updated;
            });
            setConfirmModal({
                isOpen: true,
                title: 'שגיאה',
                message: 'נכשל ביצירת פלייליסט',
                onConfirm: () => setConfirmModal((prev) => ({ ...prev, isOpen: false })),
                isAlertOnly: true
            });
            return null;
        } finally {
            setGlobalLoading(null);
        }
    };

    const apiSaveExternalPlaylist = async (item: YouTubeSearchResult) => {
        if (!currentUser || !item) return;
        setGlobalLoading('שומר קיצור דרך...');

        const typeMapping: Record<string, Playlist['externalType']> = {
            playlist: 'playlist',
            album: 'album',
            artist: 'artist',
            podcast: 'podcast',
            spotify_playlist: 'spotify_playlist'
        };
        const externalType = typeMapping[item.type || 'playlist'] || 'playlist';

        const newPlaylist: Playlist = {
            id: crypto.randomUUID(),
            name: item.title,
            creator: currentUser.email,
            isPublic: false,
            songs: [],
            externalId: item.id,
            externalType
        };

        setPlaylists((prev) => {
            const updated = [...prev, newPlaylist];
            storageService.saveData('streamify_cache_playlists', updated);
            return updated;
        });
        setBulkImportState((prev) => ({ ...prev, isOpen: false }));

        try {
            const res = await fetch(`${LIBRARY_API_BASE}/playlist/save_external`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: item.title,
                    creator: currentUser.email,
                    externalId: item.id,
                    externalType
                })
            });
            if (!res.ok) throw new Error('Save external failed');
            fetchLibrary();
        } catch {
            setPlaylists((prev) => {
                const updated = prev.filter(
                    (p) => p.name !== item.title || p.externalId !== item.id
                );
                storageService.saveData('streamify_cache_playlists', updated);
                return updated;
            });
            setConfirmModal({
                isOpen: true,
                title: 'שגיאה',
                message: 'נכשל בשמירה',
                onConfirm: () => setConfirmModal((prev) => ({ ...prev, isOpen: false })),
                isAlertOnly: true
            });
        } finally {
            setGlobalLoading(null);
        }
    };

    const apiCreateFolder = async (name: string) => {
        if (!currentUser || !name.trim()) return;
        setGlobalLoading('יוצר תיקייה...');
        const tempId = crypto.randomUUID();
        const newFolder: Folder = {
            id: tempId,
            name,
            creator: currentUser.email,
            playlistIds: []
        };

        updateFoldersLocally([...folders, newFolder]);

        try {
            const res = await fetch(`${LIBRARY_API_BASE}/folder/create`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, creator: currentUser.email, id: tempId })
            });
            if (!res.ok) throw new Error('Create folder failed');
        } catch {
            updateFoldersLocally(folders.filter((f) => f.id !== tempId));
        } finally {
            setGlobalLoading(null);
        }
    };

    const apiSharePlaylist = async (playlistId: string, targetEmail: string) => {
        if (!currentUser || !targetEmail.trim().includes('@')) return;
        setGlobalLoading('משתף...');

        try {
            const res = await fetch(`${LIBRARY_API_BASE}/playlist/share`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: playlistId, email: targetEmail, action: 'add' })
            });
            if (!res.ok) throw new Error('Share failed');

            const updated = playlists.map((p) =>
                p.id === playlistId
                    ? { ...p, allowedUsers: [...(p.allowedUsers || []), targetEmail] }
                    : p
            );
            updatePlaylistsLocally(updated);

            setConfirmModal({
                isOpen: true,
                title: 'הצלחה',
                message: `הפלייליסט שותף עם ${targetEmail}`,
                onConfirm: () => setConfirmModal((prev) => ({ ...prev, isOpen: false })),
                isAlertOnly: true
            });
        } catch {
            setConfirmModal({
                isOpen: true,
                title: 'שגיאה',
                message: 'נכשל בשיתוף',
                onConfirm: () => setConfirmModal((prev) => ({ ...prev, isOpen: false })),
                isAlertOnly: true
            });
        } finally {
            setGlobalLoading(null);
        }
    };

    const apiUnsharePlaylist = async (playlistId: string, emailToRemove: string) => {
        if (!currentUser) return;
        setGlobalLoading('מסיר...');
        try {
            const res = await fetch(`${LIBRARY_API_BASE}/playlist/share`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: playlistId, email: emailToRemove, action: 'remove' })
            });
            if (!res.ok) throw new Error('Unshare failed');

            const updated = playlists.map((p) => {
                if (p.id === playlistId) {
                    const newP = {
                        ...p,
                        allowedUsers: (p.allowedUsers || []).filter((e) => e !== emailToRemove)
                    };
                    if (
                        manageUsersState.isOpen &&
                        manageUsersState.playlist?.id === playlistId
                    ) {
                        setManageUsersState((prev) => ({ ...prev, playlist: newP }));
                    }
                    return newP;
                }
                return p;
            });
            updatePlaylistsLocally(updated);
        } catch {
            setConfirmModal({
                isOpen: true,
                title: 'שגיאה',
                message: 'נכשל בהסרה',
                onConfirm: () => setConfirmModal((prev) => ({ ...prev, isOpen: false })),
                isAlertOnly: true
            });
        } finally {
            setGlobalLoading(null);
        }
    };

    const apiDeletePlaylist = async (playlistId: string) => {
        const pl = playlists.find((p) => p.id === playlistId);
        if (!pl || pl.isLikedSongs) return;

        setConfirmModal({
            isOpen: true,
            title: 'מחיקת פלייליסט',
            message: `האם למחוק את "${pl.name}"?`,
            onConfirm: async () => {
                setConfirmModal((prev) => ({ ...prev, isOpen: false }));
                setGlobalLoading('מוחק...');

                const oldPlaylists = [...playlists];
                const oldFolders = [...folders];

                const updatedPlaylists = playlists.filter((p) => p.id !== playlistId);
                const updatedFolders = folders.map((f) => ({
                    ...f,
                    playlistIds: f.playlistIds.filter((id) => id !== playlistId)
                }));

                updatePlaylistsLocally(updatedPlaylists);
                updateFoldersLocally(updatedFolders);

                if (selectedPlaylist?.id === playlistId) {
                    setSelectedPlaylist(null);
                    setActiveTab('home');
                }
                if (playingPlaylistId === playlistId) setPlayingPlaylistId(null);

                try {
                    const res = await fetch(`${LIBRARY_API_BASE}/playlist/delete`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ id: playlistId })
                    });
                    if (!res.ok) throw new Error('Delete failed');
                } catch {
                    updatePlaylistsLocally(oldPlaylists);
                    updateFoldersLocally(oldFolders);
                    setConfirmModal({
                        isOpen: true,
                        title: 'שגיאה',
                        message: 'נכשל במחיקה',
                        onConfirm: () =>
                            setConfirmModal((prev) => ({ ...prev, isOpen: false })),
                        isAlertOnly: true
                    });
                } finally {
                    setGlobalLoading(null);
                }
            }
        });
    };

    const apiDeleteFolder = async (folderId: string) => {
        const folder = folders.find((f) => f.id === folderId);
        if (!folder) return;
        setConfirmModal({
            isOpen: true,
            title: 'מחיקת תיקייה',
            message: `האם למחוק את "${folder.name}"?`,
            onConfirm: async () => {
                setConfirmModal((prev) => ({ ...prev, isOpen: false }));
                setGlobalLoading('מוחק...');

                const oldFolders = [...folders];
                updateFoldersLocally(folders.filter((f) => f.id !== folderId));

                try {
                    const res = await fetch(`${LIBRARY_API_BASE}/folder/delete`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ id: folderId })
                    });
                    if (!res.ok) throw new Error('Delete failed');
                } catch {
                    updateFoldersLocally(oldFolders);
                } finally {
                    setGlobalLoading(null);
                }
            }
        });
    };

    const apiMovePlaylistToFolder = async (
        playlistId: string,
        targetFolderId: string | null
    ) => {
        setGlobalLoading('מעביר...');
        const oldFolders = [...folders];

        let updatedFolders = folders.map((f) => ({
            ...f,
            playlistIds: f.playlistIds.filter((id) => id !== playlistId)
        }));
        if (targetFolderId) {
            updatedFolders = updatedFolders.map((f) =>
                f.id === targetFolderId
                    ? { ...f, playlistIds: [...f.playlistIds, playlistId] }
                    : f
            );
        }

        updateFoldersLocally(updatedFolders);
        setMoveToFolderState({ visible: false, playlistId: null });

        try {
            const res = await fetch(`${LIBRARY_API_BASE}/folder/content`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ playlistId, targetFolderId })
            });
            if (!res.ok) throw new Error('Move failed');
        } catch {
            updateFoldersLocally(oldFolders);
        } finally {
            setGlobalLoading(null);
        }
    };

    const apiRenameItem = async (
        itemId: string,
        newName: string,
        itemType: 'playlist' | 'folder'
    ) => {
        if (!currentUser || !newName.trim()) return;
        setGlobalLoading('משנה שם...');

        try {
            if (itemType === 'playlist') {
                updatePlaylistsLocally(
                    playlists.map((p) => (p.id === itemId ? { ...p, name: newName } : p))
                );
                const res = await fetch(`${LIBRARY_API_BASE}/playlist/rename`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id: itemId, name: newName })
                });
                if (!res.ok) throw new Error('Rename failed');
            } else {
                updateFoldersLocally(
                    folders.map((f) => (f.id === itemId ? { ...f, name: newName } : f))
                );
            }
        } catch {
            setNetworkError('שגיאה בשינוי השם');
        } finally {
            setGlobalLoading(null);
        }
    };

    const apiAddSongsToPlaylist = async (
        playlistId: string,
        newSongs: PlaylistItem[],
        playlistOverride?: Playlist
    ) => {
        if (!currentUser || newSongs.length === 0) return;
        setGlobalLoading('מוסיף שירים...');

        const playlist = playlistOverride || playlists.find((p) => p.id === playlistId);
        if (!playlist) {
            setGlobalLoading(null);
            return;
        }

        const existingIds = new Set(playlist.songs.map((s) => s.id));
        const filteredToAdd = newSongs.filter((s) => !existingIds.has(s.id));
        if (filteredToAdd.length === 0) {
            setGlobalLoading(null);
            setShowPlaylistSelector(false);
            return;
        }

        const updatedPlaylist = {
            ...playlist,
            songs: [...playlist.songs, ...filteredToAdd]
        };

        setPlaylists((prev) => {
            const pIndex = prev.findIndex((p) => p.id === playlistId);
            const newAllPlaylists =
                pIndex > -1
                    ? prev.map((p, idx) => (idx === pIndex ? updatedPlaylist : p))
                    : [...prev, updatedPlaylist];
            storageService.saveData('streamify_cache_playlists', newAllPlaylists);
            return newAllPlaylists;
        });

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
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    playlistId,
                    songs: filteredToAdd,
                    user: currentUser.email
                })
            });
            if (!res.ok) throw new Error('Add songs failed');
        } catch {
            setConfirmModal({
                isOpen: true,
                title: 'שגיאה',
                message: 'נכשל בהוספת שירים',
                onConfirm: () => setConfirmModal((prev) => ({ ...prev, isOpen: false })),
                isAlertOnly: true
            });
        } finally {
            setGlobalLoading(null);
        }
    };

    const apiRemoveSong = async (playlistId: string, songId: string) => {
        if (!currentUser) return;
        setGlobalLoading('מסיר...');

        const oldPlaylists = [...playlists];
        const updated = playlists.map((p) =>
            p.id === playlistId
                ? { ...p, songs: p.songs.filter((s) => s.id !== songId) }
                : p
        );
        updatePlaylistsLocally(updated);

        try {
            const res = await fetch(`${LIBRARY_API_BASE}/songs/remove`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ playlistId, songId })
            });
            if (!res.ok) throw new Error('Remove song failed');
        } catch {
            updatePlaylistsLocally(oldPlaylists);
        } finally {
            setGlobalLoading(null);
        }
    };

    // החלפה שקטה של שיר בפלייליסט (בלי חלון טעינה חוסם) עבור תיקון ברקע ו-Auto-Heal
    const silentReplaceSongInPlaylist = useCallback(
        async (playlistId: string, oldSongId: string, newSongItem: PlaylistItem) => {
            if (!currentUser) return false;
            try {
                const currentList = playlistsRef.current;
                const updated = currentList.map((p) => {
                    if (p.id !== playlistId) return p;
                    const alreadyHasNew = p.songs.some((s) => s.id === newSongItem.id);
                    const replacedSongs = p.songs
                        .map((s) => (s.id === oldSongId ? newSongItem : s))
                        .filter((s, idx, arr) =>
                            alreadyHasNew ? arr.findIndex((x) => x.id === s.id) === idx : true
                        );
                    return { ...p, songs: replacedSongs };
                });

                updatePlaylistsLocally(updated);

                await fetch(`${LIBRARY_API_BASE}/songs/remove`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ playlistId, songId: oldSongId })
                });

                await fetch(`${LIBRARY_API_BASE}/songs/add`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        playlistId,
                        songs: [newSongItem],
                        userEmail: currentUser.email
                    })
                });

                return true;
            } catch (e) {
                console.warn('Silent song replacement failed:', e);
                return false;
            }
        },
        [currentUser, updatePlaylistsLocally]
    );

    // תיקון אוטומטי שקוף ברקע (Auto-Heal) כאשר הנגן מדלג על שיר תקול:
    // הנגן מדלג מיד לשיר הבא בלי לעכב את המשתמש, וברקע אנחנו מוודאים מול יוטיוב אם השיר באמת נמחק
    // (ולא סתם שגיאת בוט/קוקיז/רשת). רק אם נמחק באמת - מעדכנים את ה-ID לפעם הבאה!
    const autoHealSkippedSong = useCallback(
        async (skippedSongId: string) => {
            if (!skippedSongId || !currentUser) return;
            if (autoHealedInSessionRef.current.has(skippedSongId)) return;
            autoHealedInSessionRef.current.add(skippedSongId);

            const affectedPlaylists = playlistsRef.current.filter(
                (p) =>
                    !p.id.startsWith('temp-') &&
                    !p.externalId &&
                    p.songs.some((s) => s.id === skippedSongId)
            );
            if (affectedPlaylists.length === 0) return;

            const sampleSong = affectedPlaylists[0].songs.find((s) => s.id === skippedSongId);
            if (!sampleSong || !sampleSong.title) return;

            try {
                const res = await verifyAndFindReplacementApi(
                    YOUTUBE_API_BASE,
                    {
                        id: sampleSong.id,
                        title: sampleSong.title,
                        author: sampleSong.author || ''
                    },
                    isEncryptionEnabled,
                    false // חובה לבדוק מול YouTube API v3 שהשיר באמת נמחק ולא סתם חסימת בוט!
                );

                if (res.success && res.needsReplacement && res.replacement && res.replacement.id) {
                    const replacementId = res.replacement.id;
                    if (replacementId !== skippedSongId) {
                        console.log(
                            `[Auto-Heal] Song "${sampleSong.title}" (${skippedSongId}) confirmed deleted on YouTube. Updating ID to ${replacementId} for next time.`
                        );
                        for (const pl of affectedPlaylists) {
                            const oldItem = pl.songs.find((s) => s.id === skippedSongId);
                            if (oldItem) {
                                const newSongItem: PlaylistItem = {
                                    ...oldItem,
                                    id: replacementId,
                                    thumbnail:
                                        res.replacement.thumbnail_url || oldItem.thumbnail,
                                    addedAt: new Date().toISOString()
                                };
                                await silentReplaceSongInPlaylist(
                                    pl.id,
                                    skippedSongId,
                                    newSongItem
                                );
                            }
                        }
                    }
                }
            } catch (e) {
                console.warn('[Auto-Heal] Verification skipped due to network/server error:', e);
            }
        },
        [currentUser, isEncryptionEnabled, silentReplaceSongInPlaylist]
    );

    // מנוע סריקה ותיקון פלייליסטים חכם ברקע עם שמירת מיקום (Checkpoint) ובדיקת Batch מהירה
    const runBackgroundPlaylistRepair = useCallback(
        async (
            playlist: Playlist,
            startIndex: number = 0,
            initialFixedCount: number = 0
        ) => {
            if (repairRunningRef.current) return;
            const songsSnapshot = [...playlist.songs];
            const total = songsSnapshot.length;
            if (total === 0 || startIndex >= total) {
                await storageService.saveData('streamify_repair_job', null);
                setRepairProgress(null);
                return;
            }

            repairRunningRef.current = true;
            repairCancelledRef.current = false;
            let fixedCount = initialFixedCount;
            const BATCH_SIZE = 25;

            try {
                for (let batchStart = startIndex; batchStart < total; batchStart += BATCH_SIZE) {
                    if (repairCancelledRef.current) break;

                    const batchEnd = Math.min(batchStart + BATCH_SIZE, total);
                    const batchSongs = songsSnapshot.slice(batchStart, batchEnd);
                    const batchIds = batchSongs.map((s) => s.id).filter(Boolean);

                    // שלב א': בדיקת קיום מהירה בבקשה אחת לכל הקבוצה (25 שירים ב-0.2 שניות!)
                    let deletedSet: Set<string> | null = null;
                    try {
                        const batchCheck = await checkVideosBatchApi(
                            YOUTUBE_API_BASE,
                            batchIds
                        );
                        if (batchCheck && batchCheck.success && Array.isArray(batchCheck.deletedIds)) {
                            deletedSet = new Set(batchCheck.deletedIds);
                        }
                    } catch {
                        deletedSet = null;
                    }

                    // שלב ב': עוברים על השירים בקבוצה - שירים תקינים מדולגים מיידית ב-0 השהיה!
                    for (let offset = 0; offset < batchSongs.length; offset++) {
                        if (repairCancelledRef.current) break;

                        const currentIdx = batchStart + offset;
                        const song = batchSongs[offset];

                        const checkpoint: RepairJobCheckpoint = {
                            playlistId: playlist.id,
                            playlistName: playlist.name,
                            nextIndex: currentIdx + 1,
                            total,
                            fixedCount,
                            updatedAt: Date.now()
                        };
                        setRepairProgress(checkpoint);
                        await storageService.saveData('streamify_repair_job', checkpoint);

                        // אם בדיקת ה-Batch אישרה שהשיר חי וקיים ביוטיוב - לא נוגעים בו ולא מבזבזים זמן!
                        if (deletedSet !== null && !deletedSet.has(song.id)) {
                            continue;
                        }

                        // השיר זוהה כמחוק/חסום (או שאין Batch API): נבצע אימות וחיפוש חלופה בקצב בטוח
                        try {
                            const rep = await verifyAndFindReplacementApi(
                                YOUTUBE_API_BASE,
                                {
                                    id: song.id,
                                    title: song.title,
                                    author: song.author || ''
                                },
                                isEncryptionEnabled,
                                deletedSet !== null && deletedSet.has(song.id)
                            );

                            if (
                                rep.success &&
                                rep.needsReplacement &&
                                rep.replacement &&
                                rep.replacement.id &&
                                rep.replacement.id !== song.id
                            ) {
                                const newSongItem: PlaylistItem = {
                                    ...song,
                                    id: rep.replacement.id,
                                    thumbnail:
                                        rep.replacement.thumbnail_url || song.thumbnail,
                                    addedAt: new Date().toISOString()
                                };
                                const ok = await silentReplaceSongInPlaylist(
                                    playlist.id,
                                    song.id,
                                    newSongItem
                                );
                                if (ok) {
                                    fixedCount++;
                                    const updatedCp: RepairJobCheckpoint = {
                                        ...checkpoint,
                                        fixedCount
                                    };
                                    setRepairProgress(updatedCp);
                                    await storageService.saveData(
                                        'streamify_repair_job',
                                        updatedCp
                                    );
                                }
                            }
                        } catch (err) {
                            console.warn(`Error repairing song "${song.title}":`, err);
                        }

                        // המתנה מאובטחת של 1.5 שניות רק אחרי חיפוש בפועל כדי לעולם לא להיחסם
                        await new Promise((r) => setTimeout(r, 1500));
                    }
                }

                if (!repairCancelledRef.current) {
                    await storageService.saveData('streamify_repair_job', null);
                    setRepairProgress(null);
                    setConfirmModal({
                        isOpen: true,
                        title: 'סריקת הפלייליסט הושלמה',
                        message:
                            fixedCount > 0
                                ? `הסריקה של "${playlist.name}" הסתיימה בהצלחה! נמצאו ותוקנו ${fixedCount} שירים שנמחקו מיוטיוב.`
                                : `הסריקה של "${playlist.name}" הסתיימה! כל ${total} השירים בפלייליסט תקינים ופעילים.`,
                        onConfirm: () => setConfirmModal((p) => ({ ...p, isOpen: false })),
                        isAlertOnly: true
                    });
                }
            } finally {
                repairRunningRef.current = false;
            }
        },
        [isEncryptionEnabled, setConfirmModal, silentReplaceSongInPlaylist]
    );

    const cancelRepairPlaylist = useCallback(async () => {
        repairCancelledRef.current = true;
        repairRunningRef.current = false;
        setRepairProgress(null);
        await storageService.saveData('streamify_repair_job', null);
    }, []);

    // המשך אוטומטי של סריקה/תיקון פלייליסט ברקע אם האפליקציה נסגרה באמצע בפעם הקודמת
    useEffect(() => {
        if (!currentUser || playlists.length === 0 || autoRetryResumedRef.current) return;
        autoRetryResumedRef.current = true;

        storageService
            .loadData<RepairJobCheckpoint | null>('streamify_repair_job', null)
            .then((savedJob) => {
                if (
                    savedJob &&
                    savedJob.playlistId &&
                    typeof savedJob.nextIndex === 'number' &&
                    savedJob.nextIndex < savedJob.total
                ) {
                    const targetPl = playlists.find((p) => p.id === savedJob.playlistId);
                    if (targetPl && targetPl.songs.length > savedJob.nextIndex) {
                        console.log(
                            `[Repair] Resuming background playlist repair for "${targetPl.name}" from song ${savedJob.nextIndex + 1}/${targetPl.songs.length}`
                        );
                        runBackgroundPlaylistRepair(
                            targetPl,
                            savedJob.nextIndex,
                            savedJob.fixedCount || 0
                        );
                    } else {
                        storageService.saveData('streamify_repair_job', null);
                    }
                }
            })
            .catch(() => {});
    }, [currentUser, playlists, runBackgroundPlaylistRepair]);

    const repairPlaylistSongs = async (playlist: Playlist) => {
        const songsToFix = playlist.songs;
        if (songsToFix.length === 0) {
            alert('הפלייליסט ריק.');
            return;
        }

        if (repairRunningRef.current) {
            setConfirmModal({
                isOpen: true,
                title: 'סריקה כבר פעילה ברקע',
                message: 'כרגע מתבצעת סריקה ותיקון של פלייליסט ברקע. המתן לסיומה או בטל אותה מהפס התחתון.',
                onConfirm: () => setConfirmModal((prev) => ({ ...prev, isOpen: false })),
                isAlertOnly: true
            });
            return;
        }

        const savedJob = await storageService.loadData<RepairJobCheckpoint | null>(
            'streamify_repair_job',
            null
        );
        const canResume =
            savedJob &&
            savedJob.playlistId === playlist.id &&
            savedJob.nextIndex > 0 &&
            savedJob.nextIndex < songsToFix.length;

        setConfirmModal({
            isOpen: true,
            title: 'סריקה ותיקון חכם ברקע',
            message: canResume
                ? `נמצאה סריקה קודמת של "${playlist.name}" שעצרה בשיר ${savedJob.nextIndex} מתוך ${songsToFix.length}. הסריקה תמשיך כעת ברקע (ללא חסימת האפליקציה) ותחליף אך ורק שירים שבאמת נמחקו מיוטיוב. להמשיך?`
                : `האפליקציה תסרוק ברקע ${songsToFix.length} שירים בפלייליסט "${playlist.name}". רק שירים שבאמת נמחקו מיוטיוב יוחלפו במזהה חדש, והמיקום יישמר אוטומטית גם אם תצא מהאפליקציה. להתחיל?`,
            onConfirm: async () => {
                setConfirmModal((prev) => ({ ...prev, isOpen: false }));
                runBackgroundPlaylistRepair(
                    playlist,
                    canResume ? savedJob!.nextIndex : 0,
                    canResume ? savedJob!.fixedCount : 0
                );
            }
        });
    };

    const handleToggleLike = (songResult: YouTubeSearchResult | PlaylistItem) => {
        if (!likedSongsPlaylist) return;
        const songItem =
            'addedBy' in songResult
                ? (songResult as PlaylistItem)
                : searchResultToPlaylistItem(songResult);
        const isLiked = likedSongsPlaylist.songs.some((s) => s.id === songItem.id);
        if (isLiked) {
            apiRemoveSong(likedSongsPlaylist.id, songItem.id);
        } else {
            apiAddSongsToPlaylist(likedSongsPlaylist.id, [songItem]);
        }
    };

    return {
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
    };
};
