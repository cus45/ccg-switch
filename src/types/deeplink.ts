/**
 * Deep Link 导入请求结构
 * 对应后端 DeepLinkImportRequest 结构体
 */
export interface DeepLinkImportRequest {
  /** 协议版本 (e.g., "v1") */
  version: string;
  /** 资源类型: "provider" */
  resource: string;

  // 通用字段
  /** 目标应用类型 */
  app?: string;
  /** 资源名称 */
  name?: string;
  /** 导入后是否启用 */
  enabled?: boolean;

  // Provider 字段
  /** 首页 URL */
  homepage?: string;
  /** API endpoint (支持逗号分隔多个) */
  endpoint?: string;
  /** API Key */
  apiKey?: string;
  /** 图标名称 */
  icon?: string;
  /** 通用模型名 */
  model?: string;
  /** 备注 */
  notes?: string;
  /** Haiku 模型 (Claude) */
  haikuModel?: string;
  /** Sonnet 模型 (Claude) */
  sonnetModel?: string;
  /** Opus 模型 (Claude) */
  opusModel?: string;

  // 配置文件字段
  /** Base64 编码的配置内容 */
  config?: string;
  /** 配置格式 (json/toml) */
  configFormat?: string;
  /** 远程配置 URL */
  configUrl?: string;
}
