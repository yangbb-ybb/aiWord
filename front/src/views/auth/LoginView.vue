<script setup lang="ts">
import { onUnmounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const router = useRouter()
const route = useRoute()

const tab = ref<'sms' | 'wechat'>('sms')

// ---------- 手机号+验证码 ----------
const phone = ref('')
const smsCode = ref('')
const smsLoading = ref(false)
const sending = ref(false)
const countdown = ref(0)
let timer: number | null = null

async function sendCode() {
  if (!/^1[3-9]\d{9}$/.test(phone.value)) {
    ElMessage.warning('请输入正确的手机号')
    return
  }
  sending.value = true
  try {
    await auth.sendSmsCode(phone.value, 'login')
    ElMessage.success('验证码已发送（dev: 看后端控制台）')
    countdown.value = 60
    timer = window.setInterval(() => {
      countdown.value -= 1
      if (countdown.value <= 0 && timer) {
        clearInterval(timer)
        timer = null
      }
    }, 1000)
  } catch (err) {
    ElMessage.error((err as Error).message)
  } finally {
    sending.value = false
  }
}

async function submitSms() {
  if (!/^1[3-9]\d{9}$/.test(phone.value)) {
    ElMessage.warning('请输入正确的手机号')
    return
  }
  if (!/^\d{6}$/.test(smsCode.value)) {
    ElMessage.warning('请输入 6 位验证码')
    return
  }
  smsLoading.value = true
  try {
    await auth.loginSms(phone.value, smsCode.value.trim())
    ElMessage.success(`登录成功，欢迎 ${auth.user?.nickname}`)
    goAfterLogin()
  } catch (err) {
    ElMessage.error((err as Error).message)
  } finally {
    smsLoading.value = false
  }
}

// ---------- 微信扫码（占位） ----------
const wechatLoading = ref(false)
async function mockWechatLogin() {
  wechatLoading.value = true
  ElMessage.info('微信扫码流程尚未接入前端 mock 页（占位）')
  setTimeout(() => (wechatLoading.value = false), 800)
}

// ---------- 通用 ----------
function goAfterLogin() {
  const r = route.query.redirect
  const target = typeof r === 'string' && r.startsWith('/') ? r : '/'
  router.replace(target)
}

onUnmounted(() => {
  if (timer) clearInterval(timer)
})
</script>

<template>
  <div class="login-page">
    <div class="login-card">
      <header class="login-header">
        <div class="login-logo">
          <span class="logo-mark">Ai</span>
          <span class="logo-text">aiWord</span>
        </div>
        <!-- <h1 class="login-title">登录 aiWord</h1> -->
        <p class="login-sub">一句话主题 → 一键成稿 + 多平台分发</p>
      </header>

      <!-- <nav class="login-tabs">
        <button
          v-for="t in [
            { key: 'sms', label: '手机验证码' },
            // { key: 'wechat', label: '微信扫码' }
          ]"
          :key="t.key"
          class="login-tab"
          :class="{ 'is--active': tab === t.key }"
          @click="tab = t.key as 'sms' | 'wechat'"
        >
          {{ t.label }}
        </button>
      </nav> -->

      <!-- 手机验证码 -->
      <form v-if="tab === 'sms'" class="login-form" @submit.prevent="submitSms">
        <label class="field">
          <span class="field__label">手机号</span>
          <input
            v-model="phone"
            class="field__input"
            type="tel"
            inputmode="numeric"
            maxlength="11"
            placeholder="11 位手机号"
          />
        </label>
        <label class="field">
          <span class="field__label">验证码</span>
          <div class="field__row">
            <input
              v-model="smsCode"
              class="field__input"
              type="text"
              inputmode="numeric"
              maxlength="6"
              placeholder="6 位数字"
            />
            <button
              class="ghost-btn"
              type="button"
              :disabled="countdown > 0 || sending"
              @click="sendCode"
            >
              {{ countdown > 0 ? `${countdown}s` : sending ? '发送中…' : '获取验证码' }}
            </button>
          </div>
        </label>
        <button class="primary-btn" type="submit" :disabled="smsLoading">
          {{ smsLoading ? '登录中…' : '登录 / 注册' }}
        </button>
        <p class="hint">dev 阶段短信直接打印到控制台，不接网关</p>
      </form>

      <!-- 微信扫码 -->
      <div v-else class="login-wechat">
        <div class="qrcode-placeholder">
          <span>📱</span>
          <p>扫码登录</p>
        </div>
        <p class="hint wechat-hint">
          微信扫码流程的 <code>/wechat-mock</code> 确认页暂未接入，<br />后端接口已就绪
          （<code>POST /api/auth/wechat/qrcode</code>）。
        </p>
        <button
          class="primary-btn"
          type="button"
          :disabled="wechatLoading"
          @click="mockWechatLogin"
        >
          {{ wechatLoading ? '占位中…' : '微信扫码登录（占位）' }}
        </button>
      </div>

      <footer class="login-footer">
        <span>登录即表示同意</span>
        <a href="#">服务条款</a>
        <span>·</span>
        <a href="#">隐私政策</a>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.login-page {
  min-height: 100vh;
  display: grid;
  place-items: center;
  background: linear-gradient(135deg, #eef2ff 0%, #f5f3ff 50%, #fdf4ff 100%);
  padding: var(--space-5);
}
.login-card {
  width: 100%;
  max-width: 420px;
  background: var(--bg-card);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-lg);
  padding: var(--space-8) var(--space-8) var(--space-6);
}
.login-header {
  text-align: center;
  margin-bottom: var(--space-6);
}
.login-logo {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  margin-bottom: var(--space-4);
}
.logo-mark {
  width: 32px;
  height: 32px;
  border-radius: var(--radius-md);
  background: linear-gradient(135deg, var(--color-accent-from), var(--color-accent-to));
  color: #fff;
  display: grid;
  place-items: center;
  font-weight: 700;
  font-size: 13px;
}
.logo-text {
  font-size: 18px;
  font-weight: 700;
  color: var(--text-primary);
}
.login-title {
  margin: 0 0 4px;
  font-size: 20px;
  font-weight: 700;
  color: var(--text-primary);
}
.login-sub {
  margin: 0;
  font-size: var(--fs-sm);
  color: var(--text-secondary);
}

