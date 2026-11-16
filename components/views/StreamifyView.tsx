import React from 'react';
import { YouTubeSearchResult } from '../../types';
import { getLowResThumbnail } from '../../utils/mediaUtils';
import {
    LoaderIcon,
    PauseIcon,
    PlayIcon,
    PlaylistIcon,
    RefreshCcwIcon
} from '../Icons';
import { SmartImage } from '../SmartImage';

export type StreamifyCategory =
    | 'all'
    | 'chasidic'
    | 'religious_israeli'
    | 'global_hits'
    | 'instrumental'
    | 'chill_focus'
    | 'energetic'
    | 'world_ethnic';

export const STREAMIFY_CATEGORIES: { id: StreamifyCategory; label: string }[] = [
    { id: 'all', label: 'הכל' },
    { id: 'chasidic', label: 'חסידי' },
    { id: 'religious_israeli', label: 'דתי וישראלי' },
    { id: 'global_hits', label: 'להיטים עולמיים' },
    { id: 'instrumental', label: 'מנגינות ואינסטרומנטלי' },
    { id: 'chill_focus', label: 'רגוע וריכוז' },
    { id: 'energetic', label: 'אנרגטי ודרך' },
    { id: 'world_ethnic', label: 'מוזיקת עולם' }
];

export const StreamifyView: React.FC<{
    isEncryptionEnabled: boolean;
    activeCategory: StreamifyCategory;
    streamifyResults: YouTubeSearchResult[];
    streamifyDisplayLimit: number;
    isLoadingStreamify: boolean;
    playingPlaylistId: string | null;
    isPlaying: boolean;
    observerRef: React.RefObject<HTMLDivElement>;
    onSelectCategory: (cat: StreamifyCategory) => void;
    onRefresh: () => void;
    onResultClick: (res: YouTubeSearchResult) => void;
    onDirectPlay: (e: React.MouseEvent, res: YouTubeSearchResult) => void;
}> = ({
    isEncryptionEnabled,
    activeCategory,
    streamifyResults,
    streamifyDisplayLimit,
    isLoadingStreamify,
    playingPlaylistId,
    isPlaying,
    observerRef,
    onSelectCategory,
    onRefresh,
    onResultClick,
    onDirectPlay
}) => {
    const activeLabel =
        STREAMIFY_CATEGORIES.find((c) => c.id === activeCategory)?.label || 'מומלצים עבורך';

    return (
        <div className="flex-1 flex flex-col overflow-hidden">
            <div className="sticky top-0 z-20 p-4 pt-[max(2.5rem,env(safe-area-inset-top))] md:pt-4 bg-spotify-base/95 backdrop-blur-md border-b border-white/5 shadow-md">
                <div className="flex justify-between items-center mb-3 px-1">
                    <div>
                        <h1 className="text-2xl font-bold">
                            {activeCategory === 'all' ? 'מומלצים עבורך' : activeLabel}
                        </h1>
                        <p className="text-xs text-gray-400 mt-0.5">
                            הפלייליסטים הגדולים והמובילים מ-YouTube Music
                        </p>
                    </div>
                    <button
                        onClick={onRefresh}
                        className="p-2.5 bg-white/10 hover:bg-white/20 rounded-full flex items-center transition text-gray-300 hover:text-white"
                        title="רענן פלייליסטים מחדש"
                    >
                        <RefreshCcwIcon
                            className={`w-5 h-5 ${isLoadingStreamify ? 'animate-spin' : ''}`}
                        />
                    </button>
                </div>

                <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1" dir="rtl">
                    {STREAMIFY_CATEGORIES.map((cat) => {
                        const isSelected = activeCategory === cat.id;
                        return (
                            <button
                                key={cat.id}
                                onClick={() => onSelectCategory(cat.id)}
                                className={`px-4 py-1.5 rounded-full text-xs md:text-sm font-bold border whitespace-nowrap transition-all ${
                                    isSelected
                                        ? 'bg-spotify-primary text-black border-spotify-primary shadow-md'
                                        : 'bg-white/5 border-white/15 hover:bg-white/10 hover:border-white/30 text-white'
                                }`}
                            >
                                {cat.label}
                            </button>
                        );
                    })}
                </div>
            </div>

            <div className="flex-1 p-4 overflow-y-auto no-scrollbar">
                {isLoadingStreamify && streamifyResults.length === 0 ? (
                    <div className="flex flex-col justify-center items-center mt-16 gap-3">
                        <LoaderIcon className="w-9 h-9 animate-spin text-spotify-primary" />
                        <span className="text-sm text-gray-400">טוען פלייליסטים מובילים...</span>
                    </div>
                ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 md:gap-6 px-1">
                        {streamifyResults.slice(0, streamifyDisplayLimit).map((res, idx) => {
                            const isItemPlaying =
                                playingPlaylistId === `temp-${res.id}` && isPlaying;
                            return (
                                <div
                                    key={`${res.id}-${idx}`}
                                    onClick={() => onResultClick(res)}
                                    className="flex flex-col p-4 bg-[#181818] hover:bg-[#282828] text-right rounded-2xl cursor-pointer transition-all relative group border border-transparent hover:border-white/10"
                                    dir="rtl"
                                >
                                    <div className="relative w-full aspect-square mb-4 flex items-center justify-center rounded-xl shadow-lg bg-[#282828] overflow-hidden">
                                        <SmartImage
                                            src={
                                                res.thumbnail_url
                                                    ? getLowResThumbnail(res.thumbnail_url)
                                                    : ''
                                            }
                                            encryptionEnabled={isEncryptionEnabled}
                                            className="w-full h-full object-cover"
                                            loading="lazy"
                                            decoding="async"
                                            fallback={
                                                <PlaylistIcon className="w-2/5 h-2/5 text-gray-500" />
                                            }
                                        />

                                        <button
                                            onClick={(e) => onDirectPlay(e, res)}
                                            className="absolute bg-spotify-primary rounded-full flex items-center justify-center text-black shadow-[0_4px_12px_rgba(0,0,0,0.6)] hover:scale-110 active:scale-95 transition-transform z-20 w-8 h-8 md:w-10 md:h-10 bottom-2 left-2 opacity-100"
                                        >
                                            {isItemPlaying ? (
                                                <PauseIcon className="w-4 h-4 md:w-5 md:h-5" fill />
                                            ) : (
                                                <PlayIcon
                                                    className="w-4 h-4 md:w-5 md:h-5 ml-0.5"
                                                    fill
                                                />
                                            )}
                                        </button>
                                    </div>

                                    <div className="text-[15px] font-bold truncate w-full px-1 group-hover:text-spotify-primary text-white">
                                        {res.title}
                                    </div>
                                    <div className="text-[12px] text-gray-400 truncate w-full px-1 mt-1 font-medium">
                                        {res.author || 'YouTube Music'}
                                    </div>
                                </div>
                            );
                        })}

                        {streamifyResults.length > streamifyDisplayLimit && (
                            <div
                                ref={observerRef}
                                className="col-span-full h-4 w-full opacity-0 pointer-events-none"
                            />
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};
