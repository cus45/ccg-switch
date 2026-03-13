import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useAboutStore } from '../../stores/useAboutStore';
import VersionInfoCard from './about/VersionInfoCard';
import ToolStatusGrid from './about/ToolStatusGrid';
import InstallCommandPanel from './about/InstallCommandPanel';

function AboutPanel() {
    const { t } = useTranslation();
    const { fetchToolVersions, loadAppVersion, initEventListeners } = useAboutStore();

    useEffect(() => {
        initEventListeners();
        loadAppVersion();
        fetchToolVersions();
    }, [fetchToolVersions, loadAppVersion, initEventListeners]);

    return (
        <div className="space-y-6">
            {/* 关于 - 标题 */}
            <div>
                <h2 className="font-semibold text-gray-900 dark:text-base-content">
                    {t('settings.about.title', { defaultValue: '关于' })}
                </h2>
                <p className="text-xs text-gray-400 mt-0.5">
                    {t('settings.aboutHint', { defaultValue: '查看版本信息与更新状态。' })}
                </p>
            </div>
            <VersionInfoCard />
            <ToolStatusGrid />
            <InstallCommandPanel />
        </div>
    );
}

export default AboutPanel;
