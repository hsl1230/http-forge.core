/**
 * Doppler secret resolver
 *
 * Uses the Doppler REST API — no SDK required, just a service token.
 * Credentials: DOPPLER_TOKEN env var (or serviceToken in config for per-project override)
 *
 * Token syntax: {{secret:doppler/<secretName>}}
 * e.g.          {{secret:doppler/API_KEY}}
 *               {{secret:doppler/DATABASE_URL}}
 *
 * The Doppler project/config are baked into the service token itself —
 * no project or config fields needed in http-forge.config.json.
 *
 * Prerequisites: none (uses Node.js built-in https)
 */

import type { ClientRequest, IncomingMessage, RequestOptions } from 'http';
import * as https from 'https';
import type { DopplerConfig } from '../../types/secret-resolver';
import { BaseSecretResolver } from './base-secret-resolver';

const REQUEST_TIMEOUT_MS = 10000;

type DopplerRequestFn = (
    url: string,
    options: RequestOptions,
    callback: (res: IncomingMessage) => void
) => ClientRequest;

export class DopplerResolver extends BaseSecretResolver {
    readonly providerName = 'doppler';

    private readonly token: string | undefined;
    private readonly requestFn: DopplerRequestFn;

    constructor(config: DopplerConfig, requestFn: DopplerRequestFn = https.request as DopplerRequestFn) {
        super({ cacheTtlMs: (config as any)?.cacheTtlMs });
        this.token = config.serviceToken || process.env['DOPPLER_TOKEN'];
        this.requestFn = requestFn;
    }

    protected async fetchRaw(secretName: string, _jsonPath?: string): Promise<string | undefined> {
        // path is the secret name, e.g. "API_KEY"
        const name = secretName.trim().toUpperCase();

        const token = this.token;
        if (!token) {
            throw new Error(
                '[HTTP Forge] Doppler secret resolver: no service token found. ' +
                'Set DOPPLER_TOKEN env var or add serviceToken to config.'
            );
        }

        const url = `https://api.doppler.com/v3/configs/config/secret?name=${encodeURIComponent(name)}`;

        return new Promise<string | undefined>((resolve, reject) => {
            const req = this.requestFn(
                url,
                {
                    method: 'GET',
                    timeout: REQUEST_TIMEOUT_MS,
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Accept': 'application/json'
                    }
                },
                (res) => {
                    const chunks: Buffer[] = [];
                    res.on('data', (chunk: Buffer) => chunks.push(chunk));
                    res.on('error', reject);
                    res.on('end', () => {
                        const body = Buffer.concat(chunks).toString('utf-8');
                        if (res.statusCode === 404) {
                            resolve(undefined);
                            return;
                        }
                        if (res.statusCode !== 200) {
                            reject(new Error(
                                `[HTTP Forge] Doppler API returned ${res.statusCode} for secret "${name}": ${body}`
                            ));
                            return;
                        }
                        try {
                            const json = JSON.parse(body);
                            // Response shape: { "value": { "computed": "actualValue", ... } }
                            const computed = json?.value?.computed;
                            resolve(computed !== undefined && computed !== null ? String(computed) : undefined);
                        } catch {
                            reject(new Error(`[HTTP Forge] Doppler API returned non-JSON response for secret "${name}"`));
                        }
                    });
                }
            );
            req.on('error', reject);
            req.on('timeout', () => {
                req.destroy(new Error(`[HTTP Forge] Doppler request timed out after ${REQUEST_TIMEOUT_MS}ms`));
            });
            req.end();
        });
    }
}
