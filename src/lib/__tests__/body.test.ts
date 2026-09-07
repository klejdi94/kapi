import { describe, it, expect } from 'vitest';
import { buildBody } from '../body';
import { newRequest } from '../factory';
import { putFile, dropFile } from '../files';
import type { VarScope } from '../variables';

const scope: VarScope = new Map();

describe('buildBody — binary mode', () => {
  it('sends the file registered under this body.binary.id, not just any file in the store', async () => {
    const fileA = new File(['aaa'], 'a.bin');
    const fileB = new File(['bbbbb'], 'b.bin');
    putFile('body-test-a', fileA);
    putFile('body-test-b', fileB);

    const requestA = newRequest({ method: 'POST', body: { ...newRequest().body, mode: 'binary', binary: { fileName: 'a.bin', id: 'body-test-a' } } });
    const requestB = newRequest({ method: 'POST', body: { ...newRequest().body, mode: 'binary', binary: { fileName: 'b.bin', id: 'body-test-b' } } });

    const builtA = buildBody(requestA, scope);
    const builtB = buildBody(requestB, scope);

    expect(builtA.payload).toBe(fileA);
    expect(builtB.payload).toBe(fileB);
    expect(builtA.bytes).toBe(3);
    expect(builtB.bytes).toBe(5);

    dropFile('body-test-a');
    dropFile('body-test-b');
  });

  it('reports the file as missing when its id has nothing registered', () => {
    const request = newRequest({ method: 'POST', body: { ...newRequest().body, mode: 'binary', binary: { fileName: 'gone.bin', id: 'no-such-id' } } });
    const built = buildBody(request, scope);
    expect(built.payload).toBeNull();
    expect(built.missingFiles).toEqual(['gone.bin']);
  });

  it('treats old data with no id as missing rather than picking up an unrelated file', () => {
    putFile('some-other-id', new File(['x'], 'x.bin'));
    const request = newRequest({ method: 'POST', body: { ...newRequest().body, mode: 'binary', binary: { fileName: 'legacy.bin' } } });
    const built = buildBody(request, scope);
    expect(built.missingFiles).toEqual(['legacy.bin']);
    dropFile('some-other-id');
  });
});
