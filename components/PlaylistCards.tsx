import React, { useRef } from 'react';
import { Playlist } from '../types';
import {
    ArtistIcon,
    AlbumIcon,
    PodcastIcon,
    PlaylistIcon,
    PauseIcon,
    PlayIcon
} from './Icons';

export interface PlaylistComponentProps {
    playlist: Playlist;
    onSelect: (playlist: Playlist) => void;
    onTogglePlay: (playlist: Playlist) => void;
    isPlaying: boolean;
    onContextMenu: (e: React.MouseEvent | React.TouchEvent, playlist: Playlist) => void;
}

export const PlaylistSquare: React.FC<PlaylistComponentProps> = React.memo(({
    playlist,
    onSelect,
    onTogglePlay,
    isPlaying,
    onContextMenu
}) => {
    const longPressTimer = useRef<any>(null);
    const isLongPress = useRef(false);

    const handleTouchStart = () => {
        isLongPress.current = false;
        longPressTimer.current = setTimeout(() => {
            isLongPress.current = true;
        }, 500);
    };

    const handleTouchEnd = () => clearTimeout(longPressTimer.current);

    return (
        <div
            onClick={() => {
                if (!isLongPress.current) onSelect(playlist);
            }}
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
                    {playlist.externalType === 'artist' ? (
                        <ArtistIcon className="w-10 h-10" />
                    ) : playlist.externalType === 'album' ? (
                        <AlbumIcon className="w-10 h-10" />
                    ) : playlist.externalType === 'podcast' ? (
                        <PodcastIcon className="w-10 h-10" />
                    ) : (
                        <PlaylistIcon className="w-10 h-10" />
                    )}
                </div>
            </div>
            <div className="flex items-center justify-between gap-2">
                <div className="font-bold truncate text-sm pointer-events-none flex-1">
                    {playlist.name}
                    {playlist.externalId && (
                        <span className="text-[10px] text-green-500 block">חיצוני</span>
                    )}
                </div>
                {(playlist.songs.length > 0 || playlist.externalId) && (
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            onTogglePlay(playlist);
                        }}
                        className="p-2 rounded-full shadow-lg transition-transform duration-200 ease-in-out hover:scale-110 flex-shrink-0 bg-spotify-primary text-black"
                    >
                        {isPlaying ? (
                            <PauseIcon className="w-4 h-4" fill />
                        ) : (
                            <PlayIcon className="w-4 h-4" fill />
                        )}
                    </button>
                )}
            </div>
        </div>
    );
});

export const PlaylistRow: React.FC<PlaylistComponentProps> = React.memo(({
    playlist,
    onSelect,
    onTogglePlay,
    isPlaying,
    onContextMenu
}) => {
    const longPressTimer = useRef<any>(null);
    const isLongPress = useRef(false);

    const handleTouchStart = () => {
        isLongPress.current = false;
        longPressTimer.current = setTimeout(() => {
            isLongPress.current = true;
        }, 500);
    };

    const handleTouchEnd = () => clearTimeout(longPressTimer.current);

    return (
        <div
            onClick={() => {
                if (!isLongPress.current) onSelect(playlist);
            }}
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
                {playlist.externalType === 'artist' ? (
                    <ArtistIcon className="w-5 h-5" />
                ) : playlist.externalType === 'album' ? (
                    <AlbumIcon className="w-5 h-5" />
                ) : playlist.externalType === 'podcast' ? (
                    <PodcastIcon className="w-5 h-5" />
                ) : (
                    <PlaylistIcon className="w-5 h-5" />
                )}
            </div>
            <div className="min-w-0 flex-1">
                <div className="font-bold truncate text-sm pointer-events-none">{playlist.name}</div>
                {playlist.externalId && (
                    <div className="text-[10px] text-green-500">נשמר מהרשת</div>
                )}
            </div>
            {(playlist.songs.length > 0 || playlist.externalId) && (
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        onTogglePlay(playlist);
                    }}
                    className="p-2 rounded-full shadow-lg transition-transform duration-200 ease-in-out hover:scale-110 mr-2 bg-spotify-primary text-black"
                >
                    {isPlaying ? (
                        <PauseIcon className="w-5 h-5" fill />
                    ) : (
                        <PlayIcon className="w-5 h-5" fill />
                    )}
                </button>
            )}
        </div>
    );
});
