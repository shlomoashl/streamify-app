
import React, { useEffect, useState, useRef } from 'react';
import { logger, LogEntry } from '../Logger';
import { XIcon, TrashIcon, CopyIcon } from './Icons';

interface LogViewerProps {
    onClose: () => void;
}

const LogViewer: React.FC<LogViewerProps> = ({ onClose }) => {
    const [logs, setLogs] = useState<LogEntry[]>([]);
    const endRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        return logger.subscribe((newLogs) => {
            setLogs([...newLogs]);
        });
    }, []);

    useEffect(() => {
        endRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [logs]);

    const handleCopy = () => {
        const text = logs.map(l => `[${l.timestamp}] [${l.level.toUpperCase()}] ${l.message}`).join('\n');
        navigator.clipboard.writeText(text).then(() => alert('הלוגים הועתקו!'));
    };

    return (
        <div className="fixed inset-0 bg-black/90 z-[100] flex flex-col font-mono text-sm" dir="ltr">
            <div className="flex items-center justify-between p-3 bg-neutral-800 border-b border-white/10">
                <div className="font-bold text-white flex items-center gap-2">
                    <span className="text-green-500">➜</span> System Logs
                </div>
                <div className="flex gap-4">
                    <button onClick={handleCopy} className="text-gray-400 hover:text-white" title="Copy">
                        <CopyIcon className="w-5 h-5" />
                    </button>
                    <button onClick={() => logger.clear()} className="text-gray-400 hover:text-red-500" title="Clear">
                        <TrashIcon className="w-5 h-5" />
                    </button>
                    <button onClick={onClose} className="text-gray-400 hover:text-white" title="Close">
                        <XIcon className="w-6 h-6" />
                    </button>
                </div>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-1">
                {logs.length === 0 && <div className="text-gray-500 text-center mt-10">No logs yet...</div>}
                {logs.map((log, i) => (
                    <div key={i} className="flex gap-2 break-all">
                        <span className="text-gray-500 whitespace-nowrap">[{log.timestamp}]</span>
                        <span className={`uppercase font-bold text-xs w-12 shrink-0 ${
                            log.level === 'error' ? 'text-red-500' : 
                            log.level === 'warn' ? 'text-yellow-500' : 'text-blue-400'
                        }`}>
                            {log.level}
                        </span>
                        <span className={log.level === 'error' ? 'text-red-200' : 'text-gray-300'}>
                            {log.message}
                        </span>
                    </div>
                ))}
                <div ref={endRef} />
            </div>
        </div>
    );
};

export default LogViewer;
