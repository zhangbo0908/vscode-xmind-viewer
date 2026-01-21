import * as JSZip from 'jszip';
import { v4 as uuidv4 } from 'uuid';

let currentZip: any = null;
let currentSettings: any = null; // Store settings/styles from original file if possible

/**
 * Parses initial XMind data and caches the zip structure.
 * If data is empty or invalid, returns a default sheet.
 */
export async function parseXMind(data: Uint8Array): Promise<any[]> {
    // Check for empty or too-small data (minimum ZIP size is ~22 bytes for empty archive)
    if (!data || data.length < 22) {
        console.log('Parser: Empty or invalid data, returning default sheet');
        currentZip = null; // Will be created fresh on pack
        return [{
            id: uuidv4(),
            title: 'Sheet 1',
            data: {
                data: {
                    text: 'Central Topic',
                    layout: 'mindMap',
                    uid: uuidv4()
                },
                children: []
            }
        }];
    }

    try {
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
    } catch (e) {
        console.error('Parser: Failed to parse ZIP, returning default sheet:', e);
        currentZip = null;
        return [{
            id: uuidv4(),
            title: 'Sheet 1',
            data: {
                data: {
                    text: 'Central Topic',
                    layout: 'mindMap',
                    uid: uuidv4()
                },
                children: []
            }
        }];
    }
}

/**
 * Packs the current simple-mind-map sheets back into an XMind zip.
 * Creates a complete XMind-compatible archive with all required files.
 */
export async function packXMind(sheets: any[]): Promise<Uint8Array> {
    const isNewFile = !currentZip;

    if (!currentZip) {
        // @ts-ignore: JSZip type definition mismatch workarounds
        currentZip = new JSZip.default();
    }

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

    // For new files, we need to create the required XMind structure
    if (isNewFile) {
        // Create manifest.json (required by XMind)
        const manifest = {
            "file-entries": {
                "content.json": {},
                "metadata.json": {}
            }
        };
        zip.file('manifest.json', JSON.stringify(manifest));

        // Create metadata.json (required by XMind)
        const now = new Date().toISOString();
        const metadata = {
            "creator": {
                "name": "XMind VS Code Viewer",
                "version": "0.1.1"
            },
            "created": now,
            "modified": now
        };
        zip.file('metadata.json', JSON.stringify(metadata));
    } else {
        // Update metadata.json modified time if it exists
        const metadataFile = zip.file('metadata.json');
        if (metadataFile) {
            try {
                const metaStr = await metadataFile.async('string');
                const metadata = JSON.parse(metaStr);
                metadata.modified = new Date().toISOString();
                zip.file('metadata.json', JSON.stringify(metadata));
            } catch (e) {
                // Ignore metadata update errors
            }
        }
    }

    // Generate new binary
    return await zip.generateAsync({ type: 'uint8array' });
}

const LAYOUT_MAP: Record<string, string> = {
    'org.xmind.ui.structure.mindmap': 'mindMap',
    'org.xmind.ui.logical.right': 'logicalStructure',
    'org.xmind.ui.logical.left': 'logicalStructureLeft',
    'org.xmind.ui.org-chart.down': 'organizationStructure',
    'org.xmind.ui.org-chart.up': 'organizationStructureUp',
    'org.xmind.ui.tree.right': 'treeStructure',
    'org.xmind.ui.tree.left': 'treeStructureLeft'
};

const REVERSE_LAYOUT_MAP: Record<string, string> = Object.entries(LAYOUT_MAP).reduce((acc, [k, v]) => {
    acc[v] = k;
    return acc;
}, {} as Record<string, string>);

function transformToMindMap(xmindNode: any, isRoot: boolean = true): any {
    const layout = xmindNode.structureClass ? LAYOUT_MAP[xmindNode.structureClass] : (isRoot ? 'mindMap' : undefined);

    const node: any = {
        data: {
            // Copy all properties to preserve styles, etc.
            ...xmindNode,
            text: xmindNode.title,
            uid: xmindNode.id,
            layout: layout
        },
        children: []
    };

    // Remove internal XMind structures that we handle separately or don't want in 'data'
    delete node.data.children;
    delete node.data.title;
    delete node.data.id;
    delete node.data.structureClass;

    if (xmindNode.children && xmindNode.children.attached) {
        node.children = xmindNode.children.attached.map((child: any) => transformToMindMap(child, false));
    }
    return node;
}

function transformToXMind(mmNode: any): any {
    const xmindNode: any = {
        // Restore all original properties
        ...mmNode.data,
        "id": mmNode.data.uid || mmNode.data.id || uuidv4(),
        "title": mmNode.data.text,
        "class": "topic"
    };

    // Clean up simple-mind-map specific fields from the XMind output
    delete xmindNode.text;
    delete xmindNode.uid;

    if (mmNode.data.layout) {
        xmindNode.structureClass = REVERSE_LAYOUT_MAP[mmNode.data.layout];
    }
    delete xmindNode.layout;

    if (mmNode.children && mmNode.children.length > 0) {
        xmindNode.children = {
            "attached": mmNode.children.map(transformToXMind)
        };
    }

    return xmindNode;
}
