#!/usr/bin/env node
/**
 * 从 cc-switch 上游同步供应商预设，生成 src/config/providerPresets.generated.ts
 *
 * 用法：
 *   node scripts/sync-provider-presets.mjs [上游仓库路径] [git ref]
 *   默认：../demo/cc-switch  origin/main（需先在上游仓库 git fetch）
 *
 * 只保留本项目能直接使用的字段与预设：
 * - 跳过需要 OAuth、隐藏、需要接口格式转换（本项目未实现）的预设；模板变量取默认值，仍有占位符的跳过
 * - 跳过没有 Base URL 的官方登录类预设
 * - 去掉推广 / 追踪参数；合作伙伴预设不保留邀请链接，官网只留到域名
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const upstream = path.resolve(root, process.argv[2] ?? '../demo/cc-switch');
const ref = process.argv[3] ?? 'origin/main';

const SOURCES = {
    claude: ['src/config/claudeProviderPresets.ts', 'providerPresets'],
    codex: ['src/config/codexProviderPresets.ts', 'codexProviderPresets'],
    gemini: ['src/config/geminiProviderPresets.ts', 'geminiProviderPresets'],
    opencode: ['src/config/opencodeProviderPresets.ts', 'opencodeProviderPresets'],
    claudedesktop: ['src/config/claudeDesktopProviderPresets.ts', 'claudeDesktopProviderPresets'],
};

/** 取上游文件、转成 CommonJS 后执行，拿到导出的预设数组 */
function loadPresets(file, exportName) {
    const source = execFileSync('git', ['-C', upstream, 'show', `${ref}:${file}`], { encoding: 'utf8' });
    const { outputText } = ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    });
    const module = { exports: {} };
    // 只剩类型以外的跨文件依赖时给空对象；预设数据本身都在单文件里
    const stubRequire = () => new Proxy({}, { get: () => undefined });
    new Function('module', 'exports', 'require', outputText)(module, module.exports, stubRequire);
    const list = module.exports[exportName];
    if (!Array.isArray(list)) throw new Error(`${file} 没有导出数组 ${exportName}`);
    return list;
}

const TRACKING_KEYS = /^(aff|affid|aff_code|track_id|ref|referral|invite|invite_code|inviteCode|code|utm_\w+|from|source|channel|promo)$/i;

function cleanUrl(raw, { originOnly = false } = {}) {
    if (!raw || typeof raw !== 'string') return undefined;
    let url;
    try {
        url = new URL(raw);
    } catch {
        return undefined;
    }
    if (originOnly) return url.origin;
    for (const key of [...url.searchParams.keys()]) {
        if (TRACKING_KEYS.test(key)) url.searchParams.delete(key);
    }
    url.hash = '';
    return url.toString().replace(/\/$/, '') || undefined;
}

