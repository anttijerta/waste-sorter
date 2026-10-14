import type { ApplicationService } from '@adonisjs/core/types'
import ClassifyService from '#services/classify_service'
import UsageService from '#usage/usage_service'

export default class UsageProvider {
  constructor(protected app: ApplicationService) {}

  register() {
    this.app.container.singleton(UsageService, async () => {
      const { default: env } = await import('#start/env')
      const db = await this.app.container.make('lucid.db')
      return new UsageService(db, {
        perIpPerMinute: env.get('RATE_LIMIT_PER_IP_PER_MINUTE', 5),
        perIpDaily: env.get('RATE_LIMIT_PER_IP_DAILY', 20),
        monthlyCapEur: env.get('GLOBAL_MONTHLY_CAP_EUR', 5),
      })
    })
    this.app.container.singleton(ClassifyService, () => new ClassifyService())
  }

  /**
   * Builds the classify service once at startup, so a model without a
   * price stops the app instead of running without a working cost cap.
   */
  async ready() {
    await this.app.container.make(ClassifyService)
  }
}
