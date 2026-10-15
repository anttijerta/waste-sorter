import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Permanent daily statistics with no visitor data: no IP hashes, no
 * images, nothing per request. Unlike usage_events, these rows are never
 * deleted.
 */
export default class extends BaseSchema {
  async up() {
    this.schema.createTable('daily_stats', (table) => {
      // UTC YYYY-MM-DD
      table.string('day', 10).primary()
      table.integer('images').notNullable().defaultTo(0)
      table.integer('agreements').notNullable().defaultTo(0)
      // Failed model calls (a request that failed as a whole counts once)
      table.integer('errors').notNullable().defaultTo(0)
      table.integer('rejected_per_minute').notNullable().defaultTo(0)
      table.integer('rejected_daily').notNullable().defaultTo(0)
      table.integer('rejected_monthly_cap').notNullable().defaultTo(0)
      table.bigInteger('cost_micro_eur').notNullable().defaultTo(0)
    })

    this.schema.createTable('daily_category_counts', (table) => {
      table.string('day', 10).notNullable()
      table.string('model_id', 100).notNullable()
      table.string('category', 20).notNullable()
      table.integer('count').notNullable().defaultTo(0)
      table.primary(['day', 'model_id', 'category'])
    })
  }

  async down() {
    this.schema.dropTable('daily_category_counts')
    this.schema.dropTable('daily_stats')
  }
}
