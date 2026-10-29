import { describe, expect, it } from 'vitest';
import { UrlBuilder } from '../infrastructure/http/url-builder';

describe('UrlBuilder', () => {
    it('does not treat a WebSocket port as a path parameter', () => {
        const builder = new UrlBuilder();

        expect(builder.buildUrl('ws://localhost:3001/socket/:id', { id: '42' }))
            .toBe('ws://localhost:3001/socket/42');
    });

    it('replaces path params in secure WebSocket URLs', () => {
        const builder = new UrlBuilder();

        expect(builder.buildUrl('wss://example.test:8443/rooms/:room?token=abc', { room: 'a b' }))
            .toBe('wss://example.test:8443/rooms/a%20b?token=abc');
    });

    it('extracts path params without including a WebSocket port', () => {
        const builder = new UrlBuilder();

        expect(builder.extractPathParams('wss://example.test:8443/rooms/:room/messages/:id'))
            .toEqual(['room', 'id']);
    });

    it('keeps existing HTTP behavior', () => {
        const builder = new UrlBuilder();

        expect(builder.buildUrl('https://example.test:8443/users/:id', { id: '7' }, { expand: 'roles' }))
            .toBe('https://example.test:8443/users/7?expand=roles');
    });
});
