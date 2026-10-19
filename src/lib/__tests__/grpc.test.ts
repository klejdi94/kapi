import { describe, expect, it } from 'vitest';
import { messageTemplate, messagesToSend, methodKind } from '../grpc';

const method = { name: 'Chat', clientStreaming: true, serverStreaming: true, inputType: 'x.Req', outputType: 'x.Res', inputTemplate: '{\n  "name": ""\n}' };

describe('grpc helpers', () => {
  it('names method kinds', () => {
    expect(methodKind({ clientStreaming: false, serverStreaming: false })).toBe('unary');
    expect(methodKind({ clientStreaming: false, serverStreaming: true })).toBe('server streaming');
    expect(methodKind({ clientStreaming: true, serverStreaming: false })).toBe('client streaming');
    expect(methodKind(method)).toBe('bidirectional');
  });

  it('wraps templates in an array for client-streaming methods', () => {
    expect(JSON.parse(messageTemplate(method))).toEqual([{ name: '' }]);
    expect(messageTemplate({ ...method, clientStreaming: false })).toBe(method.inputTemplate);
  });

  it('splits the editor text into messages', () => {
    expect(messagesToSend(' {"a":1} ', false)).toEqual(['{"a":1}']);
    expect(messagesToSend('', false)).toEqual(['{}']);
    expect(messagesToSend('[{"a":1},{"a":2}]', true)).toEqual(['{"a":1}', '{"a":2}']);
    expect(messagesToSend('{"a":1}', true)).toEqual(['{"a":1}']);
    expect(() => messagesToSend('[]', true)).toThrow(/at least one/);
    expect(() => messagesToSend('[{', true)).toThrow(/valid JSON/);
  });
});
