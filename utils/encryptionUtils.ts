import { storageService } from '../StorageService';
import { YouTubeSearchResult } from '../types';

export const ENCRYPTION_STORAGE_KEY = 'streamify_encryption_enabled';
const ENCRYPTION_KEY_STR = 'efitoyb';
const ENCRYPTION_KEY_BYTES = new TextEncoder().encode(ENCRYPTION_KEY_STR);
const IMAGE_XOR_KEY = 0x77;

// זיכרון מטמון לתמונות מפוענחות (Blob URLs) כדי לא להוריד ולפענח פעמיים
const decryptedImageCache = new Map<string, string>();
const pendingImageLoads = new Map<string, Promise<string>>();

/**
 * קריאה סינכרונית מהירה של מצב ההצפנה (ברירת מחדל: true - מוצפן)
 */
export const getInitialEncryptionEnabled = (): boolean => {
    try {
        const raw = localStorage.getItem(ENCRYPTION_STORAGE_KEY);
        if (raw === null) return true;
        if (raw === 'false' || raw === '0') return false;
        if (raw === 'true' || raw === '1') return true;
        return Boolean(JSON.parse(raw));
    } catch {
        return true;
    }
};

/**
 * שמירה סינכרונית ואסינכרונית של מצב ההצפנה
 */
export const persistEncryptionEnabled = async (enabled: boolean): Promise<void> => {
    try {
        localStorage.setItem(ENCRYPTION_STORAGE_KEY, JSON.stringify(enabled));
    } catch (e) {
        console.warn('[Encryption] Failed to save to localStorage:', e);
    }
    try {
        await storageService.saveData(ENCRYPTION_STORAGE_KEY, enabled);
    } catch (e) {
        console.warn('[Encryption] Failed to save to storageService:', e);
    }
};

/**
 * הצפנת טקסט ב-XOR מול המפתח "efitoyb" וקידוד ל-Base64 (תואם ל-encrypt_text בפייתון)
 */
export const encryptText = (text: string): string => {
    if (!text || typeof text !== 'string') return text;
    try {
        const textBytes = new TextEncoder().encode(text);
        const xored = new Uint8Array(textBytes.length);
        for (let i = 0; i < textBytes.length; i++) {
            xored[i] = textBytes[i] ^ ENCRYPTION_KEY_BYTES[i % ENCRYPTION_KEY_BYTES.length];
        }
        let binary = '';
        for (let i = 0; i < xored.length; i++) {
            binary += String.fromCharCode(xored[i]);
        }
        return btoa(binary);
    } catch {
        return text;
    }
};

/**
 * פענוח טקסט מ-Base64 ו-XOR מול המפתח "efitoyb" (תואם ל-decrypt_text בפייתון)
 */
export const decryptText = (b64Text: string): string => {
    if (!b64Text || typeof b64Text !== 'string') return b64Text;
    try {
        const binary = atob(b64Text);
        const xored = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            xored[i] = binary.charCodeAt(i) ^ ENCRYPTION_KEY_BYTES[i % ENCRYPTION_KEY_BYTES.length];
        }
        return new TextDecoder('utf-8', { fatal: true }).decode(xored);
    } catch {
        return b64Text;
    }
};

/**
 * פענוח פריט תוצאת חיפוש/פלייליסט שחזר מוצפן מהשרת
 */
export const decryptSearchResultItem = (item: YouTubeSearchResult): YouTubeSearchResult => {
    if (!item) return item;
    return {
        ...item,
        title: item.title ? decryptText(item.title) : item.title,
        author: item.author ? decryptText(item.author) : item.author,
        channel: item.channel ? decryptText(item.channel) : item.channel,
        thumbnail: item.thumbnail ? decryptText(item.thumbnail) : item.thumbnail,
        thumbnail_url: item.thumbnail_url ? decryptText(item.thumbnail_url) : item.thumbnail_url
    };
};

/**
 * פענוח תשובת JSON מלאה מהשרת אם השרת סימן שהיא מוצפנת (או אם נשלחה במצב מוצפן)
 */
export const decryptServerResponseIfNeeded = (data: any, wasRequestedEncrypted: boolean): any => {
    if (!data || typeof data !== 'object') return data;
    const isEncrypted = data.encrypted === true || (wasRequestedEncrypted && data.encrypted !== false);
    if (!isEncrypted) return data;

    const cloned = { ...data };
    if (typeof cloned.playlistTitle === 'string') {
        cloned.playlistTitle = decryptText(cloned.playlistTitle);
    }
    if (typeof cloned.title === 'string') {
        cloned.title = decryptText(cloned.title);
    }
    if (typeof cloned.author === 'string') {
        cloned.author = decryptText(cloned.author);
    }
    if (Array.isArray(cloned.results)) {
        cloned.results = cloned.results.map((item: YouTubeSearchResult) =>
            decryptSearchResultItem(item)
        );
    }
    return cloned;
};

