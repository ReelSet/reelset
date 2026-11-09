import { describe, expect, it } from 'vitest'
import { containerEnvVars } from './container-env'

describe('containerEnvVars', () => {
  it('passes PROXY_URLS through when set', () => {
    expect(containerEnvVars({ PROXY_URLS: ' http://u:p@h:1 ' })).toEqual({
      PROXY_URLS: 'http://u:p@h:1',
    })
  })

  it('is empty without PROXY_URLS so the container runs direct', () => {
    expect(containerEnvVars({})).toEqual({})
    expect(containerEnvVars({ PROXY_URLS: '  ' })).toEqual({})
  })
})
