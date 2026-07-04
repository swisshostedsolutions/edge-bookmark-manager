document.addEventListener("DOMContentLoaded", () => {
    console.log("Popup loaded");

    document.getElementById("exportSelected").onclick = () => {
        const checkboxes = document.querySelectorAll("#bookmarkTree input[type=checkbox]:checked");
        const ids = Array.from(checkboxes).map(cb => cb.dataset.id);

        chrome.runtime.sendMessage({
            action: "exportSelectedBookmarks",
            ids
        });
    };

    document.getElementById("exportAll").onclick = () => {
        chrome.runtime.sendMessage({ action: "exportBookmarks" });
    };

    document.getElementById("exportTabGroups").onclick = () => {
        chrome.runtime.sendMessage({ action: "exportTabGroups" });
    };

    document.getElementById("importBookmarksFile").onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const text = await file.text();
        const json = JSON.parse(text);

        chrome.runtime.sendMessage({
            action: "importBookmarks",
            data: json
        });
    };

    document.getElementById("importTabGroupsFile").onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const text = await file.text();
        const json = JSON.parse(text);

        chrome.runtime.sendMessage({
            action: "importTabGroups",
            data: json
        });
    };

    initSearch();
    loadTree();
    loadTabGroups();
});

// tree[0] is the invisible root (depth 0); its children ("Bookmarks bar",
// "Other bookmarks", ...) are hierarchy level 1. Collapse starts one level
// past this so the first 3 hierarchy levels are expanded on open.
const EXPANDED_HIERARCHY_LEVELS = 3;

// Flat index of every rendered tree node, built by loadTree and consumed
// by the search. Entries: { nodeEl, checkbox, nameEl, name, searchText,
// folder: {childrenContainer, toggle} | null, parent: <parent entry> }
let treeIndex = [];
let currentMatches = [];

async function loadTree() {
    const tree = await chrome.bookmarks.getTree();
    const container = document.getElementById("bookmarkTree");
    container.innerHTML = "";
    treeIndex = [];

    function renderNode(node, depth = 0, parentEntry = null) {
        const div = document.createElement("div");
        div.className = "tree-node";

        const row = document.createElement("div");
        row.className = "tree-row";

        const hasChildren = Array.isArray(node.children) && node.children.length > 0;
        row.classList.add(hasChildren ? "folder" : "leaf");

        const toggle = document.createElement("span");
        toggle.className = "toggle";
        if (hasChildren) {
            toggle.textContent = "▾";
            toggle.classList.add("clickable");
        }
        row.appendChild(toggle);

        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.dataset.id = node.id;

        const title = node.title || node.url || (parentEntry ? "(no title)" : "All Bookmarks");

        const label = document.createElement("span");
        label.className = "title";

        const nameEl = document.createElement("span");
        nameEl.className = "name";
        nameEl.textContent = hasChildren ? "📁 " + title : title;
        label.appendChild(nameEl);

        if (!hasChildren && node.url && node.title) {
            const urlEl = document.createElement("span");
            urlEl.className = "url";
            urlEl.textContent = node.url;
            label.appendChild(urlEl);
        }

        row.appendChild(checkbox);
        row.appendChild(label);
        div.appendChild(row);

        const entry = {
            nodeEl: div,
            checkbox,
            nameEl,
            name: hasChildren ? "📁 " + title : title,
            searchText: (title + " " + (node.url || "")).toLowerCase(),
            folder: null,
            parent: parentEntry
        };
        treeIndex.push(entry);

        if (hasChildren) {
            const childrenContainer = document.createElement("div");
            childrenContainer.className = "tree-children";
            for (const child of node.children) {
                childrenContainer.appendChild(renderNode(child, depth + 1, entry));
            }
            div.appendChild(childrenContainer);

            if (depth >= EXPANDED_HIERARCHY_LEVELS) {
                childrenContainer.style.display = "none";
                toggle.textContent = "▸";
            }

            toggle.onclick = () => {
                const collapsed = childrenContainer.style.display === "none";
                childrenContainer.style.display = collapsed ? "" : "none";
                toggle.textContent = collapsed ? "▾" : "▸";
            };

            entry.folder = { childrenContainer, toggle };
        }

        return div;
    }

    container.appendChild(renderNode(tree[0]));
    applySearch(document.getElementById("searchInput").value);
}

// --- SEARCH ---

// Expand/collapse state of each folder before the search started, so
// clearing the search puts the tree back the way the user had it.
let preSearchState = null;

function initSearch() {
    const input = document.getElementById("searchInput");
    const clearBtn = document.getElementById("searchClear");
    const selectBtn = document.getElementById("selectMatches");

    let debounceTimer;
    input.addEventListener("input", () => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => applySearch(input.value), 150);
    });

    input.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
            input.value = "";
            applySearch("");
        }
    });

    clearBtn.onclick = () => {
        input.value = "";
        applySearch("");
        input.focus();
    };

    selectBtn.onclick = () => {
        for (const entry of currentMatches) {
            entry.checkbox.checked = true;
        }
    };
}

