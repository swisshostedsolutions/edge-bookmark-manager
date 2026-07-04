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

    document.getElementById("exportSelectedGroups").onclick = () => {
        const checkboxes = document.querySelectorAll("#tabGroupsView input[type=checkbox]:checked");
        const groupIds = Array.from(checkboxes).map(cb => Number(cb.dataset.groupId));

        chrome.runtime.sendMessage({
            action: "exportSelectedTabGroups",
            groupIds
        });
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
    initGroupSearch();
    loadTree();
    loadTabGroups();
});

// tree[0] is the invisible root (depth 0); its children ("Bookmarks bar",
// "Other bookmarks", ...) are hierarchy level 1. Only the root stays
// expanded, so every real folder is collapsed on open; searching
// auto-expands the folders that contain matches.
const EXPANDED_HIERARCHY_LEVELS = 1;

// Flat index of every rendered tree node, built by loadTree and consumed
// by the search. Entries: { nodeEl, checkbox, nameEl, name, searchText,
// titleText, folder: {childrenContainer, toggle} | null, parent: <parent entry> }
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
            titleText: title.toLowerCase(),
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

    document.getElementById("titleOnly").addEventListener("change", () => {
        applySearch(input.value);
    });

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

    const titleOnly = document.getElementById("titleOnly").checked;

    for (const entry of treeIndex) {
        if (!(titleOnly ? entry.titleText : entry.searchText).includes(query)) continue;
        currentMatches.push(entry);
        highlightIn(entry.nameEl, entry.name, query);

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

function highlightIn(el, text, query) {
    const idx = text.toLowerCase().indexOf(query);
    if (idx === -1) return; // matched elsewhere (e.g. on the URL)

    el.textContent = "";
    el.append(text.slice(0, idx));
    const mark = document.createElement("mark");
    mark.textContent = text.slice(idx, idx + query.length);
    el.append(mark, text.slice(idx + query.length));
}

// --- TAB GROUPS PANEL ---

// Flat index of every rendered tab group card, built by loadTabGroups and
// consumed by the group search. Entries: { card, checkbox, titleEl, title,
// titleText, list, tabEntries: [{el, titleEl, title, searchText}] }
let groupIndex = [];
let currentGroupMatches = [];

async function loadTabGroups() {
    const container = document.getElementById("tabGroupsView");
    container.innerHTML = "";
    groupIndex = [];

    const [groups, tabs, currentWindow] = await Promise.all([
        chrome.tabGroups.query({}),
        chrome.tabs.query({}),
        chrome.windows.getCurrent()
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

    // Number the browser windows that contain groups so cards from
    // unfocused windows can be badged when more than one window is open.
    const windowNumbers = new Map();
    for (const group of groups) {
        if (!windowNumbers.has(group.windowId)) {
            windowNumbers.set(group.windowId, windowNumbers.size + 1);
        }
    }

    for (const group of groups) {
        const groupTabs = tabsByGroup[group.id] || [];

        const card = document.createElement("div");
        card.className = "tab-group tg-" + group.color;

        const header = document.createElement("div");
        header.className = "tab-group-header";

        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.dataset.groupId = group.id;
        checkbox.onclick = (e) => e.stopPropagation();

        const dot = document.createElement("span");
        dot.className = "dot";

        const title = group.title || "Unnamed group";
        const titleEl = document.createElement("span");
        titleEl.className = "group-title";
        titleEl.textContent = title;

        header.append(checkbox, dot, titleEl);

        if (windowNumbers.size > 1 && group.windowId !== currentWindow.id) {
            const badge = document.createElement("span");
            badge.className = "window-badge";
            badge.textContent = "Window " + windowNumbers.get(group.windowId);
            header.appendChild(badge);
        }

        const count = document.createElement("span");
        count.className = "count";
        count.textContent = groupTabs.length === 1 ? "1 tab" : groupTabs.length + " tabs";
        header.appendChild(count);

        card.appendChild(header);

        const list = document.createElement("div");
        list.className = "tab-group-tabs collapsed";

        const tabEntries = [];
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
            const tabTitleText = tab.title || tab.url || "(no title)";
            tabTitle.textContent = tabTitleText;
            tabTitle.title = tab.url || "";

            entry.append(icon, tabTitle);
            list.appendChild(entry);

            tabEntries.push({
                el: entry,
                titleEl: tabTitle,
                title: tabTitleText,
                searchText: (tabTitleText + " " + (tab.url || "")).toLowerCase()
            });
        }

        header.onclick = () => list.classList.toggle("collapsed");

        card.appendChild(list);
        container.appendChild(card);

        groupIndex.push({
            card,
            checkbox,
            titleEl,
            title,
            titleText: title.toLowerCase(),
            list,
            tabEntries
        });
    }

    applyGroupSearch(document.getElementById("groupSearchInput").value);
}

// --- TAB GROUP SEARCH ---

// Collapsed state of each group before the search started, so clearing
// the search puts the panel back the way the user had it.
let preGroupSearchState = null;

function initGroupSearch() {
    const input = document.getElementById("groupSearchInput");
    const clearBtn = document.getElementById("groupSearchClear");
    const selectBtn = document.getElementById("selectGroupMatches");

    let debounceTimer;
    input.addEventListener("input", () => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => applyGroupSearch(input.value), 150);
    });

    input.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
            input.value = "";
            applyGroupSearch("");
        }
    });

    clearBtn.onclick = () => {
        input.value = "";
        applyGroupSearch("");
        input.focus();
    };

    document.getElementById("groupTitleOnly").addEventListener("change", () => {
        applyGroupSearch(input.value);
    });

    selectBtn.onclick = () => {
        for (const entry of currentGroupMatches) {
            entry.checkbox.checked = true;
        }
    };
}

