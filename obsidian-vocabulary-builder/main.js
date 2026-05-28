const { Plugin, ItemView, WorkspaceLeaf, Notice } = require('obsidian');
const VIEW_TYPE_VOCAB = "vocabulary-builder-view";
const DEFAULT_DB_PATH = "x/Visuals/Words/生词本数据库.md";

class VocabularyView extends ItemView {
    constructor(leaf, plugin) {
        super(leaf);
        this.plugin = plugin;
        this.currentMode = "en"; // 默认模式：en (英语), ja (日语)
        this.editingIndex = null; // 核心：新增指针，记录当前正在编辑的已有单词在数组中的位置
    }

    getViewType() { return VIEW_TYPE_VOCAB; }
    getDisplayText() { return "生词助手"; }
    getIcon() { return "languages"; }

    async onOpen() {
        const container = this.contentEl;
        container.empty();
        this.injectStyles();

        // 主包裹容器
        const mainContainer = container.createDiv({ cls: "vocab-main-container" });

        // --- 模式切换器 (Tabs 样式) ---
        const modeToggleContainer = mainContainer.createDiv({ cls: "vocab-mode-toggle" });
        this.enModeBtn = modeToggleContainer.createEl("button", { text: "English", cls: "vocab-mode-btn active" });
        this.jaModeBtn = modeToggleContainer.createEl("button", { text: "日本語", cls: "vocab-mode-btn" });

        // --- 1. 核心输入区域 ---
        this.wordSection = mainContainer.createDiv({ cls: "vocab-section" });
        this.wordLabel = this.wordSection.createEl("label", { text: "生词", cls: "vocab-label" });
        this.wordInput = this.wordSection.createEl("input", { 
            type: "text", 
            cls: "vocab-input-text vocab-search-input",
            placeholder: "输入单词，回车检索..." 
        });

        // 日语汉字框
        this.kanjiSection = mainContainer.createDiv({ cls: "vocab-section vocab-hidden" });
        this.kanjiLabel = this.kanjiSection.createEl("label", { text: "对应汉字", cls: "vocab-label" });
        this.kanjiInput = this.kanjiSection.createEl("input", { 
            type: "text", 
            cls: "vocab-input-text",
            placeholder: "例：病気" 
        });

        // --- 2. 详情表单区域 ---
        const formSection = mainContainer.createDiv({ cls: "vocab-form-section" });

        // 意思输入框
        const meaningGroup = formSection.createDiv({ cls: "vocab-input-group" });
        meaningGroup.createEl("label", { text: "词义说明", cls: "vocab-label" });
        this.meaningInput = meaningGroup.createEl("input", { 
            type: "text", 
            cls: "vocab-input-text",
            placeholder: "输入词义说明..."
        });

        // 备注框
        const notesGroup = formSection.createDiv({ cls: "vocab-input-group" });
        notesGroup.createEl("label", { text: "记忆备注", cls: "vocab-label" });
        this.notesInput = notesGroup.createEl("textarea", { 
            cls: "vocab-input-textarea",
            placeholder: "输入备注或例句..."
        });

        // 听力词选项 & 搜索次数行
        const metaRow = formSection.createDiv({ cls: "vocab-meta-row" });
        const listeningGroup = metaRow.createDiv({ cls: "vocab-checkbox-group" });
        this.listeningCheckbox = listeningGroup.createEl("input", { type: "checkbox" });
        this.listeningCheckbox.id = "vocab-listening-cb";
        const cbLabel = listeningGroup.createEl("label", { text: " 听力重点词" });
        cbLabel.setAttribute("for", "vocab-listening-cb");

        this.countEl = metaRow.createDiv({ cls: "vocab-count-display", text: "被索次数：0" });

        // --- 切换模式事件绑定 ---
        this.enModeBtn.addEventListener("click", () => this.switchMode("en"));
        this.jaModeBtn.addEventListener("click", () => this.switchMode("ja"));

        // --- 全键盘流事件绑定 ---
        this.wordInput.addEventListener("keydown", async (e) => {
            if (e.key === "Enter") {
                e.preventDefault();
                await this.handleSearch();
            }
        });

        this.kanjiInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                e.preventDefault();
                this.meaningInput.focus();
            }
        });

        this.meaningInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                e.preventDefault(); 
                this.notesInput.focus(); 
            }
        });

        this.notesInput.addEventListener("keydown", async (e) => {
            if (e.key === "Enter") {
                if (e.shiftKey) {
                    return; 
                } else {
                    e.preventDefault();
                    await this.handleSave();
                }
            }
        });
    }

    // 模式切换
    switchMode(mode) {
        this.currentMode = mode;
        this.clearForm(true);
        if (mode === "en") {
            this.enModeBtn.addClass("active");
            this.jaModeBtn.removeClass("active");
            this.kanjiSection.addClass("vocab-hidden");
            this.wordLabel.setText("生词");
            this.wordInput.placeholder = "输入单词，回车检索...";
        } else {
            this.jaModeBtn.addClass("active");
            this.enModeBtn.removeClass("active");
            this.kanjiSection.removeClass("vocab-hidden");
            this.wordLabel.setText("假名");
            this.wordInput.placeholder = "输入假名，回车检索";
        }
        this.wordInput.focus();
    }

    // 核心逻辑：查询
    async handleSearch() {
        const word = this.wordInput.value.trim();
        if (!word) return;

        // 检索前确保表单是启用状态
        this.setFormDisabled(false);

        const db = await this.plugin.readDatabase();
        const index = db.findIndex(item => item.word.toLowerCase() === word.toLowerCase() && item.lang === this.currentMode);

        if (index !== -1) {
            // 1. 自动增加搜索次数并写入
            db[index].count = parseInt(db[index].count) + 1;
            await this.plugin.writeDatabase(db);

            // 2. 填充数据
            const item = db[index];
            this.meaningInput.value = item.meaning;
            this.notesInput.value = item.notes.replace(/<br>/g, "\n");
            this.listeningCheckbox.checked = item.isListening === "是";
            this.countEl.setText(`被索次数：${item.count}`);
            
            if (this.currentMode === "ja") {
                this.kanjiInput.value = item.kanji || "";
            }

            // 3. 进入“修改模式”：记录下它的索引，并且【绝不禁用表单】
            this.editingIndex = index;
            new Notice(`🔍 [${word}] 已存在，当前检索次数：${item.count}。可直接修改内容。`);
            
            // 4. 路由光标流：方便直接开始修改内容
            if (this.currentMode === "ja") {
                this.kanjiInput.focus();
            } else {
                this.meaningInput.focus();
            }
        } else {
            // 进入“新建录入模式”
            this.editingIndex = null;
            this.clearForm(false); 
            this.countEl.setText("被索次数：0");
            new Notice(`❌ 未找到 [${word}]，请开始录入。`);
            
            if (this.currentMode === "ja") {
                this.kanjiInput.focus();
            } else {
                this.meaningInput.focus();
            }
        }
    }

    // 核心逻辑：保存（兼顾 新增录入 与 旧词更新）
    async handleSave() {
        const word = this.wordInput.value.trim();
        const kanji = this.currentMode === "ja" ? this.kanjiInput.value.trim() : "";
        const meaning = this.meaningInput.value.trim();
        const notes = this.notesInput.value.trim().replace(/\n/g, "<br>"); 
        const isListening = this.listeningCheckbox.checked ? "是" : "否";

        // 基础规则校验
        if (!word) {
            new Notice(this.currentMode === "en" ? "⚠️ 生词栏不能为空！" : "⚠️ 假名栏不能为空！");
            this.wordInput.focus();
            return;
        }
        if (!meaning) {
            new Notice("⚠️ 词义说明不能为空！");
            this.meaningInput.focus();
            return;
        }

        const db = await this.plugin.readDatabase();

        if (this.editingIndex !== null) {
            // 【修改模式】：直接更新已有行
            // 保留原本的 count（因为在上面查询时已经累加过了）和初次记录的时间 time
            db[this.editingIndex].kanji = kanji;
            db[this.editingIndex].meaning = meaning;
            db[this.editingIndex].notes = notes;
            db[this.editingIndex].isListening = isListening;

            await this.plugin.writeDatabase(db);
            new Notice(`💾 [${word}] 更新成功！`);
        } else {
            // 【新建模式】：严格检查是否在检索后被手动改成了一个已存在的词
            const isExist = db.some(item => item.word.toLowerCase() === word.toLowerCase() && item.lang === this.currentMode);
            if (isExist) {
                new Notice("⚠️ 该词汇已在数据库中，请先输入回车检索它再进行修改！");
                return;
            }

            // 获取当前时间（精确到小时）
            const now = new Date();
            const year = now.getFullYear();
            const month = String(now.getMonth() + 1).padStart(2, '0');
            const day = String(now.getDate()).padStart(2, '0');
            const hour = String(now.getHours()).padStart(2, '0');
            const timeStr = `${year}-${month}-${day} ${hour}:00`;

            // 写入全新数据项
            db.push({
                lang: this.currentMode,
                word: word,
                kanji: kanji,
                meaning: meaning,
                notes: notes,
                isListening: isListening,
                count: 0,
                time: timeStr
            });
            
            await this.plugin.writeDatabase(db);
            new Notice(`✨ [${word}] 录入成功！`);
        }
        
        // 扫尾：重置状态，清空并聚焦
        this.editingIndex = null;
        this.clearForm(true);
        this.countEl.setText("被索次数：0");
        this.wordInput.focus();
    }

    clearForm(clearWord = true) {
        if (clearWord) this.wordInput.value = "";
        this.kanjiInput.value = "";
        this.meaningInput.value = "";
        this.notesInput.value = "";
        this.listeningCheckbox.checked = false;
        this.setFormDisabled(false);
    }

    setFormDisabled(disabled) {
        this.kanjiInput.disabled = disabled;
        this.meaningInput.disabled = disabled;
        this.notesInput.disabled = disabled;
        this.listeningCheckbox.disabled = disabled;
    }

    injectStyles() {
        const existingStyle = document.getElementById("vocab-builder-styles");
        if (existingStyle) existingStyle.remove();

        const style = document.createElement("style");
        style.id = "vocab-builder-styles";
        style.textContent = `
            .vocab-main-container { padding: 16px 12px; display: flex; flex-direction: column; gap: 16px; max-width: 100%; margin: 0 auto; }
            .vocab-title { margin: 0 0 4px 0; font-size: 1.2rem; font-weight: 600; color: var(--text-normal); text-align: center; }
            
            .vocab-mode-toggle { display: flex; background: var(--background-secondary-alt); border: 1px solid var(--background-modifier-border); padding: 2px; border-radius: 6px; margin-bottom: 4px; }
            .vocab-mode-btn { flex: 1; border: none !important; background: transparent !important; padding: 6px 0 !important; font-size: 0.85rem !important; font-weight: 500 !important; color: var(--text-muted) !important; border-radius: 4px !important; cursor: pointer; transition: all 0.2s ease; shadow: none !important;}
            .vocab-mode-btn.active { background: var(--background-primary) !important; color: var(--text-accent) !important; font-weight: 600 !important; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
            
            .vocab-section { display: flex; flex-direction: column; gap: 6px; }
            .vocab-hidden { display: none !important; }
            .vocab-label { font-size: 0.82rem; font-weight: 500; color: var(--text-muted); letter-spacing: 0.3px; }
            
            .vocab-input-text { width: 100% !important; padding: 8px 10px !important; border-radius: 4px !important; border: 1px solid var(--background-modifier-border) !important; background-color: var(--background-modifier-form-field) !important; color: var(--text-normal) !important; font-size: 0.95rem !important; line-height: 1.4 !important; transition: border-color 0.2s ease, box-shadow 0.2s ease; }
            .vocab-input-text::placeholder, .vocab-input-textarea::placeholder { font-size: 0.88rem !important; font-weight: normal !important; color: var(--text-faint) !important; }
            .vocab-input-text:focus, .vocab-input-textarea:focus { border-color: var(--interactive-accent) !important; box-shadow: 0 0 0 2px var(--background-modifier-border-focus) !important; outline: none !important; }
            
            .vocab-search-input { font-size: 1.1rem !important; font-weight: 500 !important; letter-spacing: 0.3px; }
            .vocab-form-section { display: flex; flex-direction: column; gap: 12px; border-top: 1px solid var(--background-modifier-border); padding-top: 14px; }
            .vocab-input-group { display: flex; flex-direction: column; gap: 6px; }
            
            .vocab-input-textarea { width: 100% !important; height: 90px !important; padding: 8px 10px !important; border-radius: 4px !important; border: 1px solid var(--background-modifier-border) !important; background-color: var(--background-modifier-form-field) !important; color: var(--text-normal) !important; resize: none !important; font-family: inherit !important; font-size: 0.95rem !important; line-height: 1.4 !important; transition: border-color 0.2s ease, box-shadow 0.2s ease; }
            .vocab-meta-row { display: flex; justify-content: space-between; align-items: center; font-size: 0.88rem; margin-top: 2px; }
            .vocab-checkbox-group { display: flex; align-items: center; gap: 6px; cursor: pointer; font-size: 0.88rem; color: var(--text-muted); }
            .vocab-checkbox-group input[type="checkbox"] { width: 15px; height: 15px; cursor: pointer; }
            .vocab-count-display { font-size: 0.82rem; font-weight: 500; color: var(--text-muted); background: var(--background-secondary-alt); padding: 2px 8px; border-radius: 4px; border: 1px solid var(--background-modifier-border); }
        `;
        document.head.appendChild(style);
    }

    async onClose() {}
}

