/**
 * Node.js Platform Adapters
 * 
 * Implementations of platform abstractions for Node.js environments.
 * Used by CLI and external third-party Node apps that don't have VS Code context.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { IDisposable, IFileWatcher, IFileWatcherFactory, IKeyValueStore, INotificationService } from '../types/platform';

// ============================================================
// File Watcher
// ============================================================

class NodeFileWatcher implements IFileWatcher {
  private watchers: fs.FSWatcher[] = [];
  private changeCallbacks: Array<(uri: string) => void> = [];
  private createCallbacks: Array<(uri: string) => void> = [];
  private deleteCallbacks: Array<(uri: string) => void> = [];
  /** Tracks paths known to exist so we can distinguish create vs. change. */
  private knownPaths = new Set<string>();
  /** Coalesces the duplicate events fs.watch commonly emits for a single edit. */
  private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private matcher: (fullPath: string) => boolean = () => true;

  constructor(basePath: string, glob: string) {
    // File watcher backed by Node.js fs.watch. fs.watch cannot watch a
    // not-yet-existing file, so for a specific-file glob we watch the parent
    // directory (which usually already exists) and filter by path. This lets
    // us also observe create/delete of the target file.
    const target = this.resolveWatchTarget(basePath, glob);
    this.matcher = target.matcher;

    try {
      const watcher = fs.watch(
        target.watchPath,
        { recursive: target.recursive },
        (_eventType, filename) => {
          if (!filename) {
            return;
          }
          const rel = typeof filename === 'string' ? filename : String(filename);
          const fullPath = path.resolve(target.watchPath, rel);
          if (!this.matcher(fullPath)) {
            return;
          }
          this.scheduleEvent(fullPath);
        }
      );
      this.watchers.push(watcher);
    } catch (err) {
      // Watch target doesn't exist yet; watcher will be unavailable.
    }
  }

  /**
   * Translate a (base, glob) pair into a concrete watch target: which path to
   * hand to fs.watch, whether to watch recursively, and a matcher that decides
   * whether a changed path is relevant.
   */
  private resolveWatchTarget(
    base: string,
    glob: string
  ): { watchPath: string; recursive: boolean; matcher: (fullPath: string) => boolean } {
    if (glob.includes('*')) {
      // Directory glob such as "**/*" or "**/*.json".
      const recursive = glob.includes('**');
      const extMatch = glob.match(/\*\.([A-Za-z0-9]+)$/);
      const ext = extMatch ? extMatch[1].toLowerCase() : null;
      const matcher = ext
        ? (fullPath: string) => fullPath.toLowerCase().endsWith('.' + ext)
        : () => true;
      return { watchPath: base, recursive, matcher };
    }

    // Specific file glob such as ".http-forge/http-forge.config.json".
    const target = path.resolve(base, glob);
    return {
      watchPath: path.dirname(target),
      recursive: false,
      matcher: (fullPath: string) => path.resolve(fullPath) === target,
    };
  }

  private scheduleEvent(fullPath: string): void {
    const existing = this.debounceTimers.get(fullPath);
    if (existing) {
      clearTimeout(existing);
    }
    this.debounceTimers.set(
      fullPath,
      setTimeout(() => {
        this.debounceTimers.delete(fullPath);
        this.emitEvent(fullPath);
      }, 50)
    );
  }

  private emitEvent(fullPath: string): void {
    const exists = fs.existsSync(fullPath);
    if (exists) {
      if (this.knownPaths.has(fullPath)) {
        this.changeCallbacks.forEach((cb) => cb(fullPath));
      } else {
        this.knownPaths.add(fullPath);
        this.createCallbacks.forEach((cb) => cb(fullPath));
      }
    } else {
      this.knownPaths.delete(fullPath);
      this.deleteCallbacks.forEach((cb) => cb(fullPath));
    }
  }

  private register(
    list: Array<(uri: string) => void>,
    callback: (uri: string) => void
  ): IDisposable {
    list.push(callback);
    return {
      dispose: () => {
        const idx = list.indexOf(callback);
        if (idx !== -1) {
          list.splice(idx, 1);
        }
      },
    };
  }

  onDidChange(callback: (uri: string) => void): IDisposable {
    return this.register(this.changeCallbacks, callback);
  }

  onDidCreate(callback: (uri: string) => void): IDisposable {
    return this.register(this.createCallbacks, callback);
  }

  onDidDelete(callback: (uri: string) => void): IDisposable {
    return this.register(this.deleteCallbacks, callback);
  }

  dispose(): void {
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
    for (const watcher of this.watchers) {
      watcher.close();
    }
    this.watchers = [];
    this.changeCallbacks = [];
    this.createCallbacks = [];
    this.deleteCallbacks = [];
    this.knownPaths.clear();
  }
}

export class NodeFileWatcherFactory implements IFileWatcherFactory {
  createFileWatcher(base: string, glob: string): IFileWatcher {
    return new NodeFileWatcher(base, glob);
  }
}

// ============================================================
// Key-Value Store (JSON file-backed)
// ============================================================

export class NodeKeyValueStore implements IKeyValueStore {
  private data: Record<string, unknown> = {};
  private storeFile: string;

  constructor(storePath: string) {
    this.storeFile = storePath;
    this.load();
  }

  private load(): void {
    try {
      if (fs.existsSync(this.storeFile)) {
        const content = fs.readFileSync(this.storeFile, 'utf-8');
        this.data = JSON.parse(content);
      }
    } catch (err) {
      // Ignore load errors, start with empty data
    }
  }

  private save(): void {
    try {
      const dir = path.dirname(this.storeFile);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.storeFile, JSON.stringify(this.data, null, 2), 'utf-8');
    } catch (err) {
      // Silently ignore save errors
    }
  }

  get<T>(key: string, defaultValue?: T): T | undefined {
    const value = this.data[key];
    return value !== undefined ? (value as T) : defaultValue;
  }

  async update(key: string, value: unknown): Promise<void> {
    if (value === undefined) {
      delete this.data[key];
    } else {
      this.data[key] = value;
    }
    this.save();
  }
}

// ============================================================
// Notification Service (console-based)
// ============================================================

export class NodeNotificationService implements INotificationService {
  async showInformation(message: string): Promise<string | undefined> {
    console.log(`[INFO] ${message}`);
    return undefined;
  }

  async showWarning(message: string): Promise<string | undefined> {
    console.warn(`[WARN] ${message}`);
    return undefined;
  }

  async showError(message: string): Promise<string | undefined> {
    console.error(`[ERROR] ${message}`);
    return undefined;
  }
}
