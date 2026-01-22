import MindMap from 'simple-mind-map';
// @ts-ignore
import Export from 'simple-mind-map/src/plugins/Export.js';
import { v4 as uuidv4 } from 'uuid';
import 'simple-mind-map/dist/simpleMindMap.esm.css';
import { parseXMind, packXMind } from './parser';

// 在模块加载时注册 Export 插件
MindMap.usePlugin(Export);

// 暗色主题配置
const darkThemeConfig = {
    backgroundColor: '#1e1e1e',
    lineColor: '#888',
    root: {
        fillColor: '#2d5c4e',
        color: '#e0e0e0',
        borderColor: '#444'
    },
    second: {
        fillColor: '#2d2d2d',
        color: '#ccc',
        borderColor: '#555'
    },
    node: {
        fillColor: 'transparent',
        color: '#aaa',
        borderColor: 'transparent'
    }
};

// 浅色主题配置（默认）
const lightThemeConfig = {
    backgroundColor: '#fafafa',
    lineColor: '#549688',
    root: {
        fillColor: '#549688',
        color: '#fff',
        borderColor: 'transparent'
    },
    second: {
        fillColor: '#fff',
        color: '#565656',
        borderColor: '#549688'
    },
    node: {
        fillColor: 'transparent',
        color: '#6a6d6c',
        borderColor: 'transparent'
    }
};

// Initialize the API provided by VS Code
declare var acquireVsCodeApi: any;
const vscode = acquireVsCodeApi();

let mindMap: any = null;
let sheets: any[] = [];
let activeSheetIndex = 0;

// 检查 mindMap 是否完全初始化
function isMindMapReady(): boolean {
    return !!(
        mindMap &&
        mindMap.renderer &&
        mindMap.renderer.textEdit &&
        mindMap.view
    );
}

// Notify the extension host that we are ready to receive data
console.log('Webview: Script loaded, sending ready signal');
vscode.postMessage({ type: 'ready' });

window.addEventListener('message', async event => {
    const message = event.data;
    console.log('Webview: Received message:', message.type);
    switch (message.type) {
        case 'update':
            await init(message.body.data);
            break;
        case 'getFileData':
            await handleGetFileData(message.requestId);
            break;
        case 'undo':
            if (mindMap) {
                try {
                    mindMap.execCommand('BACK');
                } catch (err) {
                    console.error('Webview: BACK command failed:', err);
                }
            }
            break;
        case 'redo':
            if (mindMap) {
                try {
                    mindMap.execCommand('FORWARD');
                } catch (err) {
                    console.error('Webview: FORWARD command failed:', err);
                }
            }
            break;
        case 'theme-change':
            applyTheme(message.body.kind);
            break;
        case 'export':
            if (message.body.type === 'md') {
                exportMarkdown();
            } else {
                exportImage(message.body.type);
            }
            break;
    }
});

// Handle keyboard shortcuts for Undo/Redo
window.addEventListener('keydown', e => {
    const isMod = (navigator.platform.match("Mac") ? e.metaKey : e.ctrlKey);
    if (isMod && e.key === 'z') {
        if (e.shiftKey) {
            if (mindMap) mindMap.execCommand('FORWARD');
        } else {
            if (mindMap) mindMap.execCommand('BACK');
        }
        e.preventDefault();
    } else if (isMod && e.key === 'y') {
        if (mindMap) mindMap.execCommand('FORWARD');
        e.preventDefault();
    }
});

async function init(data: number[]) {
    try {
        console.log('Webview: Received update message, data length:', data.length);
        const uint8Array = new Uint8Array(data);
        sheets = await parseXMind(uint8Array);
        console.log('Webview: Parsed sheets count:', sheets.length);
        activeSheetIndex = 0;

        if (sheets.length > 0) {
            const isDark = document.body.classList.contains('vscode-dark');
            console.log('Webview: Init detected isDark:', isDark, 'body classes:', document.body.className);
            render(sheets[0].data, isDark);
            renderTabs();
        } else {
            console.error('Webview: No sheets found after parsing');
        }
    } catch (e) {
        console.error('Webview: Failed to initialize mind map:', e);
    }
}