.login-tabs {
  display: flex;
  gap: 4px;
  background: var(--bg-muted);
  padding: 4px;
  border-radius: var(--radius-md);
  margin-bottom: var(--space-5);
}
.login-tab {
  flex: 1;
  height: 32px;
  border: none;
  background: transparent;
  border-radius: var(--radius-sm);
  font-size: var(--fs-sm);
  color: var(--text-secondary);
  transition: all 0.15s ease;
}
.login-tab.is--active {
  background: var(--bg-card);
  color: var(--color-brand);
  font-weight: 600;
  box-shadow: var(--shadow-sm);
}

.login-form,
.login-wechat {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}
.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.field__label {
  font-size: var(--fs-xs);
  font-weight: 600;
  color: var(--text-secondary);
}
.field__input {
  height: 40px;
  padding: 0 12px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  font-size: var(--fs-base);
  outline: none;
  background: var(--bg-card);
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
.field__input:focus {
  border-color: var(--color-brand);
  box-shadow: 0 0 0 3px rgba(79, 70, 229, 0.12);
}
.field__row {
  display: flex;
  gap: var(--space-2);
}
.field__row .field__input {
  flex: 1;
}

.primary-btn {
  height: 42px;
  border: none;
  border-radius: var(--radius-md);
  background: linear-gradient(135deg, var(--color-accent-from), var(--color-accent-to));
  color: #fff;
  font-weight: 600;
  font-size: var(--fs-base);
  box-shadow: 0 6px 18px rgba(99, 102, 241, 0.32);
  transition: transform 0.15s ease, box-shadow 0.15s ease, opacity 0.15s ease;
}
.primary-btn:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 8px 22px rgba(99, 102, 241, 0.42);
}
.primary-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.ghost-btn {
  height: 40px;
  padding: 0 14px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  background: var(--bg-card);
  color: var(--text-primary);
  font-size: var(--fs-sm);
  white-space: nowrap;
  transition: border-color 0.15s ease, color 0.15s ease;
}
.ghost-btn:hover:not(:disabled) {
  border-color: var(--color-brand);
  color: var(--color-brand);
}
.ghost-btn:disabled {
  color: var(--text-muted);
  cursor: not-allowed;
}

.hint {
  margin: 0;
  font-size: var(--fs-xs);
  color: var(--text-muted);
  text-align: center;
}
.hint code {
  background: var(--bg-muted);
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 11px;
}

.login-wechat {
  align-items: center;
}
.qrcode-placeholder {
  width: 180px;
  height: 180px;
  display: grid;
  place-items: center;
  background: var(--bg-muted);
  border: 1px dashed var(--border-color);
  border-radius: var(--radius-lg);
  color: var(--text-muted);
}
.qrcode-placeholder span {
  font-size: 48px;
}
.qrcode-placeholder p {
  margin: 4px 0 0;
  font-size: var(--fs-xs);
}
.wechat-hint {
  text-align: center;
  line-height: 1.6;
}

.login-footer {
  margin-top: var(--space-5);
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 6px;
  font-size: var(--fs-xs);
  color: var(--text-muted);
}
.login-footer a {
  color: var(--color-brand);
}
</style>