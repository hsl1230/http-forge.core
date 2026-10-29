/**
 * Collection Loader Factory
 *
 * Factory Pattern: Creates appropriate loader based on configuration
 */

import { IConfigService } from '../config';
import { ICollectionStore } from './collection-store';
import { FolderCollectionStore } from './folder-collection-store';
import { JsonCollectionLoader } from './json-collection-loader';

/**
 * Factory for creating collection loaders
 */
export class CollectionLoaderFactory {
    /**
     * Create a collection loader based on configuration
     */
    static create(configService: IConfigService): ICollectionStore {
        const storageConfig = configService.getStorageConfig();
        const collectionsPath = configService.getCollectionsPath();

        if (storageConfig.format === 'folder') {
            return new FolderCollectionStore(collectionsPath);
        } else {
            return new JsonCollectionLoader(collectionsPath);
        }
    }

    /**
     * Create a loader for a specific format
     */
    static createForFormat(format: 'folder' | 'json', collectionsPath: string): ICollectionStore {
        if (format === 'folder') {
            return new FolderCollectionStore(collectionsPath);
        } else {
            return new JsonCollectionLoader(collectionsPath);
        }
    }
}
