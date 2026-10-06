import { defineStore } from 'pinia'

// 验收与移交台账认单位：页面顶部可切换当前操作人，所有写入都带着单位与角色过归属校验。
export type Actor = {
  id: string
  name: string
  unit: string
  unitName: string
  role: string
}

export const ACTORS: Actor[] = [
  { id: 'a-builder', name: '高建成', unit: 'BUILDER', unitName: '城廊建设有限公司', role: '验收人' },
  { id: 'a-builder-pm', name: '段工', unit: 'BUILDER', unitName: '城廊建设有限公司', role: '项目经理' },
  { id: 'a-receiver', name: '管运维', unit: 'RECEIVER', unitName: '管廊运维中心', role: '运维主管' },
  { id: 'a-supervisor', name: '简理', unit: 'SUPERVISOR', unitName: '市政工程监理处', role: '监理工程师' },
]

export const useSessionStore = defineStore('session', {
  state: () => ({
    actor: ACTORS[0] as Actor,
    operator: '高建成',
    shiftLabel: '白班 08:00-20:00',
    scope: '城市地下综合管廊运行维护管理平台',
  }),
  getters: {
    canOperate: (state) => state.operator.length > 0,
  },
  actions: {
    setShift(label: string) {
      this.shiftLabel = label
    },
    setActor(actor: Actor) {
      this.actor = actor
      this.operator = actor.name
    },
  },
})
