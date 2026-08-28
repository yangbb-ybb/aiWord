import axios, { type AxiosInstance } from 'axios'

/**
 * axios 实例骨架：
 * - baseURL 指向后端 end 服务（8787），与桌面端 front 保持一致
 * - 可通过 .env 文件里的 VITE_API_BASE_URL 覆盖
 * - 当前首页占位无任何 API 调用，骨架先行
 */
export const api: AxiosInstance = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8787',
  timeout: 30_000,
  headers: {
    'Content-Type': 'application/json'
  }
})

// 后续按需加拦截器（统一鉴权、错误提示、SSE 之外的请求日志等）
// api.interceptors.request.use(...)
// api.interceptors.response.use(...)
