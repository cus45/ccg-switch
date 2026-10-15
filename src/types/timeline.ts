import type {
    ChatAttachment,
    ChatMessage,
    CompactBoundaryInfo,
    TokenUsage,
    ToolResultBlock,
} from './chat';
import type { ToolType } from './tools';

/** 工具调用状态 */
export type ToolCallStatus = 'running' | 'complete' | 'failed';

/** 规范化的工具调用结构体（对齐 mindfs ToolCall 协议） */
export interface ToolCall {
    callId: string;
    name: string;
    kind: ToolType | 'ask_user' | 'task';
    input: Record<string, unknown>;
    result?: ToolResultBlock | null;
    status: ToolCallStatus;
    durationMs?: number;
    isError?: boolean;
}

/** 时间线单条实体（虚拟化列表最小渲染单元） */
export type TimelineItem =
    | {
          id: string;
          type: 'user_text';
          content: string;
          timestamp: number;
          agent?: string;
          model?: string;
          attachments?: ChatAttachment[];
          message: ChatMessage;
          isCompactSummary?: boolean;
      }
    | {
          id: string;
          type: 'assistant_text';
          content: string;
          timestamp: number;
          agent?: string;
          providerId?: string;
          providerName?: string;
          model?: string;
          durationMs?: number;
          tokenUsage?: TokenUsage;
          isStreaming?: boolean;
          message: ChatMessage;
          isLastSegment?: boolean;
      }
    | {
          id: string;
          type: 'thought';
          content: string;
          isStreaming?: boolean;
          messageId: string;
          timestamp?: number;
      }
    | {
          id: string;
          type: 'tool';
          toolCall: ToolCall;
          messageId: string;
          timestamp?: number;
      }
    | {
          id: string;
          type: 'compact';
          info: CompactBoundaryInfo;
          messageId: string;
          timestamp?: number;
      };

/** useSessionStream 返回结构 */
export interface UseSessionStreamResult {
    timeline: TimelineItem[];
    isStreaming: boolean;
    streamVersion: number;
}
