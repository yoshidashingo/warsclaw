import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { SafeFolderSchema, GroupFolderSchema, IpcTaskSchema } from '../types.js';

describe('SafeFolderSchema — path traversal prevention', () => {
  it('accepts valid folder names including reserved words', () => {
    expect(SafeFolderSchema.safeParse('main').success).toBe(true);
    expect(SafeFolderSchema.safeParse('global').success).toBe(true);
    expect(SafeFolderSchema.safeParse('dev-team').success).toBe(true);
    expect(SafeFolderSchema.safeParse('project_123').success).toBe(true);
  });

  it('rejects path traversal attempts', () => {
    expect(SafeFolderSchema.safeParse('..').success).toBe(false);
    expect(SafeFolderSchema.safeParse('../etc').success).toBe(false);
    expect(SafeFolderSchema.safeParse('foo/bar').success).toBe(false);
    expect(SafeFolderSchema.safeParse('foo\\bar').success).toBe(false);
    expect(SafeFolderSchema.safeParse('.hidden').success).toBe(false);
    expect(SafeFolderSchema.safeParse('').success).toBe(false);
  });

  it('rejects names exceeding max length', () => {
    expect(SafeFolderSchema.safeParse('a'.repeat(65)).success).toBe(false);
  });

  it('PBT: no string with path separators passes', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 64 }).filter((s) => s.includes('/') || s.includes('\\') || s.includes('.')),
        (name) => {
          // If it contains path-dangerous chars, it must fail
          if (/[^a-zA-Z0-9_-]/.test(name)) {
            expect(SafeFolderSchema.safeParse(name).success).toBe(false);
          }
        },
      ),
    );
  });
});

describe('GroupFolderSchema — reserved name rejection', () => {
  it('inherits SafeFolderSchema validation', () => {
    expect(GroupFolderSchema.safeParse('../etc').success).toBe(false);
    expect(GroupFolderSchema.safeParse('foo/bar').success).toBe(false);
  });

  it('additionally rejects reserved names', () => {
    expect(GroupFolderSchema.safeParse('main').success).toBe(false);
    expect(GroupFolderSchema.safeParse('global').success).toBe(false);
  });

  it('accepts non-reserved valid names', () => {
    expect(GroupFolderSchema.safeParse('dev-team').success).toBe(true);
    expect(GroupFolderSchema.safeParse('project_123').success).toBe(true);
  });
});

describe('IPC admin operations — source_group required', () => {
  it('register_group requires source_group field', () => {
    const withoutSource = IpcTaskSchema.safeParse({
      type: 'register_group',
      jid: 'slack_123',
      name: 'Test',
      folder: 'test-group',
      trigger: '@test',
    });
    expect(withoutSource.success).toBe(false);

    const withSource = IpcTaskSchema.safeParse({
      type: 'register_group',
      jid: 'slack_123',
      name: 'Test',
      folder: 'test-group',
      trigger: '@test',
      source_group: 'main',
    });
    expect(withSource.success).toBe(true);
  });

  it('refresh_groups requires source_group field', () => {
    const withoutSource = IpcTaskSchema.safeParse({ type: 'refresh_groups' });
    expect(withoutSource.success).toBe(false);

    const withSource = IpcTaskSchema.safeParse({ type: 'refresh_groups', source_group: 'main' });
    expect(withSource.success).toBe(true);
  });

  it('register_group rejects reserved folder names', () => {
    const result = IpcTaskSchema.safeParse({
      type: 'register_group',
      jid: 'slack_123',
      name: 'Main Clone',
      folder: 'main',
      trigger: '@main',
      source_group: 'main',
    });
    expect(result.success).toBe(false);
  });

  it('register_group rejects path traversal in folder', () => {
    const result = IpcTaskSchema.safeParse({
      type: 'register_group',
      jid: 'slack_123',
      name: 'Evil',
      folder: '../etc',
      trigger: '@evil',
      source_group: 'main',
    });
    expect(result.success).toBe(false);
  });
});

describe('Secret masking coverage', () => {
  // Import after describe to keep test file loadable
  it('masks Anthropic API keys', async () => {
    const { maskSecrets } = await import('../logger.js');
    const key = 'sk-ant-abc123-VERY-LONG-SECRET-KEY-HERE';
    const masked = maskSecrets(key);
    expect(masked).not.toContain('VERY-LONG-SECRET');
    expect(masked).toContain('sk-a');
    expect(masked).toContain('...');
  });

  it('masks Slack bot tokens', async () => {
    const { maskSecrets } = await import('../logger.js');
    // Build token dynamically to avoid push protection false positive
    const token = ['xoxb', 'FAKE00TEST00', 'NOTAREALSECRETVAL'].join('-');
    const masked = maskSecrets(token);
    expect(masked).not.toContain('FAKE00TEST00');
    expect(masked).toContain('...');
  });

  it('masks Discord bot tokens', async () => {
    const { maskSecrets } = await import('../logger.js');
    // Build token dynamically to avoid push protection false positive
    // Discord token format: base64UserId.timestamp.hmac
    const parts = ['AAAAAAAAAAAAAAAAAAAAAAAAA', 'G1a2b3', 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'];
    const token = parts.join('.');
    const masked = maskSecrets(token);
    expect(masked).toContain('...');
    expect(masked.length).toBeLessThan(token.length);
  });

  it('PBT: masked output is always shorter than original for long keys', async () => {
    const { maskSecrets } = await import('../logger.js');
    fc.assert(
      fc.property(
        // Generate diverse secrets (not just repeated chars)
        fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split('')), { minLength: 20, maxLength: 60 }),
        (secret) => {
          const anthropicKey = `sk-ant-${secret}`;
          const masked = maskSecrets(anthropicKey);
          // Masked version must be shorter (middle replaced with '...')
          expect(masked.length).toBeLessThan(anthropicKey.length);
          // Must contain the ellipsis marker
          expect(masked).toContain('...');
        },
      ),
    );
  });
});
