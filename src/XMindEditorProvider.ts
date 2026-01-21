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
                    #mindmap { 
                        flex: 1;
                        width: 100%; 
                        height: 0;
                        position: relative;
                        background: #fff;
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
                    .tab:hover:not(.active) { background: #f0f0f0; }
                    select {
                        background: #fff;
                        border: 1px solid #ddd;
                        border-radius: 4px;
                        font-size: 11px;
                        padding: 2px 4px;
                        outline: none;
                        color: #666;
                    }
                </style>
			</head>
			<body>
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
}
