```dataviewjs
// 配置参数
const dbPath = "x/Visuals/Words/生词本数据库.md";
const itemsPerPage = 12;

// 1. 读取并解析底层数据
const fileContent = await dv.io.load(dbPath);
if (!fileContent) {
    dv.paragraph("❌ 找不到生词本数据库，请先确保插件正确录入了数据。");
    return;
}

const lines = fileContent.split("\n");
const rawData = [];
for (let i = 3; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || !line.startsWith("|")) continue;
    const parts = line.split("|").map(p => p.trim());
    if (parts.length >= 9 && parts[2] !== "---") {
        rawData.push({
            lang: parts[1],
            word: parts[2],
            kanji: parts[3] || "",
            meaning: parts[4],
            notes: parts[5],
            isListening: parts[6],
            count: parseInt(parts[7]) || 0,
            time: parts[8]
        });
    }
}

// 2. 初始化全局状态
if (!window.vocabState) {
    window.vocabState = { currentPage: 0, sortKey: "time", sortOrder: -1, currentTab: "en", charFilter: "All" };
}
let state = window.vocabState;

// 3. 构建渲染骨架容器
const mainDiv = dv.container.createDiv();
mainDiv.empty();

// 注入基础结构样式（非高亮样式，防排版错乱）
const styleId = "vocab-dv-base-style";
if (!document.getElementById(styleId)) {
    const styleEl = document.createElement("style");
    styleEl.id = styleId;
    styleEl.textContent = `
        .dv-control-bar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; border-bottom: 2px solid var(--background-modifier-border); padding-bottom: 8px; }
        .dv-tabs { display: flex; gap: 8px; }
        .dv-tab-btn { background: transparent; border: none; padding: 6px 14px; font-weight: 500; color: var(--text-muted); cursor: pointer; border-radius: 4px; font-size: 0.9rem; }
        .dv-tab-btn.active { background: var(--background-secondary-alt); color: var(--text-accent); font-weight: bold; border: 1px solid var(--background-modifier-border); }
        
        .dv-alpha-bar { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 15px; background: var(--background-secondary); padding: 6px; border-radius: 6px; border: 1px solid var(--background-modifier-border); }
        .dv-alpha-btn { background: transparent; border: none; color: var(--text-muted); padding: 3px 8px; font-size: 0.8rem; cursor: pointer; border-radius: 4px; font-family: monospace; font-weight: 600; }
        .dv-alpha-btn:hover { background: var(--background-modifier-hover); color: var(--text-normal); }
        .dv-alpha-btn.active { background: var(--interactive-accent); color: var(--text-on-accent); }

        .dv-table { width: 100%; border-collapse: collapse; margin-top: 5px; font-size: 0.95rem; }
        .dv-table th { background: var(--background-secondary); padding: 10px; text-align: left; cursor: pointer; user-select: none; border-bottom: 2px solid var(--background-modifier-border); }
        .dv-table th:hover { background: var(--background-modifier-hover); color: var(--text-accent); }
        .dv-table td { padding: 10px; border-bottom: 1px solid var(--background-modifier-border); vertical-align: top; }
        
        .dv-footer-bar { display: flex; justify-content: space-between; align-items: center; margin-top: 20px; flex-wrap: wrap; gap: 15px; }
        .dv-pagination { display: flex; justify-content: center; align-items: center; gap: 15px; font-size: 0.9rem; }
        .dv-page-btn { padding: 4px 12px; background: var(--background-secondary); border: 1px solid var(--background-modifier-border); border-radius: 4px; cursor: pointer; }
        .dv-page-btn:disabled { opacity: 0.4; cursor: not-allowed; }
        
        .dv-time-sort-btn { display: flex; align-items: center; gap: 4px; background: var(--interactive-accent); color: var(--text-on-accent); border: none; padding: 5px 12px; border-radius: 4px; font-size: 0.8rem; font-weight: 500; cursor: pointer; transition: background 0.2s; }
        .dv-time-sort-btn:hover { filter: brightness(1.1); }
        .dv-time-sort-btn.inactive { background: var(--background-secondary); color: var(--text-muted); border: 1px solid var(--background-modifier-border); }
    `;
    document.head.appendChild(styleEl);
}

// 日语五十音顺映射函数
function getGojuonRow(char) {
    if (!char) return "";
    const code = char.charCodeAt(0);
    if (code >= 0x3041 && code <= 0x3049) return "あ";
    if (code >= 0x304A && code <= 0x3053) return "か";
    if (code >= 0x3054 && code <= 0x305D) return "さ";
    if (code >= 0x305E && code <= 0x3067) return "た";
    if (code >= 0x3068 && code <= 0x306C) return "な";
    if (code >= 0x306D && code <= 0x307B) return "は";
    if (code >= 0x307C && code <= 0x3080) return "ま";
    if (code >= 0x3081 && code <= 0x3085) return "や";
    if (code >= 0x3086 && code <= 0x308F) return "ら";
    return "其他";
}

// 渲染视图主函数
function renderView() {
    mainDiv.empty();
    
    // --- 1. 顶部第一栏 (语种标签切换) ---
    const controlBar = mainDiv.createDiv({ cls: "dv-control-bar" });
    const tabsContainer = controlBar.createDiv({ cls: "dv-tabs" });
    const enTab = tabsContainer.createEl("button", { text: `🇬🇧 英语 (${rawData.filter(d=>d.lang==="en").length})`, cls: `dv-tab-btn ${state.currentTab === "en" ? "active" : ""}` });
    const jaTab = tabsContainer.createEl("button", { text: `🇯🇵 日本語 (${rawData.filter(d=>d.lang==="ja").length})`, cls: `dv-tab-btn ${state.currentTab === "ja" ? "active" : ""}` });
    
    enTab.addEventListener("click", () => { state.currentTab = "en"; state.charFilter = "All"; state.currentPage = 0; renderView(); });
    jaTab.addEventListener("click", () => { state.currentTab = "ja"; state.charFilter = "All"; state.currentPage = 0; renderView(); });

    // --- 2. 顶部第二栏 (字母/50音快速跳转栏) ---
    const alphaBar = mainDiv.createDiv({ cls: "dv-alpha-bar" });
    let charsList = ["All"];
    if (state.currentTab === "en") {
        charsList = charsList.concat("ABCDEFGHIJKLMNOPQRSTUVWXYZ".split(""));
    } else {
        charsList = charsList.concat(["あ", "か", "さ", "tab", "な", "は", "ま", "や", "ら", "其他"]);
    }

    charsList.forEach(ch => {
        let displayBtnText = ch === "tab" ? "た" : ch;
        const btn = alphaBar.createEl("button", { 
            text: displayBtnText, 
            cls: `dv-alpha-btn ${state.charFilter === ch ? "active" : ""}` 
        });
        btn.addEventListener("click", () => {
            state.charFilter = ch;
            state.currentPage = 0;
            renderView();
        });
    });

    // --- 3. 语种与检索过滤逻辑 ---
    let filteredData = rawData.filter(item => item.lang === state.currentTab);
    if (state.charFilter !== "All") {
        if (state.currentTab === "en") {
            filteredData = filteredData.filter(item => item.word && item.word.trim().toUpperCase().startsWith(state.charFilter));
        } else {
            filteredData = filteredData.filter(item => {
                if (!item.word) return false;
                let targetCh = state.charFilter === "tab" ? "た" : state.charFilter;
                return getGojuonRow(item.word.trim()) === targetCh;
            });
        }
    }

    // --- 4. 数据排序核心逻辑 ---
    filteredData.sort((a, b) => {
        let valA = a[state.sortKey];
        let valB = b[state.sortKey];
        if (typeof valA === "string") {
            return valA.localeCompare(valB, "zh-CN") * state.sortOrder;
        }
        return (valA - valB) * state.sortOrder;
    });

    // --- 5. 数据分页核心计算 ---
    const totalItems = filteredData.length;
    const totalPages = Math.ceil(totalItems / itemsPerPage) || 1;
    if (state.currentPage >= totalPages) state.currentPage = totalPages - 1;
    const startIndex = state.currentPage * itemsPerPage;
    const pageData = filteredData.slice(startIndex, startIndex + itemsPerPage);

    // --- 6. 构建表格 DOM ---
    const table = mainDiv.createEl("table", { cls: "dv-table" });
    const thead = table.createEl("thead");
    const trHead = thead.createEl("tr");

    let headers = [];
    if (state.currentTab === "en") {
        headers = [
            { text: "单词", key: "word" },
            { text: "意思", key: "meaning" },
            { text: "备注", key: "notes" },
            { text: "是否为听力词", key: "isListening" },
            { text: "搜索次数", key: "count" }
        ];
    } else {
        headers = [
            { text: "假名", key: "word" },
            { text: "汉字", key: "kanji" },
            { text: "意思", key: "meaning" },
            { text: "备注", key: "notes" },
            { text: "是否为听力词", key: "isListening" },
            { text: "搜索次数", key: "count" }
        ];
    }

    headers.forEach(h => {
        let suffix = "";
        if (state.sortKey === h.key) { suffix = state.sortOrder === 1 ? " ▲" : " ▼"; }
        const th = trHead.createEl("th", { text: h.text + suffix });
        th.addEventListener("click", () => {
            if (state.sortKey === h.key) { state.sortOrder *= -1; } 
            else { state.sortKey = h.key; state.sortOrder = 1; }
            renderView();
        });
    });

    // --- 7. 全局同根词匹配 & 降维打击【硬核内联样式】注入 ---
    const tbody = table.createEl("tbody");
    if (pageData.length === 0) {
        const tr = tbody.createEl("tr");
        tr.createEl("td", { text: "当前分类下暂无匹配数据", attr: { colspan: headers.length } });
    } else {
        const getPrefix = (item) => {
            if (!item || !item.word) return "";
            const cleanWord = item.word.trim();
            if (state.currentTab === "en") {
                return cleanWord.toUpperCase().substring(0, 4);
            } else {
                return cleanWord.substring(0, 2);
            }
        };

        // 统计全量前缀频率
        let globalPrefixCounts = {};
        rawData.filter(d => d.lang === state.currentTab).forEach(item => {
            let p = getPrefix(item);
            if (p) globalPrefixCounts[p] = (globalPrefixCounts[p] || 0) + 1;
        });

        // 硬核定义内联马卡龙配色参数
        const macaronStyles = [
            { bg: "rgba(255, 182, 193, 0.6)", border: "#FF4565" }, // 樱花粉
            { bg: "rgba(168, 243, 212, 0.6)", border: "#00A86B" }, // 薄荷绿
            { bg: "rgba(255, 243, 162, 0.7)", border: "#FFB900" }, // 香蕉黄
            { bg: "rgba(211, 180, 255, 0.6)", border: "#7B1FA2" }  // 薰衣草紫
        ];

        let globalColorMap = {};
        let colorIndex = 0;
        Object.keys(globalPrefixCounts).forEach(p => {
            if (globalPrefixCounts[p] >= 2) {
                globalColorMap[p] = colorIndex % macaronStyles.length;
                colorIndex++;
            }
        });

        // 渲染单行
        pageData.forEach((item) => {
            const tr = tbody.createEl("tr");
            const currentPrefix = getPrefix(item);
            
            const isHighlighted = currentPrefix && globalPrefixCounts[currentPrefix] >= 2;
            const styleConfig = isHighlighted ? macaronStyles[globalColorMap[currentPrefix]] : null;

            // 核心内联样式应用函数（绕过任何 CSS 选择器拦截）
            const applyCellInlineStyle = (td, isFirstColumn = false) => {
                if (isHighlighted && styleConfig) {
                    let cssText = `background-color: ${styleConfig.bg} !important; color: #111111 !important; font-weight: 600 !important;`;
                    if (isFirstColumn) {
                        cssText += ` border-left: 6px solid ${styleConfig.border} !important;`;
                    }
                    td.style.cssText = cssText;
                    
                    // 顺便强力纠正单元格内的链接颜色
                    td.querySelectorAll("a").forEach(a => {
                        a.style.cssText = "color: #0047AB !important; font-weight: bold !important;";
                    });
                }
            };

            // 1. 单词列/假名列
            const tdWord = tr.createEl("td", { text: item.word });
            applyCellInlineStyle(tdWord, true);

            // 2. 汉字列 (仅限日文)
            if (state.currentTab === "ja") {
                const tdKanji = tr.createEl("td", { text: item.kanji });
                applyCellInlineStyle(tdKanji);
            }

            // 3. 意思列
            const tdMeaning = tr.createEl("td", { text: item.meaning });
            applyCellInlineStyle(tdMeaning);

            // 4. 备注列 (解析内联 HTML)
            const tdNotes = tr.createEl("td");
            tdNotes.innerHTML = item.notes;
            applyCellInlineStyle(tdNotes);

            // 5. 听力词状态列
            const tdList = tr.createEl("td", { text: item.isListening });
            applyCellInlineStyle(tdList);

            // 6. 次数列
            const tdCount = tr.createEl("td", { text: item.count });
            applyCellInlineStyle(tdCount);
        });
    }

    // --- 8. 底部控制条复合容器 ---
    const footerBar = mainDiv.createDiv({ cls: "dv-footer-bar" });
    
    const pager = footerBar.createDiv({ cls: "dv-pagination" });
    const prevBtn = pager.createEl("button", { text: "上一页", cls: "dv-page-btn" });
    prevBtn.disabled = state.currentPage === 0;
    prevBtn.addEventListener("click", () => { state.currentPage--; renderView(); });

    pager.createEl("span", { text: `第 ${state.currentPage + 1} / ${totalPages} 页 (共 ${totalItems} 条)` });

    const nextBtn = pager.createEl("button", { text: "下一页", cls: "dv-page-btn" });
    nextBtn.disabled = state.currentPage >= totalPages - 1;
    nextBtn.addEventListener("click", () => { state.currentPage++; renderView(); });

    let timeSortText = "🕒 时间";
    let isTimeActive = state.sortKey === "time";
    if (isTimeActive) { timeSortText += state.sortOrder === 1 ? " ▲ (最早)" : " ▼ (最近)"; }
    
    const timeSortBtn = footerBar.createEl("button", { 
        text: timeSortText, 
        cls: `dv-time-sort-btn ${isTimeActive ? "" : "inactive"}` 
    });
    timeSortBtn.addEventListener("click", () => {
        if (state.sortKey === "time") { state.sortOrder *= -1; } 
        else { state.sortKey = "time"; state.sortOrder = -1; }
        renderView();
    });
}

setTimeout(() => { renderView(); }, 50);
```
