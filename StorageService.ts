
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Capacitor } from '@capacitor/core';

export class StorageService {
    private isNative: boolean;

    constructor() {
        this.isNative = Capacitor.isNativePlatform();
    }

    private getKeyPath(key: string): string {
        // ממפה מפתחות לקבצים פיזיים
        const mapping: Record<string, string> = {
            'streamify_cache_playlists': 'playlists.json',
            'streamify_cache_folders': 'folders.json',
            'streamify_cache_liked': 'liked_songs.json',
            'streamify_user_email': 'user.json',
            'streamify_player_state': 'player_state.json',
            'streamify_last_playlist': 'last_playlist.json',
            'streamify_playlist_view_mode': 'settings_view.json',
            'streamify_search_history': 'search_history.json'
        };
        return mapping[key] || `${key}.json`;
    }

    async saveData(key: string, data: any): Promise<void> {
        if (!this.isNative) {
            // WEB Fallback
            try {
                const stringData = typeof data === 'string' ? data : JSON.stringify(data);
                localStorage.setItem(key, stringData);
            } catch (e) {
                console.error("LocalStorage save failed (quota exceeded?)", e);
            }
            return;
        }

        // NATIVE (Android/iOS)
        try {
            const fileName = this.getKeyPath(key);
            const stringData = typeof data === 'string' ? data : JSON.stringify(data);
            
            await Filesystem.writeFile({
                path: fileName,
                data: stringData,
                directory: Directory.Data, // /data/user/0/com.streamify.app/files/
                encoding: Encoding.UTF8
            });
        } catch (e) {
            console.error(`[Storage] Failed to save ${key}:`, e);
        }
    }

    async loadData<T>(key: string, defaultValue: T): Promise<T> {
        if (!this.isNative) {
            // WEB Fallback
            const saved = localStorage.getItem(key);
            if (!saved) return defaultValue;
            try {
                // בדיקה אם זה מחרוזת פשוטה או JSON
                if (typeof defaultValue === 'string') return saved as unknown as T;
                return JSON.parse(saved);
            } catch {
                return defaultValue;
            }
        }

        // NATIVE
        try {
            const fileName = this.getKeyPath(key);
            
            // Check if file exists by trying to read it
            // (stat() might throw if not found, easier to try read)
            const result = await Filesystem.readFile({
                path: fileName,
                directory: Directory.Data,
                encoding: Encoding.UTF8
            });

            if (!result.data) return defaultValue;

            if (typeof defaultValue === 'string') {
                return result.data as unknown as T;
            }
            
            return JSON.parse(result.data as string);
        } catch (e) {
            // File doesn't exist yet, try to migrate from localStorage if it exists there (First run after update)
            const legacy = localStorage.getItem(key);
            if (legacy) {
                console.log(`[Storage] Migrating ${key} from LocalStorage to FileSystem`);
                await this.saveData(key, legacy); // Save to FS
                // Optional: localStorage.removeItem(key); 
                try {
                    return typeof defaultValue === 'string' ? legacy as unknown as T : JSON.parse(legacy);
                } catch { return defaultValue; }
            }
            return defaultValue;
        }
    }

    async removeData(key: string): Promise<void> {
        if (!this.isNative) {
            localStorage.removeItem(key);
            return;
        }

        try {
            const fileName = this.getKeyPath(key);
            await Filesystem.deleteFile({
                path: fileName,
                directory: Directory.Data
            });
        } catch (e) {
            // Ignore error if file doesn't exist
        }
    }
    
    async clearAll(): Promise<void> {
        if(!this.isNative) {
            localStorage.clear();
            return;
        }
        // Native: we'd need to list files and delete them, or just rely on specific removeData calls
        // For safety, we map specific keys we know
        const keys = [
            'streamify_cache_playlists', 'streamify_cache_folders', 
            'streamify_cache_liked', 'streamify_user_email', 
            'streamify_player_state', 'streamify_last_playlist',
            'streamify_playlist_view_mode', 'streamify_search_history'
        ];
        for(const k of keys) await this.removeData(k);
    }
}

export const storageService = new StorageService();