/**
 * HAR parser tests — URL/headers/query/cookies/body extraction, folder
 * grouping by hostname, and failed-entry filtering.
 */

import { describe, it, expect } from 'vitest';
import { harToCollection, parseHar } from '../infrastructure/parsers/har-parser';

const SAMPLE_HAR = {
  log: {
    version: '1.2',
    entries: [
      {
        request: {
          method: 'GET',
          url: 'https://api.example.com/pets/42?verbose=true&limit=10',
          headers: [{ name: 'Accept', value: 'application/json' }],
          queryString: [
            { name: 'verbose', value: 'true' },
            { name: 'limit', value: '10' },
          ],
          cookies: [{ name: 'session', value: 'abc123' }],
        },
        response: { status: 200, content: { mimeType: 'application/json' } },
        time: 123,
      },
      {
        request: {
          method: 'POST',
          url: 'https://api.example.com/pets',
          headers: [
            { name: 'Content-Type', value: 'application/json' },
          ],
          postData: {
            mimeType: 'application/json',
            text: '{"name":"Rex","age":3}',
          },
        },
        response: { status: 201, content: { mimeType: 'application/json' } },
        time: 456,
      },
      {
        request: {
          method: 'GET',
          url: 'https://other.example.com/health',
          headers: [],
        },
        response: { status: 500, content: { mimeType: 'text/plain' } },
        time: 5,
      },
    ],
  },
};

describe('parseHar', () => {
  it('extracts requests, headers, query, cookies, and bodies', () => {
    const { requests } = parseHar(SAMPLE_HAR);

    expect(requests).toHaveLength(3);

    const get = requests[0];
    expect(get.method).toBe('GET');
    expect(get.url).toBe('https://api.example.com/pets/42?verbose=true&limit=10');
    expect(get.headers).toEqual([{ key: 'Accept', value: 'application/json', enabled: true }]);
    expect(get.query).toEqual([
      { key: 'verbose', value: 'true', enabled: true },
      { key: 'limit', value: '10', enabled: true },
    ]);
    expect(get.cookies).toEqual([{ key: 'session', value: 'abc123', enabled: true }]);
    expect(get.body).toBeNull();
    expect(get.responseStatus).toBe(200);
    expect(get.responseTimeMs).toBe(123);

    const post = requests[1];
    expect(post.method).toBe('POST');
    expect(post.body).toEqual({ type: 'raw', format: 'json', content: '{"name":"Rex","age":3}' });
  });

  it('accepts a JSON string input', () => {
    const { collection } = parseHar(JSON.stringify(SAMPLE_HAR));
    expect(collection.meta?.requestCount).toBe(3);
  });

  it('groups entries into per-hostname folders', () => {
    const { collection } = parseHar(SAMPLE_HAR);
    expect(collection.name).toBe('Imported from HAR');

    const folderNames = collection.items.map((f: any) => f.name);
    expect(folderNames).toContain('api.example.com');
    expect(folderNames).toContain('other.example.com');

    const apiFolder = collection.items.find((f: any) => f.name === 'api.example.com') as any;
    expect(apiFolder.items).toHaveLength(2);
    expect(apiFolder.items[0].headers).toContainEqual({ key: 'Cookie', value: 'session=abc123', enabled: true });
  });

  it('records observed response status as a responseSchema', () => {
    const { collection } = parseHar(SAMPLE_HAR);
    const apiFolder = collection.items.find((f: any) => f.name === 'api.example.com') as any;
    const getReq = apiFolder.items[0];
    expect(getReq.responseSchema?.responses['200']).toBeDefined();
    expect(getReq.responseSchema?.responses['200'].description).toContain('123 ms');
  });

  it('honors collectionName override', () => {
    const { collection } = parseHar(SAMPLE_HAR, { collectionName: 'Prod Traces' });
    expect(collection.name).toBe('Prod Traces');
  });

  it('skipFailed drops 4xx/5xx entries', () => {
    const { requests } = parseHar(SAMPLE_HAR, { skipFailed: true });
    expect(requests).toHaveLength(2);
    expect(requests.map((r) => r.url)).not.toContain('https://other.example.com/health');
  });

  it('filterHost keeps only matching hostnames', () => {
    const { requests } = parseHar(SAMPLE_HAR, { filterHost: 'other.example.com' });
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe('https://other.example.com/health');
  });

  it('throws on invalid HAR structure', () => {
    expect(() => parseHar('{"nope": true}')).toThrow(/Invalid HAR/);
  });

  it('harToCollection returns just the collection', () => {
    const collection = harToCollection(SAMPLE_HAR, { collectionName: 'Direct' });
    expect(collection.name).toBe('Direct');
  });
});
