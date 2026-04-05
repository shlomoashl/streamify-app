
import React, { useState, useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { 
    WindowMinimizeIcon, 
    WindowMaximizeIcon, 
    WindowRestoreIcon, 
    WindowCloseIcon,
    MusicIcon
} from './Icons';

const TitleBar: React.FC = () => {
    const [isMaximized, setIsMaximized] = useState(false);

    // לוגיקה חדשה: אנחנו מציגים את הפס תמיד במחשב (דפדפן או תוכנה)
    // ומסתירים אותו אך ורק אם אנחנו באפליקציית מובייל (Android/iOS)
    const isMobile = Capacitor.isNativePlatform();

    useEffect(() => {
        if (isMobile) return;

        const initTauriListeners = async () => {
            try {
                // @ts-ignore
                const windowModule = await import('@tauri-apps/api/window');
                
                // תמיכה בגרסאות שונות של טאורי
                const appWindow = (windowModule as any).getCurrentWindow 
                    ? (windowModule as any).getCurrentWindow() 
                    : (windowModule as any).appWindow;

                if (!appWindow) return;

                // עדכון מצב התחלתי
                appWindow.isMaximized().then(setIsMaximized).catch(() => {});

                // האזנה לשינוי גודל
                const unlisten = await appWindow.onResized(async () => {
                    const max = await appWindow.isMaximized();
                    setIsMaximized(max);
                });

                return () => {
                    if (typeof unlisten === 'function') unlisten();
                };
            } catch (error) {
                // אנחנו בדפדפן רגיל, לא בתוך תוכנה - זה בסדר
            }
        };

        initTauriListeners();
    }, [isMobile]);

    const performAction = async (action: 'minimize' | 'maximize' | 'close') => {
        try {
            // @ts-ignore
            const windowModule = await import('@tauri-apps/api/window');
            
            const appWindow = (windowModule as any).getCurrentWindow 
                ? (windowModule as any).getCurrentWindow() 
                : (windowModule as any).appWindow;

            if (!appWindow) return;

            if (action === 'minimize') await appWindow.minimize();
            if (action === 'maximize') await appWindow.toggleMaximize();
            if (action === 'close') await appWindow.close();
        } catch (error) {
            console.error("Window action failed (probably in browser):", error);
        }
    };

    // אם אנחנו באנדרואיד/אייפון - לא להציג כלום!
    if (isMobile) return null;

    return (
        <div className="fixed top-0 left-0 right-0 h-8 bg-black border-b border-white/5 select-none font-sans z-[9999] flex justify-between items-center transition-colors duration-200">
            
            {/* אזור גרירה - מכסה את כל הפס חוץ מהכפתורים */}
            <div data-tauri-drag-region className="absolute inset-0 w-full h-full z-0" />

            {/* לוגו וכותרת */}
            <div className="relative z-10 flex items-center gap-3 pl-3 pr-2 h-full pointer-events-none opacity-80">
                <MusicIcon className="w-4 h-4 text-spotify-primary" />
                <span className="text-xs font-bold text-gray-300 tracking-wider">Streamify</span>
            </div>

            {/* כפתורי שליטה */}
            <div className="relative z-50 flex h-full">
                <button 
                    onClick={() => performAction('minimize')}
                    className="w-12 h-full flex items-center justify-center hover:bg-white/10 text-gray-400 hover:text-white transition-colors cursor-pointer focus:outline-none"
                    title="מזער"
                >
                    <WindowMinimizeIcon className="fill-current pointer-events-none w-3 h-3" />
                </button>

                <button 
                    onClick={() => performAction('maximize')}
                    className="w-12 h-full flex items-center justify-center hover:bg-white/10 text-gray-400 hover:text-white transition-colors cursor-pointer focus:outline-none"
                    title={isMaximized ? "שחזר" : "הגדל"}
                >
                    {isMaximized ? (
                        <WindowRestoreIcon className="fill-current pointer-events-none w-3 h-3" />
                    ) : (
                        <WindowMaximizeIcon className="fill-current pointer-events-none w-3 h-3" />
                    )}
                </button>

                <button 
                    onClick={() => performAction('close')}
                    className="w-12 h-full flex items-center justify-center hover:bg-red-600 text-gray-400 hover:text-white transition-colors cursor-pointer focus:outline-none"
                    title="סגור"
                >
                    <WindowCloseIcon className="fill-current pointer-events-none w-3 h-3" />
                </button>
            </div>
        </div>
    );
};

export default TitleBar;