function applySearch(query) {
    query = query.trim().toLowerCase();

    const searchBox = document.querySelector(".search-box");
    const meta = document.getElementById("searchMeta");
    const countEl = document.getElementById("searchCount");
    const selectBtn = document.getElementById("selectMatches");

    searchBox.classList.toggle("has-query", query.length > 0);

    if (!query) {
        // Restore full tree and the expand state from before the search.
        for (const entry of treeIndex) {
            entry.nodeEl.classList.remove("hidden");
            entry.nameEl.textContent = entry.name;
        }
        if (preSearchState) {
            for (const [entry, display] of preSearchState) {
                entry.folder.childrenContainer.style.display = display;
                entry.folder.toggle.textContent = display === "none" ? "▸" : "▾";
            }
            preSearchState = null;
        }
        meta.classList.remove("visible");
        currentMatches = [];
        return;
    }

    // Snapshot expand state on the first keystroke of a search session.
    if (!preSearchState) {
        preSearchState = treeIndex
            .filter(e => e.folder)
            .map(e => [e, e.folder.childrenContainer.style.display]);
    }

    currentMatches = [];
    for (const entry of treeIndex) {
        entry.nodeEl.classList.add("hidden");
        entry.nameEl.textContent = entry.name;
    }

    for (const entry of treeIndex) {
        if (!entry.searchText.includes(query)) continue;
        currentMatches.push(entry);
        highlight(entry, query);

        // Reveal the match and expand every ancestor folder.
        entry.nodeEl.classList.remove("hidden");
        for (let p = entry.parent; p; p = p.parent) {
            p.nodeEl.classList.remove("hidden");
            p.folder.childrenContainer.style.display = "";
            p.folder.toggle.textContent = "▾";
        }
    }

    countEl.textContent = currentMatches.length === 1
        ? "1 match"
        : currentMatches.length + " matches";
    selectBtn.disabled = currentMatches.length === 0;
    meta.classList.add("visible");
}

function highlight(entry, query) {
    const name = entry.name;
    const idx = name.toLowerCase().indexOf(query);
    if (idx === -1) return; // matched on URL only

    entry.nameEl.textContent = "";
    entry.nameEl.append(name.slice(0, idx));
    const mark = document.createElement("mark");
    mark.textContent = name.slice(idx, idx + query.length);
    entry.nameEl.append(mark, name.slice(idx + query.length));
}

// --- TAB GROUPS PANEL ---

async function loadTabGroups() {
    const container = document.getElementById("tabGroupsView");
    container.innerHTML = "";

    const [groups, tabs] = await Promise.all([
        chrome.tabGroups.query({}),
        chrome.tabs.query({})
    ]);

    if (groups.length === 0) {
        const empty = document.createElement("div");
        empty.className = "empty-state";
        empty.textContent = "No tab groups open";
        container.appendChild(empty);
        return;
    }

    const tabsByGroup = {};
    for (const tab of tabs) {
        if (tab.groupId >= 0) {
            (tabsByGroup[tab.groupId] ||= []).push(tab);
        }
    }

    for (const group of groups) {
        const groupTabs = tabsByGroup[group.id] || [];

        const card = document.createElement("div");
        card.className = "tab-group tg-" + group.color;

        const header = document.createElement("div");
        header.className = "tab-group-header";

        const dot = document.createElement("span");
        dot.className = "dot";

        const titleEl = document.createElement("span");
        titleEl.className = "group-title";
        titleEl.textContent = group.title || "Unnamed group";

        const count = document.createElement("span");
        count.className = "count";
        count.textContent = groupTabs.length === 1 ? "1 tab" : groupTabs.length + " tabs";

        header.append(dot, titleEl, count);
        card.appendChild(header);

        const list = document.createElement("div");
        list.className = "tab-group-tabs";

        for (const tab of groupTabs) {
            const entry = document.createElement("div");
            entry.className = "tab-entry";

            let icon;
            if (tab.favIconUrl && !tab.favIconUrl.startsWith("chrome")) {
                icon = document.createElement("img");
                icon.src = tab.favIconUrl;
                icon.onerror = () => {
                    const fallback = document.createElement("span");
                    fallback.className = "favicon-fallback";
                    icon.replaceWith(fallback);
                };
            } else {
                icon = document.createElement("span");
                icon.className = "favicon-fallback";
            }

            const tabTitle = document.createElement("span");
            tabTitle.className = "tab-title";
            tabTitle.textContent = tab.title || tab.url || "(no title)";
            tabTitle.title = tab.url || "";

            entry.append(icon, tabTitle);
            list.appendChild(entry);
        }

        header.onclick = () => list.classList.toggle("collapsed");

        card.appendChild(list);
        container.appendChild(card);
    }
}
