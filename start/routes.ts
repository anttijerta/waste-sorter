/*
|--------------------------------------------------------------------------
| Routes file
|--------------------------------------------------------------------------
|
| The routes file is used for defining the HTTP routes.
|
*/

import { controllers } from '#generated/controllers'
import router from '@adonisjs/core/services/router'

router.get('/', [controllers.Home, 'show']).as('home')

router.get('/health', () => ({ status: 'ok' })).as('health')

router.post('/api/classify', [controllers.Classify, 'store']).as('classify')