/**
 * קריאת חיפוש לשרת לפי המסלול הפעיל (מוצפן / ללא הצפנה)
 */
export const fetchYouTubeSearchApi = async (
    apiBaseUrl: string,
    term: string,
    searchEngine: string,
    encryptionEnabled: boolean,
    signal?: AbortSignal
): Promise<any> => {
    const cleanBase = apiBaseUrl.replace(/\/$/, '');
    const outgoingQuery = encryptionEnabled ? encryptText(term) : term;
    const queryParams = new URLSearchParams({
        action: 'search_and_download_video',
        query: outgoingQuery,
        search_engine: searchEngine,
        use_underscore: encryptionEnabled ? 'true' : 'false',
        enc: encryptionEnabled ? '1' : '0'
    });

    const res = await fetch(`${cleanBase}?${queryParams.toString()}`, { signal });
    const data = await res.json();
    return encryptionEnabled ? decryptServerResponseIfNeeded(data, true) : data;
};

/**
 * קריאת השלמה אוטומטית (Suggestions) לפי המסלול הפעיל (מוצפן / ללא הצפנה)
 */
export const fetchYouTubeSuggestionsApi = async (
    apiBaseUrl: string,
    query: string,
    encryptionEnabled: boolean
): Promise<string[]> => {
    const cleanBase = apiBaseUrl.replace(/\/$/, '');
    const outgoingQuery = encryptionEnabled ? encryptText(query) : query;
    const params = new URLSearchParams({
        q: outgoingQuery,
        use_underscore: encryptionEnabled ? 'true' : 'false',
        enc: encryptionEnabled ? '1' : '0'
    });

    const res = await fetch(`${cleanBase}/suggestions?${params.toString()}`);
    const data = await res.json();
    if (!Array.isArray(data)) return [];
    return encryptionEnabled ? data.map((item: string) => decryptText(String(item))) : data;
};

/**
 * קריאת תוכן אלבום/פלייליסט/אמן/פודקאסט לפי המסלול הפעיל (מוצפן / ללא הצפנה)
 */
export const fetchYouTubeBrowseApi = async (
    apiBaseUrl: string,
    browseId: string,
    browseType: string,
    encryptionEnabled: boolean
): Promise<any> => {
    const cleanBase = apiBaseUrl.replace(/\/$/, '');
    const params = new URLSearchParams({
        type: browseType,
        use_underscore: encryptionEnabled ? 'true' : 'false',
        enc: encryptionEnabled ? '1' : '0'
    });

    const res = await fetch(`${cleanBase}/ytmusic-browse/${browseId}?${params.toString()}`);
    const data = await res.json();
    return encryptionEnabled ? decryptServerResponseIfNeeded(data, true) : data;
};

/**
 * הורדה ופענוח של תמונה מוצפנת (XOR 0x77) מהשרת והמרתה ל-Blob URL מקומי
 */
export const fetchEncryptedImageBlobUrl = async (
    apiBaseUrl: string,
    originalImageUrl: string
): Promise<string> => {
    if (!originalImageUrl) return '';
    if (
        originalImageUrl.startsWith('blob:') ||
        originalImageUrl.startsWith('data:') ||
        originalImageUrl.includes('via.placeholder.com')
    ) {
        return originalImageUrl;
    }

    const cached = decryptedImageCache.get(originalImageUrl);
    if (cached) return cached;

    const pending = pendingImageLoads.get(originalImageUrl);
    if (pending) return pending;

    const loadPromise = (async () => {
        try {
            const encryptedUrlParam = encryptText(originalImageUrl);
            const proxyUrl = `${apiBaseUrl}/proxy_image?u=${encodeURIComponent(encryptedUrlParam)}&enc=1`;
            const response = await fetch(proxyUrl);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const buffer = await response.arrayBuffer();
            const bytes = new Uint8Array(buffer);
            const isHeaderEncrypted = response.headers.get('X-Stream-Enc') !== '0';

            if (isHeaderEncrypted) {
                for (let i = 0; i < bytes.length; i++) {
                    bytes[i] ^= IMAGE_XOR_KEY;
                }
            }

            const blob = new Blob([bytes], { type: 'image/jpeg' });
            const blobUrl = URL.createObjectURL(blob);
            decryptedImageCache.set(originalImageUrl, blobUrl);
            return blobUrl;
        } catch (e) {
            console.warn('[Encryption] Failed to load encrypted image:', e);
            return '';
        } finally {
            pendingImageLoads.delete(originalImageUrl);
        }
    })();

    pendingImageLoads.set(originalImageUrl, loadPromise);
    return loadPromise;
};
