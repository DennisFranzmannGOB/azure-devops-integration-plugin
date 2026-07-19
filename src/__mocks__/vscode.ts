// Minimal vscode module mock for unit testing

class MockUri {
    readonly scheme: string;
    readonly authority: string;
    readonly path: string;
    readonly query: string;
    readonly fragment: string;

    constructor(scheme: string, authority: string, path: string, query: string = '', fragment: string = '') {
        this.scheme = scheme;
        this.authority = authority;
        this.path = path;
        this.query = query;
        this.fragment = fragment;
    }

    with(change: { scheme?: string; authority?: string; path?: string; query?: string; fragment?: string }): MockUri {
        return new MockUri(
            change.scheme ?? this.scheme,
            change.authority ?? this.authority,
            change.path ?? this.path,
            change.query ?? this.query,
            change.fragment ?? this.fragment,
        );
    }

    toString(): string {
        let result = `${this.scheme}://${this.authority}${this.path}`;
        if (this.query) { result += `?${this.query}`; }
        if (this.fragment) { result += `#${this.fragment}`; }
        return result;
    }

    static parse(value: string): MockUri {
        const url = new URL(value);
        return new MockUri(
            url.protocol.replace(':', ''),
            decodeURIComponent(url.hostname),
            url.pathname,
            url.search.replace('?', ''),
        );
    }

    static file(value: string): { fsPath: string } {
        return { fsPath: value };
    }

    static joinPath(base: MockUri, ...pathSegments: string[]): MockUri {
        const path = [base.path.replace(/\/$/, ''), ...pathSegments].join('/');
        return new MockUri(base.scheme, base.authority, path);
    }
}

export const Uri = MockUri;
export class TreeItem {
    label?: string;
    collapsibleState?: TreeItemCollapsibleState;
    description?: string;
    tooltip?: any;
    iconPath?: any;
    contextValue?: string;
    command?: any;
    checkboxState?: TreeItemCheckboxState | { state: TreeItemCheckboxState; tooltip?: string };
    constructor(label?: string, collapsibleState?: TreeItemCollapsibleState) {
        if (typeof label === 'string') { this.label = label; }
        this.collapsibleState = collapsibleState;
    }
}
export enum TreeItemCollapsibleState { None = 0, Collapsed = 1, Expanded = 2 }
export enum TreeItemCheckboxState { Unchecked = 0, Checked = 1 }
export class ThemeIcon { constructor(public id: string, public color?: any) { } }
export class ThemeColor { constructor(public id: string) { } }
export class MarkdownString {
    value: string;
    constructor(value?: string) { this.value = value ?? ''; }
}
export class Range {
    start: { line: number; character: number };
    end: { line: number; character: number };
    constructor(
        public startLine: number,
        public startCharacter: number,
        public endLine: number,
        public endCharacter: number
    ) {
        this.start = { line: startLine, character: startCharacter };
        this.end = { line: endLine, character: endCharacter };
    }
}
export class Selection extends Range { }
export enum TextEditorRevealType { InCenter = 0 }
export class EventEmitter<T = void> {
    private listeners: Array<(e: T) => void> = [];
    fire(data?: T) {
        for (const l of this.listeners) { l(data as T); }
    }
    event = (listener: (e: T) => void): { dispose: () => void } => {
        this.listeners.push(listener);
        return {
            dispose: () => {
                const i = this.listeners.indexOf(listener);
                if (i >= 0) { this.listeners.splice(i, 1); }
            },
        };
    };
    dispose() {
        this.listeners = [];
    }
}
export class TabInputText {
    constructor(public uri: { fsPath: string }) { }
}
export enum ProgressLocation { Notification = 15 }
export enum FileType { File = 0, Directory = 1, SymbolicLink = 64, Unknown = 0 }
export class FileSystemError extends Error {
    static FileNotFound(resource?: { toString?: () => string }): FileSystemError {
        return new FileSystemError(`File not found: ${resource?.toString?.() ?? ''}`.trim());
    }

