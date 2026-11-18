import { PlaylistItem, YouTubeSearchResult } from '../types';

export const STREAMIFY_KEYWORDS = [
    'אברהם פריד',
    'חסידי עדכני',
    'חסידי הטובים',
    'חסידי חדש',
    'brian tyler',
    'ישי ריבו',
    'שמוליק סוכות',
    'דתי מומלצים',
    'חיים ישראל',
    'חסידי להיטים',
    'יידל ורדיגר',
    'משה פלד',
    'דתי עדכני',
    'ארי היל',
    'עקיבא',
    'הראל טל',
    'שירים חסידיים',
    'פלייליסט חסידי'
];

export const getLowResThumbnail = (url: string): string => {
    if (!url) return url;

    // 1. טיפול ב-YouTube Music ובפרוקסי של גוגל (מכריח רזולוציה של 120x120)
    if (url.includes('=w') || url.includes('-w')) {
        return url.replace(/([=-])w\d+/, '$1w120').replace(/([=-])h\d+/, '$1h120');
    }

    // 2. טיפול ביוטיוב רגיל - מוריד מרזולוציות גבוהות ל-mqdefault
    if (url.match(/(maxresdefault|sddefault|hqdefault)\.jpg/)) {
        return url.replace(/(maxresdefault|sddefault|hqdefault)\.jpg/, 'mqdefault.jpg');
    }

    return url;
};

export const parseDurationToSeconds = (dur: string | number | undefined): number => {
    if (typeof dur === 'number') return dur;
    if (!dur) return 0;
    const parts = dur.split(':').map(Number);
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    return 0;
};

