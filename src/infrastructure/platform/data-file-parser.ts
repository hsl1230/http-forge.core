/**
 * Data File Parser
 * 
 * Extracted 100% from VS Code plugin: src/services/request-execution/data-file-parser.ts
 * 
 * Single Responsibility: Parse data files (JSON/CSV) into row data
 * Used by collection runner for data-driven testing
 * 
 * DO NOT modify the core logic - it has been tested and is reliable.
 */

/**
 * Data file parser interface
 * Same as plugin's IDataFileParser
 */
export interface IDataFileParser {
    /**
     * Parse file content based on file extension
     */
    parse(content: string, filePath: string): any[];

    /**
     * Parse JSON content into data rows
     */
    parseJson(content: string): any[];

    /**
     * Parse CSV content into data rows
     */
    parseCsv(content: string): any[];
}

/**
 * Default implementation of data file parser
 * Same implementation as plugin's DataFileParser class
 * Supports JSON and CSV file formats
 */
export class DataFileParser implements IDataFileParser {
    /**
     * Parse file content based on file extension
     * Same implementation as plugin
     * 
     * @param content - File content as string
     * @param filePath - File path (used to determine format)
     * @returns Array of data row objects
     */
    public parse(content: string, filePath: string): any[] {
        const isJson = filePath.toLowerCase().endsWith('.json');
        
        if (isJson) {
            return this.parseJson(content);
        } else {
            return this.parseCsv(content);
        }
    }

    /**
     * Parse JSON content into data rows
     * Same implementation as plugin
     * 
     * @param content - JSON string content
     * @returns Array of data row objects
     * @throws Error if JSON is invalid
     */
    public parseJson(content: string): any[] {
        try {
            const parsed = JSON.parse(content);
            return Array.isArray(parsed) ? parsed : [parsed];
        } catch (error) {
            throw new Error('Failed to parse JSON data file: Invalid JSON format');
        }
    }

    /**
     * Parse CSV content into data rows
     * Same implementation as plugin
     * First row is treated as headers
     * 
     * @param content - CSV string content
     * @returns Array of data row objects
     */
    public parseCsv(content: string): any[] {
        const lines = content.split(/\r?\n/).filter(line => line.trim());
        
        if (lines.length < 2) {
            return [{}];
        }

        const headers = this.parseCsvLine(lines[0]);
        const rows: any[] = [];

        for (let i = 1; i < lines.length; i++) {
            const values = this.parseCsvLine(lines[i]);
            const row: Record<string, string> = {};
            
            headers.forEach((header, index) => {
                row[header] = values[index] || '';
            });
            
            rows.push(row);
        }

        return rows;
    }

    /**
     * Parse a single CSV line, handling quoted values
     * Same implementation as plugin
     * 
     * @param line - CSV line to parse
     * @returns Array of string values
     */
    private parseCsvLine(line: string): string[] {
        const values: string[] = [];
        let current = '';
        let inQuotes = false;

        for (let i = 0; i < line.length; i++) {
            const char = line[i];
            const nextChar = line[i + 1];

            if (char === '"') {
                if (inQuotes && nextChar === '"') {
                    // Escaped quote
                    current += '"';
                    i++;
                } else {
                    // Toggle quote state
                    inQuotes = !inQuotes;
                }
            } else if (char === ',' && !inQuotes) {
                values.push(current.trim());
                current = '';
            } else {
                current += char;
            }
        }

        // Don't forget the last value
        values.push(current.trim());

        return values;
    }
}
