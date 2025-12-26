export interface ParsedRow {
  placementUrl: string;
  cost?: number;
  impressions?: number;
  views?: number;
  viewRate?: number;
  avgWatchTime?: number;
  clicks?: number;
  conversions?: number;
  [key: string]: any; // Allow other columns
}

export interface ColumnMapping {
  placementUrl: string | null;
  cost: string | null;
  impressions: string | null;
  views: string | null;
  viewRate: string | null;
  avgWatchTime: string | null;
  clicks: string | null;
  conversions: string | null;
}

/**
 * Maps CSV headers to standardized field names
 */
function mapColumns(headers: string[]): ColumnMapping {
  const normalizedHeaders = headers.map(h => h.trim().toLowerCase());
  
  const mapping: ColumnMapping = {
    placementUrl: null,
    cost: null,
    impressions: null,
    views: null,
    viewRate: null,
    avgWatchTime: null,
    clicks: null,
    conversions: null
  };

  // Placement URL candidates
  const placementCandidates = [
    'placement', 'website', 'url', 'placement url', 'where ads showed',
    'targeting', 'youtube placement', 'placement url (website)', 'display url'
  ];
  
  for (let i = 0; i < normalizedHeaders.length; i++) {
    const header = normalizedHeaders[i];
    
    // Find placement URL column
    if (!mapping.placementUrl) {
      for (const candidate of placementCandidates) {
        if (header.includes(candidate)) {
          mapping.placementUrl = headers[i];
          break;
        }
      }
    }

    // Cost candidates
    if (!mapping.cost && (header.includes('cost') || header.includes('spend'))) {
      mapping.cost = headers[i];
    }

    // Impressions candidates
    if (!mapping.impressions && (header.includes('impr') || header.includes('impression'))) {
      mapping.impressions = headers[i];
    }

    // Views candidates
    if (!mapping.views && header.includes('view') && !header.includes('rate') && !header.includes('time')) {
      mapping.views = headers[i];
    }

    // View rate candidates
    if (!mapping.viewRate && (header.includes('view rate') || header.includes('viewrate'))) {
      mapping.viewRate = headers[i];
    }

    // Avg watch time candidates
    if (!mapping.avgWatchTime && (header.includes('watch time') || header.includes('watchtime') || header.includes('avg. watch'))) {
      mapping.avgWatchTime = headers[i];
    }

    // Clicks candidates
    if (!mapping.clicks && header.includes('click')) {
      mapping.clicks = headers[i];
    }

    // Conversions candidates
    if (!mapping.conversions && (header.includes('conversion') || header.includes('conv.'))) {
      mapping.conversions = headers[i];
    }
  }

  return mapping;
}

/**
 * Parses a numeric value from CSV cell, handling commas and currency symbols
 */
function parseNumber(value: string | undefined): number | undefined {
  if (!value || value.trim() === '' || value.trim() === '-') {
    return undefined;
  }

  // Remove currency symbols, commas, and whitespace
  const cleaned = value.toString().replace(/[$,\s]/g, '');
  const parsed = parseFloat(cleaned);
  
  return isNaN(parsed) ? undefined : parsed;
}

/**
 * Parses a percentage value (e.g., "2.5%" -> 2.5)
 */
function parsePercentage(value: string | undefined): number | undefined {
  if (!value || value.trim() === '' || value.trim() === '-') {
    return undefined;
  }

  const cleaned = value.toString().replace(/[%\s]/g, '');
  const parsed = parseFloat(cleaned);
  
  return isNaN(parsed) ? undefined : parsed;
}

/**
 * Parses time duration in seconds (handles formats like "3.5", "3.5 sec", "00:03:05")
 */
function parseWatchTime(value: string | undefined): number | undefined {
  if (!value || value.trim() === '' || value.trim() === '-') {
    return undefined;
  }

  const str = value.toString().trim();
  
  // Handle MM:SS or HH:MM:SS format
  if (str.includes(':')) {
    const parts = str.split(':').map(p => parseFloat(p.trim()));
    if (parts.length === 2) {
      return parts[0] * 60 + parts[1];
    } else if (parts.length === 3) {
      return parts[0] * 3600 + parts[1] * 60 + parts[2];
    }
  }

  // Handle "X sec" or "X.5" format
  const cleaned = str.replace(/[^\d.]/g, '');
  const parsed = parseFloat(cleaned);
  
  return isNaN(parsed) ? undefined : parsed;
}

/**
 * Simple CSV parser that handles quoted fields
 * This is a basic implementation - for production, consider using csv-parse library
 */
function parseCSV(csvText: string): string[][] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = '';
  let insideQuotes = false;

  for (let i = 0; i < csvText.length; i++) {
    const char = csvText[i];
    const nextChar = csvText[i + 1];

    if (char === '"') {
      if (insideQuotes && nextChar === '"') {
        // Escaped quote
        currentField += '"';
        i++; // Skip next quote
      } else {
        // Toggle quote state
        insideQuotes = !insideQuotes;
      }
    } else if (char === ',' && !insideQuotes) {
      // Field separator
      currentRow.push(currentField.trim());
      currentField = '';
    } else if ((char === '\n' || char === '\r') && !insideQuotes) {
      // Row separator
      if (currentField || currentRow.length > 0) {
        currentRow.push(currentField.trim());
        currentField = '';
        rows.push(currentRow);
        currentRow = [];
      }
      // Skip \r\n combination
      if (char === '\r' && nextChar === '\n') {
        i++;
      }
    } else {
      currentField += char;
    }
  }

  // Add last field and row
  if (currentField || currentRow.length > 0) {
    currentRow.push(currentField.trim());
    rows.push(currentRow);
  }

  return rows;
}

/**
 * Parses CSV text and returns array of parsed rows
 */
export function parsePlacementCSV(csvText: string): ParsedRow[] {
  const rows = parseCSV(csvText);
  
  if (rows.length === 0) {
    return [];
  }

  // First row is headers
  const headers = rows[0];
  const mapping = mapColumns(headers);

  if (!mapping.placementUrl) {
    throw new Error('Could not find placement URL column in CSV. Expected columns: Placement, Website, URL, etc.');
  }

  const parsedRows: ParsedRow[] = [];

  // Process data rows
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    
    // Skip empty rows
    if (row.every(cell => !cell || cell.trim() === '')) {
      continue;
    }

    // Build row object
    const parsedRow: ParsedRow = {
      placementUrl: ''
    };

    // Map each column
    headers.forEach((header, index) => {
      const value = row[index] || '';
      
      if (header === mapping.placementUrl) {
        parsedRow.placementUrl = value.trim();
      } else if (mapping.cost && header === mapping.cost) {
        parsedRow.cost = parseNumber(value);
      } else if (mapping.impressions && header === mapping.impressions) {
        parsedRow.impressions = parseNumber(value);
      } else if (mapping.views && header === mapping.views) {
        parsedRow.views = parseNumber(value);
      } else if (mapping.viewRate && header === mapping.viewRate) {
        parsedRow.viewRate = parsePercentage(value);
      } else if (mapping.avgWatchTime && header === mapping.avgWatchTime) {
        parsedRow.avgWatchTime = parseWatchTime(value);
      } else if (mapping.clicks && header === mapping.clicks) {
        parsedRow.clicks = parseNumber(value);
      } else if (mapping.conversions && header === mapping.conversions) {
        parsedRow.conversions = parseNumber(value);
      } else {
        // Store other columns
        parsedRow[header] = value;
      }
    });

    // Only add rows with a placement URL
    if (parsedRow.placementUrl) {
      parsedRows.push(parsedRow);
    }
  }

  return parsedRows;
}

