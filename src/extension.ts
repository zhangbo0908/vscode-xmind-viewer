import * as vscode from 'vscode';
import { XMindEditorProvider } from './XMindEditorProvider';

export function activate(context: vscode.ExtensionContext) {
    // Register our custom editor provider
    context.subscriptions.push(XMindEditorProvider.register(context));
}

export function deactivate() { }
