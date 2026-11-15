import { useState, useCallback, useEffect } from 'react';
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
import { fetchYouTubeBrowseApi, fetchYouTubeSearchApi } from '../utils/encryptionUtils';
import {
    BulkImportModalState,
    ConfirmModalState,
    ManageUsersModalState,
    MoveToFolderModalState
} from '../components/Modals';

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
    const [streamifyResults, setStreamifyResults] = useState<YouTubeSearchResult[]>([]);
    const [isLoadingStreamify, setIsLoadingStreamify] = useState(false);
    const [streamifyDisplayLimit, setStreamifyDisplayLimit] = useState(20);
    const [playlistDisplayLimit, setPlaylistDisplayLimit] = useState(30);

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

    const loadStreamifyRecommendations = async (forceRefresh = false) => {
        if (!forceRefresh && streamifyResults.length > 0) return;

        setIsLoadingStreamify(true);
        setStreamifyDisplayLimit(20);

        try {
            const fetchPromises = STREAMIFY_KEYWORDS.map(async (kw) => {
                const data = await fetchYouTubeSearchApi(
                    YOUTUBE_API_BASE,
                    kw,
                    'youtubemusic_playlists',
                    isEncryptionEnabled
                );

                if (data.success && data.results) {
                    const topResults = data.results
                        .slice(0, 15)
                        .filter((r: any) => r.id && r.title);
                    for (let i = topResults.length - 1; i > 0; i--) {
                        const j = Math.floor(Math.random() * (i + 1));
                        [topResults[i], topResults[j]] = [topResults[j], topResults[i]];
                    }
                    return topResults.slice(0, 5);
                }
                return [];
            });

            const resultsArrays = await Promise.all(fetchPromises);
            const allResults = resultsArrays.flat();
            const uniqueResults = Array.from(
                new Map(allResults.map((item) => [item.id, item])).values()
            );

            for (let i = uniqueResults.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [uniqueResults[i], uniqueResults[j]] = [uniqueResults[j], uniqueResults[i]];
            }

            setStreamifyResults(uniqueResults as YouTubeSearchResult[]);
            storageService.saveData('streamify_recommended', uniqueResults);
        } catch (e) {
            console.error('Failed to load streamify recommendations', e);
        } finally {
            setIsLoadingStreamify(false);
        }
    };

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

    const repairPlaylistSongs = async (playlist: Playlist) => {
        const songsToFix = playlist.songs;
        if (songsToFix.length === 0) {
            alert('הפלייליסט ריק.');
            return;
        }

        setConfirmModal({
            isOpen: true,
            title: 'תיקון ועדכון שירים',
            message: `נמצאו ${songsToFix.length} שירים בפלייליסט. האפליקציה תסרוק ותחפש להם קישורים חדשים ותעדכן את ה-ID שלהם. פעולה זו עשויה לקחת קצת זמן. להמשיך?`,
            onConfirm: async () => {
                setConfirmModal((prev) => ({ ...prev, isOpen: false }));
                setGlobalLoading('מתחיל סריקה ועדכון...');
                let successCount = 0;

                for (let i = 0; i < songsToFix.length; i++) {
                    const oldSong = songsToFix[i];
                    setGlobalLoading(
                        `מעדכן: ${oldSong.title} (${i + 1}/${songsToFix.length})`
                    );

                    try {
                        const data = await fetchYouTubeSearchApi(
                            YOUTUBE_API_BASE,
                            `${oldSong.title} ${oldSong.author} audio`,
                            'youtubemusic_songs',
                            isEncryptionEnabled
                        );

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

                    await new Promise((resolve) => setTimeout(resolve, 600));
                }

                setGlobalLoading(null);
                setConfirmModal({
                    isOpen: true,
                    title: 'הסריקה הסתיימה',
                    message: `מתוך ${songsToFix.length} שירים, ${successCount} קיבלו מזהה (ID) חדש ועודכנו בהצלחה.`,
                    onConfirm: () => setConfirmModal((prev) => ({ ...prev, isOpen: false })),
                    isAlertOnly: true
                });
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
        streamifyResults,
        setStreamifyResults,
        isLoadingStreamify,
        streamifyDisplayLimit,
        setStreamifyDisplayLimit,
        playlistDisplayLimit,
        setPlaylistDisplayLimit,
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
