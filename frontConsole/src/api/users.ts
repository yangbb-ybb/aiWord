import { request } from './request'

/**
 * 用户管理 API(管理员视角)。
 *
 * 后端 GET /api/admin/users 返回用户列表,支持搜索 + 分页。
 */

export interface AdminUser {
  id: number
  nickname: string
  avatar?: string
  email?: string
  phone?: string
  status: 'active' | 'banned'
  role: 'user' | 'admin'
  createdAt: string
  updatedAt: string
}

export interface ListUsersReq {
  page?: number
  pageSize?: number
  keyword?: string
  role?: 'user' | 'admin'
}

export interface ListUsersResp {
  items: AdminUser[]
  total: number
}

/** 拉取用户列表(管理员) */
export function listUsers(req: ListUsersReq = {}) {
  return request<ListUsersResp>('GET', '/admin/users', req)
}

/** 更新用户状态(禁用/启用) */
export function updateUserStatus(id: number, status: 'active' | 'banned') {
  return request('PATCH', `/admin/users/${id}/status`, { status })
}

/** 修改用户角色 */
export function updateUserRole(id: number, role: 'user' | 'admin') {
  return request('PATCH', `/admin/users/${id}/role`, { role })
}