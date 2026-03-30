import { describe, it, expect } from 'vitest';
import { parseContainerOutput } from '../container-runner.js';

describe('parseContainerOutput', () => {
  it('extracts JSON between markers', () => {
    const stdout = `npm WARN deprecated pkg
Loading...
<<<OUTPUT_START>>>
{"status":"success","result":"Hello world!","newSessionId":"abc123"}
<<<OUTPUT_END>>>
Done.`;
    const output = parseContainerOutput(stdout);
    expect(output.status).toBe('success');
    expect(output.result).toBe('Hello world!');
    expect(output.newSessionId).toBe('abc123');
  });

  it('throws on missing start marker', () => {
    expect(() => parseContainerOutput('no markers here')).toThrow('Missing output markers');
  });

  it('throws on missing end marker', () => {
    expect(() => parseContainerOutput('<<<OUTPUT_START>>>{"status":"success"}')).toThrow('Missing output markers');
  });

  it('handles error status', () => {
    const stdout = `<<<OUTPUT_START>>>
{"status":"error","result":"","error":"something went wrong"}
<<<OUTPUT_END>>>`;
    const output = parseContainerOutput(stdout);
    expect(output.status).toBe('error');
    expect(output.error).toBe('something went wrong');
  });

  it('rejects invalid JSON', () => {
    const stdout = '<<<OUTPUT_START>>>not json<<<OUTPUT_END>>>';
    expect(() => parseContainerOutput(stdout)).toThrow();
  });

  it('rejects invalid schema', () => {
    const stdout = '<<<OUTPUT_START>>>{"status":"unknown","result":123}<<<OUTPUT_END>>>';
    expect(() => parseContainerOutput(stdout)).toThrow();
  });
});
