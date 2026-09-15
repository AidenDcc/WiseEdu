<script setup lang="ts">
import { reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { AppIcon, showToast } from '@aiteach/shared'
import { useAuthStore } from '@/stores/auth'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()

const DEMO = { account: 'admin', password: 'admin123' }

/** 平台演示总入口地址（可经 VITE_PORTAL_URL 覆盖） */
const portalUrl = import.meta.env.VITE_PORTAL_URL ?? 'http://localhost:5172'

const form = reactive({ account: '', password: '', remember: true })
const errors = reactive({ account: '', password: '' })
const showPassword = ref(false)
const loading = ref(false)
const failCount = ref(0)
const loginError = ref('')

function fillDemo() {
  form.account = DEMO.account
  form.password = DEMO.password
  loginError.value = ''
}

function validate(): boolean {
  errors.account = form.account.trim() ? '' : '请输入账号'
  errors.password = form.password ? '' : '请输入密码'
  return !errors.account && !errors.password
}

async function onSubmit() {
  loginError.value = ''
  if (!validate()) return
  loading.value = true
  try {
    await auth.login({ account: form.account.trim(), password: form.password })
    showToast('登录成功，欢迎回来', 'success')
    router.push((route.query.redirect as string) || '/')
  } catch (error) {
    failCount.value += 1
    loginError.value = (error as Error).message || '登录失败，请稍后重试'
  } finally {
    loading.value = false
  }
}

function onPending(name: string) {
  showToast(`「${name}」功能正在开发中`, 'info')
}
</script>

<template>
  <div class="login-page">
    <!-- 品牌区 -->
    <aside class="brand-pane">
      <div class="brand-row">
        <div class="brand-logo">☁️</div>
        <span class="brand-name">AI教学云平台</span>
      </div>
      <div class="hero">
        <h1>超级管理端</h1>
        <p class="slogan">SaaS 多租户 · 平台配置与全局运营管控</p>
        <ul class="features">
          <li><AppIcon name="building" :size="16" /> 租户入驻审核、套餐配额与数据隔离管理</li>
          <li><AppIcon name="book" :size="16" /> 学科 / 学段 / 知识点树等全局基础字典</li>
          <li><AppIcon name="cpu" :size="16" /> AI 模型接入与多智能体编排配置</li>
          <li><AppIcon name="shield" :size="16" /> AI 调用审计与全平台只读监管</li>
        </ul>
        <div class="hero-foot">
          <AppIcon name="shield" :size="13" />
          平台端零业务操作权限，仅配置与只读审计（BR-001）
        </div>
      </div>
    </aside>

    <!-- 表单区 -->
    <main class="form-pane">
      <div class="form-card">
        <div class="tabs">
          <button class="tab active">账号密码登录</button>
          <button class="tab" @click="onPending('手机验证码登录')">手机验证码登录</button>
          <i class="tab-ink" />
        </div>

        <form @submit.prevent="onSubmit">
          <label class="field">
            <span class="field-label">账号</span>
            <div class="field-box" :class="{ error: errors.account }">
              <AppIcon name="users" :size="17" class="field-icon" />
              <input
                v-model="form.account"
                type="text"
                placeholder="账号名 / 手机号 / 邮箱"
                autocomplete="username"
              />
            </div>
            <span v-if="errors.account" class="field-error">{{ errors.account }}</span>
          </label>

          <label class="field">
            <span class="field-label">密码</span>
            <div class="field-box" :class="{ error: errors.password }">
              <AppIcon name="shield" :size="17" class="field-icon" />
              <input
                v-model="form.password"
                :type="showPassword ? 'text' : 'password'"
                placeholder="请输入密码"
                autocomplete="current-password"
              />
              <button type="button" class="eye" @click="showPassword = !showPassword">
                {{ showPassword ? '隐藏' : '显示' }}
              </button>
            </div>
            <span v-if="errors.password" class="field-error">{{ errors.password }}</span>
          </label>

          <div class="form-row">
            <label class="remember">
              <input v-model="form.remember" type="checkbox" />
              <span>记住我（7 天免登录）</span>
            </label>
            <a class="forgot" @click="onPending('找回密码')">忘记密码？</a>
          </div>

          <p v-if="loginError" class="login-error">
            <AppIcon name="warning" :size="15" />
            {{ loginError }}
            <template v-if="failCount >= 3">（连续错误 5 次将锁定账号 15 分钟）</template>
          </p>

          <button class="btn btn-primary submit" :disabled="loading">
            <AppIcon v-if="loading" name="clock" :size="16" class="spin" />
            {{ loading ? '登录中…' : '登 录' }}
          </button>
        </form>

        <div class="demo-tip">
          <span>演示账号：{{ DEMO.account }} / {{ DEMO.password }}</span>
          <button type="button" class="fill" @click="fillDemo">一键填充</button>
        </div>

        <p class="back-home">
          <a :href="portalUrl">← 返回平台演示入口</a>
        </p>
      </div>
    </main>
  </div>
</template>

<style scoped>
.login-page {
  display: flex;
  min-height: 100vh;
  background: #fff;
}

/* ---- 品牌区 ---- */
.brand-pane {
  flex: 1.1;
  background:
    radial-gradient(900px 500px at -10% -10%, rgba(255, 255, 255, 0.14), transparent 50%),
    radial-gradient(700px 420px at 110% 110%, rgba(0, 224, 255, 0.18), transparent 55%),
    linear-gradient(150deg, #3b5bf0 0%, #4f6ef7 45%, #7b5cf0 100%);
  color: #fff;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: 44px 52px;
}
.brand-row { display: flex; align-items: center; gap: 12px; }
.brand-logo {
  width: 42px; height: 42px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.16);
  backdrop-filter: blur(6px);
  display: flex; align-items: center; justify-content: center;
  font-size: 22px;
}
.brand-name { font-size: 17px; font-weight: 700; letter-spacing: 1px; }

.hero h1 { font-size: 34px; letter-spacing: 2px; }
.slogan { font-size: 14.5px; opacity: 0.88; margin: 10px 0 30px; }
.features li {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13.5px;
  padding: 9px 14px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.14);
  margin-bottom: 10px;
  backdrop-filter: blur(4px);
}
.hero-foot {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 12px;
  opacity: 0.75;
  margin-top: 34px;
}

