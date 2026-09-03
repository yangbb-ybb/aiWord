import { request } from './request'

/**
 * Dashboard 统计数据。
 */

export interface DashboardStats {
  userTotal: number
  userTodayNew: number
  documentTotal: number
  documentTodayNew: number
  templateTotal: number
  /** 近 7 天 AI 生图成功次数 */
  imageSuccess7d: number
  /** 近 7 天 AI 生图失败次数 */
  imageFail7d: number
}

export function getStats() {
  return request<DashboardStats>('GET', '/admin/stats')
}