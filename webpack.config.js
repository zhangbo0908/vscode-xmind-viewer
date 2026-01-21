const path = require('path');

//@ts-check
/** @type {import('webpack').Configuration} */
const extensionConfig = {
    target: 'node', // VS Code extensions run in a Node.js-context
    mode: 'none',
    entry: './src/extension.ts',
    output: {
        path: path.resolve(__dirname, 'dist'),
        filename: 'extension.js',
        libraryTarget: 'commonjs',
        devtoolModuleFilenameTemplate: '../[resource-path]',
    },
    resolve: {
        extensions: ['.ts', '.js'],
    },
    module: {
        rules: [
            {
                test: /\.ts$/,
                exclude: /node_modules/,
                use: [
                    {
                        loader: 'ts-loader',
                    },
                ],
            },
        ],
    },
    externals: {
        vscode: 'commonjs vscode', // Ignored because it's provided by the VS Code host
    },
    devtool: 'nosources-source-map',
};

/** @type {import('webpack').Configuration} */
const webviewConfig = {
    target: 'web', // Webviews run in a browser context
    mode: 'none',
    entry: './src/webview/index.ts',
    output: {
        path: path.resolve(__dirname, 'dist'),
        filename: 'webview.js',
        devtoolModuleFilenameTemplate: '../[resource-path]',
    },
    resolve: {
        extensions: ['.ts', '.js', '.css'],
    },
    module: {
        rules: [
            {
                test: /\.ts$/,
                exclude: /node_modules/,
                use: [
                    {
                        loader: 'ts-loader',
                        options: {
                            configFile: 'tsconfig.json' // Use the same tsconfig for now, but strictly we might want a separate one for dom lib
                        }
                    },
                ],
            },
            {
                test: /\.css$/,
                use: ['style-loader', 'css-loader']
            }
        ],
    },
    devtool: 'nosources-source-map',
};

module.exports = [extensionConfig, webviewConfig];
