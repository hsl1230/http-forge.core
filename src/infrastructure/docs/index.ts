/**
 * Docs module barrel (Layer 6 — docs as a BYPRODUCT of drift).
 */

export {
  generateReleaseNotes,
  renderReleaseNotesMarkdown,
} from './release-notes';
export type {
  ReleaseNoteEntry,
  ReleaseNotes,
  ReleaseNotesOptions,
  ReleaseNoteType,
} from './release-notes';
