import * as vscode from 'vscode';
import { XMindDocument } from './XMindDocument';
import { disposeAll } from './dispose';
import { getNonce } from './util';

/**
 * Provider for XMind editors.
 */
export class XMindEditorProvider implements vscode.CustomEditorProvider<XMindDocument> {

    public static register(context: vscode.ExtensionContext): vscode.Disposable {
        const provider = new XMindEditorProvider(context);
        const providerRegistration = vscode.window.registerCustomEditorProvider(XMindEditorProvider.viewType, provider, {
            webviewOptions: {
                retainContextWhenHidden: true,
            },
            supportsMultipleEditorsPerDocument: false,
        });

        // Register export commands
        context.subscriptions.push(
            vscode.commands.registerCommand('xmind.exportPNG', (uri?: vscode.Uri) => provider.triggerExport('png', uri)),
            vscode.commands.registerCommand('xmind.exportSVG', (uri?: vscode.Uri) => provider.triggerExport('svg', uri)),
            vscode.commands.registerCommand('xmind.exportMarkdown', (uri?: vscode.Uri) => provider.triggerExport('md', uri))
        );

        return providerRegistration;
    }

    private static readonly viewType = 'vscode-xmind-viewer.xmindEditor';

    /**
     * Tracks all known webviews
     */
    private readonly webviews = new WebviewCollection();

    constructor(
        private readonly context: vscode.ExtensionContext
    ) { }

    //#region CustomEditorProvider

    async openCustomDocument(
        uri: vscode.Uri,
        openContext: { backupId?: string },
        _token: vscode.CancellationToken
    ): Promise<XMindDocument> {
        const document = await XMindDocument.create(uri, openContext.backupId, {
            getFileData: async () => {
                const webviewsForDocument = Array.from(this.webviews.get(document.uri));
                if (!webviewsForDocument.length) {
                    throw new Error('Could not find webview to save for');
                }
                const panel = webviewsForDocument[0];
                const response = await this.postMessageWithResponse<number[]>(panel, 'getFileData', {});
                return new Uint8Array(response);
            },
            undo: async () => {
                for (const panel of this.webviews.get(document.uri)) {
                    this.postMessage(panel, 'undo', {});
                }
            },
            redo: async () => {
                for (const panel of this.webviews.get(document.uri)) {
                    this.postMessage(panel, 'redo', {});
                }
            }
        });

        const listeners: vscode.Disposable[] = [];

        listeners.push(document.onDidChange(e => {
            // Propagate document changes to VS Code (dirty state)
            this._onDidChangeCustomDocument.fire({
                document,
                ...e,
            });
        }));

        listeners.push(document.onDidChangeContent(e => {
            // Propagate external file changes to the webview
            for (const webviewPanel of this.webviews.get(document.uri)) {
                this.postMessage(webviewPanel, 'update', {
                    data: Array.from(e.content ?? new Uint8Array())
                });
            }
        }));

        listeners.push(vscode.window.onDidChangeActiveColorTheme(e => {
            for (const panel of this.webviews.get(uri)) {
                this.postMessage(panel, 'theme-change', {
                    kind: e.kind
                });
            }
        }));

        document.onDidDispose(() => disposeAll(listeners));

        return document;
    }

