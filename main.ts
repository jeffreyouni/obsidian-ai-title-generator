import {
  App,
  Editor,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile,
  normalizePath,
  requestUrl,
} from 'obsidian';
import pMap from 'p-map';
import path from 'path-browserify';

interface TitleGeneratorSettings {
  openAiApiKey: string;
  baseURL: string;
  model: string;
  lowerCaseTitles: boolean;
}

const DEFAULT_SETTINGS: TitleGeneratorSettings = {
  openAiApiKey: '',
  baseURL: 'https://api.openai.com/v1',
  model: 'gpt-3.5-turbo',
  lowerCaseTitles: false,
};

class TitleGeneratorSettingTab extends PluginSettingTab {
  plugin: TitleGeneratorPlugin;

  constructor(app: App, plugin: TitleGeneratorPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl).setName('API key').addText((text) => {
      text.inputEl.type = 'password';
      text.inputEl.addClass('ai-title-generator-input');

      text
        .setPlaceholder('API Key')
        .setValue(this.plugin.settings.openAiApiKey)
        .onChange(async (newValue) => {
          this.plugin.settings.openAiApiKey = newValue;
          await this.plugin.saveSettings();
        });
    });

    new Setting(containerEl)
      .setName('API base URL')
      .setDesc(
        'Custom OpenAI API base URL (e.g., https://api.chatanywhere.tech/v1)'
      )
      .addText((text) => {
        text.inputEl.addClass('ai-title-generator-input');
        text
          .setPlaceholder('https://api.openai.com/v1')
          .setValue(this.plugin.settings.baseURL)
          .onChange(async (newValue) => {
            this.plugin.settings.baseURL = newValue;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName('Model')
      .setDesc(
        'Enter the AI model name (e.g., gpt-3.5-turbo, gpt-4o, deepseek-v3, claude-3-5-sonnet-20241022, etc.)'
      )
      .addText((text) => {
        text.inputEl.addClass('ai-title-generator-input');
        text
          .setPlaceholder('gpt-3.5-turbo')
          .setValue(this.plugin.settings.model)
          .onChange(async (newValue) => {
            this.plugin.settings.model = newValue;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName('Lower-case titles')
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.lowerCaseTitles)
          .onChange(async (newValue) => {
            this.plugin.settings.lowerCaseTitles = newValue;
            await this.plugin.saveSettings();
          });
      });
  }
}

export default class TitleGeneratorPlugin extends Plugin {
  settings: TitleGeneratorSettings;

  private async generateTitle(file: TFile, content: string) {
    const loadingStatus = this.addStatusBarItem();
    loadingStatus.createEl('span', { text: 'Generating title...' });

    try {
      const apiUrl = this.settings.baseURL.endsWith('/chat/completions')
        ? this.settings.baseURL
        : `${this.settings.baseURL}/chat/completions`;

      const response = await requestUrl({
        url: apiUrl,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.settings.openAiApiKey}`,
        },
        body: JSON.stringify({
          model: this.settings.model,
          messages: [
            {
              role: 'system',
              content:
                'You are a helpful assistant that generates concise, descriptive titles for text content. Respond with only the title, without quotes or extra punctuation.',
            },
            {
              role: 'user',
              content: `Given the following text:\n###\n${content}\n###\n\nGenerate a succinct, descriptive title:`,
            },
          ],
          max_tokens: 50,
          temperature: 0.7,
        }),
      });

      const data = response.json;
      let title = data.choices[0].message.content.trim();

      if (this.settings.lowerCaseTitles) {
        title = title.toLowerCase();
      }

      const currentPath = path.parse(file.path);
      const newPath = normalizePath(
        `${currentPath.dir}/${title}${currentPath.ext}`
      );

      await this.app.fileManager.renameFile(file, newPath);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      new Notice(`Unable to generate title:\n\nError: ${errorMessage}`);
      console.error('Title generation error:', err);
    } finally {
      loadingStatus.remove();
    }
  }

  private async generateTitleFromFile(file: TFile) {
    const content = await file.vault.cachedRead(file);
    return this.generateTitle(file, content);
  }

  private async generateTitleFromEditor(editor: Editor) {
    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile) {
      throw new Error('No active file');
    }

    const content = editor.getValue();
    await this.generateTitle(activeFile, content);
  }

  async onload() {
    await this.loadSettings();

    this.addCommand({
      id: 'title-generator-generate-title',
      name: 'Generate title',
      editorCallback: (editor) => this.generateTitleFromEditor(editor),
    });

    this.registerEvent(
      this.app.workspace.on('file-menu', (menu, file) => {
        if (!(file instanceof TFile)) {
          return;
        }

        menu.addItem((item) => {
          item
            .setTitle('Generate title')
            .setIcon('lucide-edit-3')
            .onClick(() => this.generateTitleFromFile(file));
        });
      })
    );

    this.registerEvent(
      this.app.workspace.on('files-menu', (menu, files) => {
        const tFiles = files.filter((f) => f instanceof TFile);
        if (tFiles.length < 1) {
          return;
        }

        menu.addItem((item) => {
          item
            .setTitle('Generate titles')
            .setIcon('lucide-edit-3')
            .onClick(() =>
              pMap<TFile, void>(tFiles, (f) => this.generateTitleFromFile(f), {
                concurrency: 1,
              })
            );
        });
      })
    );

    this.addSettingTab(new TitleGeneratorSettingTab(this.app, this));
  }

  async loadSettings() {
    this.settings = { ...DEFAULT_SETTINGS, ...(await this.loadData()) };
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}
