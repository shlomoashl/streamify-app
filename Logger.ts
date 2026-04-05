
export type LogLevel = 'info' | 'warn' | 'error';

export interface LogEntry {
    timestamp: string;
    level: LogLevel;
    message: string;
}

class LogManager {
    private logs: LogEntry[] = [];
    private listeners: ((logs: LogEntry[]) => void)[] = [];
    private isInitialized = false;
    private originalConsole = {
        log: console.log,
        warn: console.warn,
        error: console.error
    };

    init() {
        if (this.isInitialized) return;

        const formatArgs = (args: any[]) => {
            return args.map(arg => {
                if (typeof arg === 'object') {
                    try {
                        return JSON.stringify(arg);
                    } catch {
                        return String(arg);
                    }
                }
                return String(arg);
            }).join(' ');
        };

        console.log = (...args) => {
            // Filter out 'info' logs from the viewer per user request
            // this.addLog('info', formatArgs(args)); 
            this.originalConsole.log(...args);
        };

        console.warn = (...args) => {
            this.addLog('warn', formatArgs(args));
            this.originalConsole.warn(...args);
        };

        console.error = (...args) => {
            this.addLog('error', formatArgs(args));
            this.originalConsole.error(...args);
        };

        this.isInitialized = true;
        this.addLog('info', 'Logger initialized successfully');
    }

    private addLog(level: LogLevel, message: string) {
        const entry: LogEntry = {
            timestamp: new Date().toLocaleTimeString(),
            level,
            message
        };
        this.logs.push(entry);
        if (this.logs.length > 1000) this.logs.shift(); // Keep last 1000 logs
        this.notify();
    }

    subscribe(listener: (logs: LogEntry[]) => void) {
        this.listeners.push(listener);
        listener(this.logs);
        return () => {
            this.listeners = this.listeners.filter(l => l !== listener);
        };
    }

    private notify() {
        this.listeners.forEach(l => l(this.logs));
    }

    getLogs() {
        return this.logs;
    }

    clear() {
        this.logs = [];
        this.notify();
    }
}

export const logger = new LogManager();