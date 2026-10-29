export type ResultGroupType = 'folder' | 'block';

export interface ResultGroupingInput {
  collectionName?: string;
  folderPath?: string;
  blockLabel?: string;
}

export interface ResultGrouping {
  groupPath: string;
  groupType?: ResultGroupType;
}

/**
 * Normalize how grouped results are labeled across extension, CLI, and MCP.
 *
 * Block labels always win. Otherwise, the group path is collection name plus
 * folder path so the same folder name in different collections never merges.
 */
export function resolveResultGrouping(input: ResultGroupingInput): ResultGrouping {
  const blockLabel = typeof input.blockLabel === 'string' ? input.blockLabel.trim() : '';
  if (blockLabel) {
    return { groupPath: blockLabel, groupType: 'block' };
  }

  const collectionName = typeof input.collectionName === 'string' ? input.collectionName.trim() : '';
  const folderPath = typeof input.folderPath === 'string' ? input.folderPath.trim() : '';

  if (collectionName) {
    return {
      groupPath: folderPath ? `${collectionName}/${folderPath}` : collectionName,
      groupType: 'folder'
    };
  }

  return {
    groupPath: folderPath,
    groupType: folderPath ? 'folder' : undefined
  };
}