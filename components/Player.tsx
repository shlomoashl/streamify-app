import React, { useState, useRef, useEffect } from 'react';
import { PlayerState, SongDetailedInfo } from '../types';
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
    TrashIcon
} from './Icons';
import { SmartImage } from './SmartImage';
import { audioService } from '../AudioService';
import { fetchSongDetailedInfoApi } from '../utils/encryptionUtils';
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
    const { currentSong, isPlaying, isExpanded, isShuffled } = playerState;

    const [currentTime, setCurrentTime] = useState(initialTime || 0);
    const [duration, setDuration] = useState(currentSong?.duration || 0);
    const lastSongIdRef = useRef<string | null>(currentSong?.id || null);

    const [songDetails, setSongDetails] = useState<SongDetailedInfo | null>(null);
    const [isLoadingDetails, setIsLoadingDetails] = useState(false);
    const [showFullDescription, setShowFullDescription] = useState(false);

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
            setShowFullDescription(false);
            if (currentSong?.duration) {
                setDuration(currentSong.duration);
            }
        }
    }, [currentSong?.id, currentSong?.duration]);

    // טעינה מהירה של מידע מפורט מיוטיוב מיוזיק רק כשמסך השיר המלא פתוח (עם Cache בזיכרון)
    useEffect(() => {
        if (!isExpanded || !currentSong?.id) return;
        let cancelled = false;
        setIsLoadingDetails(true);

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

        return () => {
            cancelled = true;
        };
    }, [isExpanded, currentSong?.id, isEncryptionEnabled]);

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

    const Artwork = ({ large }: { large?: boolean }) => {
        const imgSrc = large
            ? songDetails?.thumbnail_url || currentSong?.thumbnail || ''
            : currentSong?.thumbnail
            ? getLowResThumbnail(currentSong.thumbnail)
            : '';

        return (
            <div
                className={`bg-neutral-800 flex items-center justify-center text-gray-200 overflow-hidden shadow-xl flex-shrink-0 ${
                    large ? 'w-full aspect-square rounded-2xl' : 'w-12 h-12 rounded-lg'
                }`}
            >
                <SmartImage
                    src={imgSrc}
                    encryptionEnabled={isEncryptionEnabled}
                    className="w-full h-full object-cover"
                    fallback={<MusicIcon className={large ? 'w-24 h-24 text-gray-500' : 'w-6 h-6 text-gray-400'} />}
                />
            </div>
        );
    };

    if (isExpanded && currentSong) {
        const displayTitle = songDetails?.title || currentSong.title;
        const displayArtist = songDetails?.artist || currentSong.author;
        const effectiveDuration = duration || songDetails?.duration || 0;

        return (
            <div
                className="fixed inset-0 bg-gradient-to-b from-[#1e293b] via-[#121212] to-black z-[100] flex flex-col overflow-y-auto no-scrollbar animate-slide-up text-white"
                dir="rtl"
            >
                {/* Top Header */}
                <div className="sticky top-0 z-10 flex justify-between items-center px-4 md:px-8 py-4 pt-[max(1.5rem,env(safe-area-inset-top))] bg-black/30 backdrop-blur-md border-b border-white/5">
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
                                className="flex items-center gap-1.5 text-xs md:text-sm font-bold text-spotify-primary hover:underline truncate max-w-[220px] md:max-w-xs mt-0.5"
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

                {/* Main Content Wrapper */}
                <div className="w-full max-w-4xl mx-auto px-5 md:px-10 py-6 flex flex-col gap-6 pb-16">
                    {/* Upper Player Card: Artwork + Title + Actions + Controls */}
                    <div className="flex flex-col md:flex-row gap-6 md:gap-10 items-center">
                        <div className="w-full max-w-[300px] sm:max-w-[340px] md:w-72 flex-shrink-0">
                            <Artwork large />
                        </div>

                        <div className="w-full flex-1 flex flex-col justify-between">
                            {/* Title & Artist */}
                            <div className="text-center md:text-right mb-5">
                                <h2 className="text-2xl md:text-3xl font-black text-white leading-tight mb-1.5">
                                    {displayTitle}
                                </h2>
                                <p className="text-base md:text-lg text-gray-300 font-medium">
                                    {displayArtist}
                                </p>
                            </div>

                            {/* Quick Action Buttons: Like, Add to Playlist, Back to Playlist */}
                            <div className="flex flex-wrap items-center justify-center md:justify-start gap-2.5 mb-6">
                                {onToggleLikeCurrentSong && (
                                    <button
                                        onClick={onToggleLikeCurrentSong}
                                        className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-bold transition border ${
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
                                        className="flex items-center gap-2 px-4 py-2 rounded-full text-sm font-bold bg-spotify-primary text-black hover:scale-105 active:scale-95 transition shadow-lg"
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
                                        className="flex items-center gap-2 px-4 py-2 rounded-full text-sm font-bold bg-white/10 hover:bg-white/20 border border-white/10 text-white transition"
                                    >
                                        <PlaylistIcon className="w-4 h-4" />
                                        <span>חזור לפלייליסט</span>
                                    </button>
                                )}
                            </div>

                            {/* Seek Bar */}
                            <div className="mb-5" dir="ltr">
                                <input
                                    type="range"
                                    min={0}
                                    max={effectiveDuration || 100}
                                    value={currentTime}
                                    onChange={(e) => handleSeekInput(Number(e.target.value))}
                                    className="w-full h-1.5 bg-gray-600 rounded-lg appearance-none cursor-pointer accent-spotify-primary"
                                />
                                <div className="flex justify-between text-xs text-gray-400 mt-2 font-mono">
                                    <span>{formatTime(currentTime)}</span>
                                    <span>{formatTime(effectiveDuration)}</span>
                                </div>
                            </div>

                            {/* Playback Controls */}
                            <div className="flex justify-between items-center px-2 md:px-0 max-w-md mx-auto md:mx-0 w-full">
                                <button
                                    onClick={onShuffle}
                                    className={`p-2 rounded-full hover:bg-white/10 transition ${
                                        isShuffled ? 'text-spotify-primary' : 'text-gray-300'
                                    }`}
                                    title="ערבוב"
                                >
                                    <ShuffleIcon className="w-6 h-6" active={isShuffled} />
                                </button>
                                <button
                                    onClick={onNext}
                                    className="p-2 rounded-full hover:bg-white/10 text-white transition"
                                    title="השיר הבא"
                                >
                                    <SkipForwardIcon className="w-9 h-9" />
                                </button>
                                <button
                                    onClick={onPlayPause}
                                    className="bg-white text-black rounded-full p-4 hover:scale-105 active:scale-95 transition shadow-xl"
                                >
                                    <div className="w-8 h-8 flex items-center justify-center">
                                        {isPlaying ? <PauseIcon fill /> : <PlayIcon fill />}
                                    </div>
                                </button>
                                <button
                                    onClick={onPrev}
                                    className="p-2 rounded-full hover:bg-white/10 text-white transition"
                                    title="השיר הקודם"
                                >
                                    <SkipBackIcon className="w-9 h-9" />
                                </button>
                                <div className="hidden md:flex items-center gap-2" dir="ltr">
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
                                        className="w-20 h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer accent-white"
                                    />
                                </div>
                                <div className="w-8 md:hidden" />
                            </div>
                        </div>
                    </div>

                    {/* Spotify-style Detailed YouTube Music Info & Credits */}
                    <div className="border-t border-white/10 pt-6 space-y-4">
                        <div className="flex items-center justify-between">
                            <h3 className="text-lg font-bold text-white">מידע וקרדיטים מ-YouTube Music</h3>
                            {isLoadingDetails && !songDetails && (
                                <span className="text-xs text-spotify-primary animate-pulse">
                                    טוען פרטים...
                                </span>
                            )}
                        </div>

                        {/* Stats / Ratings */}
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                            <div className="bg-white/5 border border-white/10 rounded-xl p-3">
                                <div className="text-[11px] text-gray-400 mb-1">צפיות</div>
                                <div className="text-base font-bold text-white">
                                    {formatCount(songDetails?.viewCount)}
                                </div>
                            </div>
                            <div className="bg-white/5 border border-white/10 rounded-xl p-3">
                                <div className="text-[11px] text-gray-400 mb-1">לייקים / דירוג</div>
                                <div className="text-base font-bold text-white">
                                    {formatCount(songDetails?.likeCount)}
                                </div>
                            </div>
                            <div className="bg-white/5 border border-white/10 rounded-xl p-3">
                                <div className="text-[11px] text-gray-400 mb-1">תגובות</div>
                                <div className="text-base font-bold text-white">
                                    {formatCount(songDetails?.commentCount)}
                                </div>
                            </div>
                            <div className="bg-white/5 border border-white/10 rounded-xl p-3">
                                <div className="text-[11px] text-gray-400 mb-1">תאריך יציאה</div>
                                <div className="text-base font-bold text-white font-mono">
                                    {songDetails?.publishedAt || '—'}
                                </div>
                            </div>
                        </div>

                        {/* Credits & Technical Info Grid */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {/* Credits card */}
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
                                            <span className="text-gray-400 flex-shrink-0">
                                                {c.label}
                                            </span>
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

                            {/* Technical Details card */}
                            <div className="bg-white/5 border border-white/10 rounded-2xl p-4 space-y-2.5">
                                <h4 className="text-sm font-bold text-spotify-primary mb-2">
                                    מידע טכני
                                </h4>
                                <div className="flex justify-between gap-3 text-sm border-b border-white/5 pb-2">
                                    <span className="text-gray-400">פורמט אודיו</span>
                                    <span className="font-mono text-xs md:text-sm text-gray-100 text-left" dir="ltr">
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
                        </div>

                        {/* Tags */}
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

                        {/* Description */}
                        {songDetails?.description && (
                            <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
                                <div className="flex justify-between items-center mb-2">
                                    <h4 className="text-sm font-bold text-gray-200">
                                        תיאור ופרטים נוספים
                                    </h4>
                                    {songDetails.description.length > 220 && (
                                        <button
                                            onClick={() => setShowFullDescription((v) => !v)}
                                            className="text-xs font-bold text-spotify-primary hover:underline"
                                        >
                                            {showFullDescription ? 'הצג פחות' : 'הצג הכל'}
                                        </button>
                                    )}
                                </div>
                                <p
                                    className={`text-xs md:text-sm text-gray-300 whitespace-pre-line leading-relaxed ${
                                        showFullDescription ? '' : 'line-clamp-4'
                                    }`}
                                >
                                    {songDetails.description}
                                </p>
                            </div>
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
                    <Artwork />
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
                            isDisabled ? 'text-gray-500' : 'text-white hover:text-spotify-primary transition-colors'
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
                        className="w-24 h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer accent-white hover:accent-green-500"
                    />
                </div>
            </div>
        </div>
    );
};

export default Player;
