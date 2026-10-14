import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import ClassifyService from '#services/classify_service'

@inject()
export default class HomeController {
  constructor(private classifyService: ClassifyService) {}

  async show({ inertia }: HttpContext) {
    return inertia.render('home', { demoMode: this.classifyService.demoMode })
  }
}