export const formatDuration = (seconds: number): string => {
    if (!seconds || isNaN(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
};

const RECENT_SHUFFLE_HISTORY_KEY = 'streamify_recent_shuffle_history';
const MAX_RECENT_SHUFFLE_HISTORY = 250;

const readRecentPlayedHistory = (): string[] => {
    try {
        const raw = localStorage.getItem(RECENT_SHUFFLE_HISTORY_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed.filter((id) => typeof id === 'string') : [];
    } catch {
        return [];
    }
};

/**
 * מתעד שיר שנוגן כדי שאלגוריתם הערבוב ידחה שירים שנשמעו לאחרונה לסוף התור וייתן עדיפות לשירים טריים.
 */
export const recordPlayedSongId = (songId?: string | null): void => {
    if (!songId) return;
    try {
        const history = readRecentPlayedHistory().filter((id) => id !== songId);
        history.push(songId);
        if (history.length > MAX_RECENT_SHUFFLE_HISTORY) {
            history.splice(0, history.length - MAX_RECENT_SHUFFLE_HISTORY);
        }
        localStorage.setItem(RECENT_SHUFFLE_HISTORY_KEY, JSON.stringify(history));
    } catch {}
};

const extractShuffleArtistKey = (song: PlaylistItem): string => {
    let raw = (song.author || '').trim();
    const cleanedAuthor = raw
        .replace(/\s*-\s*topic$/i, '')
        .replace(/(?:vevo|official(?:\s+channel)?|music|productions?|records?)$/i, '')
        .replace(/\s*(?:הערוץ\s+הרשמי|ערוץ\s+רשמי)$/i, '')
        .trim();

    if (
        !cleanedAuthor ||
        /^(?:unknown|youtube|streamify|various\s*artists)$/i.test(cleanedAuthor)
    ) {
        // אם ערוץ ההעלאה כללי, מנסים לחלץ אמן מתוך הכותרת ("אמן - שיר" או "שיר | אמן")
        const title = (song.title || '').trim();
        const dashMatch = title.match(/^([^-–—|]{2,35})\s+[-–—]\s+/);
        if (dashMatch) {
            return dashMatch[1].trim().toLowerCase();
        }
    }

    return (cleanedAuthor || raw || `song:${song.id}`).toLowerCase();
};

const fisherYatesInPlace = <T,>(arr: T[]): T[] => {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
};

/**
 * ערבוב מאוזן בסגנון Spotify (Martin Fiedler) עם פאזה אקראית לכל אמן ו-Jitter:
 * מבטיח פיזור אחיד של אמנים גדולים, פיזור אקראי אמיתי של אמנים עם שיר 1, ומניעת צפיפות סדרתית.
 */
const shuffleTierBalanced = (items: PlaylistItem[]): PlaylistItem[] => {
    if (items.length <= 1) return [...items];

    const authorGroups = new Map<string, PlaylistItem[]>();
    for (const song of items) {
        const key = extractShuffleArtistKey(song);
        if (!authorGroups.has(key)) {
            authorGroups.set(key, []);
        }
        authorGroups.get(key)!.push(song);
    }

    // ערבוב סדר קבוצות האמנים כדי ששום מיקום פתיחה לא יהיה קבוע
    const groupEntries = fisherYatesInPlace(Array.from(authorGroups.entries()));
    const weighted: { song: PlaylistItem; pos: number; artistKey: string }[] = [];

    for (const [artistKey, songs] of groupEntries) {
        fisherYatesInPlace(songs);
        const k = songs.length;
        const artistPhase = Math.random();

        for (let i = 0; i < k; i++) {
            // פיזור מרווחי + היסט פאזה אקראי לכל אמן (עוטף מעגלית בתוך [0, 1))
            const rawPos = (i + 0.15 + Math.random() * 0.7 + artistPhase) / k;
            const wrappedPos = ((rawPos % 1) + 1) % 1;
            weighted.push({ song: songs[i], pos: wrappedPos, artistKey });
        }
    }

    weighted.sort((a, b) => a.pos - b.pos);

    // מעבר מניעת התנגשות מקומי: שלא יופיעו שני שירים של אותו אמן ברצף אם יש חלופה קרובה
    for (let i = 1; i < weighted.length; i++) {
        if (weighted[i].artistKey === weighted[i - 1].artistKey) {
            const lookaheadEnd = Math.min(weighted.length, i + 16);
            for (let j = i + 1; j < lookaheadEnd; j++) {
                const candidateKey = weighted[j].artistKey;
                const nextOk =
                    j + 1 >= weighted.length || weighted[j + 1].artistKey !== weighted[i].artistKey;
                if (candidateKey !== weighted[i - 1].artistKey && nextOk) {
                    [weighted[i], weighted[j]] = [weighted[j], weighted[i]];
                    break;
                }
            }
        }
    }

    return weighted.map((w) => w.song);
};

// Smart Spotify / YouTube Music Style Shuffle (Balanced Artist Spread + Recency Freshness Rotation)
export const shuffleArray = (
    array: PlaylistItem[],
    pinnedFirstId?: string
): PlaylistItem[] => {
    if (array.length <= 2) {
        if (!pinnedFirstId) return [...array];
        const copy = [...array];
        const idx = copy.findIndex((s) => s.id === pinnedFirstId);
        if (idx > 0) {
            const [pinned] = copy.splice(idx, 1);
            copy.unshift(pinned);
        }
        return copy;
    }

    let pinnedSong: PlaylistItem | undefined;
    const pool = [...array];
    if (pinnedFirstId) {
        const pIdx = pool.findIndex((s) => s.id === pinnedFirstId);
        if (pIdx !== -1) {
            [pinnedSong] = pool.splice(pIdx, 1);
        }
    }

    // מיפוי היסטוריית האזנה אחרונה: שירים שלא נוגנו לאחרונה תמיד מקבלים עדיפות ראשונה!
    const history = readRecentPlayedHistory();
    const recentOrderMap = new Map<string, number>();
    history.forEach((id, idx) => recentOrderMap.set(id, idx));

    const freshSongs: PlaylistItem[] = [];
    const recentSongsWithRank: { song: PlaylistItem; recencyIdx: number }[] = [];

    for (const song of pool) {
        const rIdx = recentOrderMap.get(song.id);
        if (rIdx === undefined) {
            freshSongs.push(song);
        } else {
            recentSongsWithRank.push({ song, recencyIdx: rIdx });
        }
    }

    const orderedResult: PlaylistItem[] = [];
    if (freshSongs.length > 0) {
        orderedResult.push(...shuffleTierBalanced(freshSongs));
    }

    // שירים שנוגנו לאחרונה מחולקים לגלים (הישנים ביותר קודם, האחרונים ביותר בסוף) עם פיזור אמנים ורנדום בתוך כל גל
    if (recentSongsWithRank.length > 0) {
        recentSongsWithRank.sort((a, b) => a.recencyIdx - b.recencyIdx);
        const waveCount = Math.min(3, Math.max(1, Math.ceil(recentSongsWithRank.length / 20)));
        const waveSize = Math.ceil(recentSongsWithRank.length / waveCount);
        for (let w = 0; w < waveCount; w++) {
            const slice = recentSongsWithRank
                .slice(w * waveSize, (w + 1) * waveSize)
                .map((x) => x.song);
            orderedResult.push(...shuffleTierBalanced(slice));
        }
    }

    if (pinnedSong) {
        const pinnedKey = extractShuffleArtistKey(pinnedSong);
        if (
            orderedResult.length > 1 &&
            extractShuffleArtistKey(orderedResult[0]) === pinnedKey
        ) {
            const swapIdx = orderedResult.findIndex(
                (s, i) => i > 0 && i < 16 && extractShuffleArtistKey(s) !== pinnedKey
            );
            if (swapIdx > 0) {
                [orderedResult[0], orderedResult[swapIdx]] = [orderedResult[swapIdx], orderedResult[0]];
            }
        }
        orderedResult.unshift(pinnedSong);
    }

    return orderedResult;
};

export const searchResultToPlaylistItem = (
    result: YouTubeSearchResult,
    source: string = 'search'
): PlaylistItem => ({
    id: result.id,
    title: result.title,
    author: result.author || result.channel || '',
    duration: parseDurationToSeconds(result.duration),
    thumbnail: result.thumbnail || result.thumbnail_url || '',
    addedBy: source,
    addedAt: new Date().toISOString()
});
