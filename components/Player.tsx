import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Capacitor } from '@capacitor/core';
import { PlayerState, SongDetailedInfo, SongLyricsData } from '../types';
import { YOUTUBE_API_BASE } from '../constants';
import {
    PlayIcon,
    PauseIcon,
    SkipBackIcon,
    SkipForwardIcon,
    ShuffleIcon,
    ChevronDownIcon,
    MusicIcon,
    VolumeIcon,
    VolumeLowIcon,
    VolumeMuteIcon,
    HeartIcon,
    PlusIcon,
    PlaylistIcon,
    TrashIcon,
    CopyIcon,
    LoaderIcon
} from './Icons';
import { SmartImage } from './SmartImage';
import { audioService } from '../AudioService';
import { fetchSongDetailedInfoApi, fetchSongLyricsApi } from '../utils/encryptionUtils';
import { getLowResThumbnail } from '../utils/mediaUtils';

const formatTime = (seconds: number) => {
    if (!seconds || isNaN(seconds) || seconds < 0) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
};

const formatCount = (num?: number): string => {
    if (!num || num <= 0) return '—';
    if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
    if (num >= 1_000) return `${(num / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
    return num.toLocaleString('he-IL');
};

// רכיב חיצוני קבוע למניעת Unmount/הבהוב של התמונה בכל עדכון זמן של הנגן
const PlayerArtwork: React.FC<{
    imgSrc: string;
    encryptionEnabled: boolean;
    large?: boolean;
}> = React.memo(({ imgSrc, encryptionEnabled, large }) => (
    <div
        className={`bg-neutral-800 flex items-center justify-center text-gray-200 overflow-hidden shadow-2xl flex-shrink-0 ${
            large ? 'w-full aspect-square rounded-2xl border border-white/10' : 'w-12 h-12 rounded-lg'
        }`}
    >
        <SmartImage
            src={imgSrc}
            encryptionEnabled={encryptionEnabled}
            className="w-full h-full object-cover"
            fallback={
                <MusicIcon
                    className={large ? 'w-24 h-24 text-gray-500' : 'w-6 h-6 text-gray-400'}
                />
            }
        />
    </div>
));

interface PlayerProps {
    playerState: PlayerState;
    initialTime?: number;
    isEncryptionEnabled: boolean;
    sourcePlaylistName?: string | null;
    canGoToPlaylist?: boolean;
    isCurrentSongLiked?: boolean;
    canRemoveCurrentSong?: boolean;
    onPlayPause: () => void;
    onNext: () => void;
    onPrev: () => void;
    onShuffle: () => void;
    onToggleExpand: () => void;
    onSeek: (time: number) => void;
    onGoToPlaylist?: () => void;
    onAddCurrentSongToPlaylist?: () => void;
    onToggleLikeCurrentSong?: () => void;
    onRemoveCurrentSong?: () => void;
}

const Player: React.FC<PlayerProps> = ({
    playerState,
    initialTime = 0,
    isEncryptionEnabled,
    sourcePlaylistName,
    canGoToPlaylist = false,
    isCurrentSongLiked = false,
    canRemoveCurrentSong = false,
    onPlayPause,
    onNext,
    onPrev,
    onShuffle,
    onToggleExpand,
    onSeek,
    onGoToPlaylist,
    onAddCurrentSongToPlaylist,
    onToggleLikeCurrentSong,
    onRemoveCurrentSong
}) => {
    const isDesktop = !Capacitor.isNativePlatform();
    const { currentSong, isPlaying, isExpanded, isShuffled } = playerState;

    const [currentTime, setCurrentTime] = useState(initialTime || 0);
    const [duration, setDuration] = useState(currentSong?.duration || 0);
    const lastSongIdRef = useRef<string | null>(currentSong?.id || null);

    const [songDetails, setSongDetails] = useState<SongDetailedInfo | null>(null);
    const [isLoadingDetails, setIsLoadingDetails] = useState(false);
    const [songLyrics, setSongLyrics] = useState<SongLyricsData | null>(null);
    const [isLoadingLyrics, setIsLoadingLyrics] = useState(false);
    const [activeRightTab, setActiveRightTab] = useState<'info' | 'lyrics'>('info');
    const [autoScrollLyrics, setAutoScrollLyrics] = useState(true);
    const [copiedLyrics, setCopiedLyrics] = useState(false);
    const [showFullDescription, setShowFullDescription] = useState(false);
    const [isDescriptionTruncated, setIsDescriptionTruncated] = useState(false);
    const descriptionRef = useRef<HTMLParagraphElement | null>(null);
    const activeLyricLineRef = useRef<HTMLButtonElement | null>(null);

    // סנכרון הזמן הראשוני שנשמר (למשל בעלייה מחדש במולטימדיה לרכב)
    useEffect(() => {
        if (initialTime > 0 && currentTime === 0) {
            setCurrentTime(initialTime);
        }
    }, [initialTime]);

    useEffect(() => {
        if (currentSong?.id !== lastSongIdRef.current) {
            lastSongIdRef.current = currentSong?.id || null;
            setSongDetails(null);
            setSongLyrics(null);
            setCopiedLyrics(false);
            setAutoScrollLyrics(true);
            setShowFullDescription(false);
            setIsDescriptionTruncated(false);
            if (currentSong?.duration) {
                setDuration(currentSong.duration);
            }
        }
    }, [currentSong?.id, currentSong?.duration]);

    // בדיקה אמיתית האם התיאור נחתך בפועל (מתחשב גם בשורות קצרות מרובות בעברית וגם בטקסט ארוך)
    useEffect(() => {
        if (showFullDescription) return;
        const el = descriptionRef.current;
        const desc = songDetails?.description || '';
        if (!desc) {
            setIsDescriptionTruncated(false);
            return;
        }
        const checkOverflow = () => {
            if (el && el.scrollHeight > el.clientHeight + 2) {
                setIsDescriptionTruncated(true);
            } else if (desc.length > 160 || desc.split(/\r?\n/).length > 4) {
                setIsDescriptionTruncated(true);
            } else {
                setIsDescriptionTruncated(false);
            }
        };
        checkOverflow();
        const raf = requestAnimationFrame(checkOverflow);
        return () => cancelAnimationFrame(raf);
    }, [songDetails?.description, showFullDescription, isExpanded]);

    // טעינה מהירה במקביל של מידע מפורט ומילות השיר מיוטיוב מיוזיק / LRCLIB רק כשמסך השיר המלא פתוח
    useEffect(() => {
        if (!isExpanded || !currentSong?.id) return;
        let cancelled = false;
        setIsLoadingDetails(true);
        setIsLoadingLyrics(true);

        fetchSongDetailedInfoApi(YOUTUBE_API_BASE, currentSong.id, isEncryptionEnabled)
            .then((info) => {
                if (!cancelled) {
                    setSongDetails(info);
                    if (info?.duration && info.duration > 0 && duration <= 0) {
                        setDuration(info.duration);
                    }
                }
            })
            .finally(() => {
                if (!cancelled) {
                    setIsLoadingDetails(false);
                }
            });

        fetchSongLyricsApi(
            YOUTUBE_API_BASE,
            {
                id: currentSong.id,
                title: currentSong.title,
                author: currentSong.author,
                duration: currentSong.duration || duration
            },
            isEncryptionEnabled
        )
            .then((lyricsData) => {
                if (!cancelled) {
                    setSongLyrics(lyricsData);
                }
            })
            .finally(() => {
                if (!cancelled) {
                    setIsLoadingLyrics(false);
                }
            });

        return () => {
            cancelled = true;
        };
    }, [isExpanded, currentSong?.id, isEncryptionEnabled]);

    // חישוב אינדקס השורה המתנגנת כרגע במילים מסונכרנות
    const activeLyricIndex = useMemo(() => {
        if (!songLyrics?.isSynced || !songLyrics.syncedLines.length) return -1;
        const lines = songLyrics.syncedLines;
        let idx = -1;
        for (let i = 0; i < lines.length; i++) {
            if (currentTime + 0.25 >= lines[i].time) {
                idx = i;
            } else {
                break;
            }
        }
        return idx;
    }, [songLyrics, currentTime]);

    // גלילה אוטומטית חלקה אל השורה המתנגנת כעת בטאב המילים
    useEffect(() => {
        if (
            isExpanded &&
            activeRightTab === 'lyrics' &&
            autoScrollLyrics &&
            activeLyricIndex >= 0 &&
            activeLyricLineRef.current
        ) {
            activeLyricLineRef.current.scrollIntoView({
                behavior: 'smooth',
                block: 'center'
            });
        }
    }, [isExpanded, activeRightTab, autoScrollLyrics, activeLyricIndex]);

    useEffect(() => {
        const timeListener = audioService.addListener('timeUpdate', (data: any) => {
            if (typeof data.currentTime === 'number') {
                setCurrentTime(data.currentTime);
            }
            if (data.duration && data.duration > 0) {
                setDuration(data.duration);
            }
        });
        const durationListener = audioService.addListener('durationChange', (data: any) => {
            if (data.duration && data.duration > 0) {
                setDuration(data.duration);
            }
        });
        const transitionListener = audioService.addListener('itemTransition', (data: any) => {
            if (data?.id && data.id !== lastSongIdRef.current) {
                lastSongIdRef.current = data.id;
                setCurrentTime(0);
            }
        });

        if (currentSong?.duration && currentSong.duration > 0) {
            setDuration(currentSong.duration);
        }

        return () => {
            timeListener.remove();
            durationListener.remove();
            transitionListener.remove();
        };
    }, [currentSong?.id]);

    // Volume State
    const [volume, setVolume] = useState(1);
    const [isMuted, setIsMuted] = useState(false);
    const prevVolume = useRef(1);

    const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const newVol = parseFloat(e.target.value);
        setVolume(newVol);
        audioService.setVolume(newVol);
        setIsMuted(newVol === 0);
    };

    const toggleMute = () => {
        if (isMuted) {
            setVolume(prevVolume.current);
            audioService.setVolume(prevVolume.current);
            setIsMuted(false);
        } else {
            prevVolume.current = volume;
            setVolume(0);
            audioService.setVolume(0);
            setIsMuted(true);
        }
    };

    const renderVolumeIcon = () => {
        if (isMuted || volume === 0) return <VolumeMuteIcon className="w-5 h-5" />;
        if (volume < 0.5) return <VolumeLowIcon className="w-5 h-5" />;
        return <VolumeIcon className="w-5 h-5" />;
    };

    const handleSeekInput = (newTime: number) => {
        setCurrentTime(newTime);
        onSeek(newTime);
    };

    const displaySong = currentSong || {
        title: 'בחר שיר לניגון',
        author: 'Streamify',
        thumbnail: ''
    };
    const isDisabled = !currentSong;
    const barThumb = currentSong?.thumbnail ? getLowResThumbnail(currentSong.thumbnail) : '';
    const largeThumb = songDetails?.thumbnail_url || currentSong?.thumbnail || '';

    if (isExpanded && currentSong) {
        const displayTitle = songDetails?.title || currentSong.title;
        const displayArtist = songDetails?.artist || currentSong.author;
        const effectiveDuration = duration || songDetails?.duration || 0;

        return (
            <div
                className={`fixed inset-x-0 bottom-0 ${
                    isDesktop ? 'top-8' : 'top-0'
                } bg-gradient-to-br from-[#18222f] via-[#121212] to-black z-[100] flex flex-col overflow-hidden animate-slide-up text-white`}
                dir="rtl"
            >
                {/* סרגל כותרת עליון - ממוקם נקי מתחת ל-TitleBar במחשב */}
                <div className="flex-shrink-0 flex justify-between items-center px-4 md:px-8 py-3 pt-[max(0.9rem,env(safe-area-inset-top))] md:pt-3 bg-black/35 backdrop-blur-md border-b border-white/10">
                    <button
                        onClick={onToggleExpand}
                        className="p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition"
                        title="מזער נגן"
                    >
                        <ChevronDownIcon className="w-6 h-6" />
                    </button>

                    <div className="flex flex-col items-center min-w-0 px-3">
                        <span className="text-[11px] font-bold tracking-widest uppercase text-gray-400">
                            מתנגן כעת
                        </span>
                        {canGoToPlaylist && onGoToPlaylist && (
                            <button
                                onClick={() => {
                                    onGoToPlaylist();
                                    onToggleExpand();
                                }}
                                className="flex items-center gap-1.5 text-xs md:text-sm font-bold text-spotify-primary hover:underline truncate max-w-[230px] md:max-w-sm mt-0.5"
                                title="עבור לפלייליסט שממנו השיר מופעל"
                            >
                                <PlaylistIcon className="w-3.5 h-3.5 flex-shrink-0" />
                                <span className="truncate">{sourcePlaylistName || 'לפלייליסט הפעיל'}</span>
                            </button>
                        )}
                    </div>

                    <div className="w-10 flex justify-end">
                        {canRemoveCurrentSong && onRemoveCurrentSong && (
                            <button
                                onClick={onRemoveCurrentSong}
                                className="p-2 rounded-full bg-white/10 hover:bg-red-500/20 text-gray-300 hover:text-red-400 transition"
                                title="הסר שיר זה מהפלייליסט"
                            >
                                <TrashIcon className="w-5 h-5" />
                            </button>
                        )}
                    </div>
                </div>

                {/* פריסת Spotify דו-צדדית במחשב: צד שמאל = השיר והפקדים, צד ימין = המידע והקרדיטים */}
                <div
                    className="flex-1 min-h-0 flex flex-col md:flex-row overflow-y-auto md:overflow-hidden"
                    dir="ltr"
                >
                    {/* צד שמאל: תמונת השיר, כותרת, פעולות מהירות ופקדי ניגון */}
                    <div
                        className="w-full md:w-[44%] lg:w-[42%] flex-shrink-0 flex flex-col items-center justify-center p-6 md:p-8 md:border-r md:border-white/10 bg-gradient-to-b from-white/[0.03] to-black/30 md:overflow-y-auto no-scrollbar"
                        dir="rtl"
                    >
                        <div className="w-full max-w-[270px] sm:max-w-[300px] lg:max-w-[320px] mb-5">
                            <PlayerArtwork
                                imgSrc={largeThumb}
                                encryptionEnabled={isEncryptionEnabled}
                                large
                            />
                        </div>

                        <div className="w-full max-w-md text-center mb-4">
                            <h2 className="text-xl md:text-2xl font-black text-white leading-snug line-clamp-2 mb-1">
                                {displayTitle}
                            </h2>
                            <p className="text-sm md:text-base text-gray-300 font-medium truncate">
                                {displayArtist}
                            </p>
                        </div>

                        {/* כפתורי פעולה: לייק, הוספה לפלייליסט, חזרה לפלייליסט */}
                        <div className="flex flex-wrap items-center justify-center gap-2 mb-5">
                            {onToggleLikeCurrentSong && (
                                <button
                                    onClick={onToggleLikeCurrentSong}
                                    className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs md:text-sm font-bold transition border ${
                                        isCurrentSongLiked
                                            ? 'bg-spotify-primary/20 border-spotify-primary text-spotify-primary'
                                            : 'bg-white/10 border-white/10 hover:bg-white/20 text-white'
                                    }`}
                                >
                                    <HeartIcon className="w-4 h-4" filled={isCurrentSongLiked} />
                                    <span>{isCurrentSongLiked ? 'אהבתי' : 'לייק'}</span>
                                </button>
                            )}

                            {onAddCurrentSongToPlaylist && (
                                <button
                                    onClick={onAddCurrentSongToPlaylist}
                                    className="flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs md:text-sm font-bold bg-spotify-primary text-black hover:scale-105 active:scale-95 transition shadow-lg"
                                >
                                    <PlusIcon className="w-4 h-4" />
                                    <span>הוסף לפלייליסט</span>
                                </button>
                            )}

                            {canGoToPlaylist && onGoToPlaylist && (
                                <button
                                    onClick={() => {
                                        onGoToPlaylist();
                                        onToggleExpand();
                                    }}
                                    className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs md:text-sm font-bold bg-white/10 hover:bg-white/20 border border-white/10 text-white transition"
                                >
                                    <PlaylistIcon className="w-4 h-4" />
                                    <span>לפלייליסט</span>
                                </button>
                            )}
                        </div>

                        {/* פס התקדמות */}
                        <div className="w-full max-w-md mb-4" dir="ltr">
                            <input
                                type="range"
                                min={0}
                                max={effectiveDuration || 100}
                                value={currentTime}
                                onChange={(e) => handleSeekInput(Number(e.target.value))}
                                className="w-full h-1.5 bg-gray-600 rounded-lg appearance-none cursor-pointer accent-spotify-primary"
                            />
                            <div className="flex justify-between text-xs text-gray-400 mt-1.5 font-mono">
                                <span>{formatTime(currentTime)}</span>
                                <span>{formatTime(effectiveDuration)}</span>
                            </div>
                        </div>

                        {/* כפתורי שליטה ווליום */}
                        <div className="w-full max-w-md flex flex-col gap-3">
                            <div className="flex justify-between items-center px-3">
                                <button
                                    onClick={onShuffle}
                                    className={`p-2 rounded-full hover:bg-white/10 transition ${
                                        isShuffled ? 'text-spotify-primary' : 'text-gray-300'
                                    }`}
                                    title="ערבוב"
                                >
                                    <ShuffleIcon className="w-5 h-5" active={isShuffled} />
                                </button>
                                <button
                                    onClick={onNext}
                                    className="p-2 rounded-full hover:bg-white/10 text-white transition"
                                    title="השיר הבא"
                                >
                                    <SkipForwardIcon className="w-8 h-8" />
                                </button>
                                <button
                                    onClick={onPlayPause}
                                    className="bg-white text-black rounded-full p-3.5 hover:scale-105 active:scale-95 transition shadow-xl"
                                >
                                    <div className="w-7 h-7 flex items-center justify-center">
                                        {isPlaying ? <PauseIcon fill /> : <PlayIcon fill />}
                                    </div>
                                </button>
                                <button
                                    onClick={onPrev}
                                    className="p-2 rounded-full hover:bg-white/10 text-white transition"
                                    title="השיר הקודם"
                                >
                                    <SkipBackIcon className="w-8 h-8" />
                                </button>
                                <div className="w-9" />
                            </div>

                            {isDesktop && (
                                <div className="flex items-center justify-center gap-2 pt-1" dir="ltr">
                                    <button
                                        onClick={toggleMute}
                                        className="text-gray-400 hover:text-white"
                                    >
                                        {renderVolumeIcon()}
                                    </button>
                                    <input
                                        type="range"
                                        min={0}
                                        max={1}
                                        step={0.01}
                                        value={volume}
                                        onChange={handleVolumeChange}
                                        className="w-28 h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer accent-white hover:accent-spotify-primary"
                                    />
                                </div>
                            )}
                        </div>
                    </div>

                    {/* צד ימין: טאבים של מידע וקרדיטים + מילות השיר (YouTube Music & LRCLIB) */}
                    <div
                        className="w-full md:w-[56%] lg:w-[58%] flex-1 md:overflow-y-auto no-scrollbar p-5 md:p-8 space-y-5 pb-12"
                        dir="rtl"
                    >
                        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-3">
                            <div className="flex items-center gap-2 bg-white/5 p-1 rounded-full border border-white/10">
                                <button
                                    onClick={() => setActiveRightTab('info')}
                                    className={`px-4 py-1.5 rounded-full text-xs md:text-sm font-bold transition-all ${
                                        activeRightTab === 'info'
                                            ? 'bg-spotify-primary text-black shadow-md'
                                            : 'text-gray-300 hover:text-white'
                                    }`}
                                >
                                    פרטים וקרדיטים
                                </button>
                                <button
                                    onClick={() => setActiveRightTab('lyrics')}
                                    className={`flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs md:text-sm font-bold transition-all ${
                                        activeRightTab === 'lyrics'
                                            ? 'bg-spotify-primary text-black shadow-md'
                                            : 'text-gray-300 hover:text-white'
                                    }`}
                                >
                                    <span>מילים</span>
                                    {songLyrics?.isSynced && (
                                        <span
                                            className={`text-[10px] px-1.5 py-0.5 rounded-full font-extrabold ${
                                                activeRightTab === 'lyrics'
                                                    ? 'bg-black/20 text-black'
                                                    : 'bg-spotify-primary/20 text-spotify-primary'
                                            }`}
                                        >
                                            מסונכרן
                                        </span>
                                    )}
                                </button>
                            </div>

                            {activeRightTab === 'info' && isLoadingDetails && !songDetails && (
                                <span className="text-xs font-semibold text-spotify-primary animate-pulse bg-spotify-primary/10 px-3 py-1 rounded-full">
                                    טוען פרטים...
                                </span>
                            )}

                            {activeRightTab === 'lyrics' && (
                                <div className="flex items-center gap-2">
                                    {songLyrics?.isSynced && (
                                        <button
                                            onClick={() => setAutoScrollLyrics((v) => !v)}
                                            className={`text-xs font-bold px-3 py-1 rounded-full border transition ${
                                                autoScrollLyrics
                                                    ? 'bg-spotify-primary/20 border-spotify-primary text-spotify-primary'
                                                    : 'bg-white/5 border-white/15 text-gray-300 hover:text-white'
                                            }`}
                                        >
                                            {autoScrollLyrics ? 'גלילה אוטומטית: פעיל' : 'גלילה ידנית'}
                                        </button>
                                    )}
                                    {songLyrics?.hasLyrics && songLyrics.plainLyrics && (
                                        <button
                                            onClick={() => {
                                                navigator.clipboard?.writeText(songLyrics.plainLyrics);
                                                setCopiedLyrics(true);
                                                setTimeout(() => setCopiedLyrics(false), 2000);
                                            }}
                                            className="flex items-center gap-1 text-xs font-bold px-3 py-1 rounded-full bg-white/10 hover:bg-white/20 text-gray-200 transition"
                                            title="העתק מילים"
                                        >
                                            <CopyIcon className="w-3.5 h-3.5" />
                                            <span>{copiedLyrics ? 'הועתק!' : 'העתק'}</span>
                                        </button>
                                    )}
                                </div>
                            )}
                        </div>

                        {activeRightTab === 'lyrics' ? (
                            <div className="space-y-4">
                                {isLoadingLyrics && !songLyrics ? (
                                    <div className="flex flex-col items-center justify-center py-16 gap-3">
                                        <LoaderIcon className="w-9 h-9 animate-spin text-spotify-primary" />
                                        <span className="text-sm text-gray-400">
                                            מחפש את מילות השיר...
                                        </span>
                                    </div>
                                ) : songLyrics?.hasLyrics ? (
                                    <div className="bg-white/[0.04] border border-white/10 rounded-2xl p-5 md:p-6">
                                        {songLyrics.source && (
                                            <div className="text-[11px] text-gray-400 mb-4 pb-2 border-b border-white/5 flex justify-between items-center">
                                                <span>מקור: {songLyrics.source}</span>
                                                {songLyrics.isSynced && (
                                                    <span className="text-spotify-primary font-semibold">
                                                        לחץ על שורה כדי לקפוץ אליה בשיר
                                                    </span>
                                                )}
                                            </div>
                                        )}

                                        {songLyrics.isSynced && songLyrics.syncedLines.length > 0 ? (
                                            <div className="space-y-2.5">
                                                {songLyrics.syncedLines.map((line, idx) => {
                                                    const isCurrentLine = idx === activeLyricIndex;
                                                    const isPastLine =
                                                        activeLyricIndex >= 0 && idx < activeLyricIndex;

                                                    return (
                                                        <button
                                                            key={`${line.time}-${idx}`}
                                                            ref={
                                                                isCurrentLine
                                                                    ? activeLyricLineRef
                                                                    : undefined
                                                            }
                                                            onClick={() => handleSeekInput(line.time)}
                                                            dir="auto"
                                                            className={`w-full text-start px-3 py-2 rounded-xl transition-all duration-200 block ${
                                                                isCurrentLine
                                                                    ? 'text-white font-black text-xl md:text-2xl bg-spotify-primary/15 border border-spotify-primary/30 shadow-md'
                                                                    : isPastLine
                                                                    ? 'text-gray-500 hover:text-gray-300 text-base md:text-lg font-semibold hover:bg-white/5'
                                                                    : 'text-gray-300 hover:text-white text-base md:text-lg font-semibold hover:bg-white/5'
                                                            }`}
                                                        >
                                                            {line.text}
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        ) : (
                                            <p
                                                dir="auto"
                                                className="text-base md:text-lg text-gray-100 whitespace-pre-line leading-loose font-medium"
                                            >
                                                {songLyrics.plainLyrics}
                                            </p>
                                        )}
                                    </div>
                                ) : (
                                    <div className="bg-white/5 border border-white/10 rounded-2xl p-8 text-center space-y-2">
                                        <MusicIcon className="w-10 h-10 text-gray-500 mx-auto" />
                                        <div className="text-base font-bold text-gray-300">
                                            לא נמצאו מילים עבור שיר זה
                                        </div>
                                        <p className="text-xs text-gray-500">
                                            ייתכן שמדובר בקטע אינסטרומנטלי או שהמילים טרם הוזנו במאגרי YouTube Music ו-LRCLIB.
                                        </p>
                                    </div>
                                )}
                            </div>
                        ) : (
                            <>
                                {/* כרטיסיות סטטיסטיקה ודירוגים */}
                        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                            <div className="bg-white/5 border border-white/10 rounded-xl p-3.5">
                                <div className="text-[11px] text-gray-400 mb-1">צפיות</div>
                                <div className="text-base md:text-lg font-bold text-white">
                                    {formatCount(songDetails?.viewCount)}
                                </div>
                            </div>
                            <div className="bg-white/5 border border-white/10 rounded-xl p-3.5">
                                <div className="text-[11px] text-gray-400 mb-1">לייקים / דירוג</div>
                                <div className="text-base md:text-lg font-bold text-white">
                                    {formatCount(songDetails?.likeCount)}
                                </div>
                            </div>
                            <div className="bg-white/5 border border-white/10 rounded-xl p-3.5">
                                <div className="text-[11px] text-gray-400 mb-1">תגובות</div>
                                <div className="text-base md:text-lg font-bold text-white">
                                    {formatCount(songDetails?.commentCount)}
                                </div>
                            </div>
                            <div className="bg-white/5 border border-white/10 rounded-xl p-3.5">
                                <div className="text-[11px] text-gray-400 mb-1">תאריך יציאה</div>
                                <div className="text-base md:text-lg font-bold text-white font-mono">
                                    {songDetails?.publishedAt || '—'}
                                </div>
                            </div>
                        </div>

                        {/* קרדיטים ויוצרים */}
                        <div className="bg-white/5 border border-white/10 rounded-2xl p-4 space-y-2.5">
                            <h4 className="text-sm font-bold text-spotify-primary mb-2">
                                אמנים, מלחינים ויוצרים
                            </h4>
                            <div className="flex justify-between gap-3 text-sm border-b border-white/5 pb-2">
                                <span className="text-gray-400">זמר / ערוץ</span>
                                <span className="font-semibold text-white text-left">
                                    {displayArtist || 'לא צוין'}
                                </span>
                            </div>

                            {songDetails?.credits && songDetails.credits.length > 0 ? (
                                songDetails.credits.map((c, idx) => (
                                    <div
                                        key={idx}
                                        className="flex justify-between gap-3 text-sm border-b border-white/5 pb-2 last:border-b-0 last:pb-0"
                                    >
                                        <span className="text-gray-400 flex-shrink-0">{c.label}</span>
                                        <span className="font-medium text-gray-100 text-left break-words">
                                            {c.value}
                                        </span>
                                    </div>
                                ))
                            ) : (
                                <div className="text-xs text-gray-500 pt-1">
                                    {isLoadingDetails
                                        ? 'שולף קרדיטים ויוצרים...'
                                        : 'אין קרדיטים נוספים זמינים בדף השיר'}
                                </div>
                            )}
                        </div>

                        {/* מידע טכני */}
                        <div className="bg-white/5 border border-white/10 rounded-2xl p-4 space-y-2.5">
                            <h4 className="text-sm font-bold text-spotify-primary mb-2">מידע טכני</h4>
                            <div className="flex justify-between gap-3 text-sm border-b border-white/5 pb-2">
                                <span className="text-gray-400">פורמט אודיו</span>
                                <span
                                    className="font-mono text-xs md:text-sm text-gray-100 text-left"
                                    dir="ltr"
                                >
                                    {songDetails?.audioFormat || 'M4A (AAC-LC 128kbps)'}
                                </span>
                            </div>
                            <div className="flex justify-between gap-3 text-sm border-b border-white/5 pb-2">
                                <span className="text-gray-400">איכות מקור</span>
                                <span className="font-mono text-sm text-gray-100">
                                    {songDetails?.definition || 'HD'}
                                </span>
                            </div>
                            <div className="flex justify-between gap-3 text-sm border-b border-white/5 pb-2">
                                <span className="text-gray-400">משך מדויק</span>
                                <span className="font-mono text-sm text-gray-100">
                                    {formatTime(effectiveDuration)}
                                </span>
                            </div>
                            <div className="flex justify-between gap-3 text-sm border-b border-white/5 pb-2">
                                <span className="text-gray-400">מזהה שיר (Video ID)</span>
                                <span className="font-mono text-xs text-gray-300" dir="ltr">
                                    {currentSong.id}
                                </span>
                            </div>
                            <div className="flex justify-between gap-3 text-sm">
                                <span className="text-gray-400">מצב הצפנה</span>
                                <span
                                    className={`font-bold text-xs px-2.5 py-0.5 rounded-full ${
                                        isEncryptionEnabled
                                            ? 'bg-spotify-primary/20 text-spotify-primary'
                                            : 'bg-white/10 text-gray-300'
                                    }`}
                                >
                                    {isEncryptionEnabled ? 'מוצפן (מלא)' : 'ישיר (ללא הצפנה)'}
                                </span>
                            </div>
                        </div>

                        {/* תגיות */}
                        {songDetails?.tags && songDetails.tags.length > 0 && (
                            <div className="flex flex-wrap gap-2">
                                {songDetails.tags.map((tag, i) => (
                                    <span
                                        key={i}
                                        className="px-3 py-1 bg-white/5 border border-white/10 rounded-full text-xs text-gray-300"
                                    >
                                        #{tag}
                                    </span>
                                ))}
                            </div>
                        )}

                        {/* תיאור מלא */}
                        {songDetails?.description && (
                            <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
                                <div className="flex justify-between items-center mb-2">
                                    <h4 className="text-sm font-bold text-gray-200">
                                        תיאור ופרטים נוספים
                                    </h4>
                                    {(isDescriptionTruncated || showFullDescription) && (
                                        <button
                                            onClick={() => setShowFullDescription((v) => !v)}
                                            className="text-xs font-bold text-spotify-primary hover:underline"
                                        >
                                            {showFullDescription ? 'הצג פחות' : 'הצג הכל'}
                                        </button>
                                    )}
                                </div>
                                <p
                                    ref={descriptionRef}
                                    dir="auto"
                                    className={`text-xs md:text-sm text-gray-300 whitespace-pre-line leading-relaxed ${
                                        showFullDescription ? '' : 'line-clamp-5'
                                    }`}
                                >
                                    {songDetails.description}
                                </p>
                            </div>
                        )}
                            </>
                        )}
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div
            className={`w-full h-[100px] bg-gradient-to-b from-spotify-elevated/0 via-spotify-elevated/75 to-spotify-elevated/90 backdrop-blur-xl p-4 flex items-center justify-between z-40 flex-shrink-0 ${
                !isDisabled ? 'cursor-pointer hover:brightness-110' : ''
            } transition-all duration-300 ease-in-out`}
            onClick={(e) => {
                if (isDisabled) return;
                if (
                    !(e.target as HTMLElement).closest('button') &&
                    !(e.target as HTMLElement).closest('input')
                ) {
                    onToggleExpand();
                }
            }}
        >
            <div className="flex items-center gap-3 flex-1 min-w-0">
                <div
                    onClick={(e) => {
                        if (isDisabled) return;
                        e.stopPropagation();
                        onToggleExpand();
                    }}
                    className={!isDisabled ? 'cursor-pointer' : ''}
                >
                    <PlayerArtwork
                        imgSrc={barThumb}
                        encryptionEnabled={isEncryptionEnabled}
                    />
                </div>
                <div
                    className={`min-w-0 flex-1 relative ${!isDisabled ? 'cursor-pointer' : ''}`}
                    onClick={(e) => {
                        if (isDisabled) return;
                        e.stopPropagation();
                        onToggleExpand();
                    }}
                    title={isDisabled ? '' : 'לחץ לפתיחת נגן מלא ופרטי השיר'}
                >
                    <div
                        className={`font-semibold text-sm truncate ${
                            isDisabled
                                ? 'text-gray-500'
                                : 'text-white hover:text-spotify-primary transition-colors'
                        }`}
                    >
                        {displaySong.title}
                    </div>
                    <div className="text-xs text-gray-400 truncate">{displaySong.author}</div>
                </div>
            </div>

            <div className="flex flex-col items-center flex-1 max-w-[40%] hidden md:flex justify-center">
                <div className="flex items-center gap-6 mb-4">
                    <button
                        disabled={isDisabled}
                        onClick={onShuffle}
                        className={`${
                            isDisabled
                                ? 'text-gray-600'
                                : isShuffled
                                ? 'text-spotify-primary'
                                : 'text-gray-400 hover:text-white'
                        }`}
                    >
                        <ShuffleIcon className="w-5 h-5" active={isShuffled} />
                    </button>
                    <button
                        disabled={isDisabled}
                        onClick={onNext}
                        className={isDisabled ? 'text-gray-600' : ''}
                    >
                        <SkipForwardIcon className="w-6 h-6" />
                    </button>
                    <button
                        disabled={isDisabled}
                        onClick={(e) => {
                            e.stopPropagation();
                            onPlayPause();
                        }}
                        className={`bg-white text-black rounded-full p-2 ${
                            isDisabled ? 'opacity-50' : ''
                        }`}
                    >
                        <div className="w-7 h-7 flex items-center justify-center">
                            {isPlaying ? <PauseIcon fill /> : <PlayIcon fill />}
                        </div>
                    </button>
                    <button
                        disabled={isDisabled}
                        onClick={onPrev}
                        className={isDisabled ? 'text-gray-600' : ''}
                    >
                        <SkipBackIcon className="w-6 h-6" />
                    </button>
                </div>
                <div className="w-full flex items-center gap-2 text-xs text-gray-400 font-mono" dir="ltr">
                    <span>{formatTime(currentTime)}</span>
                    <input
                        type="range"
                        min={0}
                        max={duration || 100}
                        value={currentTime}
                        disabled={isDisabled}
                        onChange={(e) => {
                            e.stopPropagation();
                            handleSeekInput(Number(e.target.value));
                        }}
                        className="flex-1 h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer accent-white disabled:opacity-50"
                    />
                    <span>{formatTime(duration)}</span>
                </div>
            </div>

            <div className="flex items-center justify-end gap-4 flex-1 md:hidden">
                <button
                    disabled={isDisabled}
                    onClick={(e) => {
                        e.stopPropagation();
                        onPlayPause();
                    }}
                    className={isDisabled ? 'opacity-50' : ''}
                >
                    {isPlaying ? <PauseIcon className="w-8 h-8" /> : <PlayIcon className="w-8 h-8" />}
                </button>
            </div>

            <div className="hidden md:flex flex-col justify-center flex-1 items-start pl-4" dir="ltr">
                <div className="w-full h-6 mb-9 invisible" aria-hidden="true"></div>

                <div className="flex items-center gap-2">
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            toggleMute();
                        }}
                        className="text-gray-400 hover:text-white"
                    >
                        {renderVolumeIcon()}
                    </button>
                    <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.01}
                        value={volume}
                        onClick={(e) => e.stopPropagation()}
                        onChange={handleVolumeChange}
                        className="w-24 h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer accent-white hover:accent-spotify-primary"
                    />
                </div>
            </div>
        </div>
    );
};

export default Player;
