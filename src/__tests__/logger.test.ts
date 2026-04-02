import { describe, it, expect } from 'vitest';
import { maskSecrets } from '../logger.js';

describe('maskSecrets', () => {
  it('masks Anthropic API keys', () => {
    const result = maskSecrets('key is sk-ant-api03-abc123xyz');
    expect(result).not.toContain('sk-ant-api03-abc123xyz');
    expect(result).toContain('sk-a');
  });

  it('masks Slack bot tokens', () => {
    const result = maskSecrets('token: xoxb-123-456-abcdef');
    expect(result).not.toContain('xoxb-123-456-abcdef');
  });

  it('masks Slack app tokens', () => {
    const result = maskSecrets('token: xapp-1-ABC-123-xyz');
    expect(result).not.toContain('xapp-1-ABC-123-xyz');
  });

  it('masks Discord bot tokens', () => {
    const token = 'MTAxMjM0NTY3ODkwMTIzNDU2.GhAbCd.abcdefghijklmnopqrstuvwxyz1234';
    const result = maskSecrets(`token: ${token}`);
    expect(result).not.toContain(token);
  });

  it('does not alter strings without secrets', () => {
    const input = 'Hello world, no secrets here';
    expect(maskSecrets(input)).toBe(input);
  });
});
