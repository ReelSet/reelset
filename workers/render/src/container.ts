import { Container } from '@cloudflare/containers'
import { containerEnvVars } from './container-env'
import type { Env } from './env'

export class ReelContainer extends Container<Env> {
  defaultPort = 8080
  sleepAfter = '5m'

  constructor(ctx: ConstructorParameters<typeof Container<Env>>[0], env: Env) {
    super(ctx, env)
    this.envVars = containerEnvVars(env)
  }
}
