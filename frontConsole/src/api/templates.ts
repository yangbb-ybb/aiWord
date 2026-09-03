import { request } from './request'

/**
 * 模板管理 API。
 */

export interface Template {
  id: number
  name: string
  emoji?: string
  description?: string
  content: string
  sort: number
}

export interface UpsertTemplateReq {
  id?: number
  name: string
  emoji?: string
  description?: string
  content: string
  sort?: number
}

export function listTemplates() {
  return request<{ items: Template[] }>('GET', '/admin/templates')
}

export function upsertTemplate(req: UpsertTemplateReq) {
  return request<Template>('POST', '/admin/templates', req)
}

export function deleteTemplate(id: number) {
  return request('DELETE', `/admin/templates/${id}`)
}