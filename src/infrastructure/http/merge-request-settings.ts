/**
 * Merge Request Settings
 * 
 * Merges user-provided request settings with defaults.
 * Extracted from extension's utils/merge-request-settings.ts.
 */

import { RequestSettings } from '../../types/types';
import { DEFAULT_REQUEST_SETTINGS } from './native-http-client';

/**
 * Merge user-provided RequestSettings with defaults.
 * Idempotent and safe to call from multiple layers.
 */
export function mergeRequestSettings(userSettings?: Partial<RequestSettings>): Required<RequestSettings> {
    return {
        timeout: userSettings?.timeout ?? DEFAULT_REQUEST_SETTINGS.timeout,
        followRedirects: userSettings?.followRedirects ?? DEFAULT_REQUEST_SETTINGS.followRedirects,
        followOriginalMethod: userSettings?.followOriginalMethod ?? DEFAULT_REQUEST_SETTINGS.followOriginalMethod,
        followAuthHeader: userSettings?.followAuthHeader ?? DEFAULT_REQUEST_SETTINGS.followAuthHeader,
        maxRedirects: userSettings?.maxRedirects ?? DEFAULT_REQUEST_SETTINGS.maxRedirects,
        strictSSL: userSettings?.strictSSL ?? DEFAULT_REQUEST_SETTINGS.strictSSL,
        decompress: userSettings?.decompress ?? DEFAULT_REQUEST_SETTINGS.decompress,
        includeCookies: userSettings?.includeCookies ?? DEFAULT_REQUEST_SETTINGS.includeCookies,
        tls: userSettings?.tls ?? DEFAULT_REQUEST_SETTINGS.tls,
        certificates: userSettings?.certificates ?? DEFAULT_REQUEST_SETTINGS.certificates
    };
}
