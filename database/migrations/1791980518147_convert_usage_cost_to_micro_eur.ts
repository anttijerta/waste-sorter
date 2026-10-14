import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Stores usage cost as integer micro-euros instead of a float in euros.
 * Existing rows are converted, rounding up so no spend is lost.
 */
export default class extends BaseSchema {
  protected tableName = 'usage_events'

  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.bigInteger('cost_micro_eur').notNullable().defaultTo(0)
    })
    this.defer(async (db) => {
      // ceil() for positive values without relying on SQLite math functions
      await db.rawQuery(
        `UPDATE ${this.tableName}
         SET cost_micro_eur = CAST(cost_eur * 1000000 AS INTEGER)
           + (cost_eur * 1000000 > CAST(cost_eur * 1000000 AS INTEGER))`
      )
    })
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('cost_eur')
    })
  }

  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.double('cost_eur').notNullable().defaultTo(0)
    })
    this.defer(async (db) => {
      await db.rawQuery(`UPDATE ${this.tableName} SET cost_eur = cost_micro_eur / 1000000.0`)
    })
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('cost_micro_eur')
    })
  }
}
