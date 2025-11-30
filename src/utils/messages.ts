export function summarizeList(params: {
  subject: string;
  count: number;
  limit?: number;
  nextCursor?: string | undefined;
  filterHints?: string[];
  previewLines?: string[];
  zeroReasonHints?: string[];
  nextSteps?: string[];
}): string {
  const bits: string[] = [];
  const header = `${params.subject}: ${params.count}${
    typeof params.limit === 'number' ? ` (limit ${params.limit})` : ''
  }${params.nextCursor ? ', more available' : ''}.`;
  bits.push(header);
  if (params.filterHints?.length) {
    bits.push(`Filter: ${params.filterHints.join('; ')}.`);
  }
  if (params.previewLines?.length) {
    bits.push(`Preview:\n${params.previewLines.map((l) => `- ${l}`).join('\n')}`);
  }
  if (!params.count && params.zeroReasonHints?.length) {
    bits.push(`No results. Try: ${params.zeroReasonHints.join('; ')}.`);
  }
  const next = params.nextSteps?.length
    ? `Suggested next steps: ${params.nextSteps.join(' ')}`
    : params.nextCursor
      ? `Suggested next steps: pass cursor '${params.nextCursor}' to fetch the next page.`
      : undefined;
  if (next) {
    bits.push(next);
  }
  return bits.join(' ');
}

export function summarizeBatch(params: {
  action: string; // e.g. "Created issues", "Updated issues"
  ok: number;
  total: number;
  okIdentifiers?: string[];
  failures?: Array<{
    index: number;
    id?: string;
    error: string;
    code?: string;
  }>;
  nextSteps?: string[];
}): string {
  const okBit = `${params.action}: ${params.ok} / ${params.total}.`;
  const idBit = params.okIdentifiers?.length
    ? ` OK: ${params.okIdentifiers.join(', ')}.`
    : '';
  const failBit = params.failures?.length
    ? ` Failed (${params.failures.length}): ${params.failures
        .map(
          (f) =>
            `${
              typeof f.index === 'number' ? `item[${f.index}]` : (f.id ?? 'item')
            } — ${f.error}${f.code ? ` [${f.code}]` : ''}`,
        )
        .join('; ')}.`
    : '';
  const next = params.nextSteps?.length
    ? ` Suggested next steps: ${params.nextSteps.join(' ')}`
    : '';
  return `${okBit}${idBit}${failBit}${next}`.trim();
}

export function previewLinesFromItems(
  items: Array<Record<string, unknown>>,
  build: (item: Record<string, unknown>) => string,
  limit: number = 5,
): string[] {
  return items.slice(0, limit).map((it) => build(it));
}


