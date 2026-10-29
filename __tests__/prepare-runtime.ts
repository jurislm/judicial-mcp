import { execFileSync } from 'node:child_process'
import type { TestProject } from 'vitest/node'

export default function setup(project: TestProject): void {
  const build = () => {
    execFileSync('bun', ['run', 'build:runtime'], { cwd: project.config.root, stdio: 'pipe' })
  }
  build()
  project.onTestsRerun(build)
}
