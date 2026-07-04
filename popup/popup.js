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

    loadTree();
});

// tree[0] is the invisible root (depth 0); its children ("Bookmarks bar",
// "Other bookmarks", ...) are hierarchy level 1. Collapse starts one level
// past this so the first 3 hierarchy levels are expanded on open.
const EXPANDED_HIERARCHY_LEVELS = 3;

async function loadTree() {
    const tree = await chrome.bookmarks.getTree();
    const container = document.getElementById("bookmarkTree");
    container.innerHTML = "";

    function renderNode(node, depth = 0) {
        const div = document.createElement("div");
        div.style.marginLeft = depth * 16 + "px";

        const row = document.createElement("div");

        const hasChildren = Array.isArray(node.children) && node.children.length > 0;

        const toggle = document.createElement("span");
        toggle.style.display = "inline-block";
        toggle.style.width = "12px";
        if (hasChildren) {
            toggle.textContent = "▾";
            toggle.style.cursor = "pointer";
        }
        row.appendChild(toggle);

        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.dataset.id = node.id;

        const label = document.createElement("span");
        label.textContent = node.title || node.url || "(no title)";
        label.style.marginLeft = "4px";

        row.appendChild(checkbox);
        row.appendChild(label);
        div.appendChild(row);

        if (hasChildren) {
            const childrenContainer = document.createElement("div");
            for (const child of node.children) {
                childrenContainer.appendChild(renderNode(child, depth + 1));
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
        }

        return div;
    }

    container.appendChild(renderNode(tree[0]));
}
