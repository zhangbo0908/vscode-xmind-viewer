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

        // Setup initial content for the webview
        webviewPanel.webview.options = {
            enableScripts: true,
        };
        webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview);

        webviewPanel.webview.onDidReceiveMessage(e => this.onMessage(document, e));

        // Wait for the webview to be properly ready before sending the document data
        webviewPanel.webview.onDidReceiveMessage(e => {
            if (e.type === 'ready') {
                this.postMessage(webviewPanel, 'update', {
                    data: Array.from(document.documentData)
                });
            }
        });
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
                        height: 0; /* Important for flex-grow to work correctly */
                    }
                    #tab-container { 
                        flex-shrink: 0;
                        height: 36px; 
                        background: #f0f0f0; 
                        border-top: 1px solid #ccc; 
                        display: flex; 
                        align-items: flex-end; 
                        padding: 0 10px;
                        overflow-x: auto;
                        z-index: 100;
                    }
                    .tab { 
                        padding: 4px 12px; 
                        margin-right: 2px; 
                        cursor: pointer; 
                        font-size: 12px; 
                        color: #555; 
                        background: #e1e1e1;
                        border: 1px solid #ccc;
                        border-bottom: none;
                        border-radius: 4px 4px 0 0;
                        white-space: nowrap;
                        transition: background 0.2s;
                    }
                    .tab.active { 
                        background: #fff; 
                        color: #000; 
                        font-weight: 600;
                        position: relative;
                        top: 1px; /* Overlap the border-top of container */
                    }
                    .tab:hover { background: #d0d0d0; }
                    .tab.active:hover { background: #fff; }
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
