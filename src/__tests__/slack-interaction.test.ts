import { describe, it, expect } from 'vitest';
import { buildApprovalBlocks, buildReportBlocks } from '../channels/slack-interaction.js';
import type { ReportData } from '../types.js';

describe('SlackInteraction', () => {
  describe('buildApprovalBlocks', () => {
    it('contains header, plan text, and 3 action buttons', () => {
      const blocks = buildApprovalBlocks({
        runId: 'run-1',
        taskName: 'Daily Report',
        schedule: '0 9 * * *',
        trustLabel: '学習中',
        plan: 'Step 1: Check logs\nStep 2: Summarize',
      });

      const header = blocks.find((b: any) => b.type === 'header');
      expect(header).toBeDefined();

      const actions = blocks.find((b: any) => b.type === 'actions');
      expect(actions).toBeDefined();
      expect(actions.elements).toHaveLength(3);

      const actionIds = actions.elements.map((e: any) => e.action_id);
      expect(actionIds).toContain('wc_approve');
      expect(actionIds).toContain('wc_reject');
      expect(actionIds).toContain('wc_revise');
    });

    it('encodes runId in button values', () => {
      const blocks = buildApprovalBlocks({
        runId: 'run-abc',
        taskName: 'Test',
        schedule: 'once',
        trustLabel: '安定',
        plan: 'Plan text',
      });

      const actions = blocks.find((b: any) => b.type === 'actions');
      for (const el of actions.elements) {
        expect(el.value).toBe('run-abc');
      }
    });
  });

  describe('buildReportBlocks', () => {
    it('includes summary and suggestions', () => {
      const report: ReportData = {
        summary: 'Task completed successfully',
        planDiff: null,
        suggestions: ['Optimize query', 'Add caching'],
      };

      const blocks = buildReportBlocks({
        runId: 'run-2',
        taskName: 'Weekly Summary',
        report,
      });

      const texts = blocks
        .filter((b: any) => b.type === 'section')
        .map((b: any) => b.text?.text ?? '');
      const allText = texts.join('\n');

      expect(allText).toContain('Task completed successfully');
      expect(allText).toContain('Optimize query');
      expect(allText).toContain('Add caching');
    });

    it('includes plan diff section when provided', () => {
      const report: ReportData = {
        summary: 'Done',
        planDiff: 'Skipped step 2 due to timeout',
        suggestions: [],
      };

      const blocks = buildReportBlocks({
        runId: 'run-3',
        taskName: 'Test',
        report,
      });

      const texts = blocks
        .filter((b: any) => b.type === 'section')
        .map((b: any) => b.text?.text ?? '');
      expect(texts.some((t: string) => t.includes('Skipped step 2'))).toBe(true);
    });

    it('has feedback actions with score select and comment button', () => {
      const blocks = buildReportBlocks({
        runId: 'run-4',
        taskName: 'Test',
        report: { summary: 'OK', planDiff: null, suggestions: [] },
      });

      const actions = blocks.find((b: any) => b.type === 'actions');
      expect(actions).toBeDefined();
      const actionIds = actions.elements.map((e: any) => e.action_id);
      expect(actionIds).toContain('wc_feedback_score');
      expect(actionIds).toContain('wc_feedback_comment');
    });
  });
});
