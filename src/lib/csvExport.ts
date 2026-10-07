export function exportToCSV(data: Record<string, any>[], filename: string, columns?: { key: string; label: string }[]) {
  if (!data.length) return;

  const cols = columns || Object.keys(data[0]).map(key => ({ key, label: key }));
  const escapeCSV = (val: any) => {
    let str = val == null ? '' : String(val);
    // Neutralise spreadsheet formulas (CSV injection) in user-entered text.
    if (/^[=+\-@\t\r]/.test(str)) str = `'${str}`;
    return str.includes(',') || str.includes('"') || str.includes('\n') ? `"${str.replace(/"/g, '""')}"` : str;
  };

  const header = cols.map(c => escapeCSV(c.label)).join(',');
  const rows = data.map(row =>
    cols.map(c => escapeCSV(row[c.key])).join(',')
  );

  const csv = [header, ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filename}_${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
