/**
 * URL Builder Service
 * 
 * Single Responsibility: Build URLs with variable and path parameter substitution
 * 
 * Handles:
 * - Template variable replacement: {{variable}}
 * - Path parameter replacement: :param, :param(regex), :param?
 * - Query string building and merging
 */

const URL_WITH_ORIGIN_PATTERN = /^((?:https?|wss?):\/\/)([^\/]*)(\/.*)?$/;

/**
 * URL Builder interface
 */
export interface IUrlBuilder {
    /**
     * Build a complete URL with path parameter and query string substitution.
     * Matches extension's IUrlBuilder — expects {{variables}} pre-resolved.
     * @param path - URL path (with {{variables}} pre-resolved by caller)
     * @param params - Path parameters for :param replacement
     * @param query - Query parameters to append
     */
    buildUrl(
        path: string,
        params?: Record<string, string>,
        query?: Record<string, string>
    ): string;

    /**
     * Replace only path parameters (:param) in a URL
     */
    replacePathParams(url: string, params: Record<string, string>): string;

    /**
     * Extract path parameter names from a URL pattern
     */
    extractPathParams(urlPattern: string): string[];
}

/**
 * URL Builder implementation
 */
export class UrlBuilder implements IUrlBuilder {

    /**
     * Build a complete URL with all substitutions.
     * Expects {{variables}} in urlPattern to be pre-resolved by caller.
     */
    buildUrl(
        urlPattern: string,
        params: Record<string, string> = {},
        query: Record<string, string> = {}
    ): string {
        let url = urlPattern;

        // 1. Replace path parameters :param
        url = this.replacePathParams(url, params);

        // 2. Handle query parameters
        url = this.appendQueryParams(url, query);

        return url;
    }

    /**
     * Replace path parameters in URL
     * Supports:
     * - :param - required parameter
     * - :param? - optional parameter
     * - :param(regex) - parameter with validation regex (regex is ignored, just for documentation)
     */
    replacePathParams(url: string, params: Record<string, string>): string {
        // Parse URL into parts: protocol+host, path, query
        let protocol = '';
        let host = '';
        let path = url;
        let query = '';

        // Extract query string first (everything after ?)
        const queryIndex = url.indexOf('?');
        if (queryIndex !== -1) {
            query = url.substring(queryIndex);
            path = url.substring(0, queryIndex);
        }

        // Extract protocol and host if present
        const protocolMatch = path.match(URL_WITH_ORIGIN_PATTERN);
        if (protocolMatch) {
            protocol = protocolMatch[1];
            host = protocolMatch[2];
            path = protocolMatch[3] || '/';
        }

        // Match path-to-regexp style parameters
        // :paramName - required
        // :paramName? - optional
        // :paramName(regex) - with regex pattern (pattern ignored, used for documentation)
        const paramRegex = /:(\w+)(?:\([^)]*\))?(\?)?/g;

        // Replace params in the path portion only
        let resultPath = path.replace(paramRegex, (match, paramName, isOptional) => {
            const value = params[paramName];

            if (value !== undefined && value !== '') {
                return encodeURIComponent(value);
            }

            if (isOptional) {
                return '';
            }

            // Keep the placeholder if param not provided (will be visible as error)
            console.warn(`[UrlBuilder] Missing required path parameter: ${paramName}`);
            return match;
        });

        // Clean up any double slashes (but preserve protocol //)
        resultPath = resultPath.replace(/([^:])\/+/g, '$1/');

        // Do NOT strip trailing slashes — Postman preserves them and some APIs require them.

        return `${protocol}${host}${resultPath}${query}`;
    }

    /**
     * Extract path parameter names from a URL pattern
     */
    extractPathParams(urlPattern: string): string[] {
        let path = urlPattern;

        const queryIndex = path.indexOf('?');
        if (queryIndex !== -1) {
            path = path.substring(0, queryIndex);
        }

        const protocolMatch = path.match(URL_WITH_ORIGIN_PATTERN);
        if (protocolMatch) {
            path = protocolMatch[3] || '/';
        }

        const paramRegex = /:(\w+)(?:\([^)]*\))?(\?)?/g;
        const params: string[] = [];
        let match;

        while ((match = paramRegex.exec(path)) !== null) {
            params.push(match[1]);
        }

        return [...new Set(params)]; // Remove duplicates
    }

    /**
     * Append query parameters to URL
     */
    private appendQueryParams(
        url: string,
        query: Record<string, string>
    ): string {
        // Extract existing query params from the URL
        let pathWithoutQuery = url;
        let existingQueryParams: Record<string, string> = {};

        if (url.includes('?')) {
            const [basePath, queryString] = url.split('?');
            pathWithoutQuery = basePath;

            // Parse existing query params from URL
            if (queryString) {
                const urlParams = new URLSearchParams(queryString);
                urlParams.forEach((value, key) => {
                    existingQueryParams[key] = value;
                });
            }
        }

        // Merge query params: provided query params take precedence
        const mergedQuery = { ...existingQueryParams, ...query };

        // Build query string
        const queryParams = new URLSearchParams();
        for (const [key, value] of Object.entries(mergedQuery)) {
            if (value !== undefined && value !== null) {
                queryParams.append(key, value);
            }
        }
        const queryString = queryParams.toString();

        return queryString ? `${pathWithoutQuery}?${queryString}` : pathWithoutQuery;
    }
}