    static FileNotADirectory(resource?: { toString?: () => string }): FileSystemError {
        return new FileSystemError(`File is not a directory: ${resource?.toString?.() ?? ''}`.trim());
    }

    static NoPermissions(message?: string): FileSystemError {
        return new FileSystemError(message ?? 'No permissions');
    }
}
export class Disposable {
    constructor(private callOnDispose: () => void) { }
    dispose() { this.callOnDispose(); }
}
export class RelativePattern {
    constructor(public base: string, public pattern: string) { }
}
export const window = {
    showErrorMessage: jest.fn(),
    showInformationMessage: jest.fn(),
    showWarningMessage: jest.fn(),
    showInputBox: jest.fn(),
    showQuickPick: jest.fn(),
    showTextDocument: jest.fn(),
    withProgress: jest.fn().mockImplementation(async (_options: unknown, task: () => unknown) => await task()),
    createTreeView: jest.fn().mockImplementation(() => ({
        title: '',
        reveal: jest.fn().mockResolvedValue(undefined),
        onDidChangeCheckboxState: jest.fn().mockReturnValue({ dispose: jest.fn() }),
        onDidChangeSelection: jest.fn().mockReturnValue({ dispose: jest.fn() }),
        dispose: jest.fn(),
    })),
    createStatusBarItem: jest.fn().mockImplementation(() => ({
        text: '',
        tooltip: '',
        command: '',
        show: jest.fn(),
        hide: jest.fn(),
        dispose: jest.fn(),
    })),
    tabGroups: {
        onDidChangeTabs: jest.fn(),
    },
    activeTextEditor: undefined as any,
};
export const StatusBarAlignment = { Left: 1, Right: 2 };
export const ConfigurationTarget = {
    Global: 1,
    Workspace: 2,
    WorkspaceFolder: 3,
};
export const workspace = {
    workspaceFolders: undefined as any,
    textDocuments: [] as any[],
    openTextDocument: jest.fn(),
    onDidOpenTextDocument: jest.fn().mockReturnValue({ dispose: jest.fn() }),
    onDidChangeTextDocument: jest.fn(),
    onDidChangeConfiguration: jest.fn().mockReturnValue({ dispose: jest.fn() }),
    createFileSystemWatcher: jest.fn().mockReturnValue({
        onDidChange: jest.fn(),
        onDidCreate: jest.fn(),
        onDidDelete: jest.fn(),
        dispose: jest.fn(),
    }),
    registerTextDocumentContentProvider: jest.fn().mockReturnValue({ dispose: jest.fn() }),
    registerFileSystemProvider: jest.fn().mockReturnValue({ dispose: jest.fn() }),
    getConfiguration: jest.fn().mockReturnValue({
        get: jest.fn().mockImplementation((_key: string, defaultValue?: unknown) => defaultValue),
        update: jest.fn().mockResolvedValue(undefined),
    }),
    fs: {
        stat: jest.fn(),
    },
};
export const commands = {
    executeCommand: jest.fn(),
    registerCommand: jest.fn().mockImplementation((_command: string, callback: unknown) => callback),
};
export const extensions = {
    getExtension: jest.fn(),
};
export const env = {
    openExternal: jest.fn(),
    clipboard: {
        writeText: jest.fn(),
    },
};
export const authentication = {
    getSession: jest.fn().mockResolvedValue(undefined),
};
export enum CommentThreadCollapsibleState { Collapsed = 0, Expanded = 1 }
export enum CommentMode { Preview = 0, Editing = 1 }
export const comments = {
    createCommentController: jest.fn().mockImplementation(() => ({
        set commentingRangeProvider(_: unknown) { },
        createCommentThread: jest.fn().mockImplementation((_uri: unknown, _range: unknown, c: unknown) => ({
            uri: _uri,
            range: _range,
            comments: c,
            canReply: false,
            label: undefined as string | undefined,
            collapsibleState: CommentThreadCollapsibleState.Expanded,
            contextValue: undefined as string | undefined,
            dispose: jest.fn(),
        })),
        dispose: jest.fn(),
    })),
};
