/**
 * Environment Resolver Tests
 */

import { describe, expect, it } from 'vitest';
import { EnvironmentResolver, EnvironmentStoreConfig } from '../infrastructure/environment/environment-resolver';

describe('EnvironmentResolver', () => {
    describe('basic operations', () => {
        it('should create from simple variables', () => {
            const resolver = EnvironmentResolver.fromVariables({
                baseUrl: 'https://api.example.com',
                token: 'abc123'
            });

            expect(resolver.get('baseUrl')).toBe('https://api.example.com');
            expect(resolver.get('token')).toBe('abc123');
        });

        it('should set and get variables', () => {
            const resolver = EnvironmentResolver.fromVariables({});
            resolver.set('key', 'value');
            expect(resolver.get('key')).toBe('value');
        });

        it('should return undefined for missing variables', () => {
            const resolver = EnvironmentResolver.fromVariables({});
            expect(resolver.get('missing')).toBeUndefined();
        });
    });

    describe('multiple environments', () => {
        const config: EnvironmentStoreConfig = {
            globalVariables: {
                appName: 'MyApp'
            },
            environments: {
                dev: { name: 'dev', variables: { baseUrl: 'http://localhost:3000' } },
                staging: { name: 'staging', variables: { baseUrl: 'https://staging.example.com' } },
                prod: { name: 'prod', variables: { baseUrl: 'https://api.example.com' } }
            },
            selectedEnvironment: 'dev'
        };

        it('should use selected environment by default', () => {
            const resolver = new EnvironmentResolver(config);
            expect(resolver.getActive()).toBe('dev');
            expect(resolver.get('baseUrl')).toBe('http://localhost:3000');
        });

        it('should switch environments', () => {
            const resolver = new EnvironmentResolver(config);
            resolver.setActive('prod');
            expect(resolver.getActive()).toBe('prod');
            expect(resolver.get('baseUrl')).toBe('https://api.example.com');
        });

        it('should include global variables in all environments', () => {
            const resolver = new EnvironmentResolver(config);
            expect(resolver.get('appName')).toBe('MyApp');
            
            resolver.setActive('prod');
            expect(resolver.get('appName')).toBe('MyApp');
        });

        it('should throw for unknown environment', () => {
            const resolver = new EnvironmentResolver(config);
            expect(() => resolver.setActive('unknown')).toThrow();
        });
    });

    describe('inheritance', () => {
        it('should inherit from parent environment', () => {
            const config: EnvironmentStoreConfig = {
                environments: {
                    base: { name: 'base', variables: { baseUrl: 'https://api.example.com', timeout: '30000' } },
                    dev: { name: 'dev', variables: { timeout: '5000' }, inherits: 'base' }
                },
                selectedEnvironment: 'dev'
            };

            const resolver = new EnvironmentResolver(config);
            expect(resolver.get('baseUrl')).toBe('https://api.example.com');
            expect(resolver.get('timeout')).toBe('5000');
        });
    });
});
