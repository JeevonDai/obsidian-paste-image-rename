// tests/mocks/obsidian.ts

// Basic TFile mock
export class TFile {
  path: string;
  name: string;
  basename: string;
  extension: string;
  parent: TFolder | null; // Simplified parent
  stat: {
    ctime: number;
    mtime: number;
    size: number;
  };

  constructor(path = '', name = '', basename = '', extension = '', parentPath = '') {
    this.path = path;
    this.name = name;
    this.basename = basename;
    this.extension = extension;
    this.parent = new TFolder(parentPath); // Assign a TFolder mock
    this.stat = { ctime: Date.now(), mtime: Date.now(), size: 100 };
  }
}

// Basic TFolder mock
export class TFolder {
  path: string;
  name: string;
  children: (TFile | TFolder)[];
  parent: TFolder | null; // Simplified parent
  isRoot: () => boolean;

  constructor(path = '', name = '') {
    this.path = path;
    this.name = name || path.split('/').pop() || '';
    this.children = [];
    this.parent = null; // Simplified
    this.isRoot = () => path === '/';
  }
}


// Other Obsidian classes/objects that might be imported by the plugin
export class Plugin {}
export class Modal {}
export class Notice {}
export class PluginSettingTab {}
export class Setting {}
export class MarkdownView {
  file: TFile | null;
  editor: Editor;

  constructor(file: TFile | null, editor: Editor) {
    this.file = file;
    this.editor = editor;
  }
}

// Minimal Editor mock if not provided by main test
export interface Editor {
  getValue: () => string;
  setValue: (value: string) => void;
  getCursor: () => any;
  getLine: (line: number) => string;
  transaction: (transaction: any) => void;
}

// Minimal App mock if not provided by main test
export interface App {
  vault: Vault;
  fileManager: FileManager;
  metadataCache: MetadataCache;
  workspace: Workspace;
  // Add other app properties/methods if your plugin uses them
}

export interface Vault {
  adapter: any; // For `list`
  getConfig: (key: string) => any;
  getResourcePath: (file: TFile) => string;
  on: (event: string, callback: (...args: any[]) => any) => any;
  // Add other vault properties/methods
}

export interface FileManager {
  generateMarkdownLink: (file: TFile, sourcePath: string, subpath?: string, alias?: string) => string;
  renameFile: (file: TFile, newPath: string) => Promise<void>;
  // Add other fileManager properties/methods
}

export interface MetadataCache {
  getFileCache: (file: TFile) => any; // Returns CachedMetadata
  getFirstLinkpathDest: (linkpath: string, sourcePath: string) => TFile | null;
  // Add other metadataCache properties/methods
}

export interface Workspace {
  getActiveViewOfType: <T>(type: new (...args: any[]) => T) => T | null;
  // Add other workspace properties/methods
}

export const apiVersion = '1.0.0'; // Example API version

// Helper to create a more complete Editor mock
export const createEditorMock = (): Editor => ({
  getValue: jest.fn(),
  setValue: jest.fn(),
  getCursor: jest.fn(() => ({ line: 0, ch: 0 })),
  getLine: jest.fn(() => ''),
  transaction: jest.fn(),
});

// Helper to create a more complete TFile mock
export const createTFileMock = (
  path: string,
  name?: string,
  basename?: string,
  extension?: string,
  parentPath?: string
): TFile => {
  const fileName = name || path.split('/').pop() || 'file.md';
  const fileBasename = basename || fileName.substring(0, fileName.lastIndexOf('.'));
  const fileExtension = extension || fileName.substring(fileName.lastIndexOf('.') + 1);
  const fileParentPath = parentPath || path.substring(0, path.lastIndexOf('/')) || '/';
  
  const file = new TFile(path, fileName, fileBasename, fileExtension, fileParentPath);
  if (file.parent) {
      file.parent.children.push(file); // Add file to parent's children
  }
  return file;
};

// Default export for any wildcard imports if necessary, though named exports are preferred
export default {
  TFile,
  TFolder,
  Plugin,
  Modal,
  Notice,
  PluginSettingTab,
  Setting,
  MarkdownView,
  apiVersion,
  // You might need to add App, Vault, FileManager, MetadataCache, Workspace here if they are directly imported
  // For now, they are interfaces, assuming they'll be mocked in the test file itself.
};
