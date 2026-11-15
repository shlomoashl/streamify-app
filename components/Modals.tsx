import React from 'react';
import { Folder, Playlist, PlaylistItem, User, YouTubeSearchResult } from '../types';
import {
    AlbumIcon,
    EditIcon,
    FolderIcon,
    LibraryIcon,
    LoaderIcon,
    MusicIcon,
    PlusIcon,
    RefreshCcwIcon,
    ShareIcon,
    TrashIcon,
    UsersIcon,
    XIcon
} from './Icons';

export interface ConfirmModalState {
    isOpen: boolean;
    title: string;
    message?: string;
    onConfirm: () => void;
    isAlertOnly?: boolean;
}

export interface InputModalState {
    isOpen: boolean;
    title: string;
    defaultValue: string;
    onConfirm: (val: string) => void;
}

export interface BulkImportModalState {
    isOpen: boolean;
    item: YouTubeSearchResult | null;
    tracks: PlaylistItem[];
    targetPlaylistId?: string;
    mode: 'select_action' | 'input_name' | 'confirm_simple';
}

export interface ManageUsersModalState {
    isOpen: boolean;
    playlist: Playlist | null;
}

export interface MoveToFolderModalState {
    visible: boolean;
    playlistId: string | null;
}

export interface ContextMenuState {
    x: number;
    y: number;
    item: Playlist | Folder;
}

export const GlobalLoader: React.FC<{
    globalLoading: string | null;
    updateStatusMsg: string;
}> = ({ globalLoading, updateStatusMsg }) => {
    if (!globalLoading) return null;

    if (updateStatusMsg) {
        return (
            <div className="fixed inset-0 bg-black/95 z-[150] flex flex-col items-center justify-center p-4 animate-fade-in">
                <LoaderIcon className="w-12 h-12 text-spotify-primary animate-spin mb-4" />
                <div className="text-white font-bold text-lg animate-pulse">{globalLoading}</div>

                <div className="mt-6 p-4 bg-black/60 rounded-xl text-yellow-400 font-mono text-sm text-center max-w-xs break-words border border-yellow-400/30">
                    {updateStatusMsg}
                </div>
            </div>
        );
    }

    return (
        <div className="fixed bottom-28 left-1/2 -translate-x-1/2 z-[150] flex items-center gap-3 px-5 py-2.5 bg-[#282828] border border-white/10 rounded-full shadow-[0_10px_40px_rgba(0,0,0,0.8)] animate-fade-in pointer-events-none">
            <LoaderIcon className="w-4 h-4 text-spotify-primary animate-spin" />
            <span className="text-white text-sm font-medium truncate max-w-[200px]" dir="rtl">
                {globalLoading}
            </span>
        </div>
    );
};

