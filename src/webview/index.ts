import MindMap from 'simple-mind-map';
import { v4 as uuidv4 } from 'uuid';
import 'simple-mind-map/dist/simpleMindMap.esm.css';
import { parseXMind, packXMind } from './parser';

// Initialize the API provided by VS Code
declare var acquireVsCodeApi: any;
const vscode = acquireVsCodeApi();

let mindMap: any = null;
let sheets: any[] = [];
let activeSheetIndex = 0;

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
            if (mindMap) mindMap.execCommand('UNDO');
            break;
        case 'redo':
            if (mindMap) mindMap.execCommand('REDO');
            break;
    }
});

// Handle keyboard shortcuts for Undo/Redo
window.addEventListener('keydown', e => {
    const isMod = (navigator.platform.match("Mac") ? e.metaKey : e.ctrlKey);
    if (isMod && e.key === 'z') {
        if (e.shiftKey) {
            if (mindMap) mindMap.execCommand('REDO');
        } else {
            if (mindMap) mindMap.execCommand('UNDO');
        }
        e.preventDefault();
    } else if (isMod && e.key === 'y') {
        if (mindMap) mindMap.execCommand('REDO');
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
            render(sheets[0].data);
            renderTabs();
        } else {
            console.error('Webview: No sheets found after parsing');
        }
    } catch (e) {
        console.error('Webview: Failed to initialize mind map:', e);
    }
}

function render(mapData: any) {
    console.log('Webview: Rendering map data', mapData);
    if (!mindMap) {
        const container = document.getElementById('mindmap');
        if (container) {
            try {
                mindMap = new MindMap({
                    el: container,
                    data: mapData,
                    theme: 'default',
                    layout: 'mindMap',
                    readonly: false
                } as any);

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

    setTimeout(() => {
        if (mindMap) {
            mindMap.resize();
            mindMap.fit();
        }
    }, 100);
}

// Global functions for buttons in HTML (if needed, but usually we use postMessage)
(window as any).undo = () => { if (mindMap) mindMap.execCommand('UNDO'); };
(window as any).redo = () => { if (mindMap) mindMap.execCommand('REDO'); };
(window as any).addSheet = () => { addSheet(); };
(window as any).changeLayout = (layout: string) => { changeLayout(layout); };

function renderTabs() {
    const tabContainer = document.getElementById('tab-container');
    if (!tabContainer) return;

    tabContainer.innerHTML = `
        <div id="history-controls">
            <button onclick="undo()" title="Undo (Cmd+Z)">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/></svg>
            </button>
            <button onclick="redo()" title="Redo (Cmd+Shift+Z)">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 7v6h-6"/><path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3L21 13"/></svg>
            </button>
        </div>
        <div id="tabs-wrapper"></div>
        <div id="controls">
            <button onclick="addSheet()" title="Add Sheet">
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

    const layoutSelect = document.getElementById('layout-select') as HTMLSelectElement;
    if (layoutSelect) {
        if (sheets[activeSheetIndex]?.data?.data?.layout) {
            layoutSelect.value = sheets[activeSheetIndex].data.data.layout;
        }
        layoutSelect.onchange = (e) => {
            changeLayout((e.target as HTMLSelectElement).value);
        };
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
        mindMap.fit();
    }, 200);
}

function switchSheet(index: number) {
    if (index === activeSheetIndex) return;
    sheets[activeSheetIndex].data = mindMap.getData();
    activeSheetIndex = index;
    mindMap.setData(sheets[index].data);
    renderTabs();
    setTimeout(() => {
        mindMap.fit();
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

window.addEventListener('resize', () => {
    if (mindMap) {
        mindMap.resize();
        mindMap.fit();
    }
});
