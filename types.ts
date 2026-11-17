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
    externalId?: string;    // Reference to YouTube/Spotify ID
    externalType?: 'playlist' | 'album' | 'artist' | 'podcast' | 'spotify_playlist';
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
    duration: number | string;
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

export type ViewState = 'home' | 'search' | 'library' | 'playlist' | 'streamify';

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
    contextId?: string;
    startPosition?: number;
}

export interface PlayQueueOptions {
    items: MediaItem[];
    startIndex: number;
    contextId?: string;
    isShuffled?: boolean;
    startPosition?: number;
}

export interface LastPlayedInfo {
    id: string;
    title: string;
    artist: string;
    artwork: string;
    url: string;
    contextId?: string | null;
    isShuffled?: boolean;
    index?: number;
    savedTime?: number;
    isPlaying?: boolean;
    isInitialBoot?: boolean;
    userPaused?: boolean;
    encryptionEnabled?: boolean;
    queue?: MediaItem[];
}

export interface SongDetailedInfo {
    id: string;
    title: string;
    artist: string;
    channelId?: string;
    thumbnail_url?: string;
    publishedAt?: string;
    viewCount?: number;
    likeCount?: number;
    commentCount?: number;
    duration?: number;
    definition?: string;
    audioFormat?: string;
    category?: string;
    tags?: string[];
    credits?: { label: string; value: string }[];
    description?: string;
}

export interface ApkVersionInfo {
    versionCode: number;
    versionName: string;
    nativeSignature: string;
    lastUpdateTime?: number;
}

export interface StreamifyMediaPlugin {
    initialize(): Promise<void>;
    play(options: PlayOptions): Promise<void>;
    playQueue(options: PlayQueueOptions): Promise<void>;
    updateQueue(options: PlayQueueOptions): Promise<void>;
    skipToIndex(options: { index: number }): Promise<void>;
    addToQueue(options: PlayOptions): Promise<void>;
    pause(): Promise<void>;
    resume(): Promise<void>;
    seek(options: { position: number }): Promise<void>;
    setVolume(options: { volume: number }): Promise<void>;
    warmup(options: { url: string }): Promise<void>;
    setEncryptionMode(options: { enabled: boolean }): Promise<{ enabled: boolean }>;
    getEncryptionMode(): Promise<{ enabled: boolean }>;
    getApkInfo(): Promise<ApkVersionInfo>;
    downloadAndInstallApk(options: { url: string; fallbackUrl?: string }): Promise<{ success: boolean }>;
    getDuration(): Promise<{ value: number }>;
    getCurrentTime(): Promise<{ value: number }>;
    getPlaybackState(): Promise<{ isPlaying: boolean; userPaused?: boolean }>;
    getLastPlayedInfo(): Promise<LastPlayedInfo>;
    addListener(eventName: string, listenerFunc: (data: any) => void): Promise<{ remove: () => Promise<void> }>;
    removeAllListeners(): Promise<void>;
}
