import { Request, Response, NextFunction } from 'express'
import {
  generateReport,
  REPORT_DIMENSIONS,
  ReportDimension,
  resolveDateWindow,
} from '../services/report.service'
import { clampPageSize } from '../utils/pagination'

function toCsv(rows: Array<Record<string, any>>): string {
  if (!rows.length) return ''
  const headers = [...new Set(rows.flatMap((r) => Object.keys(r)))]
  const escape = (v: unknown): string => {
    const s = v === null || v === undefined ? '' : String(v)
    // Neutralise spreadsheet formula injection (CSV injection). Excel, Sheets
    // and LibreOffice execute a cell that begins with = + - @ (or a leading
    // tab/CR) as a formula, so user-influenced values such as a guest customer
    // name or an admin-entered product name could run on an operator's machine.
    // A leading apostrophe forces the cell to be treated as text.
    const guarded = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s
    return /[",\n]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded
  }
  const lines = [headers.join(',')]
  for (const row of rows) {
    lines.push(headers.map((h) => escape(row[h])).join(','))
  }
  return lines.join('\n')
}

export class ReportController {
  /**
   * GET /api/v1/admin/reports/:dimension
   *
   * Date-windowed reporting surface. Query parameters:
   *   range=today|week|month|all     preset window (default all = all-time)
   *   from=<ISO|YYYY-MM-DD>          custom window start (inclusive)
   *   to=<ISO|YYYY-MM-DD>            custom window end (inclusive, end-of-day)
   *   limit=<n>                      row cap for top-N reports (default 10, max 100)
   *   format=json|csv                response format (default json)
   */
  public static async getReport(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const dimension = String(req.params.dimension || '')

      if (!REPORT_DIMENSIONS.includes(dimension as ReportDimension)) {
        res.status(400).json({
          error: `Unknown report dimension. Valid dimensions: ${REPORT_DIMENSIONS.join(', ')}`,
        })
        return
      }

      const format = req.query.format ? String(req.query.format) : 'json'
      if (format !== 'json' && format !== 'csv') {
        res.status(400).json({ error: "Invalid `format`. Use 'json' or 'csv'." })
        return
      }

      const window = resolveDateWindow(req.query as Record<string, unknown>)
      const limit = clampPageSize(req.query.limit, 10)
      const result = await generateReport({
        dimension: dimension as ReportDimension,
        window,
        limit,
      })

      if (format === 'csv') {
        const csv = toCsv(result.rows)
        res.setHeader('Content-Type', 'text/csv; charset=utf-8')
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="${dimension}-report.csv"`
        )
        res.status(200).send(csv)
        return
      }

      res.status(200).json({
        success: true,
        dimension,
        range: {
          from: window.from ? window.from.toISOString() : null,
          to: window.to ? window.to.toISOString() : null,
        },
        summary: result.summary,
        rows: result.rows,
      })
    } catch (error) {
      next(error)
    }
  }
}