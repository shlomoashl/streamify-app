import React from 'react';
import { Folder, Playlist, ViewState } from '../types';
import {
    ChevronDownIcon,
    ChevronLeftIcon,
    FolderIcon,
    FolderPlusIcon,
    HeartIcon,
    HomeIcon,
    LibraryIcon,
    LogOutIcon,
    MusicIcon,
    PlusIcon,
    RefreshCcwIcon,
    SearchIcon
} from './Icons';

export const LoginScreen: React.FC<{
    emailInput: string;
    entryCodeInput: string;
    onEmailChange: (val: string) => void;
    onEntryCodeChange: (val: string) => void;
    onSubmit: (e: React.FormEvent) => void;
}> = ({ emailInput, entryCodeInput, onEmailChange, onEntryCodeChange, onSubmit }) => {
    return (
        <div className="h-screen w-full flex items-center justify-center bg-black p-4 text-white">
            <div className="w-full max-w-md bg-spotify-elevated p-8 rounded-xl text-center shadow-2xl border border-white/5">
                <MusicIcon className="w-16 h-16 mx-auto mb-4 text-spotify-primary" />
                <h1 className="text-2xl font-bold mb-6">ברוכים הבאים ל-Streamify</h1>
                <form onSubmit={onSubmit} className="space-y-4">
                    <input
                        type="email"
                        placeholder="אימייל"
                        value={emailInput}
                        onChange={(e) => onEmailChange(e.target.value)}
                        className="w-full p-3 rounded bg-white/10 text-white border border-transparent focus:border-spotify-primary focus:outline-none transition-all text-right"
                        required
                    />
                    <input
                        type="password"
                        placeholder="קוד כניסה סודי"
                        value={entryCodeInput}
                        onChange={(e) => onEntryCodeChange(e.target.value)}
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
};

export const DesktopSidebar: React.FC<{
    activeTab: ViewState;
    likedSongsPlaylist: Playlist | null;
    selectedPlaylist: Playlist | null;
    folders: Folder[];
    playlists: Playlist[];
    expandedFolders: Set<string>;
    isEncryptionEnabled: boolean;
    onToggleEncryption: () => void;
    onSelectTab: (tab: ViewState) => void;
    onSelectPlaylist: (playlist: Playlist) => void;
    onToggleFolder: (folderId: string) => void;
    onContextMenu: (e: React.MouseEvent | React.TouchEvent, item: Playlist | Folder) => void;
    onPromptNewFolder: () => void;
    onPromptNewPlaylist: () => void;
    onPromptRestartServer: () => void;
    onLogout: () => void;
}> = ({
    activeTab,
    likedSongsPlaylist,
    selectedPlaylist,
    folders,
    playlists,
    expandedFolders,
    isEncryptionEnabled,
    onToggleEncryption,
    onSelectTab,
    onSelectPlaylist,
    onToggleFolder,
    onContextMenu,
    onPromptNewFolder,
    onPromptNewPlaylist,
    onPromptRestartServer,
    onLogout
}) => {
    return (
        <nav className="hidden md:flex flex-col w-64 bg-black px-4 pt-4 pb-2 h-full">
            <div className="space-y-1 mt-4">
                <button
                    onClick={() => onSelectTab('home')}
                    className={`flex items-center gap-4 py-2 px-4 rounded-lg transition-colors w-full text-right ${
                        activeTab === 'home'
                            ? 'bg-white/20 text-white'
                            : 'text-gray-400 hover:bg-white/10 hover:text-white'
                    }`}
                >
                    <HomeIcon /> <span className="font-medium text-lg">בית</span>
                </button>
                <button
                    onClick={() => onSelectTab('streamify')}
                    className={`flex items-center gap-4 py-2 px-4 rounded-lg transition-colors w-full text-right ${
                        activeTab === 'streamify'
                            ? 'bg-white/20 text-white'
                            : 'text-gray-400 hover:bg-white/10 hover:text-white'
                    }`}
                >
                    <MusicIcon className="w-6 h-6" />{' '}
                    <span className="font-medium text-lg">Streamify</span>
                </button>
                <button
                    onClick={() => onSelectTab('search')}
                    className={`flex items-center gap-4 py-2 px-4 rounded-lg transition-colors w-full text-right ${
                        activeTab === 'search'
                            ? 'bg-white/20 text-white'
                            : 'text-gray-400 hover:bg-white/10 hover:text-white'
                    }`}
                >
                    <SearchIcon /> <span className="font-medium text-lg">חיפוש</span>
                </button>
                {likedSongsPlaylist && (
                    <button
                        onClick={() => onSelectPlaylist(likedSongsPlaylist)}
                        className={`flex items-center gap-4 py-2 px-4 rounded-lg transition-colors w-full text-right ${
                            activeTab === 'playlist' &&
                            selectedPlaylist?.id === likedSongsPlaylist.id
                                ? 'bg-white/20 text-white'
                                : 'text-gray-400 hover:bg-white/10 hover:text-white'
                        }`}
                    >
                        <HeartIcon filled className="text-spotify-primary" />{' '}
                        <span className="font-medium text-lg">שירים שאהבתם</span>
                    </button>
                )}
            </div>

            <div className="border-t border-white/20 mt-2 pt-2 flex-1 min-h-0 overflow-y-auto no-scrollbar">
                <div className="flex justify-start items-center text-sm font-bold text-gray-400 mb-2 px-1">
                    <div className="flex flex-col gap-1 w-full">
                        <button
                            onClick={onPromptNewFolder}
                            className="flex items-center gap-3 w-full text-left p-2 rounded text-gray-400 hover:text-white hover:bg-white/10"
                        >
                            <FolderPlusIcon className="w-5 h-5" />{' '}
                            <span className="font-semibold text-sm">תיקייה חדשה</span>
                        </button>
                        <button
                            onClick={onPromptNewPlaylist}
                            className="flex items-center gap-3 w-full text-left p-2 rounded text-gray-400 hover:text-white hover:bg-white/10"
                        >
                            <PlusIcon className="w-5 h-5" />{' '}
                            <span className="font-semibold text-sm">פלייליסט חדש</span>
                        </button>
                    </div>
                </div>
                <div className="border-t border-white/20 my-2"></div>
                <div className="space-y-1">
                    {folders.map((folder) => (
                        <div key={folder.id}>
                            <div
                                onClick={() => onToggleFolder(folder.id)}
                                onContextMenu={(e) => onContextMenu(e, folder)}
                                className="flex items-center gap-3 py-2 px-3 rounded-lg cursor-pointer text-gray-400 hover:text-white hover:bg-white/10"
                            >
                                <FolderIcon className="w-5 h-5" />
                                <span className="truncate flex-1">{folder.name}</span>
                                {expandedFolders.has(folder.id) ? (
                                    <ChevronDownIcon className="w-4 h-4" />
                                ) : (
                                    <ChevronLeftIcon className="w-4 h-4" />
                                )}
                            </div>
                            {expandedFolders.has(folder.id) && (
                                <div className="pr-4 border-r-2 border-spotify-elevated my-2 space-y-px">
                                    {folder.playlistIds.map((pid) => {
                                        const playlist = playlists.find((p) => p.id === pid);
                                        if (!playlist) return null;
                                        return (
                                            <div
                                                key={pid}
                                                onClick={() => onSelectPlaylist(playlist)}
                                                onContextMenu={(e) => onContextMenu(e, playlist)}
                                                className={`py-2 px-2 rounded-lg cursor-pointer truncate text-base ${
                                                    selectedPlaylist?.id === pid
                                                        ? 'bg-white/20 text-white'
                                                        : 'text-gray-400 hover:bg-white/10 hover:text-white'
                                                }`}
                                            >
                                                {playlist.name}
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            </div>

            <div className="flex flex-col mt-2 space-y-1 border-t border-white/10 pt-2">
                <button
                    onClick={onToggleEncryption}
                    role="switch"
                    aria-checked={isEncryptionEnabled}
                    className={`p-3 text-sm flex items-center justify-between rounded-lg transition-colors ${
                        isEncryptionEnabled
                            ? 'text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/20'
                            : 'text-gray-400 hover:text-white hover:bg-white/10'
                    }`}
                    title={
                        isEncryptionEnabled
                            ? 'מצב הצפנה מופעל - לחץ לכיבוי'
                            : 'מצב הצפנה כבוי - לחץ להפעלה'
                    }
                >
                    <div className="flex items-center gap-3">
                        <svg
                            className="w-5 h-5 flex-shrink-0"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                        >
                            {isEncryptionEnabled ? (
                                <>
                                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                                </>
                            ) : (
                                <>
                                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                                    <path d="M7 11V7a5 5 0 0 1 9.9-1" />
                                </>
                            )}
                        </svg>
                        <span>מצב הצפנה: {isEncryptionEnabled ? 'מופעל' : 'כבוי'}</span>
                    </div>
                    <span
                        className={`w-8 h-4 flex items-center rounded-full p-0.5 transition-colors ${
                            isEncryptionEnabled ? 'bg-emerald-500 justify-start' : 'bg-gray-600 justify-end'
                        }`}
                    >
                        <span className="bg-white w-3 h-3 rounded-full shadow-sm" />
                    </span>
                </button>
                <button
                    onClick={onPromptRestartServer}
                    className="p-3 text-sm text-gray-500 hover:text-white flex items-center gap-3 hover:bg-white/10 rounded-lg transition-colors"
                >
                    <RefreshCcwIcon className="w-5 h-5" /> <span>אתחול שרת</span>
                </button>
                <button
                    onClick={onLogout}
                    className="p-3 text-sm text-gray-500 hover:text-white flex items-center gap-3 hover:bg-white/10 rounded-lg transition-colors"
                >
                    <LogOutIcon className="w-5 h-5" /> <span>התנתק</span>
                </button>
            </div>
        </nav>
    );
};

export const MobileBottomNav: React.FC<{
    activeTab: ViewState;
    onSelectTab: (tab: ViewState) => void;
}> = ({ activeTab, onSelectTab }) => {
    return (
        <div className="md:hidden w-full flex-shrink-0 bg-neutral-900 border-t border-white/10 flex justify-around p-2 z-50 text-[10px]">
            <button
                onClick={() => onSelectTab('home')}
                className={`flex flex-col items-center p-2 ${
                    activeTab === 'home' ? 'text-white' : 'text-gray-500'
                }`}
            >
                <HomeIcon className="mb-1" /> בית
            </button>
            <button
                onClick={() => onSelectTab('streamify')}
                className={`flex flex-col items-center p-2 ${
                    activeTab === 'streamify' ? 'text-white' : 'text-gray-500'
                }`}
            >
                <MusicIcon className="mb-1" /> Streamify
            </button>
            <button
                onClick={() => onSelectTab('search')}
                className={`flex flex-col items-center p-2 ${
                    activeTab === 'search' ? 'text-white' : 'text-gray-500'
                }`}
            >
                <SearchIcon className="mb-1" /> חיפוש
            </button>
            <button
                onClick={() => onSelectTab('library')}
                className={`flex flex-col items-center p-2 ${
                    activeTab === 'library' ? 'text-white' : 'text-gray-500'
                }`}
            >
                <LibraryIcon className="mb-1" /> ספרייה
            </button>
        </div>
    );
};
