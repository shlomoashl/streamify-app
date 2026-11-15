import React from 'react';
import { Playlist, PlaylistItem, YouTubeSearchResult } from '../../types';
import { getLowResThumbnail } from '../../utils/mediaUtils';
import {
    ArtistIcon,
    ClockIcon,
    HeartIcon,
    LoaderIcon,
    MicIcon,
    MusicIcon,
    PauseIcon,
    PlayIcon,
    PlaylistIcon,
    PlusIcon,
    PodcastIcon,
    SearchIcon,
    XIcon
} from '../Icons';
import { SmartImage } from '../SmartImage';

const FILTER_MAP: Record<string, string> = {
    songs: 'שירים',
    albums: 'אלבומים',
    artists: 'אמנים',
    playlists: 'פלייליסטים',
    podcasts: 'פודקאסטים'
};

export type YtMusicFilter = 'all' | 'songs' | 'albums' | 'artists' | 'playlists' | 'podcasts';

export const SearchView: React.FC<{
    isEncryptionEnabled: boolean;
    searchQuery: string;
    searchResults: YouTubeSearchResult[];
    isSearching: boolean;
    searchSuggestions: string[];
    showSuggestions: boolean;
    focusedSuggestionIndex: number;
    searchHistory: string[];
    ytMusicFilter: YtMusicFilter;
    isListening: boolean;
    currentSongId: string | undefined;
    playingPlaylistId: string | null;
    isPlaying: boolean;
    likedSongsPlaylist: Playlist | null;
    onSearchQueryChange: (val: string) => void;
    onSetShowSuggestions: (show: boolean) => void;
    onSetFocusedSuggestionIndex: React.Dispatch<React.SetStateAction<number>>;
    onPerformSearch: (term: string, isPlaylistContext: boolean) => void;
    onVoiceSearch: () => void;
    onFilterChange: (filter: YtMusicFilter) => void;
    onClearSearchHistory: () => void;
    onRemoveSearchHistoryItem: (term: string) => void;
    onResultClick: (res: YouTubeSearchResult) => void;
    onDirectPlay: (e: React.MouseEvent, res: YouTubeSearchResult) => void;
    onToggleLike: (res: YouTubeSearchResult | PlaylistItem) => void;
    onAddToPlaylistClick: (
        e: React.MouseEvent,
        item: PlaylistItem | YouTubeSearchResult,
        targetPlaylistId?: string
    ) => void;
}> = ({
    isEncryptionEnabled,
    searchQuery,
    searchResults,
    isSearching,
    searchSuggestions,
    showSuggestions,
    focusedSuggestionIndex,
    searchHistory,
    ytMusicFilter,
    isListening,
    currentSongId,
    playingPlaylistId,
    isPlaying,
    likedSongsPlaylist,
    onSearchQueryChange,
    onSetShowSuggestions,
    onSetFocusedSuggestionIndex,
    onPerformSearch,
    onVoiceSearch,
    onFilterChange,
    onClearSearchHistory,
    onRemoveSearchHistoryItem,
    onResultClick,
    onDirectPlay,
    onToggleLike,
    onAddToPlaylistClick
}) => {
    const renderGridSection = (title: string, type: string, items: YouTubeSearchResult[]) => {
        if (items.length === 0) return null;

        const styles: Record<string, { card: string; bg: string; titleColor: string }> = {
            artist: {
                card: 'items-center text-center',
                bg: 'bg-transparent hover:bg-white/5',
                titleColor: 'text-white'
            },
            album: {
                card: 'items-center text-center',
                bg: 'bg-transparent hover:bg-white/5',
                titleColor: 'text-white'
            },
            playlist: {
                card: 'text-right',
                bg: 'bg-[#181818] hover:bg-[#282828]',
                titleColor: 'group-hover:text-spotify-primary text-white'
            },
            podcast: {
                card: 'text-right',
                bg: 'bg-[#252525] hover:bg-[#303030]',
                titleColor: 'text-white'
            }
        };

        const s = styles[type] || styles.album;

        return (
            <section className="mb-8">
                <h2 className="text-xl font-bold text-white mb-4 px-1">{title}</h2>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 md:gap-6 px-1">
                    {items.map((res) => {
                        const isItemPlaying =
                            playingPlaylistId === `temp-${res.id}` && isPlaying;

                        return (
                            <div
                                key={res.id}
                                onClick={() => onResultClick(res)}
                                className={`flex flex-col p-4 ${s.bg} ${s.card} rounded-2xl cursor-pointer transition-all relative group border border-transparent hover:border-white/10`}
                                dir="rtl"
                            >
                                <div
                                    className={`relative w-full aspect-square mb-4 flex items-center justify-center overflow-hidden
                                    ${
                                        type === 'artist'
                                            ? 'rounded-full border-2 border-white/5 shadow-xl bg-[#282828]'
                                            : ''
                                    }
                                    ${
                                        type === 'album'
                                            ? 'rounded-full border-[2px] border-[#555] shadow-2xl bg-gradient-to-tr from-[#222] via-[#333] to-[#222]'
                                            : ''
                                    }
                                    ${
                                        type === 'podcast'
                                            ? 'rounded-2xl shadow-lg bg-[#222222]'
                                            : ''
                                    }
                                    ${
                                        type === 'playlist' || type === 'spotify_playlist'
                                            ? 'rounded-xl shadow-lg bg-[#282828]'
                                            : ''
                                    }
                                `}
                                >
                                    <SmartImage
                                        src={
                                            res.thumbnail_url
                                                ? getLowResThumbnail(res.thumbnail_url)
                                                : ''
                                        }
                                        encryptionEnabled={isEncryptionEnabled}
                                        className="w-full h-full object-cover"
                                        loading="lazy"
                                        decoding="async"
                                        fallback={
                                            <>
                                                {type === 'artist' && (
                                                    <ArtistIcon className="w-2/5 h-2/5 text-gray-500" />
                                                )}
                                                {type === 'album' && (
                                                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                                        <div className="w-[35%] h-[35%] rounded-full border border-white/20 flex items-center justify-center bg-[#111] shadow-[0_0_10px_rgba(0,0,0,0.5)]">
                                                            <div className="w-[30%] h-[30%] bg-[#181818] rounded-full shadow-[inset_0_2px_4px_rgba(0,0,0,0.8)]"></div>
                                                        </div>
                                                    </div>
                                                )}
                                                {type === 'podcast' && (
                                                    <PodcastIcon className="w-2/5 h-2/5 text-gray-500" />
                                                )}
                                                {(type === 'playlist' ||
                                                    type === 'spotify_playlist') && (
                                                    <PlaylistIcon className="w-2/5 h-2/5 text-gray-500" />
                                                )}
                                            </>
                                        }
                                    />

                                    {type !== 'artist' && (
                                        <button
                                            onClick={(e) => onDirectPlay(e, res)}
                                            className="absolute bg-spotify-primary rounded-full flex items-center justify-center text-black shadow-[0_4px_12px_rgba(0,0,0,0.6)] hover:scale-110 active:scale-95 transition-transform z-20 w-8 h-8 md:w-10 md:h-10 bottom-2 left-2 opacity-100"
                                        >
                                            {isItemPlaying ? (
                                                <PauseIcon className="w-4 h-4 md:w-5 md:h-5" fill />
                                            ) : (
                                                <PlayIcon
                                                    className="w-4 h-4 md:w-5 md:h-5 ml-0.5"
                                                    fill
                                                />
                                            )}
                                        </button>
                                    )}
                                </div>

                                <div
                                    className={`text-[15px] font-bold truncate w-full px-1 ${
                                        s.titleColor || ''
                                    }`}
                                >
                                    {res.title}
                                </div>
                                <div className="text-[12px] text-gray-400 truncate w-full px-1 mt-1 font-medium">
                                    {type === 'artist'
                                        ? 'אמן'
                                        : res.author || (type === 'playlist' ? 'פלייליסט' : '')}
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
            <div className="relative z-50 p-4 pt-[max(2.5rem,env(safe-area-inset-top))] md:pt-4 bg-spotify-base shadow-md flex-shrink-0 border-b border-white/5">
                <div className="relative flex items-center gap-4">
                    <div className="relative flex-1">
                        <SearchIcon className="absolute left-3 top-3 text-gray-400" />
                        <input
                            className="w-full bg-white/10 rounded-full py-3 pr-12 pl-10 text-white focus:outline-none focus:ring-1 focus:ring-spotify-primary"
                            placeholder="חיפוש שירים, אלבומים..."
                            value={searchQuery}
                            onChange={(e) => {
                                onSearchQueryChange(e.target.value);
                                onSetShowSuggestions(true);
                                onSetFocusedSuggestionIndex(-1);
                            }}
                            onFocus={() => onSetShowSuggestions(true)}
                            onBlur={() =>
                                setTimeout(() => {
                                    onSetShowSuggestions(false);
                                    onSetFocusedSuggestionIndex(-1);
                                }, 250)
                            }
                            onKeyDown={(e) => {
                                if (showSuggestions && searchSuggestions.length > 0) {
                                    if (e.key === 'ArrowDown') {
                                        e.preventDefault();
                                        onSetFocusedSuggestionIndex((prev) =>
                                            prev < searchSuggestions.length - 1 ? prev + 1 : prev
                                        );
                                        return;
                                    }
                                    if (e.key === 'ArrowUp') {
                                        e.preventDefault();
                                        onSetFocusedSuggestionIndex((prev) =>
                                            prev > -1 ? prev - 1 : -1
                                        );
                                        return;
                                    }
                                }

                                if (e.key === 'Enter') {
                                    e.preventDefault();
                                    onSetShowSuggestions(false);

                                    if (
                                        focusedSuggestionIndex >= 0 &&
                                        focusedSuggestionIndex < searchSuggestions.length
                                    ) {
                                        const selectedSuggestion =
                                            searchSuggestions[focusedSuggestionIndex];
                                        onSearchQueryChange(selectedSuggestion);
                                        onPerformSearch(selectedSuggestion, false);
                                    } else if (searchQuery.trim()) {
                                        onPerformSearch(searchQuery, false);
                                    }

                                    onSetFocusedSuggestionIndex(-1);
                                    (e.target as HTMLInputElement).blur();
                                }
                            }}
                        />
                        <button
                            onClick={onVoiceSearch}
                            className={`absolute right-2 top-1.5 p-1.5 rounded-full transition-all duration-300 z-10 ${
                                isListening
                                    ? 'bg-red-500/20 text-red-500 animate-pulse scale-110'
                                    : 'text-gray-400 hover:text-white hover:bg-white/10'
                            }`}
                            title="חיפוש קולי"
                        >
                            <MicIcon className="w-6 h-6" />
                        </button>

                        {showSuggestions && searchSuggestions.length > 0 && (
                            <div className="absolute top-[110%] left-0 right-0 bg-[#282828] border border-white/10 rounded-xl shadow-2xl z-[100] overflow-hidden">
                                {searchSuggestions.map((suggestion, idx) => (
                                    <div
                                        key={idx}
                                        className={`flex items-center gap-4 p-3 cursor-pointer border-b border-white/5 last:border-0 transition-colors ${
                                            focusedSuggestionIndex === idx
                                                ? 'bg-white/20'
                                                : 'hover:bg-white/10'
                                        }`}
                                        onMouseEnter={() => onSetFocusedSuggestionIndex(idx)}
                                        onClick={() => {
                                            onSearchQueryChange(suggestion);
                                            onSetShowSuggestions(false);
                                            onSetFocusedSuggestionIndex(-1);
                                            onPerformSearch(suggestion, false);
                                        }}
                                    >
                                        <SearchIcon className="w-4 h-4 text-gray-500" />
                                        <span
                                            className="text-sm font-medium text-white text-right flex-1"
                                            dir="rtl"
                                        >
                                            {suggestion}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                <div className="flex gap-2 mt-3 overflow-x-auto no-scrollbar pb-1">
                    {(
                        ['all', 'songs', 'albums', 'playlists', 'artists', 'podcasts'] as const
                    ).map((f) => (
                        <button
                            key={f}
                            onClick={() => onFilterChange(f)}
                            className={`px-4 py-1 rounded-full text-xs border whitespace-nowrap transition-colors ${
                                ytMusicFilter === f
                                    ? 'bg-white text-black border-white'
                                    : 'border-white/20 hover:border-white text-white'
                            }`}
                        >
                            {f === 'all' ? 'הכל' : FILTER_MAP[f] || f}
                        </button>
                    ))}
                </div>
            </div>

            <div className="flex-1 p-4 overflow-y-auto no-scrollbar">
                {!searchQuery.trim() && searchHistory.length > 0 ? (
                    <div className="mt-2">
                        <div className="flex justify-between items-center mb-4 px-2">
                            <h3 className="font-bold text-lg">חיפושים אחרונים</h3>
                            <button
                                onClick={onClearSearchHistory}
                                className="text-xs font-bold text-gray-400 hover:text-white"
                            >
                                נקה הכל
                            </button>
                        </div>
                        <div className="space-y-1">
                            {searchHistory.map((term, i) => (
                                <div
                                    key={i}
                                    className="flex items-center justify-between p-3 rounded-lg hover:bg-white/10 group cursor-pointer"
                                    onClick={() => {
                                        onSearchQueryChange(term);
                                        onPerformSearch(term, false);
                                    }}
                                >
                                    <div className="flex items-center gap-4 min-w-0">
                                        <div className="text-gray-400">
                                            <ClockIcon className="w-5 h-5" />
                                        </div>
                                        <span className="truncate">{term}</span>
                                    </div>
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            onRemoveSearchHistoryItem(term);
                                        }}
                                        className="text-gray-400 hover:text-white p-2 z-10"
                                    >
                                        <XIcon className="w-4 h-4" />
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
                        <div className="flex flex-col gap-1">
                            {ytMusicFilter === 'all' && searchResults.length > 0 && (
                                <section>
                                    <h2 className="text-xl font-bold text-white mb-4 px-1">
                                        התוצאה הטובה ביותר
                                    </h2>

                                    <div
                                        className="grid grid-cols-1 lg:grid-cols-2 gap-x-6 gap-y-4 lg:gap-y-0 items-stretch"
                                        dir="rtl"
                                    >
                                        {(() => {
                                            const topResult = searchResults[0];
                                            const topType = topResult.type || 'song';
                                            const isSong =
                                                topType === 'song' || topType === 'video';
                                            const isSelected = isSong
                                                ? currentSongId === topResult.id
                                                : playingPlaylistId === `temp-${topResult.id}`;
                                            const isTopPlaying = isSelected && isPlaying;

                                            return (
                                                <div
                                                    onClick={() => onResultClick(topResult)}
                                                    className="lg:col-span-1 h-full bg-gradient-to-br from-[#282828] to-[#121212] hover:from-[#383838] p-6 rounded-2xl cursor-pointer transition-all group relative flex flex-col justify-center border border-white/10 shadow-2xl"
                                                >
                                                    <div
                                                        className={`w-32 h-32 mb-5 mx-auto lg:mx-0 flex items-center justify-center relative
                                                        ${
                                                            topType === 'artist'
                                                                ? 'rounded-full border-2 border-white/5 shadow-xl bg-[#282828]'
                                                                : ''
                                                        }
                                                        ${
                                                            topType === 'album'
                                                                ? 'rounded-full border-[2px] border-[#555] shadow-xl bg-gradient-to-tr from-[#222] via-[#333] to-[#222]'
                                                                : ''
                                                        }
                                                        ${
                                                            topType === 'podcast'
                                                                ? 'rounded-2xl shadow-xl bg-[#222222]'
                                                                : ''
                                                        }
                                                        ${
                                                            topType === 'playlist' ||
                                                            topType === 'spotify_playlist'
                                                                ? 'rounded-xl shadow-xl bg-[#282828]'
                                                                : ''
                                                        }
                                                        ${
                                                            topType === 'song' ||
                                                            topType === 'video'
                                                                ? 'rounded-xl shadow-xl bg-[#282828] overflow-hidden'
                                                                : ''
                                                        }
                                                    `}
                                                    >
                                                        {topType === 'artist' && (
                                                            <ArtistIcon className="w-16 h-16 text-gray-500" />
                                                        )}

                                                        {topType === 'album' && (
                                                            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                                                <div className="w-10 h-10 rounded-full border border-white/20 flex items-center justify-center bg-[#111] shadow-[0_0_10px_rgba(0,0,0,0.5)]">
                                                                    <div className="w-4 h-4 bg-[#181818] rounded-full shadow-[inset_0_2px_4px_rgba(0,0,0,0.8)]"></div>
                                                                </div>
                                                            </div>
                                                        )}

                                                        {topType === 'podcast' && (
                                                            <PodcastIcon className="w-16 h-16 text-gray-500" />
                                                        )}
                                                        {(topType === 'playlist' ||
                                                            topType === 'spotify_playlist') && (
                                                            <PlaylistIcon className="w-16 h-16 text-gray-500" />
                                                        )}
                                                        {(topType === 'song' ||
                                                            topType === 'video') && (
                                                            <SmartImage
                                                                src={topResult.thumbnail_url || ''}
                                                                encryptionEnabled={isEncryptionEnabled}
                                                                className="w-full h-full object-cover"
                                                                fallback={
                                                                    <MusicIcon className="w-16 h-16 text-gray-500" />
                                                                }
                                                            />
                                                        )}
                                                    </div>

                                                    <h3
                                                        className={`text-3xl font-black truncate mb-2 ${
                                                            isSelected
                                                                ? 'text-spotify-primary'
                                                                : 'text-white'
                                                        }`}
                                                    >
                                                        {topResult.title}
                                                    </h3>
                                                    <div className="flex items-center gap-2">
                                                        <span className="bg-spotify-primary/20 text-spotify-primary px-3 py-1 rounded-full text-[12px] font-bold tracking-wide">
                                                            {topType === 'artist'
                                                                ? 'אמן'
                                                                : topType === 'playlist' ||
                                                                  topType === 'spotify_playlist'
                                                                ? 'פלייליסט'
                                                                : topType === 'album'
                                                                ? 'אלבום'
                                                                : 'שיר'}
                                                        </span>
                                                        {topType !== 'artist' && (
                                                            <span className="text-gray-400 text-sm font-medium truncate">
                                                                {topResult.author ||
                                                                    topResult.channel}
                                                            </span>
                                                        )}
                                                    </div>

                                                    <div className="absolute bottom-6 left-6 scale-110 z-20">
                                                        <button
                                                            onClick={(e) =>
                                                                onDirectPlay(e, topResult)
                                                            }
                                                            className="w-14 h-14 bg-spotify-primary rounded-full flex items-center justify-center text-black shadow-xl hover:scale-110 active:scale-95 transition-all"
                                                        >
                                                            {isTopPlaying ? (
                                                                <PauseIcon
                                                                    className="w-7 h-7"
                                                                    fill
                                                                />
                                                            ) : (
                                                                <PlayIcon
                                                                    className="w-7 h-7 ml-1"
                                                                    fill
                                                                />
                                                            )}
                                                        </button>
                                                    </div>
                                                </div>
                                            );
                                        })()}

                                        <div className="lg:col-span-1 flex flex-col gap-1 bg-transparent">
                                            {searchResults
                                                .filter(
                                                    (r) =>
                                                        !r.type ||
                                                        r.type === 'song' ||
                                                        r.type === 'video'
                                                )
                                                .filter((r) => r.id !== searchResults[0].id)
                                                .slice(0, 4)
                                                .map((res) => {
                                                    const isRowPlaying =
                                                        currentSongId === res.id;
                                                    const isLiked =
                                                        likedSongsPlaylist?.songs.some(
                                                            (s) => s.id === res.id
                                                        );

                                                    return (
                                                        <div
                                                            key={res.id}
                                                            onClick={() => onResultClick(res)}
                                                            className={`flex items-center gap-3 p-3 hover:bg-white/5 rounded-xl group cursor-pointer transition-all ${
                                                                isRowPlaying ? 'bg-white/10' : ''
                                                            }`}
                                                        >
                                                            <div className="w-11 h-11 bg-[#282828] rounded flex items-center justify-center text-gray-400 flex-shrink-0 overflow-hidden relative">
                                                                <SmartImage
                                                                    src={res.thumbnail_url || ''}
                                                                    encryptionEnabled={isEncryptionEnabled}
                                                                    className="w-full h-full object-cover"
                                                                    fallback={
                                                                        <MusicIcon
                                                                            className={`w-5 h-5 ${
                                                                                isRowPlaying
                                                                                    ? 'text-spotify-primary'
                                                                                    : ''
                                                                            }`}
                                                                        />
                                                                    }
                                                                />
                                                            </div>
                                                            <div className="flex-1 min-w-0 text-right">
                                                                <div
                                                                    className={`text-[14px] font-bold truncate ${
                                                                        isRowPlaying
                                                                            ? 'text-spotify-primary'
                                                                            : 'text-white'
                                                                    }`}
                                                                >
                                                                    {res.title}
                                                                </div>
                                                                <div className="text-[12px] text-gray-400 truncate">
                                                                    {res.author}
                                                                </div>
                                                            </div>
                                                            <div className="flex items-center gap-1">
                                                                <button
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        onToggleLike(res);
                                                                    }}
                                                                    className={`p-2 transition-all ${
                                                                        isLiked
                                                                            ? 'text-[#ff4b4b]'
                                                                            : 'text-gray-400 hover:text-white active:scale-95'
                                                                    }`}
                                                                >
                                                                    <HeartIcon
                                                                        className="w-4 h-4"
                                                                        filled={isLiked}
                                                                    />
                                                                </button>
                                                                <button
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        onAddToPlaylistClick(
                                                                            e,
                                                                            res
                                                                        );
                                                                    }}
                                                                    className="p-2 text-gray-400 hover:text-white transition-all active:scale-95"
                                                                >
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

                            {(() => {
                                const songsToDisplay = searchResults
                                    .filter(
                                        (r) => !r.type || r.type === 'song' || r.type === 'video'
                                    )
                                    .filter((r) => {
                                        if (ytMusicFilter !== 'all') return true;
                                        const topResultId = searchResults[0]?.id;
                                        if (r.id === topResultId) return false;
                                        const allSongsWithoutTop = searchResults
                                            .filter(
                                                (s) =>
                                                    !s.type ||
                                                    s.type === 'song' ||
                                                    s.type === 'video'
                                            )
                                            .filter((s) => s.id !== topResultId);
                                        const idx = allSongsWithoutTop.findIndex(
                                            (s) => s.id === r.id
                                        );
                                        return idx >= 4;
                                    });

                                if (songsToDisplay.length === 0) return null;

                                return (
                                    <section>
                                        {ytMusicFilter !== 'all' && (
                                            <h2 className="text-xl font-bold text-white mb-4 px-1">
                                                שירים
                                            </h2>
                                        )}

                                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-6 gap-y-1">
                                            {songsToDisplay.map((res) => {
                                                const isRowPlaying = currentSongId === res.id;
                                                const isLiked = likedSongsPlaylist?.songs.some(
                                                    (s) => s.id === res.id
                                                );
                                                return (
                                                    <div
                                                        key={res.id}
                                                        onClick={() => onResultClick(res)}
                                                        className={`flex items-center gap-3 p-3 hover:bg-white/5 rounded-xl group cursor-pointer transition-all ${
                                                            isRowPlaying ? 'bg-white/10' : ''
                                                        }`}
                                                    >
                                                        <div className="w-11 h-11 bg-[#282828] rounded flex items-center justify-center text-gray-400 flex-shrink-0 overflow-hidden">
                                                            <SmartImage
                                                                src={res.thumbnail_url || ''}
                                                                encryptionEnabled={isEncryptionEnabled}
                                                                className="w-full h-full object-cover"
                                                                fallback={
                                                                    <MusicIcon className="w-5 h-5" />
                                                                }
                                                            />
                                                        </div>
                                                        <div
                                                            className="flex-1 min-w-0 text-right"
                                                            dir="rtl"
                                                        >
                                                            <div
                                                                className={`text-[14px] font-bold truncate ${
                                                                    isRowPlaying
                                                                        ? 'text-spotify-primary'
                                                                        : 'text-white'
                                                                }`}
                                                            >
                                                                {res.title}
                                                            </div>
                                                            <div className="text-[12px] text-gray-400 truncate">
                                                                {res.author}
                                                            </div>
                                                        </div>
                                                        <div className="flex items-center gap-1">
                                                            <button
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    onToggleLike(res);
                                                                }}
                                                                className={`p-2 transition-all ${
                                                                    isLiked
                                                                        ? 'text-[#ff4b4b]'
                                                                        : 'text-gray-400 hover:text-white active:scale-95'
                                                                }`}
                                                            >
                                                                <HeartIcon
                                                                    className="w-4 h-4"
                                                                    filled={isLiked}
                                                                />
                                                            </button>
                                                            <button
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    onAddToPlaylistClick(e, res);
                                                                }}
                                                                className="p-2 text-gray-400 hover:text-white transition-all active:scale-95"
                                                            >
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

                        {renderGridSection(
                            'פלייליסטים',
                            'playlist',
                            searchResults.filter(
                                (r) => r.type === 'playlist' || r.type === 'spotify_playlist'
                            )
                        )}
                        {renderGridSection(
                            'אמנים',
                            'artist',
                            searchResults.filter((r) => r.type === 'artist')
                        )}
                        {renderGridSection(
                            'אלבומים',
                            'album',
                            searchResults.filter((r) => r.type === 'album')
                        )}
                        {renderGridSection(
                            'פודקאסטים',
                            'podcast',
                            searchResults.filter((r) => r.type === 'podcast')
                        )}
                    </>
                )}
            </div>
        </>
    );
};
