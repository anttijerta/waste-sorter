import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * One row per accepted classification request. Holds no IP address, only
 * a daily-salted HMAC of it (see app/usage/ip_hash.ts). Rows older than
 * 35 days are deleted.
 */
export default class extends BaseSchema {
  protected tableName = 'usage_events'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table.string('ip_hash', 64).notNullable()
      // Milliseconds since epoch (UTC)
      table.bigInteger('created_at_ms').notNullable()
      // UTC YYYY-MM and YYYY-MM-DD, so limits group by calendar period
      table.string('day', 10).notNullable()
      table.string('month', 7).notNullable()
      // Reserved estimate until the call finishes, then the settled cost
      table.double('cost_eur').notNullable()

      table.index(['ip_hash', 'created_at_ms'])
      table.index(['month'])
      table.index(['created_at_ms'])
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
