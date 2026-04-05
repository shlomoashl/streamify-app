
// ---------------------------------------------------------------------------
// הגדרות שרת - SERVER CONFIGURATION
// ---------------------------------------------------------------------------

// הכתובת של האתר המאובטח שלך
export const SERVER_PUBLIC_URL = 'https://www.familydigital.ovh';

// נתיב ל-WebSocket של ספוטיפיי
export const SPOTIFY_WS_URL = 'wss://www.familydigital.ovh/api/youtube/ws/spotify-playlist-stream';

// ---------------------------------------------------------------------------
// נתיבים ל-API החדש (SQL Based)
// ---------------------------------------------------------------------------

// כתובת הבסיס לניהול הספרייה (במקום קובץ JSON סטטי)
export const LIBRARY_API_BASE = `${SERVER_PUBLIC_URL}/api/library`;

// תאימות לאחור (אם יש מקומות שעדיין משתמשים בזה, למרות שמומלץ להשתמש ב-LIBRARY_API_BASE)
export const PLAYLISTS_API_URL = `${LIBRARY_API_BASE}/sync`; 

// גישה לשרת היוטיוב דרך הדומיין
export const YOUTUBE_API_BASE = `${SERVER_PUBLIC_URL}/api/youtube/youtube-api`;

// ---------------------------------------------------------------------------

export const MOCK_USER: any = {
    email: 'user@example.com',
    permissions: ['magicode'],
    playlistPermission: 'edit'
};

export const MOCK_SEARCH_RESULTS: any[] = [];
export const MOCK_PLAYLISTS = [];
