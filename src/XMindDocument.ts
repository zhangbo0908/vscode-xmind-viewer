import * as vscode from 'vscode';
import { Disposable } from './dispose';

export interface XMindDocumentDelegate {
    getFileData(): Promise<Uint8Array>;
    undo(): Promise<void>;
    redo(): Promise<void>;
}

export class XMindDocument extends Disposable implements vscode.CustomDocument {

    static async create(
        uri: vscode.Uri,
        backupId: string | undefined,
        delegate: XMindDocumentDelegate,
    ): Promise<XMindDocument | PromiseLike<XMindDocument>> {
        const dataFile = typeof backupId === 'string' ? vscode.Uri.parse(backupId) : uri;
        const fileData = await XMindDocument.readFile(dataFile);
        return new XMindDocument(uri, fileData, delegate);
    }

    private static async readFile(uri: vscode.Uri): Promise<Uint8Array> {
        if (uri.scheme === 'untitled') {
            return new Uint8Array();
        }
        return new Uint8Array(await vscode.workspace.fs.readFile(uri));
    }

    private readonly _uri: vscode.Uri;
    private _documentData: Uint8Array;
    private readonly _delegate: XMindDocumentDelegate;

    private constructor(
        uri: vscode.Uri,
        initialContent: Uint8Array,
        delegate: XMindDocumentDelegate
    ) {
        super();
        this._uri = uri;
        this._documentData = initialContent;
        this._delegate = delegate;
    }

    public get uri() { return this._uri; }

    public get documentData(): Uint8Array { return this._documentData; }

    private readonly _onDidDispose = this._register(new vscode.EventEmitter<void>());
    public readonly onDidDispose = this._onDidDispose.event;

    private readonly _onDidChangeDocument = this._register(new vscode.EventEmitter<{
        readonly content?: Uint8Array;
    }>());
    public readonly onDidChangeContent = this._onDidChangeDocument.event;

    private readonly _onDidChange = this._register(new vscode.EventEmitter<{
        readonly label: string,
        undo(): void,
        redo(): void,
    }>());
    public readonly onDidChange = this._onDidChange.event;

    dispose(): void {
        this._onDidDispose.fire();
        super.dispose();
    }

    /**
     * Called when the webview notifies us that the document has changed.
     */
    makeEdit() {
        this._onDidChange.fire({
            label: 'Edit',
            undo: async () => {
                await this._delegate.undo();
            },
            redo: async () => {
                await this._delegate.redo();
            }
        });
    }

    /**
     * Called by VS Code when the user saves the document.
     */
    async save(cancellation: vscode.CancellationToken): Promise<void> {
        await this.saveAs(this.uri, cancellation);
    }

    /**
     * Called by VS Code when the user saves the document to a new location.
     */
    async saveAs(targetResource: vscode.Uri, cancellation: vscode.CancellationToken): Promise<void> {
        const fileData = await this._delegate.getFileData();
        if (cancellation.isCancellationRequested) {
            return;
        }
        await vscode.workspace.fs.writeFile(targetResource, fileData);
    }

    /**
     * Called by VS Code when the user calls `revert` on a document.
     */
    async revert(_cancellation: vscode.CancellationToken): Promise<void> {
        const diskContent = await XMindDocument.readFile(this.uri);
        this._documentData = diskContent;
        this._onDidChangeDocument.fire({
            content: diskContent,
        });
    }

    /**
     * Called by VS Code to backup the edited document.
     */
    async backup(destination: vscode.Uri, cancellation: vscode.CancellationToken): Promise<vscode.CustomDocumentBackup> {
        await this.saveAs(destination, cancellation);
        return {
            id: destination.toString(),
            delete: async () => {
                try {
                    await vscode.workspace.fs.delete(destination);
                } catch {
                    // noop
                }
            }
        };
    }
}
