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

export const StreamifyView: React.FC<{
    isEncryptionEnabled: boolean;
    streamifyResults: YouTubeSearchResult[];
    streamifyDisplayLimit: number;
    isLoadingStreamify: boolean;
    playingPlaylistId: string | null;
    isPlaying: boolean;
    observerRef: React.RefObject<HTMLDivElement>;
    onRefresh: () => void;
    onResultClick: (res: YouTubeSearchResult) => void;
    onDirectPlay: (e: React.MouseEvent, res: YouTubeSearchResult) => void;
}> = ({
    isEncryptionEnabled,
    streamifyResults,
    streamifyDisplayLimit,
    isLoadingStreamify,
    playingPlaylistId,
    isPlaying,
    observerRef,
    onRefresh,
    onResultClick,
    onDirectPlay
}) => {
    return (
        <div className="flex-1 p-4 overflow-y-auto no-scrollbar pt-[max(2.5rem,env(safe-area-inset-top))] md:pt-4">
            <div className="flex justify-between items-center mb-6 px-1">
                <h1 className="text-2xl font-bold">מומלצים עבורך</h1>
                <button
                    onClick={onRefresh}
                    className="p-2 bg-white/10 hover:bg-white/20 rounded-full flex items-center transition text-gray-400 hover:text-white"
                    title="רענן פלייליסטים מחדש"
                >
                    <RefreshCcwIcon
                        className={`w-5 h-5 ${isLoadingStreamify ? 'animate-spin' : ''}`}
                    />
                </button>
            </div>

            {isLoadingStreamify && streamifyResults.length === 0 ? (
                <div className="flex justify-center items-center mt-10">
                    <LoaderIcon className="w-8 h-8 animate-spin text-spotify-primary" />
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
                                        src={res.thumbnail_url ? getLowResThumbnail(res.thumbnail_url) : ''}
                                        encryptionEnabled={isEncryptionEnabled}
                                        className="w-full h-full object-cover"
                                        loading="lazy"
                                        decoding="async"
                                        fallback={<PlaylistIcon className="w-2/5 h-2/5 text-gray-500" />}
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
                                    {res.author || 'פלייליסט'}
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
    );
};