const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
/** Base URL 必须是可直接使用的地址：没有 ${...} / {{...}} / <...> 之类未填的占位符 */
const usableUrl = (v) => { const s = str(v); return s && !/[{}<>$]/.test(s) && /^https?:\/\//.test(s) ? s : undefined; };
const isClaudeSafe = (m) => /^(anthropic\/)?claude-(sonnet|opus|haiku|fable)-.+/i.test(m ?? '') && !/\[1m\]/i.test(m);

/** TOML 里取顶层（第一个 [section] 之前）的 key，以及第一个 base_url */
function tomlField(toml, key) {
    const re = new RegExp(`^\\s*${key}\\s*=\\s*"([^"]*)"`, 'm');
    return toml.match(re)?.[1];
}

function common(app, p) {
    if (p.hidden || p.requiresOAuth || p.providerType) return null;
    const partner = Boolean(p.isPartner || p.primePartner || p.partnerPromotionKey);
    return {
        app,
        name: str(p.name),
        category: str(p.category) ?? 'third_party',
        websiteUrl: cleanUrl(p.websiteUrl, { originOnly: partner }),
        apiKeyUrl: partner ? undefined : cleanUrl(p.apiKeyUrl),
    };
}

const extract = {
    claude(p) {
        if (p.apiFormat && p.apiFormat !== 'anthropic') return null;
        const env = p.settingsConfig?.env ?? {};
        const url = usableUrl(env.ANTHROPIC_BASE_URL);
        if (!url) return null;
        return {
            url,
            models: {
                main: str(env.ANTHROPIC_DEFAULT_SONNET_MODEL) ?? str(env.ANTHROPIC_MODEL),
                opus: str(env.ANTHROPIC_DEFAULT_OPUS_MODEL),
                haiku: str(env.ANTHROPIC_DEFAULT_HAIKU_MODEL),
            },
        };
    },
    codex(p) {
        // 本项目的 Codex 走 Responses 协议；需要 Chat / Anthropic 转换的跳过
        if (p.apiFormat && p.apiFormat !== 'responses') return null;
        const config = typeof p.config === 'string' ? p.config : '';
        if (/wire_api\s*=\s*"chat"/.test(config)) return null;
        const url = usableUrl(tomlField(config, 'base_url'));
        if (!url) return null;
        return { url, models: { main: str(tomlField(config, 'model')) } };
    },
    gemini(p) {
        const env = p.settingsConfig?.env ?? {};
        const url = usableUrl(env.GOOGLE_GEMINI_BASE_URL) ?? usableUrl(p.baseURL);
        if (!url) return null;
        return { url, models: { main: str(env.GEMINI_MODEL) ?? str(p.model) } };
    },
    opencode(p) {
        const sc = p.settingsConfig ?? {};
        const url = usableUrl(sc.options?.baseURL) ?? usableUrl(p.templateValues?.baseURL?.defaultValue);
        if (!url) return null;
        const models = Object.keys(sc.models ?? {});
        return { url, npm: str(sc.npm), models: { main: models[0], haiku: models[1] } };
    },
    claudedesktop(p) {
        // 本项目只实现了 Desktop 直连模式；模型映射（proxy）需要本地路由
        if (p.mode !== 'direct' || (p.apiFormat && p.apiFormat !== 'anthropic')) return null;
        const url = usableUrl(p.baseUrl);
        if (!url) return null;
        const routes = (p.modelRoutes ?? [])
            .filter((r) => isClaudeSafe(r.routeId) && (!r.upstreamModel || r.upstreamModel === r.routeId))
            .map((r) => r.routeId);
        const pick = (role) => routes.find((id) => id.includes(`-${role}-`));
        return { url, models: { main: pick('sonnet'), opus: pick('opus'), haiku: pick('haiku') } };
    },
};

const out = [];
const stats = {};
for (const [app, [file, exportName]] of Object.entries(SOURCES)) {
    const presets = loadPresets(file, exportName);
    let kept = 0;
    const seen = new Set();
    for (const p of presets) {
        const base = common(app, p);
        if (!base?.name) continue;
        const specific = extract[app](p);
        if (!specific) continue;
        const key = `${base.name}|${specific.url}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const models = Object.fromEntries(Object.entries(specific.models ?? {}).filter(([, v]) => v));
        out.push({
            ...base,
            url: specific.url,
            ...(Object.keys(models).length ? { models } : {}),
            ...(specific.npm ? { npm: specific.npm } : {}),
        });
        kept++;
    }
    stats[app] = `${kept}/${presets.length}`;
}

// 去掉 undefined 字段，输出稳定、可 diff
const clean = out.map((p) => JSON.parse(JSON.stringify(p)));
const commit = execFileSync('git', ['-C', upstream, 'rev-parse', '--short', ref], { encoding: 'utf8' }).trim();
const header = `// 此文件由 scripts/sync-provider-presets.mjs 生成，请勿手改
// 来源：cc-switch ${ref} @ ${commit}（MIT License）
// 重新生成：node scripts/sync-provider-presets.mjs

import type { ProviderPresetData } from './providerPresets';

`;
writeFileSync(
    path.join(root, 'src/config/providerPresets.generated.ts'),
    `${header}export const GENERATED_PROVIDER_PRESETS: ProviderPresetData[] = ${JSON.stringify(clean, null, 4)};\n`,
);
console.log('presets kept per app:', stats, 'total', clean.length);
