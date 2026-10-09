/**
 * 支持内置余额查询的服务商域名（与后端 `builtin_balance_service::detect` 保持一致）
 *
 * 供应商没有配置用量脚本时，Base URL 命中这些域名就在卡片上直接显示余额。
 */
const BUILTIN_BALANCE_HOSTS = [
    'api.deepseek.com',
    'api.stepfun.com',
    'api.stepfun.ai',
    'api.siliconflow.cn',
    'api.siliconflow.com',
    'openrouter.ai',
    'api.novita.ai',
];

export function supportsBuiltinBalance(url: string | undefined | null): boolean {
    if (!url) return false;
    const lower = url.toLowerCase();
    return BUILTIN_BALANCE_HOSTS.some((host) => lower.includes(host));
}
