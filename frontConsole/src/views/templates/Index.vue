<script setup lang="ts">
/**
 * 模板管理:列表 + 新增 / 编辑 / 删除(弹窗表单)。
 */
import { onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  deleteTemplate,
  listTemplates,
  upsertTemplate,
  type Template
} from '@/api/templates'

const loading = ref(false)
const items = ref<Template[]>([])

const dialogVisible = ref(false)
const dialogMode = ref<'create' | 'edit'>('create')
const editing = ref<Template | null>(null)

const form = reactive({
  id: undefined as number | undefined,
  name: '',
  emoji: '',
  description: '',
  content: '',
  sort: 0
})

async function load() {
  loading.value = true
  try {
    const resp = await listTemplates()
    items.value = resp.items
  } finally {
    loading.value = false
  }
}

function resetForm() {
  form.id = undefined
  form.name = ''
  form.emoji = ''
  form.description = ''
  form.content = ''
  form.sort = 0
  editing.value = null
}

function openCreate() {
  resetForm()
  dialogMode.value = 'create'
  dialogVisible.value = true
}

function openEdit(t: Template) {
  resetForm()
  form.id = t.id
  form.name = t.name
  form.emoji = t.emoji ?? ''
  form.description = t.description ?? ''
  form.content = t.content
  form.sort = t.sort
  editing.value = t
  dialogMode.value = 'edit'
  dialogVisible.value = true
}

async function onSubmit() {
  if (!form.name.trim() || !form.content.trim()) {
    ElMessage.warning('名称和内容不能为空')
    return
  }
  await upsertTemplate({
    id: form.id,
    name: form.name.trim(),
    emoji: form.emoji.trim() || undefined,
    description: form.description.trim() || undefined,
    content: form.content,
    sort: form.sort
  })
  ElMessage.success(dialogMode.value === 'create' ? '已创建' : '已更新')
  dialogVisible.value = false
  load()
}

async function onDelete(t: Template) {
  await ElMessageBox.confirm(`确定要删除模板「${t.name}」吗?`, '提示', {
    type: 'warning'
  })
  await deleteTemplate(t.id)
  ElMessage.success('已删除')
  load()
}

onMounted(load)
</script>

<template>
  <div class="templates" v-loading="loading">
    <el-card shadow="never">
      <template #header>
        <div class="flex justify-between items-center">
          <span>模板列表</span>
          <el-button type="primary" @click="openCreate">新增模板</el-button>
        </div>
      </template>

      <el-table :data="items" stripe>
        <el-table-column label="ID" prop="id" width="80" />
        <el-table-column label="图标" prop="emoji" width="60" />
        <el-table-column label="名称" prop="name" />
        <el-table-column label="描述" prop="description" show-overflow-tooltip />
        <el-table-column label="排序" prop="sort" width="80" />
        <el-table-column label="操作" width="160" fixed="right">
          <template #default="{ row }">
            <el-button size="small" @click="openEdit(row)">编辑</el-button>
            <el-button size="small" type="danger" @click="onDelete(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- 弹窗 -->
    <el-dialog
      v-model="dialogVisible"
      :title="dialogMode === 'create' ? '新增模板' : '编辑模板'"
      width="560px"
      destroy-on-close
    >
      <el-form :model="form" label-width="80px">
        <el-form-item label="名称" required>
          <el-input v-model="form.name" maxlength="64" />
        </el-form-item>
        <el-form-item label="图标">
          <el-input v-model="form.emoji" maxlength="8" placeholder="例如 🎨" />
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="form.description" maxlength="255" />
        </el-form-item>
        <el-form-item label="内容" required>
          <el-input v-model="form.content" type="textarea" :rows="6" />
        </el-form-item>
        <el-form-item label="排序">
          <el-input-number v-model="form.sort" :min="0" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="onSubmit">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>