import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import ClassifyService from '#services/classify_service'
import { PROMPT_VERSION } from '#classifier/prompt'
import { EVAL_SUMMARY, type EvalSetSummary } from '#config/eval_summary'

/** Plain copy of the readonly config, as page props */
function evalSetProps(set: EvalSetSummary) {
  return {
    date: set.date,
    images: set.images,
    runs: set.runs,
    models: set.models.map((model) => ({ ...model })),
  }
}

@inject()
export default class HomeController {
  constructor(private classifyService: ClassifyService) {}

  async show({ inertia }: HttpContext) {
    return inertia.render('home', {
      demoMode: this.classifyService.demoMode,
      requestSettings: this.classifyService.requestSettings,
      promptVersion: PROMPT_VERSION,
      evalSummary: {
        testSet: evalSetProps(EVAL_SUMMARY.testSet),
        holdout: evalSetProps(EVAL_SUMMARY.holdout),
      },
    })
  }
}
