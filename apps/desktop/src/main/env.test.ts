import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { getDefaultDesktopEnvPaths, loadDesktopEnvironment, parseDotEnvContent } from './setup/env'

describe('desktop env loader', () => {
  test('parses dotenv content with quotes and comments', () => {
    expect(
      parseDotEnvContent([
        '# comment',
        'NORDRI_AI_API_KEY=abc123',
        'NORDRI_AI_MODEL="gpt-5.6-luna"',
        "export NORDRI_AI_BASE_URL='https://api.openai.com/v1'"
      ].join('\n'))
    ).toEqual({
      NORDRI_AI_API_KEY: 'abc123',
      NORDRI_AI_MODEL: 'gpt-5.6-luna',
      NORDRI_AI_BASE_URL: 'https://api.openai.com/v1'
    })
  })

  test('loads values without overriding existing environment', () => {
    const env: NodeJS.ProcessEnv = {
      NORDRI_AI_MODEL: 'existing-model'
    }

    loadDesktopEnvironment(env, ['virtual-a.env', 'virtual-b.env'].map((entry) => path.join('Z:/', entry)))

    expect(env.NORDRI_AI_MODEL).toBe('existing-model')
  })

  test('lists root and desktop env file locations', () => {
    const paths = getDefaultDesktopEnvPaths()

    expect(paths.some((entry) => entry.endsWith(path.join('.env')))).toBe(true)
    expect(paths.some((entry) => entry.endsWith(path.join('.env.local')))).toBe(true)
  })
})
