import { useState, useRef, useEffect } from 'react';
import { SpeechRecognition } from '@capacitor-community/speech-recognition';
import {
    Playlist,
    PlaylistItem,
    ViewState,
    YouTubeDownloadResponse,
    YouTubeSearchResult
} from '../types';
import { SPOTIFY_WS_URL, YOUTUBE_API_BASE } from '../constants';
import { storageService } from '../StorageService';
import { parseDurationToSeconds, searchResultToPlaylistItem } from '../utils/mediaUtils';
import {
    fetchYouTubeBrowseApi,
    fetchYouTubeSearchApi,
    fetchYouTubeSuggestionsApi
} from '../utils/encryptionUtils';
import { BulkImportModalState, ConfirmModalState } from '../components/Modals';
import { YtMusicFilter } from '../components/views/SearchView';

export const useSearchManager = (params: {
    isEncryptionEnabled: boolean;
    selectedPlaylistId: string | undefined;
    setSelectedPlaylist: React.Dispatch<React.SetStateAction<Playlist | null>>;
    setActiveTab: (tab: ViewState) => void;
    setGlobalLoading: (msg: string | null) => void;
    setConfirmModal: React.Dispatch<React.SetStateAction<ConfirmModalState>>;
    setBulkImportState: React.Dispatch<React.SetStateAction<BulkImportModalState>>;
    setShowPlaylistSelector: (show: boolean) => void;
    setSongsToAdd: (songs: PlaylistItem[]) => void;
    apiAddSongsToPlaylist: (
        playlistId: string,
        newSongs: PlaylistItem[],
        playlistOverride?: Playlist
    ) => Promise<void>;
}) => {
    const {
        isEncryptionEnabled,
        selectedPlaylistId,
        setSelectedPlaylist,
        setActiveTab,
        setGlobalLoading,
        setConfirmModal,
        setBulkImportState,
        setShowPlaylistSelector,
        setSongsToAdd,
        apiAddSongsToPlaylist
    } = params;

    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState<YouTubeSearchResult[]>([]);
    const [isSearching, setIsSearching] = useState(false);
    const [searchSuggestions, setSearchSuggestions] = useState<string[]>([]);
    const [showSuggestions, setShowSuggestions] = useState(false);
    const [focusedSuggestionIndex, setFocusedSuggestionIndex] = useState<number>(-1);
    const [searchHistory, setSearchHistory] = useState<string[]>([]);
    const [ytMusicFilter, setYtMusicFilter] = useState<YtMusicFilter>('all');
    const [isListening, setIsListening] = useState(false);

    const [playlistSearchQuery, setPlaylistSearchQuery] = useState('');
    const [playlistSearchResults, setPlaylistSearchResults] = useState<YouTubeSearchResult[]>(
        []
    );
    const [isPlaylistSearching, setIsPlaylistSearching] = useState(false);

    const searchAbortController = useRef<AbortController | null>(null);
    const silenceTimeoutRef = useRef<any>(null);
    const spotifyWsRef = useRef<WebSocket | null>(null);

    useEffect(() => {
        setPlaylistSearchQuery('');
        setPlaylistSearchResults([]);
    }, [selectedPlaylistId]);

    const addToSearchHistory = (term: string) => {
        if (!term || !term.trim()) return;
        const trimmed = term.trim();
        setSearchHistory((prev) => {
            const filtered = prev.filter((t) => t !== trimmed);
            const newHistory = [trimmed, ...filtered].slice(0, 15);
            storageService.saveData('streamify_search_history', newHistory);
            return newHistory;
        });
    };

    const removeSearchHistoryItem = (term: string) => {
        setSearchHistory((prev) => {
            const newHistory = prev.filter((t) => t !== term);
            storageService.saveData('streamify_search_history', newHistory);
            return newHistory;
        });
    };

    const clearSearchHistory = () => {
        setSearchHistory([]);
        storageService.saveData('streamify_search_history', []);
    };

    const handleSpotifyImport = (playlistId: string) => {
        const tempPlaylist: Playlist = {
            id: `temp-spotify-${playlistId}`,
            name: 'טוען פלייליסט ספוטיפיי...',
            creator: 'Spotify',
            isPublic: false,
            songs: []
        };
        setSelectedPlaylist(tempPlaylist);
        setActiveTab('playlist');
        setIsSearching(false);
        if (spotifyWsRef.current) spotifyWsRef.current.close();
        try {
            const ws = new WebSocket(SPOTIFY_WS_URL);
            spotifyWsRef.current = ws;
            ws.onopen = () =>
                ws.send(JSON.stringify({ type: 'start', playlist_id: playlistId }));
            ws.onmessage = (event) => {
                const message = JSON.parse(event.data);
                if (message.type === 'track') {
                    const data = message.data;
                    if (!data.id) return;
                    const newSong: PlaylistItem = {
                        id: data.id,
                        title: data.title,
                        author: data.author || '',
                        duration: parseDurationToSeconds(data.duration),
                        thumbnail: data.thumbnail_url || '',
                        addedBy: 'spotify_import',
                        addedAt: new Date().toISOString()
                    };
                    setSelectedPlaylist((prev) =>
                        !prev || !prev.id.startsWith('temp-')
                            ? prev
                            : {
                                  ...prev,
                                  name: 'טעינה מספוטיפיי...',
                                  songs: [...prev.songs, newSong]
                              }
                    );
                } else if (message.type === 'end') {
                    ws.close();
                    setSelectedPlaylist((prev) =>
                        prev ? { ...prev, name: 'Spotify Imported Playlist' } : null
                    );
                } else if (message.type === 'error') {
                    setConfirmModal({
                        isOpen: true,
                        title: 'שגיאה',
                        message: 'שגיאה בייבוא מספוטיפיי: ' + message.message,
                        onConfirm: () =>
                            setConfirmModal((prev) => ({ ...prev, isOpen: false })),
                        isAlertOnly: true
                    });
                    ws.close();
                    setSelectedPlaylist(null);
                    setActiveTab('search');
                }
            };
        } catch (e) {
            console.error('Failed to connect WS', e);
        }
    };

    useEffect(() => {
        const fetchSuggestions = async () => {
            if (!searchQuery.trim()) {
                setSearchSuggestions([]);
                return;
            }
            try {
                const suggestions = await fetchYouTubeSuggestionsApi(
                    YOUTUBE_API_BASE,
                    searchQuery,
                    isEncryptionEnabled
                );
                setSearchSuggestions(suggestions);
            } catch (e) {
                console.error('Suggestions error', e);
            }
        };

        const handler = setTimeout(fetchSuggestions, 200);
        return () => clearTimeout(handler);
    }, [searchQuery, isEncryptionEnabled]);

    useEffect(() => {
        if (!searchQuery.trim()) {
            if (searchAbortController.current) {
                searchAbortController.current.abort();
            }
            setSearchResults([]);
            setIsSearching(false);
        }
    }, [searchQuery]);

    const performSearch = async (term: string, isPlaylistContext: boolean) => {
        const spotifyMatch = term.match(/open\.spotify\.com\/playlist\/([a-zA-Z0-9]+)/);
        if (spotifyMatch && !isPlaylistContext) {
            handleSpotifyImport(spotifyMatch[1]);
            return;
        }

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
            const searchEngine = isPlaylistContext
                ? 'youtubemusic_songs'
                : `youtubemusic_${ytMusicFilter}`;

            const data: YouTubeDownloadResponse = await fetchYouTubeSearchApi(
                YOUTUBE_API_BASE,
                term,
                searchEngine,
                isEncryptionEnabled,
                currentSignal
            );
            if (currentSignal?.aborted) return;

            const finalResults =
                data.success && data.results
                    ? data.results.filter(
                          (r: any) =>
                              r.id &&
                              String(r.id).toLowerCase() !== 'null' &&
                              String(r.id).toLowerCase() !== 'undefined' &&
                              String(r.id).trim() !== ''
                      )
                    : [];
            setResults(finalResults);
        } catch (e: any) {
            if (currentSignal?.aborted || e.name === 'AbortError') return;
            setResults([]);
        } finally {
            if (!currentSignal?.aborted) {
                setLoading(false);
            }
        }
    };

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
                alert('חיפוש קולי לא נתמך במכשיר זה.');
                return;
            }

            const permissions = await SpeechRecognition.checkPermissions();
            if (permissions.speechRecognition !== 'granted') {
                const requested = await SpeechRecognition.requestPermissions();
                if (requested.speechRecognition !== 'granted') {
                    alert('חובה לאשר גישה למיקרופון כדי להשתמש בחיפוש קולי.');
                    return;
                }
            }

            setIsListening(true);
            setSearchQuery('');
            await SpeechRecognition.removeAllListeners();

            let hasFinished = false;
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

            SpeechRecognition.addListener('partialResults', (data: any) => {
                if (data.matches && data.matches.length > 0) {
                    const transcript = data.matches[0];
                    setSearchQuery(transcript);
                    if (silenceTimeoutRef.current) clearTimeout(silenceTimeoutRef.current);
                    silenceTimeoutRef.current = setTimeout(() => {
                        finalizeSearch(transcript);
                    }, 1500);
                }
            });

            silenceTimeoutRef.current = setTimeout(() => {
                finalizeSearch('');
            }, 5000);

            await SpeechRecognition.start({
                language: 'he-IL',
                maxResults: 1,
                partialResults: true,
                popup: false
            });
        } catch (e) {
            console.error('Voice search ended or error:', e);
            if (silenceTimeoutRef.current) clearTimeout(silenceTimeoutRef.current);
            setIsListening(false);
            SpeechRecognition.removeAllListeners();
        }
    };

    const handleAddToPlaylistClick = async (
        e: React.MouseEvent,
        item: PlaylistItem | YouTubeSearchResult,
        targetPlaylistId?: string
    ) => {
        e.stopPropagation();
        const itemAsResult = item as YouTubeSearchResult;
        if (
            itemAsResult.type &&
            ['album', 'playlist', 'podcast', 'artist'].includes(itemAsResult.type)
        ) {
            const setLoading = isPlaylistSearching
                ? setIsPlaylistSearching
                : setIsSearching;
            setLoading(true);
            setGlobalLoading('טוען שירים...');
            try {
                const data = await fetchYouTubeBrowseApi(
                    YOUTUBE_API_BASE,
                    item.id,
                    itemAsResult.type,
                    isEncryptionEnabled
                );
                if (data.success && data.results && data.results.length > 0) {
                    const tracks = data.results.map((r: any) =>
                        searchResultToPlaylistItem(r, 'bulk_import')
                    );
                    setBulkImportState({
                        isOpen: true,
                        item: itemAsResult,
                        tracks,
                        targetPlaylistId,
                        mode: targetPlaylistId ? 'confirm_simple' : 'select_action'
                    });
                } else {
                    setConfirmModal({
                        isOpen: true,
                        title: 'שגיאה',
                        message: 'לא נמצאו שירים.',
                        onConfirm: () =>
                            setConfirmModal((prev) => ({ ...prev, isOpen: false })),
                        isAlertOnly: true
                    });
                }
            } catch {
                setConfirmModal({
                    isOpen: true,
                    title: 'שגיאה',
                    message: 'שגיאה בייבוא שירים.',
                    onConfirm: () =>
                        setConfirmModal((prev) => ({ ...prev, isOpen: false })),
                    isAlertOnly: true
                });
            } finally {
                setLoading(false);
                setGlobalLoading(null);
            }
            return;
        }
        if (targetPlaylistId) {
            apiAddSongsToPlaylist(targetPlaylistId, [
                searchResultToPlaylistItem(itemAsResult)
            ]);
            return;
        }
        if (itemAsResult.type === 'spotify_playlist') {
            handleSpotifyImport(itemAsResult.id);
            return;
        }
        setSongsToAdd([searchResultToPlaylistItem(itemAsResult)]);
        setShowPlaylistSelector(true);
    };

    return {
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
    };
};
