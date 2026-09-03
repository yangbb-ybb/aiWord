import { request } from './request'

/**
 * 登录 / 鉴权 API。
 */

export interface LoginReq {
  identifier: string // 手机号 / 邮箱(账号登录)
  password: string
}

export interface LoginResp {
  accessToken: string
  refreshToken?: string
  user: {
    id: number
    nickname: string
    role: 'user' | 'admin'
    avatar?: string
  }
}

/** 管理员登录(账号 + 密码) */
export function login(req: LoginReq) {
  return request<LoginResp>('POST', '/auth/login', req)
}

/** 拉当前用户信息(用 token 换) */
export function getMe() {
  return request<LoginResp['user']>('GET', '/users/me')
}

/** 登出 */
export function logout() {
  return request('POST', '/auth/logout')
}