function render(mapData: any, isDark: boolean = false) {
    console.log('Webview: Rendering map data, isDark:', isDark);
    const themeConfig = isDark ? darkThemeConfig : lightThemeConfig;
    console.log('Webview: Using themeConfig:', JSON.stringify(themeConfig));
    if (!mindMap) {
        const container = document.getElementById('mindmap');
        if (container) {
            try {
                mindMap = new MindMap({
                    el: container,
                    data: mapData,
                    theme: 'default',
                    themeConfig: themeConfig,
                    layout: 'mindMap',
                    readonly: false
                } as any);

                // 等待初始化完成
                mindMap.on('node_tree_render_end', () => {
                    console.log('Webview: MindMap fully initialized');
                });

                mindMap.on('data_change', () => {
                    if (sheets[activeSheetIndex]) {
                        sheets[activeSheetIndex].data = mindMap.getData();
                    }
                    vscode.postMessage({ type: 'edit' });
                });
                console.log('Webview: MindMap initialized');
            } catch (err) {
                console.error('Webview: Error initializing MindMap:', err);
            }
        } else {
            console.error('Webview: Container #mindmap not found');
        }
    } else {
        console.log('Webview: Updating MindMap data');
        mindMap.setData(mapData);
    }

    // 增加延迟,确保 renderer 完全初始化
    setTimeout(() => {
        if (mindMap && mindMap.view) {
            mindMap.resize();
            mindMap.view.fit();
        }
    }, 200);

    // Initial render of tabs
    renderTabs();
}

function applyTheme(kind: number) {
    const isDark = kind === 2 || kind === 3; // ColorThemeKind.Dark = 2, HighContrast = 3
    if (isDark) {
        document.body.classList.remove('vscode-light');
        document.body.classList.add('vscode-dark');
    } else {
        document.body.classList.remove('vscode-dark');
        document.body.classList.add('vscode-light');
    }
    if (mindMap) {
        // 使用 setThemeConfig 动态更新主题配置，并强制重新渲染
        const themeConfig = isDark ? darkThemeConfig : lightThemeConfig;
        mindMap.setThemeConfig(themeConfig, false); // false = 不跳过渲染
        // 强制重新渲染以确保变更生效
        setTimeout(() => {
            mindMap.render();
            mindMap.view.fit();
        }, 50);
    } else {
        // mindMap not initialized yet
    }
    // 重新渲染 Tab 栏以应用新的主题样式
    renderTabs();
}



// Close dropdown when clicking elsewhere
window.addEventListener('click', (e) => {
    const dropdown = document.getElementById('export-dropdown');
    if (dropdown && dropdown.classList.contains('open')) {
        // Check if click is outside the dropdown
        if (!dropdown.contains(e.target as Node)) {
            dropdown.classList.remove('open');
        }
    }
});

function renderTabs() {
    const tabContainer = document.getElementById('tab-container');
    if (!tabContainer) return;

    tabContainer.innerHTML = `
        <div id="tabs-wrapper"></div>
        <div id="controls">
            <button id="add-sheet-btn" title="Add Sheet">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            </button>
            <select id="layout-select">
                <option value="mindMap">思维导图</option>
                <option value="logicalStructure">逻辑图 (右)</option>
                <option value="logicalStructureLeft">逻辑图 (左)</option>
                <option value="organizationStructure">组织结构图</option>
                <option value="treeStructure">树状图</option>
            </select>
        </div>
    `;

    // 绑定 AddSheet 事件
    const addSheetBtn = document.getElementById('add-sheet-btn');

    if (addSheetBtn) {
        addSheetBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            addSheet();
        });
    }

    // 绑定 Layout Select 事件
    const layoutSelect = document.getElementById('layout-select') as HTMLSelectElement;
    if (layoutSelect) {
        if (sheets[activeSheetIndex]?.data?.data?.layout) {
            layoutSelect.value = sheets[activeSheetIndex].data.data.layout;
        }
        layoutSelect.onchange = (e) => {
            e.stopPropagation();
            changeLayout((e.target as HTMLSelectElement).value);
        };
    }



    const tabsWrapper = document.getElementById('tabs-wrapper');
    if (tabsWrapper) {
        sheets.forEach((sheet, index) => {
            const tab = document.createElement('div');
            tab.className = `tab ${index === activeSheetIndex ? 'active' : ''}`;

            const titleSpan = document.createElement('span');
            titleSpan.innerText = sheet.title;
            tab.appendChild(titleSpan);

            // Only show delete icon if more than one sheet exists
            if (sheets.length > 1) {
                const closeBtn = document.createElement('span');
                closeBtn.className = 'tab-close';
                closeBtn.innerHTML = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
                closeBtn.title = 'Delete Sheet';
                closeBtn.onclick = (e) => {
                    e.stopPropagation();
                    deleteSheet(index);
                };
                tab.appendChild(closeBtn);
            }

            tab.onclick = () => switchSheet(index);
            tabsWrapper.appendChild(tab);
        });
    }


}