    async resolveCustomEditor(
        document: XMindDocument,
        webviewPanel: vscode.WebviewPanel,
        _token: vscode.CancellationToken
    ): Promise<void> {
        // Add the webview to our internal set of active webviews
        this.webviews.add(document.uri, webviewPanel);

        // Setup initial options
        webviewPanel.webview.options = {
            enableScripts: true,
        };

        // Attach listeners BEFORE setting the HTML to avoid missing the 'ready' message
        webviewPanel.webview.onDidReceiveMessage(e => this.onMessage(document, e));

        webviewPanel.webview.onDidReceiveMessage(e => {
            if (e.type === 'ready') {
                const data = document.documentData;
                this.postMessage(webviewPanel, 'update', {
                    data: Array.from(data)
                });
            }
        });

        webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview);
    }

    private readonly _onDidChangeCustomDocument = new vscode.EventEmitter<vscode.CustomDocumentEditEvent<XMindDocument>>();
    public readonly onDidChangeCustomDocument = this._onDidChangeCustomDocument.event;

    public saveCustomDocument(document: XMindDocument, cancellation: vscode.CancellationToken): Thenable<void> {
        return document.save(cancellation);
    }

    public saveCustomDocumentAs(document: XMindDocument, destination: vscode.Uri, cancellation: vscode.CancellationToken): Thenable<void> {
        return document.saveAs(destination, cancellation);
    }

    public revertCustomDocument(document: XMindDocument, cancellation: vscode.CancellationToken): Thenable<void> {
        return document.revert(cancellation);
    }

    public backupCustomDocument(document: XMindDocument, context: vscode.CustomDocumentBackupContext, cancellation: vscode.CancellationToken): Thenable<vscode.CustomDocumentBackup> {
        return document.backup(context.destination, cancellation);
    }

    //#endregion

    private _requestIdPool = 0;
    private _callbacks = new Map<number, (response: any) => void>();

    private postMessage(panel: vscode.WebviewPanel, type: string, body: any): void {
        panel.webview.postMessage({ type, body });
    }

    private triggerExport(type: string, uri?: vscode.Uri) {
        let activePanel: vscode.WebviewPanel | undefined;

        // Priority 0: Try to find panel by URI (passed from command context)
        if (uri && uri instanceof vscode.Uri) {
            const panels = Array.from(this.webviews.get(uri));
            if (panels.length > 0) {
                // Pick the active or visible one first, otherwise just the first one
                activePanel = panels.find(p => p.active) || panels.find(p => p.visible) || panels[0];
            }
        }

        if (!activePanel) {
            activePanel = this.webviews.activePanel;
        }

        if (activePanel) {
            this.postMessage(activePanel, 'export', { type }); // Send to webview to trigger export logic
        } else {
            vscode.window.showErrorMessage('No active XMind editor found.');
        }
    }



    private postMessageWithResponse<R = any>(panel: vscode.WebviewPanel, type: string, body: any): Promise<R> {
        const requestId = this._requestIdPool++;
        const p = new Promise<R>(resolve => {
            this._callbacks.set(requestId, resolve);
        });
        panel.webview.postMessage({ type, requestId, body });
        return p;
    }

    private onMessage(document: XMindDocument, message: any) {
        switch (message.type) {
            case 'edit':
                document.makeEdit();
                break;
            case 'undo':
            case 'redo':
                // For now, these are handled via webview postMessage initiated from HTML buttons
                // If we want to support VS Code side undo, we'd need to forward this to all webviews
                for (const panel of this.webviews.get(document.uri)) {
                    this.postMessage(panel, message.type, {});
                }
                break;
            case 'response':
                const callback = this._callbacks.get(message.requestId);
                callback?.(message.body);
                return;
            case 'save-export':
                this.handleSaveExport(document, message.body);
                break;
            case 'error':
                vscode.window.showErrorMessage(message.body);
                break;
        }
    }

    private async handleSaveExport(document: XMindDocument, data: { content: string, type: string, filename: string }) {
        let defaultUri: vscode.Uri;
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
        if (workspaceFolder) {
            defaultUri = vscode.Uri.joinPath(workspaceFolder.uri, data.filename);
        } else {
            // Fallback: directory of the current file
            defaultUri = vscode.Uri.joinPath(document.uri, '..', data.filename);
        }

        const options: vscode.SaveDialogOptions = {
            defaultUri: defaultUri,
            filters: {}
        };
        if (data.type === 'png') options.filters!['Images'] = ['png'];
        if (data.type === 'svg') options.filters!['SVG'] = ['svg'];
        if (data.type === 'md') options.filters!['Markdown'] = ['md'];

        const uri = await vscode.window.showSaveDialog(options);
        if (uri) {
            let buffer: Uint8Array;
            if (data.type === 'png') {
                const base64Data = data.content.split(',')[1];
                buffer = Buffer.from(base64Data, 'base64');
            } else {
                buffer = Buffer.from(data.content, 'utf8');
            }
            await vscode.workspace.fs.writeFile(uri, buffer);
            vscode.window.showInformationMessage(`Successfully exported to ${uri.fsPath}`);
        }
    }

    private getHtmlForWebview(webview: vscode.Webview): string {
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview.js'));
        const nonce = getNonce();

        return `
			<!DOCTYPE html>
			<html lang="en">
			<head>
				<meta charset="UTF-8">
				<meta name="viewport" content="width=device-width, initial-scale=1.0">
				<title>XMind Viewer</title>
                <style>
                    html, body { 
                        margin: 0; 
                        padding: 0; 
                        width: 100%; 
                        height: 100%; 
                        overflow: hidden; 
                        background-color: #fff; 
                        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
                        display: flex;
                        flex-direction: column;
                    }
                    .vscode-dark, .vscode-dark body {
                        background-color: #1e1e1e;
                        color: #ccc;
                    }
                    #mindmap { 
                        flex: 1;
                        width: 100%; 
                        height: 0;
                        position: relative;
                        background: #fff;
                    }
                    .vscode-dark #mindmap {
                        background: #1e1e1e;
                    }
                    #tab-container {
                        flex-shrink: 0;
                        height: 34px; /* Slightly slimmer */
                        background: #f8f8f8;
                        border-top: 1px solid #ddd;
                        display: flex;
                        align-items: center;
                        padding: 0 12px;
                        overflow: hidden;
                        z-index: 100;
                        justify-content: space-between;
                        box-shadow: 0 -2px 5px rgba(0,0,0,0.05);
                    }
                    #history-controls, #controls {
                        display: flex;
                        align-items: center;
                        gap: 6px;
                        flex-shrink: 0;
                    }
                    #history-controls button, #controls button {
                        background: transparent;
                        border: 1px solid transparent;
                        border-radius: 4px;
                        padding: 4px;
                        cursor: pointer;
                        font-size: 16px;
                        line-height: 1;
                        transition: all 0.2s;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        color: #666;
                    }
                    #history-controls button:hover, #controls button:hover {
                        background: #eee;
                        border-color: #ccc;
                        color: #333;
                    }
                    #tabs-wrapper { 
                        flex-grow: 1;
                        display: flex;
                        align-items: center;
                        height: 100%;
                        overflow-x: auto;
                        -webkit-overflow-scrolling: touch;
                        margin: 0 15px;
                    }
                    #tabs-wrapper::-webkit-scrollbar { display: none; }
                    .tab { 
                        padding: 4px 12px; 
                        margin-right: 4px; 
                        cursor: pointer; 
                        font-size: 11px; 
                        color: #666; 
                        background: #ececec;
                        border: 1px solid #ddd;
                        border-bottom: none;
                        border-radius: 4px 4px 0 0;
                        white-space: nowrap;
                        transition: all 0.2s;
                        align-self: flex-end;
                        display: flex;
                        align-items: center;
                        gap: 8px;
                        max-width: 140px; /* Limit width */
                    }
                    .tab span {
                        overflow: hidden;
                        text-overflow: ellipsis;
                        white-space: nowrap;
                    }
                    .tab-close {
                        font-size: 12px;
                        color: #aaa;
                        border-radius: 50%;
                        width: 14px;
                        height: 14px;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        line-height: 1;
                        opacity: 0.6;
                        transition: all 0.2s;
                    }
                    .tab-close:hover {
                        background: #ff4d4f;
                        color: #fff;
                        opacity: 1;
                    }
                    .tab.active { 
                        background: #fff; 
                        color: #000; 
                        font-weight: 600;
                        position: relative;
                        top: 1px;
                        border-bottom: 2px solid #fff;
                        box-shadow: 0 -2px 4px rgba(0,0,0,0.03);
                    }
                    select {
                        background: #fff;
                        border: 1px solid #ddd;
                        border-radius: 4px;
                        font-size: 11px;
                        padding: 2px 4px;
                        outline: none;
                        color: #666;
                    }
                    .export-dropdown {
                        position: relative;
                        display: inline-block;
                    }
                    .dropdown-content {
                        display: none;
                        position: absolute;
                        right: 0;
                        bottom: 40px;
                        background-color: #f9f9f9;
                        min-width: 130px;
                        box-shadow: 0px 8px 16px 0px rgba(0,0,0,0.2);
                        z-index: 1000;
                        border-radius: 4px;
                        overflow: hidden;
                    }
                    .vscode-dark .dropdown-content {
                        background-color: #2d2d2d;
                        box-shadow: 0px 8px 16px 0px rgba(0,0,0,0.5);
                    }
                    .dropdown-content a {
                        color: #333;
                        padding: 8px 12px;
                        text-decoration: none;
                        display: block;
                        font-size: 12px;
                    }
                    .vscode-dark .dropdown-content a { color: #ccc; }
                    .dropdown-content a:hover { background-color: #eee; }
                    .vscode-dark .dropdown-content a:hover { background-color: #3e3e3e; }
                    .export-dropdown.open .dropdown-content { display: block; }
                    /* 暗色模式样式 - Sheet 栏 */
                    .vscode-dark #tab-container {
                        background: #252526;
                        border-top-color: #3c3c3c;
                        box-shadow: 0 -2px 5px rgba(0,0,0,0.2);
                    }
                    .vscode-dark #history-controls button, .vscode-dark #controls button {
                        color: #ccc;
                    }
                    .vscode-dark #history-controls button:hover, .vscode-dark #controls button:hover {
                        background: #3c3c3c;
                        border-color: #555;
                        color: #fff;
                    }
                    .vscode-dark .tab {
                        background: #333 !important;
                        color: #aaa !important;
                        border-color: #444 !important;
                    }
                    .vscode-dark .tab.active {
                        background: #1e1e1e !important;
                        color: #e0e0e0 !important;
                        border-bottom-color: #1e1e1e !important;
                    }
                    .vscode-dark .tab-close {
                        color: #888;
                    }
                    .vscode-dark select {
                        background: #3c3c3c;
                        border-color: #555;
                        color: #ccc;
                    }

                </style>
			</head>
			<body class="${vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Dark || vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.HighContrast ? 'vscode-dark' : 'vscode-light'}">
				<div id="mindmap"></div>
                <div id="tab-container"></div>
				<script nonce="${nonce}" src="${scriptUri}"></script>
			</body>
			</html>`;
    }
}

