/**
 * Native HTTP Client Implementation
 * 
 * Extracted 100% from VS Code plugin: src/services/http-request-service.ts
 * Uses Node.js native http/https modules instead of fetch for full control.
 * 
 * DO NOT modify the core logic - it has been tested and is reliable.
 * 
 * Features (same as plugin):
 * - Redirect handling (301, 302, 303, 307, 308)
 * - SSL certificate verification control
 * - Automatic decompression (gzip, deflate)
 * - Timeout handling
 * - Request cancellation via AbortSignal
 * - Cookie parsing from Set-Cookie headers
 */

import * as fs from 'fs';
import * as http from 'http';
import * as https from 'https';
import * as net from 'net';
import * as path from 'path';
import * as tls from 'tls';
import { URL } from 'url';
import * as zlib from 'zlib';
import { IHttpClient } from '../../types/platform';
import { HttpRequest, HttpResponse, RequestSettings, TlsCertificateMapping, TlsSettings } from '../../types/types';
import { ProxyConfig } from '../config/config.interface';
import { ParsedCookie } from '../cookie/interfaces';
import { sanitizeHeaders as sanitizeAllHeaders } from './header-utils';

/**
 * Default request settings
 * Same as plugin's DEFAULT_REQUEST_SETTINGS from shared/constants.ts
 */
export const DEFAULT_REQUEST_SETTINGS: Required<RequestSettings> = {
    timeout: 30000,
    followRedirects: true,
    followOriginalMethod: false,
    followAuthHeader: false,
    maxRedirects: 10,
    strictSSL: true,
    decompress: true,
    includeCookies: false,
    tls: {},
    certificates: []
};

/**
 * Source of default request settings for {@link NodeHttpClient}.
 *
 * Pass a plain object for static settings, or a provider function to resolve
 * settings lazily on every request. The provider form lets live configuration
 * changes (e.g. newly added host certificates) take effect without recreating
 * the client instance.
 */
export type RequestSettingsSource =
    | Partial<RequestSettings>
    | (() => Partial<RequestSettings> | undefined);

/**
 * Source of proxy configuration for {@link NodeHttpClient}.
 * May be a static config object or a provider function for live config reloads.
 */
export type ProxySource =
    | ProxyConfig
    | null
    | undefined
    | (() => ProxyConfig | null | undefined);

/**
 * Native HTTP client using Node.js http/https modules
 * 
 * Implementation extracted 100% from plugin's HttpRequestService.executeInternal
 */
export class NodeHttpClient implements IHttpClient {
    private readonly resolveDefaults: () => Required<RequestSettings>;
    private readonly resolveProxy: () => ProxyConfig | null | undefined;
    private version: string;
    private readonly basePath: string;

