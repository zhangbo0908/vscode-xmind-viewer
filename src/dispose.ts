import * as vscode from 'vscode';

export class Disposable {
    private readonly _disposables: vscode.Disposable[] = [];

    public dispose() {
        while (this._disposables.length) {
            const item = this._disposables.pop();
            if (item) {
                item.dispose();
            }
        }
    }

    protected _register<T extends vscode.Disposable>(value: T): T {
        this._disposables.push(value);
        return value;
    }
}

export function disposeAll(disposables: vscode.Disposable[]) {
    while (disposables.length) {
        const item = disposables.pop();
        if (item) {
            item.dispose();
        }
    }
}
