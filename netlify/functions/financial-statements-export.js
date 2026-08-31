// Export the real financial-statements.js output as PDF, CSV, or a
// browser-openable "Excel" file (an HTML table saved with a .xls
// extension — a long-standing, genuinely supported trick; Excel opens it
// fine). No PDF library needed: builds a minimal, valid PDF by hand
// (single page, one text stream) — verified with a real PDF parser
// (pypdf) before this was adapted from the uploaded zip, which wrapped a
// different "enterprise" statements variant with field names that don't
// match what this project's financial-statements.js actually returns.
const { json } = require('./_lib/supabase');
const statementsHandler = require('./financial-statements').handler;

function esc(v){ return String(v ?? '').replace(/"/g, '""'); }
function csvRows(rows){ return rows.map(r => r.map(x => `"${esc(x)}"`).join(',')).join('\n'); }

function pdfFromLines(lines){
  const safe = lines.map(x => String(x).replace(/\\/g,'\\\\').replace(/\(/g,'\\(').replace(/\)/g,'\\)'));
  let y = 790, content = `BT /F1 9 Tf 40 ${y} Td `;
  for(let i=0;i<safe.length;i++){ if(i) content += '0 -13 Td '; content += `(${safe[i]}) Tj `; }
  content += 'ET';
  const o = [];
  o[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  o[2] = '<< /Type /Pages /Kids [3 0 R] /Count 1 >>';
  o[3] = '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>';
  o[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  o[5] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
  let out = '%PDF-1.4\n', offs = [0];
  for(let i=1;i<o.length;i++){ offs[i] = out.length; out += `${i} 0 obj\n${o[i]}\nendobj\n`; }
  const xrefStart = out.length;
  out += `xref\n0 ${o.length}\n0000000000 65535 f \n`;
  for(let i=1;i<o.length;i++) out += String(offs[i]).padStart(10,'0') + ' 00000 n \n';
  out += `trailer\n<< /Size ${o.length} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return Buffer.from(out, 'binary').toString('base64');
}

exports.handler = async (event) => {
  if(event.httpMethod !== 'GET') return json(405, { error: 'Method not allowed.' });
  const q = event.queryStringParameters || {};
  const format = (q.format || 'pdf').toLowerCase();

  // Reuse the real statements endpoint's own RBAC + computation — never
  // duplicate that logic here, so export always matches what's on screen.
  const inner = await statementsHandler(event);
  if(inner.statusCode !== 200) return inner;
  const d = JSON.parse(inner.body);
  const p = d.profit_and_loss, b = d.balance_sheet, c = d.cash_flow;

  const lines = [
    'HAPPYNET FINANCIAL STATEMENTS',
    `Period: ${d.period_start} to ${d.period_end}`,
    '',
    'PROFIT & LOSS',
    ...p.revenue.map(r => `  ${r.name}: KES ${Number(r.amount).toLocaleString()}`),
    `  Total Revenue: KES ${p.total_revenue_kes.toLocaleString()}`,
    ...p.expenses.map(e => `  ${e.name}: KES (${Number(e.amount).toLocaleString()})`),
    `  Total Expenses: KES (${p.total_expense_kes.toLocaleString()})`,
    `  Operating Result: KES ${p.operating_result_kes.toLocaleString()}`,
    '',
    `BALANCE SHEET as of ${b.as_of}`,
    ...b.assets.map(a => `  Asset — ${a.name}: KES ${Number(a.amount).toLocaleString()}`),
    `  Total Assets: KES ${b.total_assets_kes.toLocaleString()}`,
    ...b.liabilities.map(l => `  Liability — ${l.name}: KES ${Number(l.amount).toLocaleString()}`),
    `  Total Liabilities: KES ${b.total_liabilities_kes.toLocaleString()}`,
    `  Current Earnings: KES ${b.current_earnings_kes.toLocaleString()}`,
    `  Total Equity: KES ${b.total_equity_kes.toLocaleString()}`,
    `  Balance check: ${b.is_balanced ? 'BALANCED' : 'OUT OF BALANCE — DO NOT TRUST'}`,
    '',
    'CASH FLOW',
    `  Operating: KES ${c.operating_kes.toLocaleString()}`,
    `  Financing: KES ${c.financing_kes.toLocaleString()}`,
    `  Net Movement: KES ${c.net_movement_kes.toLocaleString()}`
  ];

  const filenameBase = `happynet-statements-${d.period_start}-to-${d.period_end}`;

  if(format === 'pdf'){
    return {
      statusCode: 200, isBase64Encoded: true,
      headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${filenameBase}.pdf"` },
      body: pdfFromLines(lines)
    };
  }

  if(format === 'csv'){
    const rows = [['Statement', 'Line', 'Amount KES']];
    p.revenue.forEach(r => rows.push(['Profit & Loss', r.name, r.amount]));
    rows.push(['Profit & Loss', 'Total Revenue', p.total_revenue_kes]);
    p.expenses.forEach(e => rows.push(['Profit & Loss', e.name, -e.amount]));
    rows.push(['Profit & Loss', 'Total Expenses', -p.total_expense_kes]);
    rows.push(['Profit & Loss', 'Operating Result', p.operating_result_kes]);
    b.assets.forEach(a => rows.push(['Balance Sheet', 'Asset: ' + a.name, a.amount]));
    rows.push(['Balance Sheet', 'Total Assets', b.total_assets_kes]);
    b.liabilities.forEach(l => rows.push(['Balance Sheet', 'Liability: ' + l.name, l.amount]));
    rows.push(['Balance Sheet', 'Total Liabilities', b.total_liabilities_kes]);
    rows.push(['Balance Sheet', 'Current Earnings', b.current_earnings_kes]);
    rows.push(['Balance Sheet', 'Total Equity', b.total_equity_kes]);
    rows.push(['Cash Flow', 'Operating', c.operating_kes]);
    rows.push(['Cash Flow', 'Financing', c.financing_kes]);
    rows.push(['Cash Flow', 'Net Movement', c.net_movement_kes]);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${filenameBase}.csv"` },
      body: csvRows(rows)
    };
  }

  if(format === 'xls'){
    const rows = [['Statement', 'Line', 'Amount KES']];
    p.revenue.forEach(r => rows.push(['Profit & Loss', r.name, r.amount]));
    rows.push(['Profit & Loss', 'Total Revenue', p.total_revenue_kes]);
    p.expenses.forEach(e => rows.push(['Profit & Loss', e.name, e.amount]));
    rows.push(['Profit & Loss', 'Total Expenses', p.total_expense_kes]);
    rows.push(['Profit & Loss', 'Operating Result', p.operating_result_kes]);
    b.assets.forEach(a => rows.push(['Balance Sheet', 'Asset: ' + a.name, a.amount]));
    rows.push(['Balance Sheet', 'Total Assets', b.total_assets_kes]);
    b.liabilities.forEach(l => rows.push(['Balance Sheet', 'Liability: ' + l.name, l.amount]));
    rows.push(['Balance Sheet', 'Total Liabilities', b.total_liabilities_kes]);
    const html = '<html><body><table border="1">' +
      rows.map((r,i) => '<tr>' + r.map(x => `<${i?'td':'th'}>${esc(x)}</${i?'td':'th'}>`).join('') + '</tr>').join('') +
      '</table></body></html>';
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/vnd.ms-excel', 'Content-Disposition': `attachment; filename="${filenameBase}.xls"` },
      body: html
    };
  }

  return json(400, { error: 'format must be pdf, csv, or xls.' });
};
