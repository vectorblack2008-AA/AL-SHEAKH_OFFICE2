/**
 * Opens a dedicated, self-contained print window. Keeping print markup out of
 * the app DOM avoids the shell, sidebars and dialogs leaking into printouts.
 */
export function printDocument(title: string, bodyHtml: string, options?: { dir?: 'ltr' | 'rtl'; lang?: string }): boolean {
  const win = window.open('', '_blank', 'width=920,height=1040')
  if (!win) return false
  const dir = options?.dir ?? 'ltr'
  const lang = options?.lang ?? 'en'
  win.document.open()
  win.document.write(`<!doctype html>
<html dir="${dir}" lang="${lang}">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
<style>
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 40px;
    font-family: "Manrope", "Noto Kufi Arabic", -apple-system, Segoe UI, sans-serif;
    color: #1a1a1a;
    background: #fff;
    font-size: 12px;
    line-height: 1.55;
  }
  h1, h2, h3, p { margin: 0; }
  .doc-head { display: flex; justify-content: space-between; gap: 32px; padding-bottom: 20px; border-bottom: 2px solid #d6b15e; }
  .brand { font-size: 20px; font-weight: 800; letter-spacing: -0.02em; }
  .brand small { display: block; margin-top: 2px; font-size: 9px; font-weight: 600; letter-spacing: 0.18em; text-transform: uppercase; color: #8a7a50; }
  .doc-title { text-align: end; }
  .doc-title h1 { font-size: 22px; font-weight: 700; letter-spacing: -0.02em; }
  .doc-title p { margin-top: 3px; font-size: 10px; color: #666; }
  .meta { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin: 24px 0; }
  .meta-label { font-size: 8px; letter-spacing: 0.14em; text-transform: uppercase; color: #888; font-weight: 700; }
  .meta-value { margin-top: 3px; font-size: 12px; font-weight: 600; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  thead th { text-align: start; padding: 8px 10px; border-bottom: 1.5px solid #222; font-size: 8px; letter-spacing: 0.12em; text-transform: uppercase; color: #666; }
  tbody td { padding: 9px 10px; border-bottom: 1px solid #e8e8e8; font-size: 11px; }
  tbody tr:last-child td { border-bottom: none; }
  .num { text-align: end; font-variant-numeric: tabular-nums; }
  .totals { margin-top: 16px; margin-inline-start: auto; width: 280px; }
  .totals div { display: flex; justify-content: space-between; gap: 20px; padding: 5px 0; font-size: 11px; }
  .totals .grand { margin-top: 4px; padding-top: 9px; border-top: 1.5px solid #222; font-size: 14px; font-weight: 800; }
  .section-title { margin: 26px 0 7px; font-size: 10px; font-weight: 800; letter-spacing: 0.12em; text-transform: uppercase; color: #8a7a50; }
  .muted { color: #666; }
  .badge { display: inline-block; padding: 2px 8px; border: 1px solid #ddd; border-radius: 999px; font-size: 9px; font-weight: 700; text-transform: capitalize; }
  .foot { margin-top: 36px; padding-top: 14px; border-top: 1px solid #e2e2e2; font-size: 9px; color: #888; display: flex; justify-content: space-between; gap: 20px; }
  .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
  .box { padding: 12px 14px; border: 1px solid #e5e5e5; border-radius: 8px; }
  .kpi { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin: 20px 0; }
  .kpi div { padding: 12px; border: 1px solid #e5e5e5; border-radius: 8px; }
  .kpi strong { display: block; margin-top: 3px; font-size: 16px; }
  @page { size: A4; margin: 14mm; }
  @media print { body { padding: 0; } }
</style>
</head>
<body>${bodyHtml}</body>
</html>`)
  win.document.close()
  win.focus()
  window.setTimeout(() => {
    try {
      win.print()
    } catch {
      // The user may have closed the window before printing.
    }
  }, 280)
  return true
}

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
