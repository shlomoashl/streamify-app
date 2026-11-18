import React from 'react';
import { Capacitor } from '@capacitor/core';
import { Folder, Playlist } from '../../types';
import {
    ChevronDownIcon,
    ChevronLeftIcon,
    FolderIcon,
    GridIcon,
    ListIcon,
    LogOutIcon,
    TerminalIcon
} from '../Icons';
import { PlaylistRow, PlaylistSquare } from '../PlaylistCards';

export const HomeView: React.FC<{
    folders: Folder[];
    playlists: Playlist[];
    expandedHomeFolders: Set<string>;
    playlistViewMode: 'grid' | 'list';
    playingPlaylistId: string | null;
    isPlaying: boolean;
    updateAvailable: boolean;
    isEncryptionEnabled: boolean;
    onToggleEncryption: () => void;
    onToggleHomeFolder: (folderId: string) => void;
    onToggleViewMode: () => void;
    onSelectPlaylist: (playlist: Playlist) => void;
    onPlaylistPlay: (playlist: Playlist) => void;
    onContextMenu: (e: React.MouseEvent | React.TouchEvent, item: Playlist | Folder) => void;
    onCheckUpdates: () => void;
    onShowLogs: () => void;
    onLogout: () => void;
}> = ({
    folders,
    playlists,
    expandedHomeFolders,
    playlistViewMode,
    playingPlaylistId,
    isPlaying,
    updateAvailable,
    isEncryptionEnabled,
    onToggleEncryption,
    onToggleHomeFolder,
    onToggleViewMode,
    onSelectPlaylist,
    onPlaylistPlay,
    onContextMenu,
    onCheckUpdates,
    onShowLogs,
    onLogout
}) => {
    const playlistInFolderIds = new Set(folders.flatMap((f) => f.playlistIds));
    const topLevelPlaylists = playlists.filter(
        (p) => !p.isLikedSongs && !playlistInFolderIds.has(p.id)
    );
    const showUpdateButton = Capacitor.isNativePlatform() || '__TAURI__' in window;

    return (
        <>
            <div className="sticky top-0 z-10 p-4 pt-[max(2.5rem,env(safe-area-inset-top))] md:pt-4 bg-spotify-elevated/95 backdrop-blur-sm shadow-md">
                <div className="flex justify-between items-center gap-2">
                    <h1 className="text-2xl font-bold">שלום</h1>
                    <div className="flex items-center gap-2 md:gap-3 flex-wrap justify-end">
                        <button
                            onClick={onToggleEncryption}
                            role="switch"
                            aria-checked={isEncryptionEnabled}
                            title={
                                isEncryptionEnabled
                                    ? 'הצפנה מופעלת - לחץ לכיבוי'
                                    : 'הצפנה כבויה - לחץ להפעלה'
                            }
                            className={`flex items-center gap-2 px-3 py-1.5 hover:scale-105 active:scale-95 rounded-full text-sm font-bold transition-all shadow-lg ${
                                isEncryptionEnabled
                                    ? 'bg-spotify-primary text-black'
                                    : 'bg-neutral-700 text-gray-300'
                            }`}
                        >
                            <span>הצפנה</span>
                            <span
                                className={`w-8 h-4 flex items-center rounded-full p-0.5 transition-colors ${
                                    isEncryptionEnabled
                                        ? 'bg-black/30 justify-start'
                                        : 'bg-neutral-900/60 justify-end'
                                }`}
                            >
                                <span
                                    className={`w-3 h-3 rounded-full shadow-sm transition-transform ${
                                        isEncryptionEnabled ? 'bg-black' : 'bg-gray-400'
                                    }`}
                                />
                            </span>
                        </button>

                        {showUpdateButton && (
                            <div className="flex items-center gap-3">
                                <div className="relative">
                                    <button
                                        onClick={onCheckUpdates}
                                        className={`flex items-center gap-2 px-3 py-1.5 hover:scale-105 active:scale-95 rounded-full transition-all font-bold text-sm shadow-lg ${
                                            updateAvailable
                                                ? 'bg-green-500 text-white'
                                                : 'bg-spotify-primary text-black'
                                        }`}
                                        title="בדוק עדכון לאפליקציה"
                                    >
                                        <span>{updateAvailable ? 'עדכון זמין!' : 'עדכון'}</span>
                                        <svg
                                            className="w-4 h-4"
                                            viewBox="0 0 24 24"
                                            fill="none"
                                            stroke="currentColor"
                                            strokeWidth="2.5"
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                        >
                                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                                            <polyline points="7 10 12 15 17 10"></polyline>
                                            <line x1="12" y1="15" x2="12" y2="3"></line>
                                        </svg>
                                    </button>

                                    {updateAvailable && (
                                        <span className="absolute -top-1 -right-1 flex h-3 w-3">
                                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                                            <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500 shadow-md border border-white"></span>
                                        </span>
                                    )}
                                </div>
                            </div>
                        )}

                        <div className="flex gap-2 md:hidden">
                            <button
                                onClick={onShowLogs}
                                className="px-3 py-2 bg-white/10 rounded-full text-white hover:bg-white/20 flex items-center gap-1.5 text-xs font-bold"
                                title="ניהול"
                            >
                                <TerminalIcon className="w-4 h-4" />
                                <span>ניהול</span>
                            </button>
                            <button
                                onClick={onLogout}
                                className="p-3 bg-white/10 rounded-full text-white hover:bg-white/20"
                                title="התנתק"
                            >
                                <LogOutIcon className="w-5 h-5" />
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            <div className="p-4">
                {folders.length > 0 && (
                    <div className="mb-8">
                        <h2 className="text-xl font-bold mb-4 px-2">תיקיות</h2>
                        <div className="flex flex-col gap-2">
                            {folders.map((folder) => {
                                const isExpanded = expandedHomeFolders.has(folder.id);
                                const folderPlaylists = folder.playlistIds
                                    .map((pid) => playlists.find((p) => p.id === pid))
                                    .filter(Boolean) as Playlist[];

                                return (
                                    <div key={folder.id}>
                                        <div
                                            onClick={() => onToggleHomeFolder(folder.id)}
                                            onContextMenu={(e) => onContextMenu(e, folder)}
                                            className="bg-white/5 p-2 rounded-lg flex items-center gap-3 cursor-pointer hover:bg-white/10 transition"
                                        >
                                            <div className="w-10 h-10 bg-neutral-800 rounded flex-shrink-0 flex items-center justify-center text-gray-200">
                                                <FolderIcon className="w-5 h-5" />
                                            </div>
                                            <div className="min-w-0 flex-1">
                                                <div className="font-bold truncate text-sm">
                                                    {folder.name}
                                                </div>
                                            </div>
                                            <div className="text-gray-400">
                                                {isExpanded ? (
                                                    <ChevronDownIcon className="w-5 h-5" />
                                                ) : (
                                                    <ChevronLeftIcon className="w-5 h-5" />
                                                )}
                                            </div>
                                        </div>
                                        {isExpanded && (
                                            <div className="mt-2 pt-2 pl-4 border-t border-white/10">
                                                {playlistViewMode === 'grid' ? (
                                                    <div className="grid grid-cols-3 md:grid-cols-5 gap-3 md:gap-4 select-none">
                                                        {folderPlaylists.map((p) => (
                                                            <PlaylistSquare
                                                                key={p.id}
                                                                playlist={p}
                                                                onSelect={onSelectPlaylist}
                                                                onTogglePlay={onPlaylistPlay}
                                                                isPlaying={
                                                                    playingPlaylistId === p.id &&
                                                                    isPlaying
                                                                }
                                                                onContextMenu={onContextMenu}
                                                            />
                                                        ))}
                                                    </div>
                                                ) : (
                                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                                        {folderPlaylists.map((p) => (
                                                            <PlaylistRow
                                                                key={p.id}
                                                                playlist={p}
                                                                onSelect={onSelectPlaylist}
                                                                onTogglePlay={onPlaylistPlay}
                                                                isPlaying={
                                                                    playingPlaylistId === p.id &&
                                                                    isPlaying
                                                                }
                                                                onContextMenu={onContextMenu}
                                                            />
                                                        ))}
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
                            <button
                                onClick={onToggleViewMode}
                                className="p-2 rounded-full hover:bg-white/10 text-gray-400 hover:text-white"
                            >
                                {playlistViewMode === 'grid' ? (
                                    <ListIcon className="w-5 h-5" />
                                ) : (
                                    <GridIcon className="w-5 h-5" />
                                )}
                            </button>
                        </div>
                        {playlistViewMode === 'grid' ? (
                            <div className="grid grid-cols-3 md:grid-cols-5 gap-3 md:gap-4 select-none">
                                {topLevelPlaylists.map((p) => (
                                    <PlaylistSquare
                                        key={p.id}
                                        playlist={p}
                                        onSelect={onSelectPlaylist}
                                        onTogglePlay={onPlaylistPlay}
                                        isPlaying={playingPlaylistId === p.id && isPlaying}
                                        onContextMenu={onContextMenu}
                                    />
                                ))}
                            </div>
                        ) : (
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                                {topLevelPlaylists.map((p) => (
                                    <PlaylistRow
                                        key={p.id}
                                        playlist={p}
                                        onSelect={onSelectPlaylist}
                                        onTogglePlay={onPlaylistPlay}
                                        isPlaying={playingPlaylistId === p.id && isPlaying}
                                        onContextMenu={onContextMenu}
                                    />
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </>
    );
};
