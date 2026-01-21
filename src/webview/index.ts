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
            // message.body.data is the number[] for Uint8Array
            await init(message.body.data);
            break;
        case 'getFileData':
            await handleGetFileData(message.requestId);
            break;
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
    if (!mindMap) {
        const container = document.getElementById('mindmap');
        if (container) {
            mindMap = new MindMap({
                el: container,
                data: mapData,
                theme: 'default',
                layout: 'mindMap', // Default to radial layout
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

    // Create tabs wrapper to separate from control area if needed
    const tabsWrapper = document.createElement('div');
    tabsWrapper.style.display = 'flex';
    tabsWrapper.style.flex = '1';
    tabsWrapper.style.overflowX = 'auto';

    sheets.forEach((sheet, index) => {
        const tab = document.createElement('div');
        tab.className = `tab ${index === activeSheetIndex ? 'active' : ''}`;
        tab.innerText = sheet.title;
        tab.onclick = () => switchSheet(index);
        tabsWrapper.appendChild(tab);
    });

    // Add "+" button
    const addTab = document.createElement('div');
    addTab.className = 'tab add-tab';
    addTab.innerText = '+';
    addTab.title = 'Add Sheet';
    addTab.onclick = (e) => {
        e.stopPropagation();
        addSheet();
    };
    tabsWrapper.appendChild(addTab);
    tabContainer.appendChild(tabsWrapper);

    // Add Layout Selector
    const controlArea = document.createElement('div');
    controlArea.style.marginLeft = 'auto';
    controlArea.style.display = 'flex';
    controlArea.style.alignItems = 'center';
    controlArea.style.paddingLeft = '10px';

    const layoutLabel = document.createElement('span');
    layoutLabel.innerText = 'Layout: ';
    layoutLabel.style.fontSize = '12px';
    layoutLabel.style.marginRight = '5px';
    layoutLabel.style.color = '#666';
    controlArea.appendChild(layoutLabel);

    const layoutSelect = document.createElement('select');
    layoutSelect.id = 'layout-select';
    layoutSelect.style.fontSize = '12px';
    layoutSelect.style.padding = '2px';

    const layouts = [
        { name: 'Mind Map', value: 'mindMap' },
        { name: 'Logical (Right)', value: 'logicalStructure' },
        { name: 'Logical (Left)', value: 'logicalStructureLeft' },
        { name: 'Org Chart (Down)', value: 'organizationStructure' },
        { name: 'Tree Chart (Right)', value: 'treeStructure' }
    ];

    layouts.forEach(l => {
        const opt = document.createElement('option');
        opt.value = l.value;
        opt.innerText = l.name;
        if (sheets[activeSheetIndex]?.data?.data?.layout === l.value) {
            opt.selected = true;
        }
        layoutSelect.appendChild(opt);
    });

    layoutSelect.onchange = (e) => {
        const value = (e.target as HTMLSelectElement).value;
        changeLayout(value);
    };

    controlArea.appendChild(layoutSelect);
    tabContainer.appendChild(controlArea);
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
                layout: 'mindMap'
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
