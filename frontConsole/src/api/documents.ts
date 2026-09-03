import { request } from './request'

/**
 * 文档管理 API(管理员视角,能看所有用户的文档)。
 */

export interface AdminDocument {
  id: number
  userId: number
  userNickname?: string
  title: string
  excerpt?: string
  platforms?: string
  createdAt: string
  updatedAt: string
  deletedAt?: string
}

export interface ListDocumentsReq {
  page?: number
  pageSize?: number
  keyword?: string
  userId?: number
  includeDeleted?: boolean
}

export interface ListDocumentsResp {
  items: AdminDocument[]
  total: number
}

export function listDocuments(req: ListDocumentsReq = {}) {
  return request<ListDocumentsResp>('GET', '/admin/documents', req)
}

export function deleteDocument(id: number) {
  return request('DELETE', `/admin/documents/${id}`)
}