/**
 * Tracks all webviews.
 */
class WebviewCollection {
    private readonly _webviews = new Set<{ readonly resource: string; readonly webviewPanel: vscode.WebviewPanel; }>();

    public *get(uri: vscode.Uri): Iterable<vscode.WebviewPanel> {
        const key = uri.toString();
        for (const entry of this._webviews) {
            if (entry.resource === key) {
                yield entry.webviewPanel;
            }
        }
    }

    public add(uri: vscode.Uri, webviewPanel: vscode.WebviewPanel) {
        const entry = { resource: uri.toString(), webviewPanel };
        this._webviews.add(entry);

        webviewPanel.onDidDispose(() => {
            this._webviews.delete(entry);
        });
    }

    public get activePanel(): vscode.WebviewPanel | undefined {
        const entries = Array.from(this._webviews);
        // Priority 1: Strictly active panel
        const activeEntry = entries.find(entry => entry.webviewPanel.active);
        if (activeEntry) {
            return activeEntry.webviewPanel;
        }

        // Priority 2: If only one panel is visible, assume it's the target (handles focus loss cases)
        const visibleEntries = entries.filter(entry => entry.webviewPanel.visible);
        if (visibleEntries.length === 1) {
            return visibleEntries[0].webviewPanel;
        }

        // Priority 3: Fallback - if there is only one webview in total, us it.
        // This covers cases where the user clicked a command from the title bar (stealing focus)
        // and VS Code hasn't updated the active/visible state yet, or for single-file users.
        if (entries.length === 1) {
            return entries[0].webviewPanel;
        }

        return undefined;
    }
}
