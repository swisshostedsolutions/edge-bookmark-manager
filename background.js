// Listen for messages from popup
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === "exportBookmarks") {
        exportBookmarks().then(sendResponse);
        return true;
    }

    if (msg.action === "exportTabGroups") {
        exportTabGroups().then(sendResponse);
        return true;
    }

    if (msg.action === "importBookmarks") {
        importBookmarks(msg.data).then(sendResponse);
        return true;
    }

    if (msg.action === "exportSelectedBookmarks") {
        exportSelectedBookmarks(msg.ids).then(sendResponse);
        return true;
    }

    if (msg.action === "importTabGroups") {
        importTabGroups(msg.data).then(sendResponse);
        return true;
    }
});

// --- EXPORT BOOKMARKS ---
async function exportBookmarks() {
    const tree = await chrome.bookmarks.getTree();
    const payload = {
        version: 1,
        exportedAt: new Date().toISOString(),
        tree
    };

    const json = JSON.stringify(payload, null, 2);
    const base64 = btoa(unescape(encodeURIComponent(json)));

    const dataUrl = "data:application/json;base64," + base64;

    await chrome.downloads.download({
        url: dataUrl,
        filename: "bookmarks-export.json",
        saveAs: true
    });

    return { ok: true };
}

// --- EXPORT TAB GROUPS ---
async function exportTabGroups() {
    const tabs = await chrome.tabs.query({ currentWindow: true });
    const groups = {};

    for (const tab of tabs) {
        if (tab.groupId >= 0) {
            const group = await chrome.tabGroups.get(tab.groupId);
            if (!groups[group.id]) {
                groups[group.id] = {
                    title: group.title,
                    color: group.color,
                    tabs: []
                };
            }
            groups[group.id].tabs.push({ title: tab.title, url: tab.url });
        }
    }

    const payload = {
        exportedAt: new Date().toISOString(),
        groups: Object.values(groups)
    };

    const json = JSON.stringify(payload, null, 2);
    const base64 = btoa(unescape(encodeURIComponent(json)));

    const dataUrl = "data:application/json;base64," + base64;

    await chrome.downloads.download({
        url: dataUrl,
        filename: "tabgroups-export.json",
        saveAs: true
    });

    return { ok: true };
}

// --- IMPORT BOOKMARKS (robust) ---
async function importBookmarks(data) {
    const nodes = data.tree
        ? data.tree[0]?.children || []
        : data.selection || [];

    if (!Array.isArray(nodes)) {
        console.error("Invalid bookmark import format");
        return { ok: false, error: "Invalid bookmark import format" };
    }

    const importedRoot = await chrome.bookmarks.create({
        title: "Imported Bookmarks"
    });

    async function createNode(node, parentId) {
        if (node.children && Array.isArray(node.children)) {
            const folder = await chrome.bookmarks.create({
                parentId,
                title: node.title || "Folder"
            });

            for (const child of node.children) {
                await createNode(child, folder.id);
            }
        } else if (node.url) {
            await chrome.bookmarks.create({
                parentId,
                title: node.title || node.url,
                url: node.url
            });
        }
    }

    for (const node of nodes) {
        await createNode(node, importedRoot.id);
    }

    return { ok: true };
}

// --- IMPORT TAB GROUPS ---
async function importTabGroups(data) {
    if (!data.groups || !Array.isArray(data.groups)) {
        console.error("Invalid tab group import format");
        return { ok: false, error: "Invalid tab group import format" };
    }

    const win = await chrome.windows.create({ focused: true });
    const windowId = win.id;

    for (const group of data.groups) {
        const createdTabs = [];

        for (const tab of group.tabs) {
            const created = await chrome.tabs.create({
                windowId,
                url: tab.url,
                active: false
            });
            createdTabs.push(created.id);
        }

        const groupId = await chrome.tabs.group({ tabIds: createdTabs });

        await chrome.tabGroups.update(groupId, {
            title: group.title || "",
            color: group.color || "grey"
        });
    }

    return { ok: true };
}

// --- EXPORT SELECTED BOOKMARKS ---
async function exportSelectedBookmarks(ids) {
    const nodes = [];

    for (const id of ids) {
        const result = await chrome.bookmarks.getSubTree(id);
        nodes.push(result[0]);
    }

    const payload = {
        version: 1,
        exportedAt: new Date().toISOString(),
        selection: nodes
    };

    const json = JSON.stringify(payload, null, 2);
    const base64 = btoa(unescape(encodeURIComponent(json)));
    const dataUrl = "data:application/json;base64," + base64;

    await chrome.downloads.download({
        url: dataUrl,
        filename: "bookmarks-selected.json",
        saveAs: true
    });

    return { ok: true };
}
