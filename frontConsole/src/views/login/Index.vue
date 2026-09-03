<script setup lang="ts">
/**
 * 管理员登录页。
 *
 * - 后端 /auth/login 走手机号/邮箱 + 密码
 * - role !== admin 直接拒绝(由 router 守卫兜底)
 * - 支持 ?redirect= 回跳
 */
import { reactive, ref } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import { useAuthStore } from '@/stores/auth'

const router = useRouter()
const route = useRoute()
const auth = useAuthStore()

const form = reactive({
  identifier: '',
  password: ''
})
const loading = ref(false)
const formRef = ref()

const rules = {
  identifier: [{ required: true, message: '请输入手机号或邮箱', trigger: 'blur' }],
  password: [{ required: true, message: '请输入密码', trigger: 'blur' }]
}

async function onSubmit() {
  if (!formRef.value) return
  try {
    await formRef.value.validate()
  } catch {
    return
  }
  loading.value = true
  try {
    const u = await auth.doLogin({
      identifier: form.identifier.trim(),
      password: form.password
    })
    if (u.role !== 'admin') {
      ElMessage.error('该账号不是管理员')
      auth.doLogout()
      return
    }
    const redirect = (route.query.redirect as string) || '/dashboard'
    router.push(redirect)
  } catch (e: any) {
    // 错误已经在 request.ts 弹过了,这里不再重复
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="login">
    <el-card class="login__card" shadow="always">
      <div class="login__title">aiWord 控制台</div>
      <div class="login__subtitle">仅管理员账号可登录</div>

      <el-form
        ref="formRef"
        :model="form"
        :rules="rules"
        label-position="top"
        @submit.prevent="onSubmit"
      >
        <el-form-item label="手机号 / 邮箱" prop="identifier">
          <el-input v-model="form.identifier" placeholder="请输入手机号或邮箱" size="large" />
        </el-form-item>
        <el-form-item label="密码" prop="password">
          <el-input
            v-model="form.password"
            type="password"
            placeholder="请输入密码"
            show-password
            size="large"
            @keyup.enter="onSubmit"
          />
        </el-form-item>
        <el-button
          type="primary"
          size="large"
          :loading="loading"
          style="width: 100%"
          @click="onSubmit"
        >
          登录
        </el-button>
      </el-form>
    </el-card>
  </div>
</template>

<style scoped lang="scss">
.login {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
}
.login__card {
  width: 400px;
  padding: 32px 16px;
  border-radius: 12px;
}
.login__title {
  font-size: 22px;
  font-weight: 600;
  text-align: center;
  margin-bottom: 4px;
}
.login__subtitle {
  font-size: 13px;
  color: #909399;
  text-align: center;
  margin-bottom: 24px;
}
</style>