export const ConfirmationModal: React.FC<{
    modal: ConfirmModalState;
    onClose: () => void;
}> = ({ modal, onClose }) => {
    if (!modal.isOpen) return null;
    return (
        <div
            className="fixed inset-0 bg-black/80 z-[140] flex items-center justify-center p-4 animate-fade-in"
            onClick={() => !modal.isAlertOnly && onClose()}
        >
            <div
                className="bg-spotify-elevated p-6 rounded-xl w-full max-w-sm border border-white/10 text-center"
                onClick={(e) => e.stopPropagation()}
            >
                <h3 className="text-xl font-bold mb-2 text-white">{modal.title}</h3>
                {modal.message && (
                    <p className="text-gray-300 mb-6 text-sm leading-relaxed">{modal.message}</p>
                )}
                <div className="flex gap-3 justify-center">
                    {!modal.isAlertOnly && (
                        <button
                            onClick={onClose}
                            className="px-6 py-2 rounded-full font-bold bg-white/10 hover:bg-white/20 text-white"
                        >
                            ביטול
                        </button>
                    )}
                    <button
                        onClick={modal.onConfirm}
                        className="px-6 py-2 bg-spotify-primary text-black rounded-full font-bold hover:scale-105 shadow-lg"
                    >
                        {modal.isAlertOnly ? 'אישור' : 'כן, אני בטוח'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export const InputModal: React.FC<{
    modal: InputModalState;
    value: string;
    onChange: (val: string) => void;
    onClose: () => void;
}> = ({ modal, value, onChange, onClose }) => {
    if (!modal.isOpen) return null;
    return (
        <div
            className="fixed inset-0 bg-black/80 z-[120] flex items-center justify-center p-4 animate-fade-in"
            onClick={onClose}
        >
            <div
                className="bg-spotify-elevated p-6 rounded-xl w-full max-w-sm border border-white/10"
                onClick={(e) => e.stopPropagation()}
            >
                <h3 className="text-lg font-bold mb-4 text-white text-center">{modal.title}</h3>
                <form
                    onSubmit={(e) => {
                        e.preventDefault();
                        if (value.trim()) {
                            modal.onConfirm(value);
                            onClose();
                        }
                    }}
                >
                    <input
                        autoFocus
                        type="text"
                        value={value}
                        onChange={(e) => onChange(e.target.value)}
                        className="w-full bg-white/10 border border-white/10 rounded-lg p-3 text-white focus:outline-none focus:border-spotify-primary mb-6 text-right"
                    />
                    <div className="flex gap-3 justify-end">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-4 py-2 rounded-full font-bold hover:text-white text-gray-400"
                        >
                            ביטול
                        </button>
                        <button
                            type="submit"
                            className="px-6 py-2 bg-spotify-primary text-black rounded-full font-bold hover:scale-105"
                        >
                            אישור
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export const ManageUsersModal: React.FC<{
    state: ManageUsersModalState;
    onClose: () => void;
    onUnshare: (playlistId: string, email: string) => void;
    onConfirmPrompt: (config: ConfirmModalState) => void;
}> = ({ state, onClose, onUnshare, onConfirmPrompt }) => {
    if (!state.isOpen || !state.playlist) return null;
    return (
        <div
            className="fixed inset-0 bg-black/80 z-[130] flex items-center justify-center p-4 animate-fade-in"
            onClick={onClose}
        >
            <div
                className="bg-spotify-elevated p-6 rounded-xl w-full max-w-sm border border-white/10"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex justify-between items-center mb-4">
                    <button onClick={onClose} className="text-gray-400 hover:text-white">
                        <XIcon className="w-6 h-6" />
                    </button>
                    <h3 className="text-xl font-bold text-white text-center">משתמשים משותפים</h3>
                </div>
                <div className="space-y-2 max-h-60 overflow-y-auto no-scrollbar">
                    {(state.playlist.allowedUsers || []).length === 0 ? (
                        <div className="text-center text-gray-500 py-4">לא שותף עם אף אחד</div>
                    ) : (
                        state.playlist.allowedUsers!.map((email) => (
                            <div
                                key={email}
                                className="flex items-center justify-between p-3 bg-white/5 rounded-lg hover:bg-white/10"
                            >
                                <span className="text-sm truncate mr-2 flex-1 text-right" dir="ltr">
                                    {email}
                                </span>
                                <button
                                    onClick={() => {
                                        onConfirmPrompt({
                                            isOpen: true,
                                            title: 'הסרת משתמש',
                                            message: `האם להסיר את השיתוף עם ${email}?`,
                                            onConfirm: () => {
                                                onConfirmPrompt({
                                                    isOpen: false,
                                                    title: '',
                                                    onConfirm: () => {}
                                                });
                                                onUnshare(state.playlist!.id, email);
                                            }
                                        });
                                    }}
                                    className="text-red-400 hover:text-red-600 p-2 rounded-full hover:bg-white/10"
                                >
                                    <TrashIcon className="w-5 h-5" />
                                </button>
                            </div>
                        ))
                    )}
                </div>
            </div>
        </div>
    );
};

export const BulkImportModal: React.FC<{
    state: BulkImportModalState;
    inputValue: string;
    onInputChange: (val: string) => void;
    onSetState: React.Dispatch<React.SetStateAction<BulkImportModalState>>;
    onClose: () => void;
    onAddSongsToPlaylist: (
        playlistId: string,
        songs: PlaylistItem[],
        playlistOverride?: Playlist
    ) => Promise<void>;
    onCreatePlaylist: (name: string) => Promise<Playlist | null>;
    onSaveExternalPlaylist: (item: YouTubeSearchResult) => Promise<void>;
    onOpenPlaylistSelector: (songs: PlaylistItem[]) => void;
}> = ({
    state,
    inputValue,
    onInputChange,
    onSetState,
    onClose,
    onAddSongsToPlaylist,
    onCreatePlaylist,
    onSaveExternalPlaylist,
    onOpenPlaylistSelector
}) => {
    if (!state.isOpen || !state.item) return null;
    const item = state.item;

    return (
        <div
            className="fixed inset-0 bg-black/80 z-[120] flex items-center justify-center p-4 animate-fade-in"
            onClick={onClose}
        >
            <div
                className="bg-spotify-elevated p-6 rounded-xl w-full max-w-md border border-white/10 text-center"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="mb-6">
                    <div className="w-24 h-24 mx-auto bg-neutral-800 rounded-lg mb-4 flex items-center justify-center">
                        {item.thumbnail || item.thumbnail_url ? (
                            <img
                                src={item.thumbnail || item.thumbnail_url}
                                className="w-full h-full object-cover rounded-lg"
                            />
                        ) : (
                            <AlbumIcon className="w-10 h-10 text-gray-500" />
                        )}
                    </div>
                    <h3 className="text-lg font-bold text-white truncate px-4">{item.title}</h3>
                    <p className="text-gray-400 text-sm mt-1">{state.tracks.length} שירים ייובאו</p>
                </div>

                {state.mode === 'confirm_simple' && (
                    <div>
                        <p className="mb-6 text-gray-300">להוסיף את השירים?</p>
                        <div className="flex gap-3 justify-center">
                            <button
                                onClick={onClose}
                                className="px-6 py-2 rounded-full font-bold bg-white/10"
                            >
                                ביטול
                            </button>
                            <button
                                onClick={() => {
                                    if (state.targetPlaylistId) {
                                        onAddSongsToPlaylist(state.targetPlaylistId, state.tracks);
                                    }
                                    onClose();
                                }}
                                className="px-6 py-2 bg-spotify-primary text-black rounded-full font-bold"
                            >
                                אישור
                            </button>
                        </div>
                    </div>
                )}

                {state.mode === 'select_action' && (
                    <div className="space-y-3">
                        <button
                            onClick={() => {
                                onOpenPlaylistSelector(state.tracks);
                                onClose();
                            }}
                            className="w-full py-3 bg-white/10 hover:bg-white/20 rounded-lg font-bold border border-white/5"
                        >
                            הוסף לפלייליסט קיים
                        </button>
                        <button
                            onClick={() => {
                                onInputChange(item.title);
                                onSetState((prev) => ({ ...prev, mode: 'input_name' }));
                            }}
                            className="w-full py-3 bg-white/10 hover:bg-white/20 text-white rounded-lg font-bold border border-white/5"
                        >
                            צור פלייליסט חדש (ייבוא מלא)
                        </button>
                        <button
                            onClick={() => {
                                onSaveExternalPlaylist(item);
                            }}
                            className="w-full py-3 bg-spotify-primary text-black rounded-lg font-bold shadow-lg hover:scale-105 transition-transform"
                        >
                            שמור לספרייה (קיצור דרך)
                        </button>
                        <button onClick={onClose} className="w-full py-2 text-gray-400 mt-2">
                            ביטול
                        </button>
                    </div>
                )}

                {state.mode === 'input_name' && (
                    <form
                        onSubmit={async (e) => {
                            e.preventDefault();
                            if (!inputValue.trim()) return;
                            const newPlaylist = await onCreatePlaylist(inputValue);
                            if (newPlaylist) {
                                await onAddSongsToPlaylist(newPlaylist.id, state.tracks, newPlaylist);
                            }
                            onClose();
                        }}
                    >
                        <input
                            autoFocus
                            type="text"
                            value={inputValue}
                            onChange={(e) => onInputChange(e.target.value)}
                            className="w-full bg-white/10 border border-white/10 rounded-lg p-3 text-white focus:outline-none focus:border-spotify-primary mb-6 text-right"
                        />
                        <div className="flex gap-3 justify-center">
                            <button
                                type="button"
                                onClick={() =>
                                    onSetState((prev) => ({ ...prev, mode: 'select_action' }))
                                }
                                className="px-6 py-2 rounded-full font-bold bg-white/10"
                            >
                                חזרה
                            </button>
                            <button
                                type="submit"
                                className="px-6 py-2 bg-spotify-primary text-black rounded-full font-bold"
                            >
                                צור והוסף
                            </button>
                        </div>
                    </form>
                )}
            </div>
        </div>
    );
};

export const PlaylistSelectorModal: React.FC<{
    isOpen: boolean;
    playlists: Playlist[];
    songsToAdd: PlaylistItem[];
    onClose: () => void;
    onAddSongsToPlaylist: (
        playlistId: string,
        songs: PlaylistItem[],
        playlistOverride?: Playlist
    ) => Promise<void>;
    onPromptNewPlaylist: () => void;
}> = ({
    isOpen,
    playlists,
    songsToAdd,
    onClose,
    onAddSongsToPlaylist,
    onPromptNewPlaylist
}) => {
    if (!isOpen) return null;
    const availablePlaylists = playlists.filter((p) => !p.isLikedSongs && !p.externalId);
    return (
        <div
            className="fixed inset-0 bg-black/80 z-[60] flex items-center justify-center p-4 animate-fade-in"
            onClick={onClose}
        >
            <div
                className="bg-spotify-elevated p-6 rounded-xl w-full max-w-sm"
                onClick={(e) => e.stopPropagation()}
            >
                <h3 className="text-xl font-bold mb-4 text-center">
                    הוסף {songsToAdd.length} שירים ל...
                </h3>
                <div className="space-y-2 max-h-60 overflow-y-auto no-scrollbar">
                    <div
                        onClick={onPromptNewPlaylist}
                        className="p-3 bg-white/10 rounded flex items-center gap-3 cursor-pointer"
                    >
                        <PlusIcon /> <span>פלייליסט חדש</span>
                    </div>
                    {availablePlaylists.map((p) => (
                        <button
                            key={p.id}
                            onClick={() => onAddSongsToPlaylist(p.id, songsToAdd)}
                            className="w-full text-right p-3 hover:bg-white/10 rounded flex items-center gap-3"
                        >
                            <MusicIcon className="text-gray-500" />
                            <span className="truncate">{p.name}</span>
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
};

export const MoveToFolderModal: React.FC<{
    state: MoveToFolderModalState;
    folders: Folder[];
    onClose: () => void;
    onMove: (playlistId: string, targetFolderId: string | null) => void;
}> = ({ state, folders, onClose, onMove }) => {
    if (!state.visible) return null;
    return (
        <div
            className="fixed inset-0 bg-black/80 z-[110] flex items-center justify-center p-4"
            onClick={onClose}
        >
            <div
                className="bg-spotify-elevated p-6 rounded-xl w-full max-w-sm"
                onClick={(e) => e.stopPropagation()}
            >
                <h3 className="text-xl font-bold mb-4 text-center">העבר לתיקייה</h3>
                <div className="space-y-2 max-h-60 overflow-y-auto no-scrollbar">
                    <button
                        onClick={() => onMove(state.playlistId!, null)}
                        className="w-full text-right p-3 hover:bg-white/10 rounded flex items-center gap-3"
                    >
                        <LibraryIcon className="w-5 h-5" /> <span>הסר מתיקייה</span>
                    </button>
                    {folders.map((f) => (
                        <button
                            key={f.id}
                            onClick={() => onMove(state.playlistId!, f.id)}
                            className="w-full text-right p-3 hover:bg-white/10 rounded flex items-center gap-3"
                        >
                            <FolderIcon className="w-5 h-5" />
                            <span className="truncate">{f.name}</span>
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
};

export const ContextMenuPopup: React.FC<{
    contextMenu: ContextMenuState | null;
    currentUser: User | null;
    onClose: () => void;
    onRenamePrompt: (item: Playlist | Folder, type: 'playlist' | 'folder') => void;
    onSharePrompt: (playlist: Playlist) => void;
    onManageUsers: (playlist: Playlist) => void;
    onDelete: (item: Playlist | Folder, isFolder: boolean) => void;
    onRepairPlaylist: (playlist: Playlist) => void;
    onMoveToFolder: (playlistId: string) => void;
}> = ({
    contextMenu,
    currentUser,
    onClose,
    onRenamePrompt,
    onSharePrompt,
    onManageUsers,
    onDelete,
    onRepairPlaylist,
    onMoveToFolder
}) => {
    if (!contextMenu) return null;
    const { x, y, item } = contextMenu;
    const isFolder = 'playlistIds' in item;
    const isExternal = !isFolder && !!(item as Playlist).externalId;

    return (
        <div
            style={{ top: y, left: x }}
            className="fixed bg-spotify-elevated rounded-lg shadow-2xl p-2 z-[100] text-sm flex flex-col items-start gap-1 w-48"
            onClick={(e) => e.stopPropagation()}
        >
            {isFolder && (
                <button
                    className="w-full text-right p-2 hover:bg-white/10 rounded flex items-center gap-2"
                    onClick={() => {
                        onRenamePrompt(item, 'folder');
                        onClose();
                    }}
                >
                    <EditIcon className="w-4 h-4" /> <span>שנה שם</span>
                </button>
            )}

            {!isFolder && (item as Playlist).creator === currentUser?.email && (
                <>
                    <button
                        className="w-full text-right p-2 hover:bg-white/10 rounded flex items-center gap-2"
                        onClick={() => {
                            onRenamePrompt(item, 'playlist');
                            onClose();
                        }}
                    >
                        <EditIcon className="w-4 h-4" /> <span>שנה שם</span>
                    </button>
                    {!isExternal && (
                        <button
                            className="w-full text-right p-2 hover:bg-white/10 rounded flex items-center gap-2"
                            onClick={() => {
                                onSharePrompt(item as Playlist);
                                onClose();
                            }}
                        >
                            <ShareIcon className="w-4 h-4" /> <span>שתף פלייליסט</span>
                        </button>
                    )}
                    {!isExternal &&
                        (item as Playlist).allowedUsers &&
                        (item as Playlist).allowedUsers!.length > 0 && (
                            <button
                                className="w-full text-right p-2 hover:bg-white/10 rounded flex items-center gap-2"
                                onClick={() => {
                                    onManageUsers(item as Playlist);
                                    onClose();
                                }}
                            >
                                <UsersIcon className="w-4 h-4" /> <span>נהל משתמשים</span>
                            </button>
                        )}
                </>
            )}

            <button
                className="w-full text-right p-2 hover:bg-white/10 rounded flex items-center gap-2"
                onClick={() => {
                    onDelete(item, isFolder);
                    onClose();
                }}
            >
                <TrashIcon className="w-4 h-4" /> <span>מחק</span>
            </button>

            {!isFolder && !isExternal && (item as Playlist).creator === currentUser?.email && (
                <button
                    className="w-full text-right p-2 hover:bg-white/10 rounded flex items-center gap-2 text-yellow-400"
                    onClick={() => {
                        onRepairPlaylist(item as Playlist);
                        onClose();
                    }}
                >
                    <RefreshCcwIcon className="w-4 h-4" />
                    <span>סרוק ותקן קישורי שירים</span>
                </button>
            )}

            {!isFolder && (
                <button
                    className="w-full text-right p-2 hover:bg-white/10 rounded flex items-center gap-2"
                    onClick={() => {
                        onMoveToFolder(item.id);
                        onClose();
                    }}
                >
                    <FolderIcon className="w-4 h-4" /> <span>העבר לתיקייה</span>
                </button>
            )}
        </div>
    );
};
