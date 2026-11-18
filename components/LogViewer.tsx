import React, { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import { Capacitor } from '@capacitor/core';
import { logger, LogEntry } from '../Logger';
import { YOUTUBE_API_BASE } from '../constants';
import { decryptText, encryptText } from '../utils/encryptionUtils';
import {
    XIcon,
    TrashIcon,
    CopyIcon,
    RefreshCcwIcon,
    TerminalIcon,
    SearchIcon
} from './Icons';

const ADMIN_PIN = '7548';

export const AdminManagementModal: React.FC<{
    isOpen: boolean;
    isEncryptionEnabled: boolean;
    onClose: () => void;
    onOpenLogs: () => void;
}> = ({ isOpen, isEncryptionEnabled, onClose, onOpenLogs }) => {
    const [pinInput, setPinInput] = useState('');
    const [isUnlocked, setIsUnlocked] = useState(false);
    const [pinError, setPinError] = useState('');
    const [confirmingRestart, setConfirmingRestart] = useState(false);
    const [isRestarting, setIsRestarting] = useState(false);
    const [restartResultMsg, setRestartResultMsg] = useState('');

    useEffect(() => {
        if (isOpen) {
            setPinInput('');
            setIsUnlocked(false);
            setPinError('');
            setConfirmingRestart(false);
            setIsRestarting(false);
            setRestartResultMsg('');
        }
    }, [isOpen]);

    if (!isOpen) return null;

    const handlePinSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (pinInput.trim() === ADMIN_PIN) {
            setIsUnlocked(true);
            setPinError('');
        } else {
            setPinError('סיסמה שגויה');
        }
    };

    const handleRestartServer = async () => {
        setIsRestarting(true);
        setRestartResultMsg('');
        try {
            const cleanBase = YOUTUBE_API_BASE.replace(/\/$/, '');
            const pinParam = isEncryptionEnabled ? encryptText(ADMIN_PIN) : ADMIN_PIN;
            const params = new URLSearchParams({
                use_underscore: isEncryptionEnabled ? 'true' : 'false',
                enc: isEncryptionEnabled ? '1' : '0',
                pin: pinParam
            });
            const res = await fetch(`${cleanBase}/restart?${params.toString()}`, {
                method: 'POST'
            });
            if (res.ok) {
                setRestartResultMsg('השרת מבצע אתחול כעת...');
                setTimeout(() => {
                    onClose();
                }, 1400);
            } else {
                setRestartResultMsg('שגיאה בביצוע אתחול השרת');
            }
        } catch {
            setRestartResultMsg('שגיאה בתקשורת עם השרת');
        } finally {
            setIsRestarting(false);
        }
    };

    return (
        <div
            className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[145] flex items-center justify-center p-4 animate-fade-in"
            onClick={onClose}
            dir="rtl"
        >
            <div
                className="bg-[#181818] border border-white/15 rounded-2xl p-6 w-full max-w-sm shadow-[0_20px_60px_rgba(0,0,0,0.85)] text-white"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-center justify-between mb-4 pb-3 border-b border-white/10">
                    <div className="flex items-center gap-2.5">
                        <div className="p-2 rounded-xl bg-spotify-primary/15 text-spotify-primary">
                            <TerminalIcon className="w-5 h-5" />
                        </div>
                        <h3 className="text-lg font-bold">ניהול שרת</h3>
                    </div>
                    <button
                        onClick={onClose}
                        className="text-gray-400 hover:text-white p-1 rounded-lg hover:bg-white/10 transition"
                    >
                        <XIcon className="w-5 h-5" />
                    </button>
                </div>

                {!isUnlocked ? (
                    <form onSubmit={handlePinSubmit} className="space-y-4">
                        <p className="text-sm text-gray-300">הזן סיסמת ניהול להמשך:</p>
                        <input
                            type="password"
                            inputMode="numeric"
                            autoFocus
                            value={pinInput}
                            onChange={(e) => {
                                setPinInput(e.target.value);
                                if (pinError) setPinError('');
                            }}
                            placeholder="••••"
                            className="w-full p-3 rounded-xl bg-neutral-800 border border-white/15 text-white text-center text-xl tracking-[0.4em] font-mono focus:outline-none focus:border-spotify-primary"
                        />
                        {pinError && (
                            <div className="text-xs font-bold text-red-400 text-center">
                                {pinError}
                            </div>
                        )}
                        <div className="flex gap-3 pt-1">
                            <button
                                type="button"
                                onClick={onClose}
                                className="flex-1 py-2.5 rounded-xl bg-white/10 hover:bg-white/15 text-gray-200 font-bold text-sm transition"
                            >
                                ביטול
                            </button>
                            <button
                                type="submit"
                                className="flex-1 py-2.5 rounded-xl bg-spotify-primary hover:brightness-110 text-black font-bold text-sm transition"
                            >
                                כניסה
                            </button>
                        </div>
                    </form>
                ) : !confirmingRestart ? (
                    <div className="space-y-3">
                        <p className="text-xs text-gray-400 mb-2">בחר פעולת ניהול:</p>
                        <button
                            onClick={() => {
                                onClose();
                                onOpenLogs();
                            }}
                            className="w-full flex items-center justify-between p-4 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 hover:border-spotify-primary/50 transition group"
                        >
                            <div className="flex items-center gap-3">
                                <div className="p-2.5 rounded-xl bg-spotify-primary/20 text-spotify-primary group-hover:scale-105 transition">
                                    <TerminalIcon className="w-5 h-5" />
                                </div>
                                <div className="text-right">
                                    <div className="font-bold text-sm text-white">לוגים של השרת</div>
                                    <div className="text-xs text-gray-400">
                                        צפייה חיה בלוגים המלאים של הפייתון והמערכת
                                    </div>
                                </div>
                            </div>
                        </button>

                        <button
                            onClick={() => setConfirmingRestart(true)}
                            className="w-full flex items-center justify-between p-4 rounded-xl bg-white/5 hover:bg-red-500/10 border border-white/10 hover:border-red-500/40 transition group"
                        >
                            <div className="flex items-center gap-3">
                                <div className="p-2.5 rounded-xl bg-red-500/20 text-red-400 group-hover:scale-105 transition">
                                    <RefreshCcwIcon className="w-5 h-5" />
                                </div>
                                <div className="text-right">
                                    <div className="font-bold text-sm text-white">איפוס שרת</div>
                                    <div className="text-xs text-gray-400">
                                        אתחול מהיר לתהליך שרת הפייתון
                                    </div>
                                </div>
                            </div>
                        </button>
                    </div>
                ) : (
                    <div className="space-y-4 text-center">
                        <p className="text-sm text-gray-200 leading-relaxed">
                            האם אתה בטוח שברצונך לאתחל את שרת הפייתון כעת?
                        </p>
                        {restartResultMsg && (
                            <div className="text-xs font-bold text-spotify-primary bg-spotify-primary/10 p-2.5 rounded-xl">
                                {restartResultMsg}
                            </div>
                        )}
                        <div className="flex gap-3">
                            <button
                                type="button"
                                disabled={isRestarting}
                                onClick={() => setConfirmingRestart(false)}
                                className="flex-1 py-2.5 rounded-xl bg-white/10 hover:bg-white/15 text-gray-200 font-bold text-sm transition"
                            >
                                חזור
                            </button>
                            <button
                                type="button"
                                disabled={isRestarting}
                                onClick={handleRestartServer}
                                className="flex-1 py-2.5 rounded-xl bg-red-500 hover:bg-red-600 text-white font-bold text-sm transition"
                            >
                                {isRestarting ? 'מאתחל...' : 'אשר אתחול'}
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

interface LogViewerProps {
    isEncryptionEnabled: boolean;
    onClose: () => void;
}

type LogSourceTab = 'server' | 'client';
type LogFilterType = 'all' | 'errors' | 'audio' | 'lyrics';

const LogViewer: React.FC<LogViewerProps> = ({ isEncryptionEnabled, onClose }) => {
    const [sourceTab, setSourceTab] = useState<LogSourceTab>('server');
    const [serverLogs, setServerLogs] = useState<LogEntry[]>([]);
    const [clientLogs, setClientLogs] = useState<LogEntry[]>([]);
    const [isLive, setIsLive] = useState(true);
    const [autoScroll, setAutoScroll] = useState(true);
    const [filterType, setFilterType] = useState<LogFilterType>('all');
    const [searchQuery, setSearchQuery] = useState('');
    const [isLoadingServer, setIsLoadingServer] = useState(false);
    const [serverError, setServerError] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);
    const endRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        return logger.subscribe((newLogs) => {
            setClientLogs([...newLogs]);
        });
    }, []);

    const fetchServerLogs = useCallback(async () => {
        try {
            setIsLoadingServer(true);
            const cleanBase = YOUTUBE_API_BASE.replace(/\/$/, '');
            const pinParam = isEncryptionEnabled ? encryptText(ADMIN_PIN) : ADMIN_PIN;
            const params = new URLSearchParams({
                use_underscore: isEncryptionEnabled ? 'true' : 'false',
                enc: isEncryptionEnabled ? '1' : '0',
                pin: pinParam,
                t: String(Date.now())
            });
            const res = await fetch(`${cleanBase}/server-logs?${params.toString()}`);
            if (!res.ok) {
                setServerError(`שגיאת שרת (${res.status})`);
                return;
            }
            const data = await res.json();
            if (!data || !data.success || !Array.isArray(data.logs)) {
                setServerError(data?.error || 'לא התקבלו לוגים מהשרת');
                return;
            }
            const shouldDecrypt = isEncryptionEnabled || Boolean(data.encrypted);
            const parsed: LogEntry[] = data.logs.map((entry: any) => ({
                timestamp: shouldDecrypt
                    ? decryptText(String(entry.timestamp || ''))
                    : String(entry.timestamp || ''),
                level:
                    entry.level === 'error' || entry.level === 'warn'
                        ? entry.level
                        : 'info',
                message: shouldDecrypt
                    ? decryptText(String(entry.message || ''))
                    : String(entry.message || '')
            }));
            setServerLogs(parsed);
            setServerError(null);
        } catch {
            setServerError('לא ניתן להתחבר לשרת הפייתון');
        } finally {
            setIsLoadingServer(false);
        }
    }, [isEncryptionEnabled]);

    useEffect(() => {
        if (sourceTab !== 'server') return;
        void fetchServerLogs();
        if (!isLive) return;
        const timer = setInterval(() => {
            void fetchServerLogs();
        }, 2500);
        return () => clearInterval(timer);
    }, [sourceTab, isLive, fetchServerLogs]);

    const activeLogs = sourceTab === 'server' ? serverLogs : clientLogs;

    const filteredLogs = useMemo(() => {
        const q = searchQuery.trim().toLowerCase();
        return activeLogs.filter((log) => {
            const msg = (log.message || '').toLowerCase();
            if (filterType === 'errors' && log.level !== 'error' && log.level !== 'warn') {
                return false;
            }
            if (
                filterType === 'audio' &&
                !msg.includes('audio') &&
                !msg.includes('fetching fresh html') &&
                !msg.includes('warmup') &&
                !msg.includes('m4a') &&
                !msg.includes('playability') &&
                !msg.includes('cooldown')
            ) {
                return false;
            }
            if (
                filterType === 'lyrics' &&
                !msg.includes('lyrics') &&
                !msg.includes('lrclib') &&
                !msg.includes('ytmusic')
            ) {
                return false;
            }
            if (q && !msg.includes(q) && !(log.timestamp || '').toLowerCase().includes(q)) {
                return false;
            }
            return true;
        });
    }, [activeLogs, filterType, searchQuery]);

    useEffect(() => {
        if (autoScroll) {
            endRef.current?.scrollIntoView({ behavior: 'smooth' });
        }
    }, [filteredLogs.length, autoScroll, sourceTab]);

    const handleCopy = () => {
        const text = filteredLogs
            .map((l) => `[${l.timestamp}] [${l.level.toUpperCase()}] ${l.message}`)
            .join('\n');
        navigator.clipboard?.writeText(text).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        });
    };

    const handleClear = async () => {
        if (sourceTab === 'client') {
            logger.clear();
            return;
        }
        try {
            const cleanBase = YOUTUBE_API_BASE.replace(/\/$/, '');
            const pinParam = isEncryptionEnabled ? encryptText(ADMIN_PIN) : ADMIN_PIN;
            const params = new URLSearchParams({
                use_underscore: isEncryptionEnabled ? 'true' : 'false',
                enc: isEncryptionEnabled ? '1' : '0',
                pin: pinParam,
                action: 'clear'
            });
            await fetch(`${cleanBase}/server-logs?${params.toString()}`, { method: 'POST' });
            setServerLogs([]);
        } catch {}
    };

    const isDesktop = !Capacitor.isNativePlatform();

    return (
        <div
            className={`fixed inset-x-0 bottom-0 ${
                isDesktop ? 'top-8' : 'top-0'
            } bg-[#0c0c0c] z-[150] flex flex-col font-mono text-sm overflow-hidden`}
        >
            {/* סרגל עליון - ממוקם נקי מתחת ל-TitleBar במחשב ועם safe-area באנדרואיד */}
            <div
                className="flex-shrink-0 flex flex-wrap items-center justify-between gap-2 px-4 py-3 pt-[max(1rem,env(safe-area-inset-top))] md:pt-3 bg-neutral-900 border-b border-white/10"
                dir="rtl"
            >
                <div className="flex items-center gap-2 flex-wrap">
                    <div className="flex bg-white/5 p-1 rounded-xl border border-white/10 font-sans">
                        <button
                            onClick={() => setSourceTab('server')}
                            className={`px-3 py-1 rounded-lg text-xs font-bold transition ${
                                sourceTab === 'server'
                                    ? 'bg-spotify-primary text-black'
                                    : 'text-gray-300 hover:text-white'
                            }`}
                        >
                            שרת פייתון ({serverLogs.length})
                        </button>
                        <button
                            onClick={() => setSourceTab('client')}
                            className={`px-3 py-1 rounded-lg text-xs font-bold transition ${
                                sourceTab === 'client'
                                    ? 'bg-spotify-primary text-black'
                                    : 'text-gray-300 hover:text-white'
                            }`}
                        >
                            אפליקציה ({clientLogs.length})
                        </button>
                    </div>

                    {sourceTab === 'server' && (
                        <button
                            onClick={() => setIsLive((v) => !v)}
                            className={`px-2.5 py-1 rounded-lg text-xs font-sans font-bold border transition flex items-center gap-1.5 ${
                                isLive
                                    ? 'bg-green-500/20 border-green-500/40 text-green-400'
                                    : 'bg-white/5 border-white/10 text-gray-400'
                            }`}
                        >
                            <span
                                className={`w-2 h-2 rounded-full ${
                                    isLive ? 'bg-green-400 animate-ping' : 'bg-gray-500'
                                }`}
                            />
                            <span>{isLive ? 'לייב' : 'מושהה'}</span>
                        </button>
                    )}

                    <button
                        onClick={() => setAutoScroll((v) => !v)}
                        className={`px-2.5 py-1 rounded-lg text-xs font-sans font-bold border transition ${
                            autoScroll
                                ? 'bg-spotify-primary/15 border-spotify-primary/40 text-spotify-primary'
                                : 'bg-white/5 border-white/10 text-gray-400'
                        }`}
                    >
                        {autoScroll ? 'גלילה: פעיל' : 'גלילה: ידני'}
                    </button>
                </div>

                <div className="flex items-center gap-3">
                    {sourceTab === 'server' && (
                        <button
                            onClick={() => void fetchServerLogs()}
                            className="text-gray-300 hover:text-white p-1.5 rounded-lg hover:bg-white/10"
                            title="רענן עכשיו"
                        >
                            <RefreshCcwIcon
                                className={`w-4 h-4 ${isLoadingServer ? 'animate-spin text-spotify-primary' : ''}`}
                            />
                        </button>
                    )}
                    <button
                        onClick={handleCopy}
                        className="flex items-center gap-1 text-xs font-sans font-bold px-2.5 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white"
                        title="העתק לוגים"
                    >
                        <CopyIcon className="w-4 h-4" />
                        <span>{copied ? 'הועתק!' : 'העתק'}</span>
                    </button>
                    <button
                        onClick={() => void handleClear()}
                        className="text-gray-400 hover:text-red-400 p-1.5 rounded-lg hover:bg-white/10"
                        title="נקה לוגים"
                    >
                        <TrashIcon className="w-4 h-4" />
                    </button>
                    <button
                        onClick={onClose}
                        className="text-gray-300 hover:text-white p-1.5 rounded-lg hover:bg-white/10"
                        title="סגור"
                    >
                        <XIcon className="w-5 h-5" />
                    </button>
                </div>
            </div>

            {/* סרגל סינון וחיפוש */}
            <div
                className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 bg-neutral-900/60 border-b border-white/10 font-sans"
                dir="rtl"
            >
                <div className="flex items-center gap-1.5 flex-wrap">
                    {(
                        [
                            ['all', 'הכל'],
                            ['errors', 'שגיאות ואזהרות'],
                            ['audio', 'אודיו וקוקיז'],
                            ['lyrics', 'מילות שירים']
                        ] as [LogFilterType, string][]
                    ).map(([key, label]) => (
                        <button
                            key={key}
                            onClick={() => setFilterType(key)}
                            className={`px-2.5 py-1 rounded-full text-xs font-bold transition ${
                                filterType === key
                                    ? 'bg-white text-black'
                                    : 'bg-white/5 text-gray-300 hover:bg-white/10'
                            }`}
                        >
                            {label}
                        </button>
                    ))}
                </div>

                <div className="relative w-full sm:w-64">
                    <SearchIcon className="w-3.5 h-3.5 text-gray-400 absolute right-3 top-1/2 -translate-y-1/2" />
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="חיפוש בלוגים (ID, שיר, שגיאה)..."
                        className="w-full pr-8 pl-3 py-1 rounded-full bg-white/5 border border-white/10 text-xs text-white focus:outline-none focus:border-spotify-primary"
                    />
                </div>
            </div>

            {serverError && sourceTab === 'server' && (
                <div className="bg-red-500/20 border-b border-red-500/30 text-red-300 text-xs font-sans font-bold px-4 py-2 text-center">
                    {serverError}
                </div>
            )}

            {/* רשימת הלוגים */}
            <div className="flex-1 overflow-y-auto p-3 md:p-4 space-y-1.5 text-xs md:text-sm" dir="ltr">
                {filteredLogs.length === 0 ? (
                    <div className="text-gray-500 text-center mt-12 font-sans">
                        {isLoadingServer ? 'טוען לוגים מהשרת...' : 'אין רשומות לוג להצגה'}
                    </div>
                ) : (
                    filteredLogs.map((log, i) => {
                        const msg = log.message || '';
                        const isAudioHit = msg.includes('🎵') || msg.includes('⚡ WARMUP');
                        const isLyricsHit = msg.includes('🎤');
                        return (
                            <div
                                key={i}
                                className={`flex gap-2 break-all px-2 py-1 rounded ${
                                    log.level === 'error'
                                        ? 'bg-red-950/35 border-l-2 border-red-500'
                                        : log.level === 'warn'
                                        ? 'bg-yellow-950/25 border-l-2 border-yellow-500'
                                        : isAudioHit
                                        ? 'bg-green-950/20'
                                        : isLyricsHit
                                        ? 'bg-emerald-950/20'
                                        : ''
                                }`}
                            >
                                <span className="text-gray-500 whitespace-nowrap select-all">
                                    [{log.timestamp}]
                                </span>
                                <span
                                    className={`uppercase font-bold text-[11px] w-12 shrink-0 ${
                                        log.level === 'error'
                                            ? 'text-red-400'
                                            : log.level === 'warn'
                                            ? 'text-yellow-400'
                                            : 'text-blue-400'
                                    }`}
                                >
                                    {log.level}
                                </span>
                                <span
                                    className={`select-all ${
                                        log.level === 'error'
                                            ? 'text-red-200 font-semibold'
                                            : log.level === 'warn'
                                            ? 'text-yellow-100'
                                            : isAudioHit
                                            ? 'text-green-300'
                                            : isLyricsHit
                                            ? 'text-cyan-300'
                                            : 'text-gray-200'
                                    }`}
                                >
                                    {msg}
                                </span>
                            </div>
                        );
                    })
                )}
                <div ref={endRef} />
            </div>
        </div>
    );
};

export default LogViewer;
