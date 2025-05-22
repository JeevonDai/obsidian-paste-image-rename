import PasteImageRenamePlugin from './main';
import { TFile, TFolder, MarkdownView, Editor, App, Vault, FileManager, MetadataCache, Workspace } from 'obsidian';
import { DEFAULT_SETTINGS } from './settings'; // Assuming DEFAULT_SETTINGS is exported from settings.ts or main.ts
                                          // If not, I'll define a local one for testing.

// Mock TFile and TFolder from our mock file
jest.mock('obsidian', () => require('../../tests/mocks/obsidian'), { virtual: true });


const mockPastedImageName = 'Pasted image 20240101120000.png';
const mockPastedImageExt = 'png';
const mockPastedImageBaseName = 'Pasted image 20240101120000';

describe('PasteImageRenamePlugin - batchRenameAllImages Issue #109', () => {
  let plugin: PasteImageRenamePlugin;
  let mockApp: jest.Mocked<App>;
  let mockEditor: jest.Mocked<Editor>;
  let mockActiveFile: TFile;
  let mockPastedImageFile: TFile;
  let mockAttachmentFolder: TFolder;

  beforeEach(()_ => {
    // ---- Mocks Setup ----
    mockEditor = {
      getValue: jest.fn(),
      setValue: jest.fn(),
      getCursor: jest.fn(() => ({ line: 0, ch: 0 })),
      getLine: jest.fn(() => ''),
      transaction: jest.fn(),
    };

    mockActiveFile = new TFile('notes/中 文 abc.md', '中 文 abc.md', '中 文 abc', 'md', 'notes');
    
    // Assume attachments are in a subfolder "attachments" relative to the note's folder
    // Or, for simplicity, in the same folder as the note. Let's use same folder for now.
    // The plugin's path.join might need careful handling if it assumes absolute paths.
    // For now, let's assume file.parent.path will give the correct directory for newPath.
    mockAttachmentFolder = new TFolder('notes'); 
    mockPastedImageFile = new TFile(
      `notes/${mockPastedImageName}`, 
      mockPastedImageName, 
      mockPastedImageBaseName, 
      mockPastedImageExt,
      'notes' // parent path
    );
    mockPastedImageFile.parent = mockAttachmentFolder;


    const mockFileManager: jest.Mocked<FileManager> = {
      generateMarkdownLink: jest.fn((file, sourcePath) => {
        // @ts-ignore
        const useMarkdown = mockApp.vault.getConfig('useMarkdownLinks');
        if (useMarkdown) {
          // Simulate URI encoding for spaces if Obsidian does that by default for ![]()
          // For this test, we assume the initial link might or might not be encoded.
          // The crucial part is that our plugin correctly *generates* the new encoded link.
          return `![](${file.name.replace(/ /g, '%20')})`; 
        }
        return `![[${file.name}]]`;
      }),
      renameFile: jest.fn().mockResolvedValue(undefined),
    };

    const mockMetadataCache: jest.Mocked<MetadataCache> = {
      getFileCache: jest.fn().mockImplementation((file) => {
        if (file === mockActiveFile) {
          return {
            embeds: [{ link: mockPastedImageFile.name, original: `![[${mockPastedImageFile.name}]]` }], // original might vary
          };
        }
        return null;
      }),
      getFirstLinkpathDest: jest.fn().mockImplementation((linkpath, sourcePath) => {
        if (linkpath === mockPastedImageFile.name && sourcePath === mockActiveFile.path) {
          return mockPastedImageFile;
        }
        return null;
      }),
    } as any; // Cast because some methods might be missing from the manual mock

    const mockVault: jest.Mocked<Vault> = {
      getConfig: jest.fn(),
      // @ts-ignore
      adapter: {
        list: jest.fn().mockResolvedValue({ files: [], folders: [] }), // No duplicates for simplicity
      },
      getResourcePath: jest.fn(file => file.path), // Simplified
      on: jest.fn(),
    } as any; // Cast for missing methods

    const mockWorkspace: jest.Mocked<Workspace> = {
      getActiveViewOfType: jest.fn().mockImplementation((type) => {
        if (type === MarkdownView) {
          return {
            file: mockActiveFile,
            editor: mockEditor,
          } as MarkdownView;
        }
        return null;
      }),
    } as any; // Cast for missing methods

    mockApp = {
      vault: mockVault,
      fileManager: mockFileManager,
      metadataCache: mockMetadataCache,
      workspace: mockWorkspace,
    } as jest.Mocked<App>;

    // --- Plugin Instantiation ---
    // @ts-ignore (obsidian.Plugin takes App and Manifest)
    plugin = new PasteImageRenamePlugin(mockApp, { id: 'test-plugin', version: '0.0.1' } as any);
    plugin.settings = {
      ...DEFAULT_SETTINGS, // Use a local copy or import if accessible
      imageNamePattern: '{{fileName}}', // Key setting for the test
      dupNumberAtStart: false,
      dupNumberDelimiter: '-',
      dupNumberAlways: false,
      autoRename: false,
	    handleAllAttachments: false,
	    excludeExtensionPattern: '',
	    disableRenameNotice: true, // Disable notices for cleaner test output
    };
    
    // Ensure getVaultConfig from utils.ts uses our mockApp
    jest.mock('./utils', () => ({
      ...jest.requireActual('./utils'), // Import and retain default behavior
      getVaultConfig: jest.fn((app) => { // Mock getVaultConfig specifically
        // @ts-ignore
        return { useMarkdownLinks: app.vault.getConfig('useMarkdownLinks') };
      }),
      // escapeRegExp is used, ensure it's the real one
    }));
  });

  afterEach(() => {
    jest.resetAllMocks();
    jest.restoreAllMocks(); // Restore original implementations if any were spied on globally
  });

  test('should correctly rename and update Markdown links for filenames with CJK chars and spaces', async () => {
    mockApp.vault.getConfig.mockImplementation((key) => key === 'useMarkdownLinks' ? true : undefined);
    
    // Even if Obsidian generates `Pasted%20image...png`, our oldLinkText logic should find it if editor has `Pasted image...png`
    // Let's assume editor has the non-encoded version for `oldLinkText` generation simplicity test
    // The critical part is the *new* link text encoding
    mockEditor.getValue.mockReturnValue(`Some text ![](${mockPastedImageName}) more text`);
    // Mock fileManager.generateMarkdownLink to return the same non-encoded for oldLinkText matching
     mockApp.fileManager.generateMarkdownLink.mockImplementation((file, sourcePath) => `![](${file.name})`);


    await plugin.batchRenameAllImages();

    const expectedNewFileName = `${mockActiveFile.basename}.${mockPastedImageExt}`; // "中 文 abc.png"
    const expectedEncodedNewLink = `![](${encodeURIComponent(expectedNewFileName)})`; // "![](%E4%B8%AD%20%E6%96%87%20abc.png)"
    
    expect(mockEditor.setValue).toHaveBeenCalledTimes(1);
    expect(mockEditor.setValue).toHaveBeenCalledWith(
      `Some text ${expectedEncodedNewLink} more text`
    );

    expect(mockApp.fileManager.renameFile).toHaveBeenCalledTimes(1);
    expect(mockApp.fileManager.renameFile).toHaveBeenCalledWith(
      mockPastedImageFile,
      `${mockPastedImageFile.parent.path}/${expectedNewFileName}` // "notes/中 文 abc.png"
    );
  });

  test('should correctly rename and update Wikilinks for filenames with CJK chars and spaces', async () => {
    mockApp.vault.getConfig.mockImplementation((key) => key === 'useMarkdownLinks' ? false : undefined);
    mockEditor.getValue.mockReturnValue(`Some text ![[${mockPastedImageName}]] more text`);
    // Mock fileManager.generateMarkdownLink for Wikilink style
    mockApp.fileManager.generateMarkdownLink.mockImplementation((file, sourcePath) => `![[${file.name}]]`);


    await plugin.batchRenameAllImages();

    const expectedNewFileName = `${mockActiveFile.basename}.${mockPastedImageExt}`; // "中 文 abc.png"
    const expectedNewLink = `![[${expectedNewFileName}]]`; // "![[中 文 abc.png]]"

    expect(mockEditor.setValue).toHaveBeenCalledTimes(1);
    expect(mockEditor.setValue).toHaveBeenCalledWith(
      `Some text ${expectedNewLink} more text`
    );
    
    expect(mockApp.fileManager.renameFile).toHaveBeenCalledTimes(1);
    expect(mockApp.fileManager.renameFile).toHaveBeenCalledWith(
      mockPastedImageFile,
      `${mockPastedImageFile.parent.path}/${expectedNewFileName}` // "notes/中 文 abc.png"
    );
  });

  // Test for deduplication (e.g., "中 文 abc-1.png")
  test('should correctly handle deduplication in Markdown links', async () => {
    mockApp.vault.getConfig.mockImplementation((key) => key === 'useMarkdownLinks' ? true : undefined);
    mockEditor.getValue.mockReturnValue(`Some text ![](${mockPastedImageName}) more text`);
    mockApp.fileManager.generateMarkdownLink.mockImplementation((file, sourcePath) => `![](${file.name})`);

    // Simulate that "中 文 abc.png" already exists
    const existingFileName = `${mockActiveFile.basename}.${mockPastedImageExt}`;
    mockApp.vault.adapter.list.mockResolvedValue({ files: [`notes/${existingFileName}`], folders: [] });

    await plugin.batchRenameAllImages();

    const expectedNewFileNameWithDup = `${mockActiveFile.basename}${plugin.settings.dupNumberDelimiter}1.${mockPastedImageExt}`; // "中 文 abc-1.png"
    const expectedEncodedNewLinkWithDup = `![](${encodeURIComponent(expectedNewFileNameWithDup)})`;
    
    expect(mockEditor.setValue).toHaveBeenCalledWith(
      `Some text ${expectedEncodedNewLinkWithDup} more text`
    );
    expect(mockApp.fileManager.renameFile).toHaveBeenCalledWith(
      mockPastedImageFile,
      `${mockPastedImageFile.parent.path}/${expectedNewFileNameWithDup}`
    );
  });
});

// Minimal DEFAULT_SETTINGS if not exportable from plugin
const DEFAULT_SETTINGS_LOCAL = {
	imageNamePattern: '{{fileName}}',
	dupNumberAtStart: false,
	dupNumberDelimiter: '-',
	dupNumberAlways: false,
	autoRename: false,
	handleAllAttachments: false,
	excludeExtensionPattern: '',
	disableRenameNotice: false,
};
// If DEFAULT_SETTINGS is exported from 'main.ts' or a 'settings.ts', use that import.
// Otherwise, ensure PasteImageRenamePlugin initializes its settings or use this local one.
// The plugin code shows it's assigned in loadSettings, but for tests, we set it directly.

// Need to ensure that `path.join` used by the plugin is available.
// The plugin imports it from './utils'. If that's a custom `path.join`,
// it should work fine. Standard node `path` is not available in Obsidian plugins directly.
// The `utils.ts` seems to provide its own `path.join` and `path.basename`, etc.
// These should be fine as long as they are correctly imported and used by the plugin.
// The mock for `getVaultConfig` also needs to be correctly in place.

// The `escapeRegExp` from `utils.ts` is also used.
// The mock `jest.mock('./utils', ...)` should handle this by re-exporting the actual utils.