function deleteSheet(index: number) {
    if (sheets.length <= 1) return;

    sheets.splice(index, 1);

    // Adjust active index
    if (activeSheetIndex >= index) {
        activeSheetIndex = Math.max(0, activeSheetIndex - 1);
    }

    mindMap.setData(sheets[activeSheetIndex].data);
    renderTabs();
    vscode.postMessage({ type: 'edit' });
}

function changeLayout(layout: string) {
    if (mindMap) {
        mindMap.setLayout(layout);
        if (sheets[activeSheetIndex]) {
            sheets[activeSheetIndex].data = mindMap.getData();
        }
        vscode.postMessage({ type: 'edit' });
    }
}

function addSheet() {
    const newSheet = {
        id: uuidv4(),
        title: `Sheet ${sheets.length + 1}`,
        data: {
            data: {
                text: 'Central Topic',
                layout: 'mindMap',
                uid: uuidv4()
            },
            children: []
        }
    };
    sheets.push(newSheet);
    activeSheetIndex = sheets.length - 1;
    mindMap.setData(newSheet.data);
    renderTabs();
    vscode.postMessage({ type: 'edit' });

    setTimeout(() => {
        mindMap.view.fit();
    }, 200);
}

function switchSheet(index: number) {
    if (index === activeSheetIndex) return;
    sheets[activeSheetIndex].data = mindMap.getData();
    activeSheetIndex = index;
    mindMap.setData(sheets[index].data);
    renderTabs();
    setTimeout(() => {
        mindMap.view.fit();
    }, 200);
}

async function handleGetFileData(requestId: number) {
    if (!mindMap || sheets.length === 0) return;
    sheets[activeSheetIndex].data = mindMap.getData();
    const packedData = await packXMind(sheets);
    vscode.postMessage({
        type: 'response',
        requestId,
        body: Array.from(packedData)
    });
}

// Export Image
async function exportImage(type: string) {
    console.log('Webview: exportImage called, type:', type);

    // 检查 mindMap 基本状态
    if (!mindMap) {
        const msg = 'MindMap not initialized';
        console.error('Webview:', msg);
        vscode.postMessage({ type: 'error', body: msg });
        return;
    }

    // 检查关键依赖
    if (!mindMap.renderer) {
        const msg = 'MindMap renderer not available';
        console.error('Webview:', msg);
        vscode.postMessage({ type: 'error', body: msg });
        return;
    }

    if (!mindMap.renderer.textEdit) {
        const msg = 'MindMap textEdit not available';
        console.error('Webview:', msg);
        vscode.postMessage({ type: 'error', body: msg });
        return;
    }

    if (typeof mindMap.export !== 'function') {
        const msg = 'MindMap export function not available';
        console.error('Webview:', msg);
        vscode.postMessage({ type: 'error', body: msg });
        return;
    }

    try {
        console.log('Webview: Starting export process...');

        // 在导出前确保文本编辑器已关闭
        try {
            mindMap.renderer.textEdit.hideEditTextBox();
        } catch (e) {
            console.warn('Webview: Could not hide edit text box:', e);
        }

        console.log('Webview: Calling mindMap.export with type:', type);
        const data = await mindMap.export(type, false, sheets[activeSheetIndex].title);
        console.log('Webview: Export completed successfully');

        vscode.postMessage({
            type: 'save-export',
            body: {
                content: data,
                type: type,
                filename: `${sheets[activeSheetIndex].title}.${type}`
            }
        });
    } catch (e: any) {
        console.error('Webview: Export failed with error:', e);
        console.error('Webview: Error stack:', e.stack);
        vscode.postMessage({
            type: 'error',
            body: `Export failed: ${e.message || e}`
        });
    }
}

function exportMarkdown() {
    if (!mindMap) return;
    const data = mindMap.getData();
    // Use root node text as title
    let md = `# ${data.data.text || sheets[activeSheetIndex].title}\n\n`;

    function traverse(node: any, level: number) {
        const indent = '  '.repeat(level);
        md += `${indent}- ${node.data.text}\n`;
        if (node.children) {
            node.children.forEach((child: any) => traverse(child, level + 1));
        }
    }

    // Start traversing from children to avoid redundant root item
    if (data.children) {
        data.children.forEach((child: any) => traverse(child, 0));
    }

    vscode.postMessage({
        type: 'save-export',
        body: {
            content: md,
            type: 'md',
            filename: `${data.data.text || sheets[activeSheetIndex].title}.md`
        }
    });
}

window.addEventListener('resize', () => {
    if (mindMap) {
        mindMap.resize();
        mindMap.view.fit();
    }
});
