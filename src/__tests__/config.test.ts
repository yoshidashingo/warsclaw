import { describe, it, expect } from 'vitest';
import { validateWorkspacePath } from '../config.js';

describe('validateWorkspacePath', () => {
  it('accepts a normal project path', () => {
    expect(() => validateWorkspacePath('/home/user/projects/repo')).not.toThrow();
  });

  it('rejects root path', () => {
    expect(() => validateWorkspacePath('/')).toThrow();
  });

  it('rejects /etc', () => {
    expect(() => validateWorkspacePath('/etc')).toThrow();
  });

  it('rejects /var', () => {
    expect(() => validateWorkspacePath('/var')).toThrow();
  });

  it('rejects /root', () => {
    expect(() => validateWorkspacePath('/root')).toThrow();
  });

  it('accepts undefined (no workspace)', () => {
    expect(() => validateWorkspacePath(undefined)).not.toThrow();
  });

  it('rejects single-level paths', () => {
    expect(() => validateWorkspacePath('/tmp')).toThrow();
  });

  it('accepts multi-level paths', () => {
    expect(() => validateWorkspacePath('/tmp/warsclaw-workspace')).not.toThrow();
  });
});