    constructor(defaultSettings?: RequestSettingsSource, basePath: string = process.cwd(), proxySource?: ProxySource) {
        if (typeof defaultSettings === 'function') {
            // Resolve on every request so live config changes (e.g. added host
            // certificates) take effect without recreating the client.
            this.resolveDefaults = () => ({
                ...DEFAULT_REQUEST_SETTINGS,
                ...(defaultSettings() ?? {})
            });
        } else {
            const frozen: Required<RequestSettings> = {
                ...DEFAULT_REQUEST_SETTINGS,
                ...defaultSettings
            };
            this.resolveDefaults = () => frozen;
        }
        this.basePath = basePath;

        // Proxy config provider
        if (typeof proxySource === 'function') {
            this.resolveProxy = proxySource;
        } else {
            this.resolveProxy = () => proxySource;
        }

        // Read version from package.json for User-Agent header
        try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            this.version = require('../../package.json').version || '0.0.0';
        } catch {
            this.version = '0.0.0';
        }
    }

    /** Current default settings, resolved fresh from the configured source. */
    private get settings(): Required<RequestSettings> {
        return this.resolveDefaults();
    }

    /**
     * Send an HTTP request
     */
    async send(request: HttpRequest): Promise<HttpResponse> {
        const settings = this.mergeSettings(request.settings);
        const response = await this.executeInternal(request, settings, 0);
        return response;
    }

    /**
     * Merge user settings with defaults
     * Same implementation as plugin's HttpRequestService.mergeSettings
     */
    private mergeSettings(userSettings?: RequestSettings): Required<RequestSettings> {
        const defaults = this.settings;
        return {
            timeout: userSettings?.timeout ?? defaults.timeout,
            followRedirects: userSettings?.followRedirects ?? defaults.followRedirects,
            followOriginalMethod: userSettings?.followOriginalMethod ?? defaults.followOriginalMethod,
            followAuthHeader: userSettings?.followAuthHeader ?? defaults.followAuthHeader,
            maxRedirects: userSettings?.maxRedirects ?? defaults.maxRedirects,
            strictSSL: userSettings?.strictSSL ?? defaults.strictSSL,
            decompress: userSettings?.decompress ?? defaults.decompress,
            includeCookies: userSettings?.includeCookies ?? defaults.includeCookies,
            tls: userSettings?.tls ?? defaults.tls ?? {},
            certificates: userSettings?.certificates ?? defaults.certificates ?? []
        };
    }

    /**
     * Internal execute method that handles redirects
     * 
     * Implementation extracted 100% from plugin's HttpRequestService.executeInternal
     */
    private async executeInternal(
        request: HttpRequest,
        settings: Required<RequestSettings>,
        redirectCount: number,
        signal?: AbortSignal
    ): Promise<HttpResponse> {
        const startTime = Date.now();
        const url = new URL(request.url);
        const isHttps = url.protocol === 'https:';

        // Sanitize headers
        const requestHeaders = sanitizeAllHeaders(request.headers || {});

        // Set default User-Agent if not already provided
        const hasUserAgent = Object.keys(requestHeaders).some(
            key => key.toLowerCase() === 'user-agent'
        );
        if (!hasUserAgent) {
            requestHeaders['User-Agent'] = `HttpForge/${this.version}`;
        }

        const requestOptions: http.RequestOptions = {
            hostname: url.hostname,
            port: url.port || (isHttps ? 443 : 80),
            path: url.pathname + url.search,
            method: request.method,
            headers: { ...requestHeaders },
            timeout: settings.timeout || undefined
        };

        let requestBody: string | Buffer | undefined;
        if (request.body !== undefined && request.body !== null) {
            if (typeof request.body === 'string') {
                requestBody = request.body;
            } else if (request.body instanceof Buffer) {
                requestBody = request.body;
            } else if (request.body instanceof URLSearchParams) {
                requestBody = request.body.toString();
            } else if (typeof request.body === 'object') {
                requestBody = JSON.stringify(request.body);
            } else {
                requestBody = String(request.body);
            }

            const headers = requestOptions.headers as Record<string, string>;
            const hasContentLength = Object.keys(headers).some(
                key => key.toLowerCase() === 'content-length'
            );
            if (!hasContentLength && requestBody !== undefined) {
                headers['Content-Length'] = Buffer.byteLength(requestBody).toString();
            }
        }

        // Add Accept-Encoding header for decompression
        if (settings.decompress && !requestHeaders['accept-encoding'] && !requestHeaders['Accept-Encoding']) {
            (requestOptions.headers as Record<string, string>)['Accept-Encoding'] = 'gzip, deflate';
        }

        // SSL settings and proxy — resolved from the env-specific config cache.
        const proxyConfig = this.resolveProxy();
        // Proxy is disabled when enabled === false (default: enabled when config is set)
        const proxyActive = proxyConfig && proxyConfig.enabled !== false;
        const targetHost = url.hostname;
        const targetPort = url.port ? parseInt(url.port, 10) : (isHttps ? 443 : 80);

        if (isHttps) {
            const tlsSettings = this.resolveTlsSettings(url, settings);
            const httpsOptions = requestOptions as https.RequestOptions;
            httpsOptions.rejectUnauthorized = settings.strictSSL;

            const agentOptions: https.AgentOptions = {
                rejectUnauthorized: settings.strictSSL
            };

            const ca = this.readOptionalFile(tlsSettings.caPath, 'CA certificate');
            if (ca) {
                agentOptions.ca = ca;
            }

            const cert = this.readOptionalFile(tlsSettings.certPath, 'client certificate');
            if (cert) {
                agentOptions.cert = cert;
            }

            const key = this.readOptionalFile(tlsSettings.keyPath, 'client private key');
            if (key) {
                agentOptions.key = key;
            }

            const pfx = this.readOptionalFile(tlsSettings.pfxPath, 'client pfx');
            if (pfx) {
                agentOptions.pfx = pfx;
            }

            if (tlsSettings.passphrase) {
                agentOptions.passphrase = tlsSettings.passphrase;
            }

            if (tlsSettings.servername) {
                httpsOptions.servername = tlsSettings.servername;
            }

            if (proxyActive && (proxyConfig.https || proxyConfig.http)) {
                // HTTPS through proxy: open a CONNECT tunnel then upgrade to TLS
                httpsOptions.agent = this.buildHttpsProxyAgent(
                    proxyConfig.https || proxyConfig.http!,
                    targetHost,
                    targetPort,
                    agentOptions
                );
            } else {
                // Always use an explicit HTTPS agent so we can apply host-based certificates.
                // When no cert options are provided this still uses Node's default trust store.
                httpsOptions.agent = new https.Agent(agentOptions);
            }
        } else if (proxyActive && proxyConfig.http) {
            // Plain HTTP through proxy: send full URL to proxy host
            const proxyUrl = new URL(proxyConfig.http);
            requestOptions.hostname = proxyUrl.hostname;
            requestOptions.port = proxyUrl.port || 80;
            requestOptions.path = url.toString(); // absolute URI required by HTTP/1.1 proxy
            requestOptions.agent = this.buildHttpProxyAgent(proxyConfig.http, targetHost, targetPort);
        }

        // Apply bypass list: if target host matches, skip proxy (revert any overrides)
        if (proxyActive && proxyConfig.bypass?.length) {
            const bypassed = proxyConfig.bypass.some((pattern: string) => this.hostMatchesBypass(targetHost, pattern));
            if (bypassed) {
                // Revert to direct connection
                requestOptions.hostname = url.hostname;
                requestOptions.port = url.port || (isHttps ? 443 : 80);
                requestOptions.path = url.pathname + url.search;
                if (!isHttps) {
                    delete requestOptions.agent;
                } else {
                    const tlsSettings = this.resolveTlsSettings(url, settings);
                    const agentOptions: https.AgentOptions = { rejectUnauthorized: settings.strictSSL };
                    const ca = this.readOptionalFile(tlsSettings.caPath, 'CA certificate');
                    if (ca) { agentOptions.ca = ca; }
                    (requestOptions as https.RequestOptions).agent = new https.Agent(agentOptions);
                }
            }
        }

        return new Promise((resolve, reject) => {
            // Handle abort signal
            if (signal?.aborted) {
                const abortError = new Error('Request cancelled');
                abortError.name = 'AbortError';
                reject(abortError);
                return;
            }

            const lib = isHttps ? https : http;
            
            const req = lib.request(requestOptions, async (res) => {
                const statusCode = res.statusCode || 0;
                
                // Handle redirects
                if (settings.followRedirects && [301, 302, 303, 307, 308].includes(statusCode)) {
                    if (redirectCount >= settings.maxRedirects) {
                        reject(new Error(`Maximum redirects (${settings.maxRedirects}) exceeded`));
                        return;
                    }

                    const location = res.headers.location;
                    if (!location) {
                        reject(new Error('Redirect response missing Location header'));
                        return;
                    }

                    // Build new URL (handle relative redirects)
                    const redirectUrl = new URL(location, request.url).toString();
                    
                    // Determine method for redirect
                    let redirectMethod = request.method;
                    if (!settings.followOriginalMethod && [301, 302, 303].includes(statusCode)) {
                        // Convert to GET for these status codes unless followOriginalMethod is set
                        redirectMethod = 'GET';
                    }

                    // Build new headers
                    const redirectHeaders = { ...request.headers };
                    if (!settings.followAuthHeader) {
                        delete redirectHeaders['authorization'];
                        delete redirectHeaders['Authorization'];
                    }

                    try {
                        const redirectResponse = await this.executeInternal({
                            ...request,
                            url: redirectUrl,
                            method: redirectMethod,
                            headers: redirectHeaders,
                            body: redirectMethod === 'GET' ? undefined : request.body
                        }, settings, redirectCount + 1, signal);
                        
                        // Adjust time to include redirect time
                        const endTime = Date.now();
                        redirectResponse.time = endTime - startTime;
                        resolve(redirectResponse);
                    } catch (error) {
                        reject(error);
                    }
                    return;
                }

                const chunks: Buffer[] = [];

                res.on('data', (chunk) => chunks.push(chunk));
                
                res.on('end', () => {
                    const endTime = Date.now();
                    let rawBody = Buffer.concat(chunks);
                    
                    // Handle decompression
                    const encoding = res.headers['content-encoding'];
                    if (settings.decompress && encoding) {
                        try {
                            if (encoding === 'gzip') {
                                rawBody = zlib.gunzipSync(rawBody);
                            } else if (encoding === 'deflate') {
                                rawBody = zlib.inflateSync(rawBody);
                            }
                        } catch (e) {
                            console.warn('[NodeHttpClient] Decompression failed:', e);
                            // Continue with raw body if decompression fails
                        }
                    }
                    
                    // Keep the raw response body as a string (Postman-compatible).
                    // Scripts parse on demand via response.json(); eager parsing is
                    // intentionally avoided so `response.body` matches Postman.
                    const body: any = rawBody.toString('utf-8');

                    const headers: Record<string, string | string[]> = {};
                    for (const [key, value] of Object.entries(res.headers)) {
                        if (typeof value === 'string') {
                            headers[key] = value;
                        } else if (Array.isArray(value)) {
                            headers[key] = value;
                        }
                    }

                    const cookies = this.parseCookies(res.headers['set-cookie'], url.hostname);

                    resolve({
                        status: res.statusCode || 0,
                        statusText: res.statusMessage || '',
                        headers,
                        cookies,
                        body,
                        time: endTime - startTime,
                        size: rawBody.length
                    });
                });
            });

            // Listen for abort signal
            if (signal) {
                signal.addEventListener('abort', () => {
                    req.destroy();
                    const abortError = new Error('Request cancelled');
                    abortError.name = 'AbortError';
                    reject(abortError);
                });
            }

            req.on('error', (error) => {
                reject(error);
            });

            req.on('timeout', () => {
                req.destroy();
                reject(new Error('Request timeout'));
            });

            if (requestBody !== undefined) {
                req.write(requestBody);
            }

            req.end();
        });
    }

    /**
     * Build an http.Agent that routes plain-HTTP requests through an HTTP proxy.
     */
    private buildHttpProxyAgent(proxyUrl: string, _targetHost: string, _targetPort: number): http.Agent {
        const proxy = new URL(proxyUrl);
        const proxyHost = proxy.hostname;
        const proxyPort = parseInt(proxy.port || '8080', 10);
        const agent = new http.Agent();
        // Override createConnection to connect to the proxy host
        (agent as any).createConnection = (opts: any, cb: any) => {
            return net.createConnection({ host: proxyHost, port: proxyPort }, cb);
        };
        return agent;
    }

    /**
     * Build an https.Agent that tunnels HTTPS through an HTTP proxy using CONNECT.
     */
    private buildHttpsProxyAgent(
        proxyUrl: string,
        targetHost: string,
        targetPort: number,
        agentOptions: https.AgentOptions
    ): https.Agent {
        const proxy = new URL(proxyUrl);
        const proxyHost = proxy.hostname;
        const proxyPort = parseInt(proxy.port || '8080', 10);
        const proxyAuth = proxy.username
            ? 'Basic ' + Buffer.from(`${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`).toString('base64')
            : undefined;

        const agent = new https.Agent(agentOptions);
        (agent as any).createConnection = (_opts: any, cb: (err: Error | null, socket?: any) => void) => {
            // Open a TCP connection to the proxy
            const socket = net.createConnection({ host: proxyHost, port: proxyPort });
            socket.once('connect', () => {
                // Send HTTP CONNECT request
                const connectHeaders = [`CONNECT ${targetHost}:${targetPort} HTTP/1.1`, `Host: ${targetHost}:${targetPort}`];
                if (proxyAuth) {
                    connectHeaders.push(`Proxy-Authorization: ${proxyAuth}`);
                }
                socket.write(connectHeaders.join('\r\n') + '\r\n\r\n');

                // Wait for 200 Connection established
                let response = '';
                socket.once('data', (data: Buffer) => {
                    response += data.toString();
                    if (!response.includes('200')) {
                        cb(new Error(`Proxy CONNECT failed: ${response.split('\r\n')[0]}`));
                        socket.destroy();
                        return;
                    }
                    // Upgrade to TLS
                    const tlsSocket = tls.connect({
                        ...agentOptions,
                        socket,
                        servername: targetHost
                    });
                    tlsSocket.once('error', (err: Error) => cb(err));
                    tlsSocket.once('secureConnect', () => cb(null, tlsSocket));
                });
            });
            socket.once('error', (err: Error) => cb(err));
        };
        return agent;
    }

    /**
     * Check whether a host matches a bypass pattern (exact or wildcard).
     */
    private hostMatchesBypass(host: string, pattern: string): boolean {
        const p = pattern.toLowerCase().trim();
        const h = host.toLowerCase();
        if (p === '*') return true;
        if (p.startsWith('*.')) return h === p.slice(2) || h.endsWith(`.${p.slice(2)}`);
        return h === p;
    }

    private resolveTlsSettings(url: URL, settings: Required<RequestSettings>): TlsSettings {
        const perRequestTls = settings.tls || {};
        const hasExplicitPerRequestTls = Boolean(
            perRequestTls.caPath ||
            perRequestTls.certPath ||
            perRequestTls.keyPath ||
            perRequestTls.pfxPath ||
            perRequestTls.servername ||
            perRequestTls.passphrase
        );

        if (hasExplicitPerRequestTls) {
            return perRequestTls;
        }

        const matched = this.findCertificateMapping(url, settings.certificates || []);
        return matched ? {
            caPath: matched.caPath,
            certPath: matched.certPath,
            keyPath: matched.keyPath,
            pfxPath: matched.pfxPath,
            passphrase: matched.passphrase,
            servername: matched.servername
        } : perRequestTls;
    }

    private findCertificateMapping(url: URL, mappings: TlsCertificateMapping[]): TlsCertificateMapping | undefined {
        if (!Array.isArray(mappings) || mappings.length === 0) {
            return undefined;
        }

        const hostname = url.hostname;
        const port = url.port ? Number(url.port) : 443;

        // Prefer exact host matches over wildcard matches.
        const exactMatch = mappings.find(m => this.mappingMatchesHost(m, hostname, port, true));
        if (exactMatch) {
            return exactMatch;
        }
        return mappings.find(m => this.mappingMatchesHost(m, hostname, port, false));
    }

    private mappingMatchesHost(mapping: TlsCertificateMapping, hostname: string, port: number, exactOnly: boolean): boolean {
        if (!mapping || mapping.enabled === false) {
            return false;
        }

        const hostPattern = String(mapping.host || '').trim().toLowerCase();
        if (!hostPattern) {
            return false;
        }

        if (mapping.port != null && Number(mapping.port) !== port) {
            return false;
        }

        const h = hostname.toLowerCase();
        if (exactOnly) {
            return hostPattern !== '*' && !hostPattern.startsWith('*.') && h === hostPattern;
        }

        if (hostPattern === '*') {
            return true;
        }

        if (hostPattern.startsWith('*.')) {
            const suffix = hostPattern.slice(2);
            return h === suffix || h.endsWith(`.${suffix}`);
        }

        return h === hostPattern;
    }

    private readOptionalFile(filePath: string | undefined, label: string): Buffer | undefined {
        if (!filePath) {
            return undefined;
        }

        const resolved = path.isAbsolute(filePath)
            ? filePath
            : path.resolve(this.basePath, filePath);

        try {
            return fs.readFileSync(resolved);
        } catch (error: any) {
            throw new Error(`[NodeHttpClient] Failed to read ${label} file at ${resolved}: ${error?.message || 'Unknown error'}`);
        }
    }

    /**
     * Parse Set-Cookie headers into structured objects
     * Same implementation as plugin's HttpRequestService.parseCookies
     */
    private parseCookies(setCookieHeaders?: string[], defaultDomain?: string): ParsedCookie[] {
        if (!setCookieHeaders) {
            return [];
        }

        return setCookieHeaders.map((header) => {
            const parts = header.split(';').map(p => p.trim());
            const [nameValue, ...attributes] = parts;
            const [name, value] = nameValue.split('=');

            const cookie: ParsedCookie = {
                name: name.trim(),
                value: value?.trim() || '',
                domain: defaultDomain
            };

            for (const attr of attributes) {
                const [attrName, attrValue] = attr.split('=');
                const lowerName = attrName.toLowerCase().trim();

                switch (lowerName) {
                    case 'domain':
                        cookie.domain = attrValue?.trim();
                        break;
                    case 'path':
                        cookie.path = attrValue?.trim();
                        break;
                    case 'expires':
                        cookie.expires = attrValue?.trim();
                        break;
                    case 'httponly':
                        cookie.httpOnly = true;
                        break;
                    case 'secure':
                        cookie.secure = true;
                        break;
                }
            }

            return cookie;
        });
    }
}
