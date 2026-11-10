// The plugin's one hooks module: Claude Code loads a single module per plugin, so it registers each part's hooks.
import type { Register } from 'claude-code'

import { register as rotation } from './rotation/register'
import { register as tier } from './tier/register'

export const register: Register = (on, options) => {
  tier(on, options)
  rotation(on, options)
}
