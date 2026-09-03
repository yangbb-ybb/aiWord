<script setup lang="ts">
/**
 * 文档列表(管理员视角,看所有用户的文档)。
 */
import { onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { deleteDocument, listDocuments, type AdminDocument } from '@/api/documents'

const loading = ref(false)
const items = ref<AdminDocument[]>([])
const total = ref(0)

const query = reactive({
  page: 1,
  pageSize: 10,
  keyword: '',
  userId: undefined as number | undefined,
  includeDeleted: false
})

async function load() {
  loading.value = true
  try {
    const resp = await listDocuments({
      page: query.page,
      pageSize: query.pageSize,
      keyword: query.keyword || undefined,
      userId: query.userId,
      includeDeleted: query.includeDeleted
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

async function onDelete(d: AdminDocument) {
  await ElMessageBox.confirm(`确定要删除「${d.title}」吗?`, '提示', {
    type: 'warning'
  })
  await deleteDocument(d.id)
  ElMessage.success('已删除')
  load()
}

onMounted(load)
</script>

<template>
  <div class="docs" v-loading="loading">
    <el-card shadow="never">
      <el-form :inline="true" @submit.prevent="onSearch">
        <el-form-item label="关键词">
          <el-input
            v-model="query.keyword"
            placeholder="标题"
            clearable
            style="width: 240px"
            @keyup.enter="onSearch"
          />
        </el-form-item>
        <el-form-item label="用户 ID">
          <el-input-number
            v-model="query.userId"
            :min="0"
            placeholder="可选"
            controls-position="right"
          />
        </el-form-item>
        <el-form-item>
          <el-checkbox v-model="query.includeDeleted">包含已删除</el-checkbox>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="onSearch">查询</el-button>
        </el-form-item>
      </el-form>

      <el-table :data="items" stripe style="margin-top: 8px">
        <el-table-column label="ID" prop="id" width="80" />
        <el-table-column label="标题" prop="title" min-width="220" show-overflow-tooltip />
        <el-table-column label="用户" width="160">
          <template #default="{ row }">
            {{ row.userNickname ?? `#${row.userId}` }}
          </template>
        </el-table-column>
        <el-table-column label="平台" width="140">
          <template #default="{ row }">
            <span v-if="row.platforms">{{ row.platforms }}</span>
            <span v-else class="muted">—</span>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag v-if="row.deletedAt" type="info" size="small">已删除</el-tag>
            <el-tag v-else type="success" size="small">正常</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="更新时间" width="180">
          <template #default="{ row }">
            {{ new Date(row.updatedAt).toLocaleString('zh-CN') }}
          </template>
        </el-table-column>
        <el-table-column label="操作" width="120" fixed="right">
          <template #default="{ row }">
            <el-button
              v-if="!row.deletedAt"
              size="small"
              type="danger"
              @click="onDelete(row)"
            >
              删除
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

<style scoped>
.muted { color: #c0c4cc; }
</style>