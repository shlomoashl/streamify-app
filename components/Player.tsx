
import React, { useState, useRef, useEffect } from 'react';
import { PlayerState } from '../types';
import { 
    PlayIcon, PauseIcon, SkipBackIcon, SkipForwardIcon, 
    ShuffleIcon, ChevronDownIcon, MusicIcon,
    VolumeIcon, VolumeLowIcon, VolumeMuteIcon
} from './Icons';
import { audioService } from '../AudioService';

const formatTime = (seconds: number) => {
    if (isNaN(seconds)) return "0:00";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
};

interface PlayerProps {
    playerState: PlayerState;
    onPlayPause: () => void;
    onNext: () => void;
    onPrev: () => void;
    onShuffle: () => void;
    onToggleExpand: () => void;
    onSeek: (time: number) => void;
}

const Player: React.FC<PlayerProps> = ({
    playerState, onPlayPause, onNext, onPrev, onShuffle, 
    onToggleExpand, onSeek
}) => {
    const { currentSong, isPlaying, isExpanded, isShuffled } = playerState;
    
    // --- ניהול זמן עצמאי של הנגן ---
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);

    useEffect(() => {
        const timeListener = audioService.addListener('timeUpdate', (data: any) => { 
            setCurrentTime(data.currentTime); 
            if (data.duration > 0) setDuration(data.duration); 
        });
        const durationListener = audioService.addListener('durationChange', (data: any) => { 
            if (data.duration > 0) setDuration(data.duration); 
        });
        const transitionListener = audioService.addListener('itemTransition', () => {
            setCurrentTime(0);
        });

        if (currentSong?.duration) {
            setDuration(currentSong.duration);
        }

        return () => { 
            timeListener.remove(); 
            durationListener.remove(); 
            transitionListener.remove();
        };
    }, [currentSong?.id]);
    // --------------------------------

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

    // Fallback data for empty state
    const displaySong = currentSong || {
        title: "בחר שיר לניגון",
        author: "Streamify",
        thumbnail: ""
    };
    const isDisabled = !currentSong;

    const Artwork = ({ large }: { large?: boolean }) => (
        <div className={`bg-neutral-800 flex items-center justify-center text-gray-200 rounded-lg ${large ? 'w-full aspect-square' : 'w-12 h-12'}`}>
            <MusicIcon className={large ? "w-24 h-24" : "w-6 h-6"} />
        </div>
    );

    // Full Screen Player (Mobile Overlay) - Remains fixed covering everything
    if (isExpanded && currentSong) {
        return (
            <div className="fixed inset-0 bg-gradient-to-b from-gray-900 to-black z-[100] flex flex-col p-6 overflow-y-auto animate-slide-up">
                <div className="flex justify-between items-center mb-8">
                    <button onClick={onToggleExpand} className="text-white"><ChevronDownIcon /></button>
                    <span className="text-xs font-bold tracking-widest uppercase text-gray-400">מתנגן כעת</span>
                    <div className="w-6"></div>
                </div>
                
                <div className="mb-8 px-8"><Artwork large /></div>
                
                <div className="mb-6">
                    <h2 className="text-2xl font-bold text-white mb-2">{currentSong.title}</h2>
                    <p className="text-lg text-gray-400">{currentSong.author}</p>
                </div>

                <div className="mb-6" dir="ltr">
                    <input type="range" min={0} max={duration || 100} value={currentTime} onChange={e => onSeek(Number(e.target.value))} className="w-full h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer accent-white" />
                    <div className="flex justify-between text-xs text-gray-400 mt-2 font-mono">
                        <span>{formatTime(currentTime)}</span><span>{formatTime(duration)}</span>
                    </div>
                </div>

                <div className="flex justify-between items-center px-4">
                    <button onClick={onShuffle} className={isShuffled ? 'text-spotify-primary' : 'text-white'}><ShuffleIcon className="w-6 h-6" active={isShuffled} /></button>
                    <button onClick={onNext}><SkipForwardIcon className="w-10 h-10" /></button>
                    <button onClick={onPlayPause} className="bg-white text-black rounded-full p-4"><div className="w-8 h-8 flex items-center justify-center">{isPlaying ? <PauseIcon fill /> : <PlayIcon fill />}</div></button>
                    <button onClick={onPrev}><SkipBackIcon className="w-10 h-10" /></button>
                    <div className="w-6"></div>
                </div>
            </div>
        );
    }

    // Bottom Bar Player (Desktop & Mobile Mini)
    // Updated Design: Gradient from 0% opacity (top) to ~90% opacity (bottom) with backdrop blur.
    // This allows a "silhouette" of the content behind to be visible at the bottom.
    return (
        <div 
            className={`w-full h-[100px] bg-gradient-to-b from-spotify-elevated/0 via-spotify-elevated/75 to-spotify-elevated/90 backdrop-blur-xl p-4 flex items-center justify-between z-40 flex-shrink-0 ${!isDisabled ? 'cursor-pointer hover:brightness-110' : ''} transition-all duration-300 ease-in-out`}
            onClick={(e) => { 
                if (isDisabled) return;
                // Only expand on click if on mobile (screen width < 768px)
                if (window.innerWidth < 768 && !(e.target as HTMLElement).closest('button') && !(e.target as HTMLElement).closest('input')) {
                    onToggleExpand();
                }
            }}
        >
            <div className="flex items-center gap-3 flex-1 min-w-0">
                <Artwork />
                <div className="min-w-0">
                    <div className={`font-semibold text-sm truncate ${isDisabled ? 'text-gray-500' : 'text-white'}`}>{displaySong.title}</div>
                    <div className="text-xs text-gray-500 truncate">{displaySong.author}</div>
                </div>
            </div>

            <div className="flex flex-col items-center flex-1 max-w-[40%] hidden md:flex justify-center">
                 <div className="flex items-center gap-6 mb-4">
                    <button disabled={isDisabled} onClick={onShuffle} className={`${isDisabled ? 'text-gray-600' : isShuffled ? 'text-spotify-primary' : 'text-gray-400 hover:text-white'}`}><ShuffleIcon className="w-5 h-5" active={isShuffled} /></button>
                    <button disabled={isDisabled} onClick={onNext} className={isDisabled ? 'text-gray-600' : ''}><SkipForwardIcon className="w-6 h-6" /></button>
                    <button disabled={isDisabled} onClick={(e) => {e.stopPropagation(); onPlayPause()}} className={`bg-white text-black rounded-full p-2 ${isDisabled ? 'opacity-50' : ''}`}><div className="w-7 h-7 flex items-center justify-center">{isPlaying ? <PauseIcon fill /> : <PlayIcon fill />}</div></button>
                    <button disabled={isDisabled} onClick={onPrev} className={isDisabled ? 'text-gray-600' : ''}><SkipBackIcon className="w-6 h-6" /></button>
                 </div>
                 <div className="w-full flex items-center gap-2 text-xs text-gray-400 font-mono" dir="ltr">
                    <span>{formatTime(currentTime)}</span>
                    <input 
                        type="range" 
                        min={0} 
                        max={duration || 100} 
                        value={currentTime} 
                        disabled={isDisabled}
                        onChange={e => {e.stopPropagation(); onSeek(Number(e.target.value))}} 
                        className="flex-1 h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer accent-white disabled:opacity-50" 
                    />
                    <span>{formatTime(duration)}</span>
                 </div>
            </div>

            <div className="flex items-center justify-end gap-4 flex-1 md:hidden">
                <button disabled={isDisabled} onClick={(e) => {e.stopPropagation(); onPlayPause()}} className={isDisabled ? 'opacity-50' : ''}>{isPlaying ? <PauseIcon className="w-8 h-8" /> : <PlayIcon className="w-8 h-8" />}</button>
            </div>
            
            {/* Desktop Volume Control - Located on the far left (in RTL) and aligned down to match timeline */}
             <div className="hidden md:flex flex-col justify-center flex-1 items-start pl-4" dir="ltr">
                 {/* Invisible spacer to match the Player's button row height + margin (h-6 icon + mb-4 = ~40px) */}
                 <div className="w-full h-6 mb-9 invisible" aria-hidden="true"></div>
                 
                 <div className="flex items-center gap-2">
                     <button onClick={(e) => { e.stopPropagation(); toggleMute(); }} className="text-gray-400 hover:text-white">
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
