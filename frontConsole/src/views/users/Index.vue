<script setup lang="ts">
/**
 * 用户列表(管理员视角)。
 */
import { onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  listUsers,
  updateUserStatus,
  updateUserRole,
  type AdminUser
} from '@/api/users'

const loading = ref(false)
const items = ref<AdminUser[]>([])
const total = ref(0)

const query = reactive({
  page: 1,
  pageSize: 10,
  keyword: '',
  role: '' as '' | 'user' | 'admin'
})

async function load() {
  loading.value = true
  try {
    const resp = await listUsers({
      page: query.page,
      pageSize: query.pageSize,
      keyword: query.keyword || undefined,
      role: query.role || undefined
    })
    items.value = resp.items
    total.value = resp.total
  } finally {
    loading.value = false
  }
}

function onSearch() {
  query.page = 1
  load()
}

function onPageChange(p: number) {
  query.page = p
  load()
}

async function onToggleStatus(u: AdminUser) {
  const next = u.status === 'active' ? 'banned' : 'active'
  await ElMessageBox.confirm(
    `确定要${next === 'banned' ? '禁用' : '启用'}「${u.nickname}」吗?`,
    '提示',
    { type: 'warning' }
  )
  await updateUserStatus(u.id, next)
  ElMessage.success('已更新')
  load()
}

async function onToggleRole(u: AdminUser) {
  const next = u.role === 'admin' ? 'user' : 'admin'
  await ElMessageBox.confirm(
    `确定要将「${u.nickname}」改为${next === 'admin' ? '管理员' : '普通用户'}吗?`,
    '提示',
    { type: 'warning' }
  )
  await updateUserRole(u.id, next)
  ElMessage.success('已更新')
  load()
}

onMounted(load)
</script>

<template>
  <div class="users" v-loading="loading">
    <el-card shadow="never">
      <!-- 筛选 -->
      <el-form :inline="true" @submit.prevent="onSearch">
        <el-form-item label="关键词">
          <el-input
            v-model="query.keyword"
            placeholder="昵称 / 手机 / 邮箱"
            clearable
            style="width: 220px"
            @keyup.enter="onSearch"
          />
        </el-form-item>
        <el-form-item label="角色">
          <el-select v-model="query.role" placeholder="全部" clearable style="width: 140px">
            <el-option label="管理员" value="admin" />
            <el-option label="普通用户" value="user" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="onSearch">查询</el-button>
        </el-form-item>
      </el-form>

      <!-- 表格 -->
      <el-table :data="items" stripe style="margin-top: 8px">
        <el-table-column label="ID" prop="id" width="80" />
        <el-table-column label="昵称" prop="nickname" />
        <el-table-column label="手机" prop="phone" width="140" />
        <el-table-column label="邮箱" prop="email" />
        <el-table-column label="角色" width="100">
          <template #default="{ row }">
            <el-tag :type="row.role === 'admin' ? 'danger' : 'info'" size="small">
              {{ row.role === 'admin' ? '管理员' : '普通用户' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="row.status === 'active' ? 'success' : 'warning'" size="small">
              {{ row.status === 'active' ? '正常' : '已禁用' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="注册时间" width="180">
          <template #default="{ row }">
            {{ new Date(row.createdAt).toLocaleString('zh-CN') }}
          </template>
        </el-table-column>
        <el-table-column label="操作" width="200" fixed="right">
          <template #default="{ row }">
            <el-button
              size="small"
              :type="row.status === 'active' ? 'warning' : 'success'"
              @click="onToggleStatus(row)"
            >
              {{ row.status === 'active' ? '禁用' : '启用' }}
            </el-button>
            <el-button size="small" @click="onToggleRole(row)">
              切换角色
            </el-button>
          </template>
        </el-table-column>
      </el-table>

      <el-pagination
        v-model:current-page="query.page"
        :page-size="query.pageSize"
        :total="total"
        layout="prev, pager, next, total"
        style="margin-top: 16px; justify-content: flex-end"
        @current-change="onPageChange"
      />
    </el-card>
  </div>
</template>