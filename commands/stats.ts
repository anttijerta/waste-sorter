import { BaseCommand, flags } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import { CATEGORY_IDS } from '#config/categories'
import { formatDailyStats, readDailyStats } from '#usage/daily_stats'

export default class Stats extends BaseCommand {
  static commandName = 'stats'
  static description =
    'Print daily usage statistics: images, agreements, errors, rejections, cost and categories per model'

  static options: CommandOptions = { startApp: true }

  @flags.number({ description: 'Number of most recent days to show', default: 30 })
  declare days: number

  async run() {
    if (!Number.isInteger(this.days) || this.days < 1) {
      this.logger.error('--days must be a whole number of at least 1')
      this.exitCode = 1
      return
    }

    const db = await this.app.container.make('lucid.db')
    const rows = await readDailyStats(db, this.days)
    if (rows.length === 0) {
      this.logger.info('No statistics yet.')
      return
    }

    const { summary, categories } = formatDailyStats(rows, CATEGORY_IDS)
    const print = ([head, ...body]: string[][]) => {
      const table = this.ui.table().head(head)
      for (const row of body) table.row(row)
      table.render()
    }
    print(summary)
    this.logger.log('')
    this.logger.log('Answers per category and model:')
    print(categories)
  }
}
