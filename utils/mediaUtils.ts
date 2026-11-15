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

// Spotify-Style Balanced Shuffle Algorithm
export const shuffleArray = (array: PlaylistItem[]): PlaylistItem[] => {
    if (array.length <= 2) return [...array];

    const authorGroups = new Map<string, PlaylistItem[]>();
    for (const song of array) {
        const author = song.author || 'Unknown';
        if (!authorGroups.has(author)) {
            authorGroups.set(author, []);
        }
        authorGroups.get(author)!.push(song);
    }

    for (const [, songs] of authorGroups.entries()) {
        for (let i = songs.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [songs[i], songs[j]] = [songs[j], songs[i]];
        }
    }

    const groups = Array.from(authorGroups.values()).sort((a, b) => b.length - a.length);
    const result: PlaylistItem[] = new Array(array.length);
    let resultIndex = 0;

    for (const group of groups) {
        const spacing = array.length / group.length;

        for (let i = 0; i < group.length; i++) {
            let targetIndex = Math.floor(i * spacing) + (resultIndex % Math.floor(spacing || 1));

            while (result[targetIndex % array.length] !== undefined) {
                targetIndex++;
            }

            result[targetIndex % array.length] = group[i];
        }
        resultIndex++;
    }

    return result.filter(item => item !== undefined);
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