/* ---- 表单区 ---- */
.form-pane {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 40px 24px;
  background: linear-gradient(180deg, #fbfcfe, #f5f7fb);
}
.form-card { width: 100%; max-width: 380px; }

.tabs {
  display: flex;
  gap: 26px;
  border-bottom: 1px solid var(--border);
  margin-bottom: 28px;
}
.tab {
  background: none;
  border: none;
  font-size: 15px;
  color: var(--sub);
  padding: 10px 2px 14px;
  position: relative;
  transition: color 0.2s;
}
.tab:hover { color: var(--ink-2); }
.tab.active { color: var(--brand); font-weight: 700; }
.tab.active::after {
  content: '';
  position: absolute;
  left: 0; right: 0; bottom: -1px;
  height: 3px;
  border-radius: 3px 3px 0 0;
  background: var(--brand-grad);
}

.field { display: block; margin-bottom: 18px; }
.field-label { display: block; font-size: 13px; color: var(--ink-2); margin-bottom: 7px; font-weight: 500; }
.field-box {
  display: flex;
  align-items: center;
  gap: 10px;
  border: 1.5px solid var(--border);
  border-radius: 11px;
  padding: 0 14px;
  height: 46px;
  background: #fff;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.field-box:focus-within {
  border-color: var(--brand);
  box-shadow: 0 0 0 4px var(--brand-soft);
}
.field-box.error { border-color: var(--danger); }
.field-box input {
  flex: 1;
  border: none;
  outline: none;
  font-size: 14px;
  color: var(--ink);
  background: transparent;
}
.field-icon { color: var(--sub); flex-shrink: 0; }
.eye {
  border: none;
  background: none;
  color: var(--sub);
  font-size: 12px;
  padding: 2px 4px;
}
.eye:hover { color: var(--brand); }
.field-error { display: block; font-size: 12px; color: var(--danger); margin-top: 5px; }

.form-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin: 4px 0 20px;
  font-size: 13px;
}
.remember { display: flex; align-items: center; gap: 7px; color: var(--ink-2); cursor: pointer; }
.remember input { accent-color: var(--brand); }
.forgot { color: var(--brand); cursor: pointer; }

.login-error {
  display: flex;
  align-items: center;
  gap: 6px;
  background: var(--danger-soft);
  color: var(--danger);
  font-size: 12.5px;
  border-radius: 9px;
  padding: 9px 12px;
  margin-bottom: 14px;
}

.submit { width: 100%; height: 46px; font-size: 15.5px; letter-spacing: 6px; }
.spin { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

.demo-tip {
  margin-top: 22px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: var(--brand-soft);
  border: 1px dashed rgba(79, 110, 247, 0.35);
  color: var(--ink-2);
  border-radius: 10px;
  padding: 10px 14px;
  font-size: 12.5px;
}
.fill {
  border: none;
  background: none;
  color: var(--brand);
  font-weight: 700;
  font-size: 12.5px;
}
.fill:hover { text-decoration: underline; }

.back-home {
  text-align: center;
  margin-top: 26px;
  font-size: 12.5px;
}
.back-home a { color: var(--sub); }
.back-home a:hover { color: var(--brand); }

@media (max-width: 860px) {
  .brand-pane { display: none; }
}
</style>
