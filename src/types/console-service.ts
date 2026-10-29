/**
 * Console Service Interface
 * 
 * Platform-agnostic logging abstraction.
 * VS Code extension implements this with an Output Channel.
 * Standalone / CLI can implement with stdout or a file logger.
 */

/**
 * Log levels for console output
 */
export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error';

/**
 * Log entry with metadata
 */
export interface LogEntry {
    timestamp: Date;
    level: LogLevel;
    message: string;
    source?: string;
    context?: Record<string, unknown>;
}

/**
 * Console service interface for unified logging
 */
export interface IConsoleService {
    log(level: LogLevel, message: string, source?: string): void;

    trace(message: string, source?: string): void;
    debug(message: string, source?: string): void;
    info(message: string, source?: string): void;
    warn(message: string, source?: string): void;
    error(message: string, source?: string): void;

    logBatch(entries: Array<{ level: LogLevel; message: string }>, source?: string): void;
    logRawLines(lines: string[], source?: string): void;

    show(preserveFocus?: boolean): void;
    clear(): void;
    dispose(): void;
}
