import { defineStore } from 'pinia'
import type { Identity, UnitId } from '@/data/handover-types'

export const useSessionStore = defineStore('session', {
  state: () => ({
    operator: '值班管理员',
    shiftLabel: '白班 08:00-20:00',
    scope: '城市地下综合管廊运行维护管理平台',
    // 当前登录身份的归属单位：验收移交台账的每一笔写入都按它做归属校验。
    unit: 'CONS' as UnitId,
    person: '陈建设',
  }),
  getters: {
    canOperate: (state) => state.operator.length > 0,
    identity: (state): Identity => ({ unit: state.unit, person: state.person }),
  },
  actions: {
    setShift(label: string) {
      this.shiftLabel = label
    },
    setIdentity(unit: UnitId, person: string) {
      this.unit = unit
      this.person = person
      this.operator = person
    },
  },
})