function applyGroupSearch(query) {
    query = query.trim().toLowerCase();

    const searchBox = document.querySelector(".card-search .search-box");
    const meta = document.getElementById("groupSearchMeta");
    const countEl = document.getElementById("groupSearchCount");
    const selectBtn = document.getElementById("selectGroupMatches");

    searchBox.classList.toggle("has-query", query.length > 0);

    if (!query) {
        // Restore all cards and the collapsed state from before the search.
        for (const entry of groupIndex) {
            entry.card.classList.remove("hidden");
            entry.titleEl.textContent = entry.title;
            for (const tab of entry.tabEntries) {
                tab.el.classList.remove("hidden");
                tab.titleEl.textContent = tab.title;
            }
        }
        if (preGroupSearchState) {
            for (const [entry, collapsed] of preGroupSearchState) {
                entry.list.classList.toggle("collapsed", collapsed);
            }
            preGroupSearchState = null;
        }
        meta.classList.remove("visible");
        currentGroupMatches = [];
        return;
    }

    // Snapshot collapsed state on the first keystroke of a search session.
    if (!preGroupSearchState) {
        preGroupSearchState = groupIndex.map(e => [e, e.list.classList.contains("collapsed")]);
    }

    const titleOnly = document.getElementById("groupTitleOnly").checked;
    currentGroupMatches = [];

    for (const entry of groupIndex) {
        entry.titleEl.textContent = entry.title;

        const titleMatch = entry.titleText.includes(query);
        const tabMatches = titleOnly
            ? []
            : entry.tabEntries.filter(tab => tab.searchText.includes(query));

        if (!titleMatch && tabMatches.length === 0) {
            entry.card.classList.add("hidden");
            continue;
        }

        currentGroupMatches.push(entry);
        entry.card.classList.remove("hidden");
        entry.list.classList.remove("collapsed");
        if (titleMatch) {
            highlightIn(entry.titleEl, entry.title, query);
        }

        // A title match shows the whole group; otherwise only matching tabs.
        for (const tab of entry.tabEntries) {
            const tabMatch = tabMatches.includes(tab);
            tab.titleEl.textContent = tab.title;
            tab.el.classList.toggle("hidden", !titleMatch && !tabMatch);
            if (tabMatch) {
                highlightIn(tab.titleEl, tab.title, query);
            }
        }
    }

    countEl.textContent = currentGroupMatches.length === 1
        ? "1 match"
        : currentGroupMatches.length + " matches";
    selectBtn.disabled = currentGroupMatches.length === 0;
    meta.classList.add("visible");
}
