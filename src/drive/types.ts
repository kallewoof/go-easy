/**
 * Drive types — agent-friendly shapes.
 * Stub: will be fleshed out during Drive implementation phase.
 */

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size?: number;
  createdTime?: string;
  modifiedTime?: string;
  parents?: string[];
  webViewLink?: string;
  driveId?: string;
  shared?: boolean;
}

export interface DrivePermission {
  id: string;
  type: 'user' | 'group' | 'domain' | 'anyone';
  role: 'owner' | 'organizer' | 'fileOrganizer' | 'writer' | 'commenter' | 'reader';
  emailAddress?: string;
}

export type ExportFormat = 'pdf' | 'docx' | 'xlsx' | 'pptx' | 'csv' | 'txt' | 'html';
