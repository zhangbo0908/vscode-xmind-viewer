import MindMap from 'simple-mind-map';
import 'simple-mind-map/dist/simpleMindMap.esm.css';
import { parseXMind, packXMind } from './parser';

// Initialize the API provided by VS Code
declare var acquireVsCodeApi: any;
const vscode = acquireVsCodeApi();

let mindMap: any = null;
let sheets: any[] = [];
let activeSheetIndex = 0;

window.addEventListener('load', () => {
    vscode.postMessage({ type: 'ready' });
});

window.addEventListener('message', async event => {
    const message = event.data;
    switch (message.type) {
        case 'update':
            await init(message.body.data);
            break;
        case 'getFileData':
            await handleGetFileData(message.requestId);
            break;
    }
});

async function init(data: number[]) {
    try {
        const uint8Array = new Uint8Array(data);
        sheets = await parseXMind(uint8Array);
        activeSheetIndex = 0;

        if (sheets.length > 0) {
            render(sheets[0].data);
            renderTabs();
        }
    } catch (e) {
        console.error('Failed to initialize mind map:', e);
    }
}

function render(mapData: any) {
    if (!mindMap) {
        const container = document.getElementById('mindmap');
        if (container) {
            mindMap = new MindMap({
                el: container,
                data: mapData,
                theme: 'default',
                readonly: false
            } as any);

            mindMap.on('data_change', () => {
                if (sheets[activeSheetIndex]) {
                    sheets[activeSheetIndex].data = mindMap.getData();
                }
                vscode.postMessage({ type: 'edit' });
            });
        }
    } else {
        mindMap.setData(mapData);
    }

    setTimeout(() => {
        mindMap.fit();
    }, 500);
}

function renderTabs() {
    let tabContainer = document.getElementById('tab-container');
    if (!tabContainer) {
        tabContainer = document.createElement('div');
        tabContainer.id = 'tab-container';
        document.body.appendChild(tabContainer);
    }

    tabContainer.innerHTML = '';
    sheets.forEach((sheet, index) => {
        const tab = document.createElement('div');
        tab.className = `tab ${index === activeSheetIndex ? 'active' : ''}`;
        tab.innerText = sheet.title;
        tab.onclick = () => switchSheet(index);
        tabContainer?.appendChild(tab);
    });
}

function switchSheet(index: number) {
    if (index === activeSheetIndex) return;

    // Save current data before switching just in case (though data_change should handle it)
    sheets[activeSheetIndex].data = mindMap.getData();

    activeSheetIndex = index;
    mindMap.setData(sheets[index].data);
    renderTabs();

    setTimeout(() => {
        mindMap.fit();
    }, 200);
}

async function handleGetFileData(requestId: number) {
    if (!mindMap || sheets.length === 0) {
        return;
    }
    // Update active sheet data one more time
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
