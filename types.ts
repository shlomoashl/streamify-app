
export interface User {
    email: string;
    permissions?: string[];
    playlistPermission?: 'view' | 'edit';
}

export interface PlaylistItem {
    id: string;
    title: string;
    author: string; // Sometimes mapped from 'channel' in search results
    duration: number; // JSON has numbers (seconds)
    thumbnail: string;
    addedBy: string;
    addedAt: string;
}

export interface Playlist {
    id: string;
    name: string;
    creator: string;
    createdAt?: string;
    isPublic: boolean;
    songs: PlaylistItem[];
    collaborators?: string[];
    allowedUsers?: string[];
    isLikedSongs?: boolean; // For the special "Liked Songs" playlist
    externalId?: string;    // New: Reference to YouTube/Spotify ID
    externalType?: 'playlist' | 'album' | 'artist' | 'podcast' | 'spotify_playlist'; // New: Type of external content
}

export interface Folder {
    id: string;
    name: string;
    creator: string;
    playlistIds: string[];
}

export interface LibraryData {
    playlists: Playlist[];
    folders: Folder[];
}

export interface YouTubeSearchResult {
    id: string;
    title: string;
    author?: string;
    channel?: string;
    duration: number | string; // Search API might return string
    thumbnail?: string;
    thumbnail_url?: string;
    type?: 'song' | 'playlist' | 'artist' | 'album' | 'podcast' | 'spotify_playlist' | 'video';
    itemCount?: number | string;
}

export interface YouTubeDownloadResponse {
    success: boolean;
    results?: YouTubeSearchResult[];
    playlistTitle?: string;
    isPlaylistUrlResult?: boolean;
    error?: string;
    sessionId?: string;
    hasMore?: boolean;
    key_index?: number;
}

export interface PlayerState {
    isOpen: boolean;
    isPlaying: boolean;
    currentSong: PlaylistItem | null;
    queue: PlaylistItem[];
    currentIndex: number;
    isShuffled: boolean;
    isExpanded: boolean; // For mobile full screen player
    originalQueue?: PlaylistItem[]; // To restore order when shuffle is off
}

export type ViewState = 'home' | 'search' | 'library' | 'playlist';

// --- Native Plugin Interfaces ---

export interface MediaItem {
    url: string;
    title: string;
    artist: string;
    artwork: string;
    duration: number; // in seconds
    id: string;
}

export interface PlayOptions {
    url: string;
    title?: string;
    artist?: string;
    artwork?: string;
    duration?: number;
    id?: string;
    autoPlay?: boolean;
}

export interface PlayQueueOptions {
    items: MediaItem[];
    startIndex: number;
}

export interface LastPlayedInfo {
    id: string;
    title: string;
    artist: string;
    artwork: string;
    url: string;
    position: number; // seconds (optional if saved)
}

export interface StreamifyMediaPlugin {
    initialize(): Promise<void>;
    play(options: PlayOptions): Promise<void>;
    playQueue(options: PlayQueueOptions): Promise<void>;
    addToQueue(options: PlayOptions): Promise<void>;
    pause(): Promise<void>;
    resume(): Promise<void>;
    seek(options: { position: number }): Promise<void>;
    setVolume(options: { volume: number }): Promise<void>;
    getDuration(): Promise<{ value: number }>;
    getCurrentTime(): Promise<{ value: number }>;
    getPlaybackState(): Promise<{ isPlaying: boolean }>;
    getLastPlayedInfo(): Promise<LastPlayedInfo>; // New method
    addListener(eventName: string, listenerFunc: (data: any) => void): Promise<{ remove: () => Promise<void> }>;
    removeAllListeners(): Promise<void>;
}
