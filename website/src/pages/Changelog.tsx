import { Tag, Calendar, Github, Sparkles, Wrench, Zap } from 'lucide-react';
import { RELEASES_URL } from '../config/site';

interface Version {
  version: string;
  date: string;
  type: 'major' | 'minor' | 'patch';
  changes: {
    type: 'feature' | 'fix' | 'improvement' | 'breaking';
    text: string;
  }[];
}

const versions: Version[] = [
        {
    version: '1.2.18',
    date: '2026-03-13',
    type: 'patch',
    changes: [
      { type: 'improvement', text: '优化：设置页面"关于"选项卡加载速度，工具版本检测改为并行执行 + 非阻塞调用 + 5分钟缓存' },
      { type: 'improvement', text: '优化：服务商页面和技能管理页面顶部搜索/筛选栏固定，内容区域独立滚动' },
      { type: 'fix', text: '修复：导入配置时取消文件选择对话框后按钮一直转圈的问题' }
    ]
  },
        {
    version: '1.2.17',
    date: '2026-03-12',
    type: 'patch',
    changes: [
      { type: 'fix', text: "修复 Windows 和 Linux 打包编译错误" }
    ]
  },
{
    version: '1.2.16',
    date: '2026-03-12',
    type: 'patch',
    changes: [
      { type: 'fix', text: "修复 Linux 打包编译错误" }
    ]
  },
{
    version: '1.2.15',
    date: '2026-03-12',
    type: 'patch',
    changes: [
      { type: 'fix', text: "统一版本号到 1.2.15" }
    ]
  },
{
    version: 'v1.2.14',
    date: '2025-03-12',
    type: 'minor',
    changes: [
      { type: 'feature', text: '新增：macOS 更新自动安装功能' },
      { type: 'feature', text: '新增：安装进度实时跟踪（挂载→复制→验证→清理→完成）' },
      { type: 'feature', text: '新增：权限不足时显示详细引导提示' },
      { type: 'improvement', text: '优化：更新安装界面交互体验' },
      { type: 'improvement', text: '新增：安装失败时提供重新下载按钮' }
    ]
  },
  {
    version: 'v1.2.13',
    date: '2025-03-12',
    type: 'minor',
    changes: [
      { type: 'feature', text: '新增：macOS 更新自动安装功能' },
      { type: 'feature', text: '新增：安装进度实时跟踪（挂载→复制→验证→清理→完成）' },
      { type: 'feature', text: '新增：权限不足时显示详细引导提示' },
      { type: 'improvement', text: '优化：更新安装界面交互体验' },
      { type: 'improvement', text: '新增：安装失败时提供重新下载按钮' }
    ]
  },
  {
    version: 'v1.2.12',
    date: '2025-01-13',
    type: 'patch',
    changes: [
      { type: 'fix', text: '修复编译错误，优化构建流程' },
      { type: 'improvement', text: '优化技能页卡片排版，提升视觉体验' },
      { type: 'fix', text: '修复若干已知问题' }
    ]
  },
  {
    version: 'v1.2.11',
    date: '2025-01-10',
    type: 'minor',
    changes: [
      { type: 'feature', text: '新增：技能页面卡片展示模式' },
      { type: 'feature', text: '新增：Prompt 预设管理功能' },
      { type: 'improvement', text: '优化：MCP 服务器配置界面' },
      { type: 'fix', text: '修复：Token 切换时的配置写入问题' }
    ]
  },
  {
    version: 'v1.2.10',
    date: '2024-12-28',
    type: 'minor',
    changes: [
      { type: 'feature', text: '新增：仪表盘数据统计功能' },
      { type: 'feature', text: '新增：活跃度历史图表' },
      { type: 'improvement', text: '优化：应用启动性能' },
      { type: 'fix', text: '修复：语言切换不生效的问题' }
    ]
  },
  {
    version: 'v1.2.0',
    date: '2024-12-15',
    type: 'major',
    changes: [
      { type: 'feature', text: '重大更新：全新的 UI 设计' },
      { type: 'feature', text: '新增：暗色模式支持' },
      { type: 'feature', text: '新增：中英文国际化' },
      { type: 'improvement', text: '重构：状态管理迁移至 Zustand' },
      { type: 'improvement', text: '优化：响应式布局适配移动端' }
    ]
  },
  {
    version: 'v1.1.0',
    date: '2024-11-20',
    type: 'minor',
    changes: [
      { type: 'feature', text: '新增：MCP 服务器管理功能' },
      { type: 'feature', text: '新增：项目级 MCP 配置支持' },
      { type: 'improvement', text: '优化：Token 管理界面' },
      { type: 'fix', text: '修复：配置文件读写权限问题' }
    ]
  },
  {
    version: 'v1.0.0',
    date: '2024-11-01',
    type: 'major',
    changes: [
      { type: 'feature', text: '首个稳定版本发布' },
      { type: 'feature', text: '支持多 API Token 管理' },
      { type: 'feature', text: '支持自定义 API 端点' },
      { type: 'feature', text: '支持模型配置映射' },
      { type: 'feature', text: '基础 CLAUDE.md 管理功能' }
    ]
  }
];

