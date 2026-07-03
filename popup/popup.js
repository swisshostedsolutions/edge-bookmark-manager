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

async function loadTree() {
    const tree = await chrome.bookmarks.getTree();
    const container = document.getElementById("bookmarkTree");
    container.innerHTML = "";

    function renderNode(node, depth = 0) {
        const div = document.createElement("div");
        div.style.marginLeft = depth * 16 + "px";

        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.dataset.id = node.id;

        const label = document.createElement("span");
        label.textContent = node.title || node.url || "(no title)";
        label.style.marginLeft = "4px";

        div.appendChild(checkbox);
        div.appendChild(label);

        if (node.children) {
            for (const child of node.children) {
                div.appendChild(renderNode(child, depth + 1));
            }
        }

        return div;
    }

    container.appendChild(renderNode(tree[0]));
}
