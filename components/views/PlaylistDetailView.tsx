import React, { useRef } from 'react';
import { Playlist, PlaylistItem, YouTubeSearchResult } from '../../types';
import { formatDuration } from '../../utils/mediaUtils';
import {
    AlbumIcon,
    ArtistIcon,
    HeartIcon,
    LoaderIcon,
    MusicIcon,
    PauseIcon,
    PlayIcon,
    PlusIcon,
    PodcastIcon,
    SearchIcon,
    ShuffleIcon
} from '../Icons';

export const PlaylistDetailView: React.FC<{
    selectedPlaylist: Playlist;
    playlistDisplayLimit: number;
    isShuffled: boolean;
    playingPlaylistId: string | null;
    isPlaying: boolean;
    currentSongId: string | undefined;
    likedSongsPlaylist: Playlist | null;
    playlistSearchQuery: string;
    playlistSearchResults: YouTubeSearchResult[];
    isPlaylistSearching: boolean;
    observerRef: React.RefObject<HTMLDivElement>;
    onBack: () => void;
    onPromptRename: () => void;
    onToggleShuffle: () => void;
    onPlaylistPlay: (playlist: Playlist) => void;
    onAddAllTempSongs: (songs: PlaylistItem[]) => void;
    onPlaySong: (
        song: PlaylistItem,
        queue: PlaylistItem[],
        index: number,
        isPlaylistStartAction: boolean,
        playlistId: string | null
    ) => void;
    onRemoveSongConfirm: (song: PlaylistItem) => void;
    onToggleLike: (song: PlaylistItem | YouTubeSearchResult) => void;
    onOpenSelectorForSong: (song: PlaylistItem) => void;
    onPlaylistSearchChange: (val: string) => void;
    onAddToPlaylistClick: (
        e: React.MouseEvent,
        item: PlaylistItem | YouTubeSearchResult,
        targetPlaylistId?: string
    ) => void;
}> = ({
    selectedPlaylist,
    playlistDisplayLimit,
    isShuffled,
    playingPlaylistId,
    isPlaying,
    currentSongId,
    likedSongsPlaylist,
    playlistSearchQuery,
    playlistSearchResults,
    isPlaylistSearching,
    observerRef,
    onBack,
    onPromptRename,
    onToggleShuffle,
    onPlaylistPlay,
    onAddAllTempSongs,
    onPlaySong,
    onRemoveSongConfirm,
    onToggleLike,
    onOpenSelectorForSong,
    onPlaylistSearchChange,
    onAddToPlaylistClick
}) => {
    const longPressTimer = useRef<any>(null);
    const isLongPressRef = useRef(false);
    const isRenameable =
        !selectedPlaylist.isLikedSongs &&
        !selectedPlaylist.id.startsWith('temp-') &&
        !selectedPlaylist.externalId;

    return (
        <div>
            <div className="sticky top-0 z-10 p-4 pt-[max(2.5rem,env(safe-area-inset-top))] md:pt-4 bg-spotify-base/95 backdrop-blur flex items-center gap-4 border-b border-white/5">
                <button
                    onClick={onBack}
                    className="p-2 bg-black/40 rounded-full hover:bg-white/20"
                >
                    <svg
                        className="w-6 h-6"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                    >
                        <polyline points="15 18 9 12 15 6" />
                    </svg>
                </button>
                <h1
                    className={`font-bold text-xl truncate ${isRenameable ? 'cursor-pointer' : ''}`}
                    onClick={() => {
                        if (isRenameable) onPromptRename();
                    }}
                >
                    {selectedPlaylist.name}
                </h1>
            </div>

            <div className="p-6 flex flex-col items-center text-center bg-gradient-to-b from-white/5 to-transparent">
                <div className="w-40 h-40 bg-neutral-800 shadow-2xl rounded-lg flex items-center justify-center text-gray-200 mb-4">
                    {selectedPlaylist.isLikedSongs ? (
                        <HeartIcon className="w-20 h-20 text-spotify-primary" filled />
                    ) : selectedPlaylist.externalType === 'album' ? (
                        <AlbumIcon className="w-20 h-20" />
                    ) : selectedPlaylist.externalType === 'artist' ? (
                        <ArtistIcon className="w-20 h-20" />
                    ) : selectedPlaylist.externalType === 'podcast' ? (
                        <PodcastIcon className="w-20 h-20" />
                    ) : (
                        <MusicIcon className="w-20 h-20" />
                    )}
                </div>
                <h2
                    className={`text-2xl font-bold mb-1 ${isRenameable ? 'cursor-pointer' : ''}`}
                    onClick={() => {
                        if (isRenameable) onPromptRename();
                    }}
                >
                    {selectedPlaylist.name}
                </h2>
                <p className="text-gray-400 text-sm">
                    {selectedPlaylist.songs.length > 0
                        ? `${selectedPlaylist.songs.length} שירים`
                        : selectedPlaylist.externalId
                        ? 'נטען מהרשת...'
                        : 'ריק'}
                </p>
            </div>

            <div className="p-4">
                <div className="flex justify-center gap-6 mb-8 items-center">
                    <button
                        onClick={onToggleShuffle}
                        className={`p-4 rounded-full bg-white/10 ${
                            isShuffled ? 'text-spotify-primary' : 'text-white'
                        }`}
                    >
                        <ShuffleIcon className="w-8 h-8" active={isShuffled} />
                    </button>
                    <button
                        onClick={() => onPlaylistPlay(selectedPlaylist)}
                        className="bg-spotify-primary text-black p-4 rounded-full shadow-lg transform hover:scale-105 transition-transform"
                        disabled={
                            selectedPlaylist.songs.length === 0 && !selectedPlaylist.externalId
                        }
                    >
                        {playingPlaylistId === selectedPlaylist.id && isPlaying ? (
                            <PauseIcon className="w-8 h-8" fill />
                        ) : (
                            <PlayIcon className="w-8 h-8" fill />
                        )}
                    </button>
                    {selectedPlaylist.id.startsWith('temp-') &&
                        selectedPlaylist.songs.length > 0 && (
                            <button
                                onClick={() => onAddAllTempSongs(selectedPlaylist.songs)}
                                className="bg-white/10 text-white p-4 rounded-full"
                                title="הוסף הכל"
                            >
                                <PlusIcon className="w-8 h-8" />
                            </button>
                        )}
                </div>

                <div className="space-y-1">
                    {selectedPlaylist.songs
                        .slice(0, playlistDisplayLimit)
                        .map((song, idx) => {
                            const isCurrentSong = Boolean(
                                currentSongId && song.id && currentSongId === song.id
                            );
                            const isLiked = likedSongsPlaylist?.songs.some(
                                (s) => s.id === song.id
                            );

                            return (
                                <div
                                    key={song.id + idx}
                                    onClick={() => {
                                        if (!isLongPressRef.current) {
                                            onPlaySong(
                                                song,
                                                selectedPlaylist.songs,
                                                idx,
                                                false,
                                                selectedPlaylist.id
                                            );
                                        }
                                    }}
                                    onTouchStart={() => {
                                        isLongPressRef.current = false;
                                        longPressTimer.current = setTimeout(() => {
                                            isLongPressRef.current = true;
                                        }, 500);
                                    }}
                                    onTouchEnd={() => clearTimeout(longPressTimer.current)}
                                    onTouchMove={() => clearTimeout(longPressTimer.current)}
                                    onContextMenu={(e) => {
                                        e.preventDefault();
                                        clearTimeout(longPressTimer.current);
                                        onRemoveSongConfirm(song);
                                    }}
                                    className="flex items-center gap-3 p-2 rounded hover:bg-white/10 cursor-pointer"
                                >
                                    <div className="w-8 text-center text-sm text-gray-400">
                                        {isCurrentSong && isPlaying ? (
                                            <MusicIcon className="w-4 h-4 text-spotify-primary animate-pulse inline" />
                                        ) : (
                                            idx + 1
                                        )}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div
                                            className={`font-medium truncate ${
                                                isCurrentSong ? 'text-spotify-primary' : ''
                                            }`}
                                        >
                                            {song.title}
                                        </div>
                                        <div className="text-xs text-gray-400 truncate">
                                            {song.author}
                                        </div>
                                    </div>
                                    <div className="text-xs text-gray-500 font-mono">
                                        {formatDuration(song.duration)}
                                    </div>
                                    <div className="flex items-center">
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                onToggleLike(song);
                                            }}
                                            className={`p-2 ${
                                                isLiked
                                                    ? 'text-spotify-primary'
                                                    : 'text-gray-400 hover:text-white'
                                            }`}
                                        >
                                            <HeartIcon filled={isLiked} />
                                        </button>
                                        {!selectedPlaylist.isLikedSongs &&
                                            !selectedPlaylist.externalId && (
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        onOpenSelectorForSong(song);
                                                    }}
                                                    className="p-2 text-gray-400 hover:text-white"
                                                >
                                                    <PlusIcon />
                                                </button>
                                            )}
                                    </div>
                                </div>
                            );
                        })}

                    {selectedPlaylist.songs.length > playlistDisplayLimit && (
                        <div
                            ref={observerRef}
                            className="h-16 w-full flex items-center justify-center"
                        >
                            <span className="text-gray-500 text-sm animate-pulse">טוען...</span>
                        </div>
                    )}
                </div>

                {!selectedPlaylist.id.startsWith('temp-') &&
                    !selectedPlaylist.isLikedSongs &&
                    !selectedPlaylist.externalId && (
                        <div className="my-8">
                            <div className="relative">
                                <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                                <input
                                    type="text"
                                    placeholder="חיפוש שירים להוספה..."
                                    value={playlistSearchQuery}
                                    onChange={(e) => onPlaylistSearchChange(e.target.value)}
                                    className="w-full bg-white/10 rounded-full py-2 pr-4 pl-10 text-white placeholder-gray-400"
                                />
                            </div>
                            {isPlaylistSearching && (
                                <div className="flex justify-center items-center mt-4">
                                    <LoaderIcon className="w-6 h-6 animate-spin text-spotify-primary" />
                                </div>
                            )}
                            {playlistSearchResults.length > 0 && (
                                <div className="mt-2 space-y-1 max-h-60 overflow-y-auto no-scrollbar">
                                    {playlistSearchResults
                                        .filter(
                                            (r) =>
                                                !r.type ||
                                                r.type === 'song' ||
                                                r.type === 'video'
                                        )
                                        .map((res) => (
                                            <div
                                                key={res.id}
                                                className="flex items-center gap-3 p-2 hover:bg-white/10 rounded group"
                                            >
                                                <div className="w-10 h-10 bg-neutral-800 rounded flex items-center justify-center text-gray-200 flex-shrink-0">
                                                    <MusicIcon className="w-5 h-5" />
                                                </div>
                                                <div className="min-w-0 flex-1">
                                                    <div className="font-medium truncate text-sm">
                                                        {res.title}
                                                    </div>
                                                    <div className="text-xs text-gray-400 truncate">
                                                        {res.author}
                                                    </div>
                                                </div>
                                                <button
                                                    onClick={(e) =>
                                                        onAddToPlaylistClick(
                                                            e,
                                                            res,
                                                            selectedPlaylist.id
                                                        )
                                                    }
                                                    className="p-2 text-gray-400 hover:text-white"
                                                >
                                                    <PlusIcon />
                                                </button>
                                            </div>
                                        ))}
                                </div>
                            )}
                        </div>
                    )}
            </div>
        </div>
    );
};
