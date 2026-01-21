import * as JSZip from 'jszip';
import { v4 as uuidv4 } from 'uuid';

let currentZip: any = null;
let currentSettings: any = null; // Store settings/styles from original file if possible

/**
 * Parses initial XMind data and caches the zip structure.
 */
export async function parseXMind(data: Uint8Array): Promise<any[]> {
    const zip = await JSZip.loadAsync(data);
    currentZip = zip as any;

    const contentFile = zip.file('content.json');
    if (!contentFile) {
        throw new Error('Invalid XMind file: content.json not found');
    }

    const contentStr = await contentFile.async('string');
    const content = JSON.parse(contentStr); // Array of sheets

    return content.map((sheet: any) => ({
        id: sheet.id,
        title: sheet.title || 'Untitled Sheet',
        data: transformToMindMap(sheet.rootTopic)
    }));
}

/**
 * Packs the current simple-mind-map sheets back into an XMind zip.
 */
export async function packXMind(sheets: any[]): Promise<Uint8Array> {
    if (!currentZip) {
        // @ts-ignore: JSZip type definition mismatch workarounds
        currentZip = new JSZip.default();
    }

    // Ensure currentZip is not null
    const zip = currentZip!;

    // Transform all sheets back to XMind JSON structure
    const xmindContent = sheets.map(sheet => ({
        "id": sheet.id || uuidv4(),
        "class": "sheet",
        "title": sheet.title,
        "rootTopic": transformToXMind(sheet.data)
    }));

    // Update content.json
    zip.file('content.json', JSON.stringify(xmindContent));

    // We might need to update manifest.json to ensure it points to content.json, 
    // but usually it's standard. For robust support, we should check/write manifest.json
    // However, existing XMind files usually have it.

    // Generate new binary
    return await zip.generateAsync({ type: 'uint8array' });
}

function transformToMindMap(xmindNode: any): any {
    const node: any = {
        data: {
            text: xmindNode.title,
            // Store original ID to potentially preserve it
            uid: xmindNode.id
        },
        children: []
    };

    if (xmindNode.children && xmindNode.children.attached) {
        node.children = xmindNode.children.attached.map(transformToMindMap);
    }
    return node;
}

function transformToXMind(mmNode: any): any {
    const xmindNode: any = {
        "id": mmNode.data.uid || uuidv4(),
        "title": mmNode.data.text,
        "class": "topic"
    };

    if (mmNode.children && mmNode.children.length > 0) {
        xmindNode.children = {
            "attached": mmNode.children.map(transformToXMind)
        };
    }

    return xmindNode;
}
