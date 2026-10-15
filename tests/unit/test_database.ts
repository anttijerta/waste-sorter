import { Logger } from '@adonisjs/core/logger'
import { Database } from '@adonisjs/lucid/database'
import CreateUsageEvents from '../../database/migrations/1791977231343_create_usage_events_table.js'
import ConvertUsageCostToMicroEur from '../../database/migrations/1791980518147_convert_usage_cost_to_micro_eur.js'
import CreateDailyStatsTables from '../../database/migrations/1792079341736_create_daily_stats_tables.js'

/**
 * A real, in-memory SQLite database with all migrations applied in order.
 * The SQLite pool holds one connection, as in production.
 */
export async function createDatabase(): Promise<Database> {
  const db = new Database(
    {
      connection: 'sqlite',
      connections: {
        sqlite: {
          client: 'better-sqlite3',
          connection: { filename: ':memory:' },
          useNullAsDefault: true,
        },
      },
    },
    new Logger({ enabled: false }),
    { emit() {}, hasListeners: () => false } as any
  )
  for (const Migration of [CreateUsageEvents, ConvertUsageCostToMicroEur, CreateDailyStatsTables]) {
    await new Migration(db.connection(), Migration.name).execUp()
  }
  return db
}