const changeTypeConfig = {
  feature: { icon: Sparkles, gradient: 'from-emerald-500 to-teal-500', label: '新功能' },
  fix: { icon: Wrench, gradient: 'from-red-500 to-orange-500', label: '修复' },
  improvement: { icon: Zap, gradient: 'from-blue-500 to-cyan-500', label: '优化' },
  breaking: { icon: Tag, gradient: 'from-purple-500 to-pink-500', label: '重大变更' }
};

const versionTypeConfig = {
  major: { badge: 'Major', gradient: 'from-purple-500 to-pink-500' },
  minor: { badge: 'Minor', gradient: 'from-blue-500 to-cyan-500' },
  patch: { badge: 'Patch', gradient: 'from-gray-500 to-gray-600' }
};

export default function Changelog() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950">
      {/* Background effects */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/3 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl" />
        <div className="absolute bottom-1/3 right-1/3 w-80 h-80 bg-blue-500/10 rounded-full blur-3xl" />
      </div>

      <div className="relative z-10">
        {/* Header */}
        <div className="py-20 sm:py-28 px-4 sm:px-6 lg:px-8">
          <div className="max-w-4xl mx-auto text-center">
            <div className="inline-flex items-center space-x-2 px-4 py-2 bg-white/5 backdrop-blur-sm border border-white/10 rounded-full mb-6">
              <Tag size={16} className="text-orange-400" />
              <span className="text-sm text-gray-300">版本历史</span>
            </div>
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold mb-6">
              <span className="bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent">
                更新日志
              </span>
            </h1>
            <p className="text-xl text-gray-400 max-w-2xl mx-auto">
              跟踪 CCG Switch 的版本更新和改进记录
            </p>
          </div>
        </div>

        {/* Latest Version Banner */}
        <section className="py-8 px-4 sm:px-6 lg:px-8">
          <div className="max-w-4xl mx-auto">
            <div className="relative p-8 bg-gradient-to-br from-orange-500/20 via-pink-500/20 to-rose-500/20 backdrop-blur-sm rounded-2xl border border-orange-500/30 overflow-hidden">
              {/* Animated background */}
              <div className="absolute inset-0 bg-gradient-to-r from-orange-500/10 via-pink-500/10 to-rose-500/10 animate-gradient-shift" />

              <div className="relative">
                <div className="flex items-center space-x-3 mb-4">
                  <div className="px-3 py-1 bg-gradient-to-r from-orange-500 to-pink-500 rounded-full">
                    <span className="text-white text-sm font-medium">最新版本</span>
                  </div>
                  <a
                    href={RELEASES_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center space-x-2 text-orange-400 hover:text-orange-300 transition-colors"
                  >
                    <Github size={18} />
                    <span className="text-sm">查看 Release</span>
                  </a>
                </div>
                <div className="text-4xl font-bold text-white mb-2">{versions[0].version}</div>
                <div className="flex items-center space-x-2 text-gray-400">
                  <Calendar size={16} />
                  <span className="text-sm">{versions[0].date}</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Version Timeline */}
        <section className="py-16 px-4 sm:px-6 lg:px-8">
          <div className="max-w-4xl mx-auto">
            <div className="relative">
              {/* Timeline line */}
              <div className="absolute left-8 top-0 bottom-0 w-px bg-gradient-to-b from-orange-500 via-pink-500 to-transparent" />

              {/* Version cards */}
              <div className="space-y-8">
                {versions.map((release) => (
                  <div key={release.version} className="relative pl-20">
                    {/* Timeline dot */}
                    <div className={`absolute left-6 w-5 h-5 rounded-full bg-gradient-to-r ${versionTypeConfig[release.type].gradient} border-4 border-slate-900 shadow-lg`} />

                    {/* Version card */}
                    <div className="group p-6 bg-white/5 backdrop-blur-sm rounded-xl border border-white/10 hover:border-white/20 transition-all">
                      {/* Header */}
                      <div className="flex flex-wrap items-center gap-4 mb-4">
                        <h3 className="text-2xl font-bold text-white">{release.version}</h3>
                        <div className={`px-2 py-0.5 bg-gradient-to-r ${versionTypeConfig[release.type].gradient} rounded-full`}>
                          <span className="text-white text-xs font-medium">{versionTypeConfig[release.type].badge}</span>
                        </div>
                        <span className="flex items-center text-gray-500 text-sm">
                          <Calendar size={14} className="mr-1" />
                          {release.date}
                        </span>
                      </div>

                      {/* Changes */}
                      <div className="space-y-2">
                        {release.changes.map((change, idx) => {
                          const Icon = changeTypeConfig[change.type].icon;
                          return (
                            <div key={idx} className="flex items-start space-x-3">
                              <div className={`flex-shrink-0 w-8 h-8 rounded-lg bg-gradient-to-br ${changeTypeConfig[change.type].gradient} p-0.5`}>
                                <div className="w-full h-full rounded-lg bg-slate-900 flex items-center justify-center">
                                  <Icon className={`bg-gradient-to-br ${changeTypeConfig[change.type].gradient} bg-clip-text text-transparent`} size={16} />
                                </div>
                              </div>
                              <div className="flex-1 pt-1">
                                <span className="text-gray-300 text-sm">{change.text}</span>
                              </div>
                              <div className={`px-2 py-0.5 bg-gradient-to-r ${changeTypeConfig[change.type].gradient} rounded-full`}>
                                <span className="text-white text-xs">{changeTypeConfig[change.type].label}</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      {/* Hover effect */}
                      <div className="absolute inset-0 bg-gradient-to-r from-orange-500/5 via-pink-500/5 to-rose-500/5 opacity-0 group-hover:opacity-100 rounded-xl transition-opacity pointer-events-none" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* View All */}
        <section className="py-16 px-4 sm:px-6 lg:px-8">
          <div className="max-w-4xl mx-auto">
            <div className="p-8 bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 text-center">
              <h3 className="text-xl font-bold text-white mb-3">查看完整历史</h3>
              <p className="text-gray-400 mb-6">访问 GitHub Releases 页面查看所有版本的详细变更</p>
              <a
                href={RELEASES_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center space-x-2 px-6 py-3 bg-white/10 hover:bg-white/20 text-white font-medium rounded-xl border border-white/20 transition-all group"
              >
                <Github size={18} />
                <span>GitHub Releases</span>
              </a>
            </div>
          </div>
        </section>
      </div>

      <style>{`
        @keyframes gradient-shift {
          0%, 100% { transform: translateX(0) translateY(0); }
          25% { transform: translateX(-2%) translateY(2%); }
          50% { transform: translateX(2%) translateY(-2%); }
          75% { transform: translateX(-2%) translateY(-2%); }
        }
      `}</style>
    </div>
  );
}
