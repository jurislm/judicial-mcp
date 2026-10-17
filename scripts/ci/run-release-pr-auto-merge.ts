// JUR-766：Woodpecker 進入點（邊界）。只在 Woodpecker 內讀 CI_COMMIT_SHA，其餘邏輯在 release-pr-auto-merge.ts。
import { runReleasePrAutoMerge } from './release-pr-auto-merge'

const isWoodpecker = process.env.CI_SYSTEM_NAME === 'woodpecker'

runReleasePrAutoMerge({
  token: process.env.GITHUB_API_TOKEN ?? '',
  expectedBaseSha: isWoodpecker ? process.env.CI_COMMIT_SHA : undefined,
}).catch((error: unknown) => {
  console.error(`release PR auto-merge failed: ${error instanceof Error ? error.message : 'unknown error'}`)
  process.exit(1)
})
