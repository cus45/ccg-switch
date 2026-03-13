import { useTranslation } from 'react-i18next';
import { Copy } from 'lucide-react';

const INSTALL_COMMANDS = `# Claude Code
curl -fsSL https://claude.ai/install.sh | bash
# Codex
npm i -g @openai/codex@latest
# Gemini CLI
npm i -g @google/gemini-cli@latest
# OpenCode
curl -fsSL https://opencode.ai/install | bash`;

function InstallCommandPanel() {
    const { t } = useTranslation();

    const copyToClipboard = async (text: string) => {
        try { await navigator.clipboard.writeText(text); } catch { /* silent */ }
    };

    return (
        <div className="bg-white dark:bg-base-100 rounded-xl p-5 shadow-sm border border-gray-100 dark:border-base-200">
            <div className="flex items-center justify-between mb-3">
                <h2 className="font-semibold text-gray-900 dark:text-base-content">
                    {t('settings.oneClickInstall', { defaultValue: '一键安装命令' })}
                </h2>
                <button
                    onClick={() => copyToClipboard(INSTALL_COMMANDS)}
                    className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-lg border border-gray-200 dark:border-base-300 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-base-300 transition-colors"
                >
                    <Copy className="w-3 h-3" />
                    {t('common.copy', { defaultValue: '复制' })}
                </button>
            </div>
            <p className="text-xs text-gray-400 mb-2">
                {t('settings.oneClickInstallHint', { defaultValue: '在终端中执行以下命令安装对应工具。' })}
            </p>
            <pre className="text-xs font-mono bg-gray-50 dark:bg-base-200 px-3 py-2.5 rounded-lg border border-gray-100 dark:border-base-300 overflow-x-auto text-gray-600 dark:text-gray-400 leading-relaxed">
                {INSTALL_COMMANDS}
            </pre>
        </div>
    );
}

export default InstallCommandPanel;
