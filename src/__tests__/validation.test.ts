import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { GroupFolderSchema, IpcMessageSchema, IpcTaskSchema, ContainerOutputSchema } from '../types.js';

describe('GroupFolderSchema', () => {
  it('accepts valid folder names', () => {
    expect(GroupFolderSchema.safeParse('dev-team').success).toBe(true);
    expect(GroupFolderSchema.safeParse('project_123').success).toBe(true);
    expect(GroupFolderSchema.safeParse('MyGroup').success).toBe(true);
  });

  it('rejects invalid folder names', () => {
    expect(GroupFolderSchema.safeParse('').success).toBe(false);
    expect(GroupFolderSchema.safeParse('..').success).toBe(false);
    expect(GroupFolderSchema.safeParse('main').success).toBe(false);
    expect(GroupFolderSchema.safeParse('global').success).toBe(false);
    expect(GroupFolderSchema.safeParse('has space').success).toBe(false);
    expect(GroupFolderSchema.safeParse('path/traversal').success).toBe(false);
    expect(GroupFolderSchema.safeParse('a'.repeat(65)).success).toBe(false);
  });

  it('PBT: valid alphanumeric strings pass (if not reserved)', () => {
    fc.assert(
      fc.property(
        fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789-_'.split('')), { minLength: 1, maxLength: 64 }),
        (name) => {
          const result = GroupFolderSchema.safeParse(name);
          if (['main', 'global', '.', '..'].includes(name)) {
            expect(result.success).toBe(false);
          } else {
            expect(result.success).toBe(true);
          }
        },
      ),
    );
  });

  it('PBT: strings with special chars always fail', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 64 }).filter((s) => /[^a-zA-Z0-9_-]/.test(s)),
        (name) => {
          expect(GroupFolderSchema.safeParse(name).success).toBe(false);
        },
      ),
    );
  });
});

describe('IpcMessageSchema', () => {
  it('accepts valid messages', () => {
    expect(IpcMessageSchema.safeParse({ type: 'message', chatJid: 'discord_123', text: 'hello' }).success).toBe(true);
  });

  it('rejects missing fields', () => {
    expect(IpcMessageSchema.safeParse({ type: 'message' }).success).toBe(false);
    expect(IpcMessageSchema.safeParse({ type: 'message', chatJid: '' }).success).toBe(false);
  });
});

describe('IpcTaskSchema', () => {
  it('accepts schedule_task', () => {
    const result = IpcTaskSchema.safeParse({
      type: 'schedule_task',
      prompt: 'test',
      schedule_type: 'cron',
      schedule_value: '* * * * *',
      targetJid: 'discord_123',
      group_folder: 'dev-team',
    });
    expect(result.success).toBe(true);
  });

  it('rejects schedule_task without group_folder', () => {
    const result = IpcTaskSchema.safeParse({
      type: 'schedule_task',
      prompt: 'test',
      schedule_type: 'cron',
      schedule_value: '* * * * *',
      targetJid: 'discord_123',
    });
    expect(result.success).toBe(false);
  });

  it('accepts pause_task', () => {
    expect(IpcTaskSchema.safeParse({ type: 'pause_task', taskId: 'abc' }).success).toBe(true);
  });

  it('rejects unknown type', () => {
    expect(IpcTaskSchema.safeParse({ type: 'unknown' }).success).toBe(false);
  });
});

describe('ContainerOutputSchema', () => {
  it('accepts valid output', () => {
    expect(ContainerOutputSchema.safeParse({ status: 'success', result: 'hello' }).success).toBe(true);
    expect(ContainerOutputSchema.safeParse({ status: 'error', result: '', error: 'oops' }).success).toBe(true);
  });

  it('rejects invalid status', () => {
    expect(ContainerOutputSchema.safeParse({ status: 'unknown', result: '' }).success).toBe(false);
  });

  it('PBT: any string result with valid status passes', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('success', 'error'),
        fc.string(),
        (status, result) => {
          expect(ContainerOutputSchema.safeParse({ status, result }).success).toBe(true);
        },
      ),
    );
  });
});