module.exports = class VocabularyBuilderPlugin extends Plugin {
    async onload() {
        this.registerView(VIEW_TYPE_VOCAB, (leaf) => new VocabularyView(leaf, this));
        this.addRibbonIcon("languages", "打开生词助手", () => this.activateView());
        this.addCommand({
            id: "open-vocabulary-builder",
            name: "打开生词查询面板",
            callback: () => this.activateView(),
        });
        await this.ensureDatabaseExists();
    }

    async activateView() {
        const { workspace } = this.app;
        let leaf = workspace.getLeavesOfType(VIEW_TYPE_VOCAB)[0];
        if (!leaf) {
            leaf = workspace.getRightLeaf(false);
            await leaf.setViewState({ type: VIEW_TYPE_VOCAB, active: true });
        }
        workspace.revealLeaf(leaf);
    }

    async readDatabase() {
        await this.ensureDatabaseExists();
        const content = await this.app.vault.adapter.read(DEFAULT_DB_PATH);
        const lines = content.split("\n");
        const data = [];

        for (let i = 3; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line || !line.startsWith("|")) continue;
            
            const parts = line.split("|").map(p => p.trim());
            if (parts.length >= 9) {
                const word = parts[2];
                if (word === "---" || (!word && !parts[4])) continue;

                data.push({
                    lang: parts[1],
                    word: word,
                    kanji: parts[3],
                    meaning: parts[4],
                    notes: parts[5],
                    isListening: parts[6],
                    count: parseInt(parts[7]) || 0,
                    time: parts[8]
                });
            }
        }
        return data;
    }

    async writeDatabase(data) {
        await this.ensureDirectoryExists(DEFAULT_DB_PATH);
        let content = "# 📓 我的生词本数据库\n\n";
        content += "| 语种 | 单词/假名 | 汉字 | 意思 | 备注 | 是否为听力词 | 搜索次数 | 记录时间 |\n";
        content += "| --- | --- | --- | --- | --- | --- | --- | --- |\n";
        
        data.forEach(item => {
            content += `| ${item.lang} | ${item.word} | ${item.kanji} | ${item.meaning} | ${item.notes} | ${item.isListening} | ${item.count} | ${item.time} |\n`;
        });
        await this.app.vault.adapter.write(DEFAULT_DB_PATH, content);
    }

    async ensureDatabaseExists() {
        await this.ensureDirectoryExists(DEFAULT_DB_PATH);
        const exists = await this.app.vault.adapter.exists(DEFAULT_DB_PATH);
        if (!exists) {
            const initialContent = "# 📓 我的生词本数据库\n\n| 语种 | 单词/假名 | 汉字 | 意思 | 备注 | 是否为听力词 | 搜索次数 | 记录时间 |\n| --- | --- | --- | --- | --- | --- | --- | --- |\n";
            await this.app.vault.adapter.write(DEFAULT_DB_PATH, initialContent);
        }
    }

    async ensureDirectoryExists(filePath) {
        const parts = filePath.split('/');
        if (parts.length > 1) {
            let currentPath = "";
            for (let i = 0; i < parts.length - 1; i++) {
                currentPath += (i === 0 ? "" : "/") + parts[i];
                if (!(await this.app.vault.adapter.exists(currentPath))) {
                    await this.app.vault.adapter.mkdir(currentPath);
                }
            }
        }
    }

    onunload() { this.app.workspace.detachLeavesOfType(VIEW_TYPE_VOCAB); }
}