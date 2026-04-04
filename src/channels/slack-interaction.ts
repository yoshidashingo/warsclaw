import type { App } from '@slack/bolt';
import type { Logger } from '../logger.js';
import type { ReportData } from '../types.js';

// --- Block Kit builders (pure functions, easy to test) ---

export interface ApprovalBlockInput {
  runId: string;
  taskName: string;
  schedule: string;
  trustLabel: string;
  plan: string;
}

export function buildApprovalBlocks(input: ApprovalBlockInput): any[] {
  return [
    { type: 'header', text: { type: 'plain_text', text: `Task Plan: ${input.taskName}` } },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*Schedule:* ${input.schedule}\n*Trust:* ${input.trustLabel}` },
    },
    { type: 'divider' },
    { type: 'section', text: { type: 'mrkdwn', text: input.plan } },
    {
      type: 'actions',
      block_id: `wc_approval_${input.runId}`,
      elements: [
        { type: 'button', text: { type: 'plain_text', text: 'Approve' }, action_id: 'wc_approve', style: 'primary', value: input.runId },
        { type: 'button', text: { type: 'plain_text', text: 'Reject' }, action_id: 'wc_reject', style: 'danger', value: input.runId },
        { type: 'button', text: { type: 'plain_text', text: 'Revise' }, action_id: 'wc_revise', value: input.runId },
      ],
    },
  ];
}

export interface ReportBlockInput {
  runId: string;
  taskName: string;
  report: ReportData;
}

export function buildReportBlocks(input: ReportBlockInput): any[] {
  const blocks: any[] = [
    { type: 'header', text: { type: 'plain_text', text: `Execution Report: ${input.taskName}` } },
    { type: 'section', text: { type: 'mrkdwn', text: input.report.summary } },
  ];

  if (input.report.planDiff) {
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*Plan vs Actual*\n${input.report.planDiff}` } });
  }

  if (input.report.suggestions.length > 0) {
    const sugText = input.report.suggestions.map((s) => `• ${s}`).join('\n');
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*Suggestions*\n${sugText}` } });
  }

  blocks.push(
    { type: 'divider' },
    {
      type: 'actions',
      block_id: `wc_feedback_${input.runId}`,
      elements: [
        {
          type: 'static_select',
          action_id: 'wc_feedback_score',
          placeholder: { type: 'plain_text', text: 'Rate this run' },
          options: [1, 2, 3, 4, 5].map((n) => ({
            text: { type: 'plain_text', text: `${'★'.repeat(n)}${'☆'.repeat(5 - n)}` },
            value: String(n),
          })),
        },
        { type: 'button', text: { type: 'plain_text', text: 'Add Comment' }, action_id: 'wc_feedback_comment', value: input.runId },
      ],
    },
  );

  return blocks;
}

// --- Slack interaction handler ---

export interface LifecycleCallbacks {
  onApprove(runId: string, userId: string): Promise<void>;
  onReject(runId: string, userId: string, reason: string): Promise<void>;
  onRevise(runId: string, userId: string, instruction: string): Promise<void>;
  onFeedbackScore(runId: string, score: number): Promise<void>;
  onFeedbackComment(runId: string, comment: string): Promise<void>;
}

export class SlackInteraction {
  constructor(
    private readonly app: App,
    private readonly logger: Logger,
  ) {}

  registerHandlers(callbacks: LifecycleCallbacks): void {
    this.app.action('wc_approve', async ({ ack, body }) => {
      await ack();
      const runId = (body as any).actions[0].value;
      const userId = body.user.id;
      await callbacks.onApprove(runId, userId);
    });

    this.app.action('wc_reject', async ({ ack, body, client }) => {
      await ack();
      const runId = (body as any).actions[0].value;
      await client.views.open({
        trigger_id: (body as any).trigger_id,
        view: {
          type: 'modal',
          callback_id: 'wc_reject_modal',
          private_metadata: runId,
          title: { type: 'plain_text', text: 'Reject Task' },
          submit: { type: 'plain_text', text: 'Submit' },
          blocks: [
            {
              type: 'input',
              block_id: 'reason_block',
              element: { type: 'plain_text_input', action_id: 'reason_input', multiline: true, placeholder: { type: 'plain_text', text: '却下理由を入力...' } },
              label: { type: 'plain_text', text: '却下理由' },
            },
          ],
        },
      });
    });

    this.app.action('wc_revise', async ({ ack, body, client }) => {
      await ack();
      const runId = (body as any).actions[0].value;
      await client.views.open({
        trigger_id: (body as any).trigger_id,
        view: {
          type: 'modal',
          callback_id: 'wc_revise_modal',
          private_metadata: runId,
          title: { type: 'plain_text', text: 'Revise Plan' },
          submit: { type: 'plain_text', text: 'Submit' },
          blocks: [
            {
              type: 'input',
              block_id: 'instruction_block',
              element: { type: 'plain_text_input', action_id: 'instruction_input', multiline: true, placeholder: { type: 'plain_text', text: '修正指示を入力...' } },
              label: { type: 'plain_text', text: '修正内容' },
            },
          ],
        },
      });
    });

    this.app.action('wc_feedback_score', async ({ ack, body }) => {
      await ack();
      const action = (body as any).actions[0];
      const runId = action.block_id.replace('wc_feedback_', '');
      const score = parseInt(action.selected_option.value, 10);
      await callbacks.onFeedbackScore(runId, score);
    });

    this.app.action('wc_feedback_comment', async ({ ack, body, client }) => {
      await ack();
      const runId = (body as any).actions[0].value;
      await client.views.open({
        trigger_id: (body as any).trigger_id,
        view: {
          type: 'modal',
          callback_id: 'wc_comment_modal',
          private_metadata: runId,
          title: { type: 'plain_text', text: 'Add Comment' },
          submit: { type: 'plain_text', text: 'Submit' },
          blocks: [
            {
              type: 'input',
              block_id: 'comment_block',
              element: { type: 'plain_text_input', action_id: 'comment_input', multiline: true, placeholder: { type: 'plain_text', text: 'コメントを入力...' } },
              label: { type: 'plain_text', text: 'コメント' },
            },
          ],
        },
      });
    });

    // Modal submissions
    this.app.view('wc_reject_modal', async ({ ack, body, view }) => {
      await ack();
      const runId = view.private_metadata;
      const reason = view.state.values.reason_block.reason_input.value ?? '';
      await callbacks.onReject(runId, body.user.id, reason);
    });

    this.app.view('wc_revise_modal', async ({ ack, body, view }) => {
      await ack();
      const runId = view.private_metadata;
      const instruction = view.state.values.instruction_block.instruction_input.value ?? '';
      await callbacks.onRevise(runId, body.user.id, instruction);
    });

    this.app.view('wc_comment_modal', async ({ ack, body, view }) => {
      await ack();
      const runId = view.private_metadata;
      const comment = view.state.values.comment_block.comment_input.value ?? '';
      await callbacks.onFeedbackComment(runId, comment);
    });
  }

  async postApprovalRequest(token: string, channelId: string, runId: string, taskName: string, schedule: string, trustLabel: string, plan: string): Promise<string> {
    const blocks = buildApprovalBlocks({ runId, taskName, schedule, trustLabel, plan });
    const res = await this.app.client.chat.postMessage({ token, channel: channelId, text: `Task Plan: ${taskName}`, blocks });
    return res.ts!;
  }

  async postReport(token: string, channelId: string, runId: string, taskName: string, report: ReportData): Promise<string> {
    const blocks = buildReportBlocks({ runId, taskName, report });
    const res = await this.app.client.chat.postMessage({ token, channel: channelId, text: `Execution Report: ${taskName}`, blocks });
    return res.ts!;
  }

  async updateMessageWithResult(token: string, channelId: string, ts: string, text: string): Promise<void> {
    await this.app.client.chat.update({ token, channel: channelId, ts, text, blocks: [{ type: 'section', text: { type: 'mrkdwn', text } }] });
  }
}
