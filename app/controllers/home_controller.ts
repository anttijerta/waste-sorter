import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import ClassifyService from '#services/classify_service'
import { EVAL_SUMMARY } from '#config/eval_summary'

@inject()
export default class HomeController {
  constructor(private classifyService: ClassifyService) {}

  async show({ inertia }: HttpContext) {
    return inertia.render('home', {
      demoMode: this.classifyService.demoMode,
      requestSettings: this.classifyService.requestSettings,
      evalSummary: {
        date: EVAL_SUMMARY.date,
        images: EVAL_SUMMARY.images,
        runs: EVAL_SUMMARY.runs,
        models: EVAL_SUMMARY.models.map((model) => ({ ...model })),
      },
    })
  }
}
