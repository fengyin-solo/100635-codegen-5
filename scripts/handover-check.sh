#!/bin/sh
# 投运前验收与移交：规则自检（不依赖 esbuild，用项目自带 tsc 编译后在 node 跑）
# 用法：sh scripts/handover-check.sh
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
WORK=/tmp/hctest
rm -rf "$WORK"
mkdir -p "$WORK/src/api" "$WORK/src/data"
cp "$ROOT/frontend/src/data/handover-types.ts" "$ROOT/frontend/src/data/handover-seed.ts" "$ROOT/frontend/src/data/types.ts" "$WORK/src/data/"
sed -e "s|@/data/modules|../data/modules|" \
    -e "s|@/data/local-store|../data/local-store|" \
    -e "s|@/data/handover-types|../data/handover-types|" \
    -e "s|@/data/handover-seed|../data/handover-seed|" \
    "$ROOT/frontend/src/api/handover-service.ts" > "$WORK/src/api/handover-service.ts"
cp "$ROOT/frontend/src/data/local-store.ts" "$WORK/src/data/"
cat > "$WORK/src/data/seed.ts" <<'EOF'
import type { EntryRow } from './types'
export const SEED_ROWS: Record<string, EntryRow[]> = {}
EOF
cp "$ROOT/frontend/handover-check.ts" "$WORK/src/check.ts"
cd "$WORK"
# 测试文件从 frontend/ 搬到 src/ 后，相对引用去掉一层
sed -i -e "s|'./src/api/handover-service'|'./api/handover-service'|" \
       -e "s|'./src/data/handover-types.ts'|'./data/handover-types'|" \
       -e "s|'./src/data/handover-types'|'./data/handover-types'|" \
       -e "s|'./src/data/local-store'|'./data/local-store'|" src/check.ts
cat > tsconfig.json <<EOF
{
  "compilerOptions": {
    "target": "ES2020", "module": "commonjs", "moduleResolution": "node",
    "strict": true, "esModuleInterop": true, "skipLibCheck": true,
    "typeRoots": ["$ROOT/frontend/node_modules/@types"],
    "outDir": "dist", "rootDir": "src"
  },
  "include": ["src/**/*.ts"]
}
EOF
node "$ROOT/frontend/node_modules/typescript/bin/tsc" -p tsconfig.json
node dist/check.js
