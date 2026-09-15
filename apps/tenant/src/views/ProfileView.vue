<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { AppIcon, hueColor, showToast } from '@aiteach/shared'
import AppSwitch from '@/components/ui/AppSwitch.vue'
import { useAuthStore } from '@/stores/auth'
import { fetchOrgLoginLogs } from '@/api/org'

const router = useRouter()
const auth = useAuthStore()

type TabKey = 'profile' | 'security' | 'notify' | 'logs'
const TABS: Array<{ key: TabKey; label: string }> = [
  { key: 'profile', label: '个人资料' },
  { key: 'security', label: '账号安全' },
  { key: 'notify', label: '消息偏好' },
  { key: 'logs', label: '登录记录' },
]
const tab = ref<TabKey>('profile')

/* ===== 个人资料（FR-GN-021） ===== */
const profile = reactive({
  name: auth.user?.name ?? '',
  phone: '139****0001',
  email: 'mingyuan@xingchen.edu.cn',
  intro: '机构管理员，分管教研与题库建设。',
})
const editingProfile = ref(false)

function saveProfile() {
  if (profile.name.trim().length < 2) {
    showToast('姓名至少 2 个字', 'error')
    return
  }
  editingProfile.value = false
  showToast('资料已保存', 'success')
}

/* ===== 账号安全（FR-GN-022） ===== */
const pwd = reactive({ old: '', first: '', second: '' })
const pwdErrors = reactive<Record<string, string>>({})

function submitPwd() {
  Object.keys(pwdErrors).forEach((key) => delete pwdErrors[key])
  if (!pwd.old) pwdErrors.old = '请输入当前密码'
  if (pwd.first.length < 8) pwdErrors.first = '新密码至少 8 位，须含字母与数字'
  else if (!/[a-zA-Z]/.test(pwd.first) || !/\d/.test(pwd.first)) pwdErrors.first = '密码须同时包含字母与数字'
  if (pwd.second !== pwd.first) pwdErrors.second = '两次输入不一致'
  if (Object.keys(pwdErrors).length) return
  pwd.old = ''
  pwd.first = ''
  pwd.second = ''
  showToast('密码已修改，下次登录生效', 'success')
}

/* ===== 消息偏好（FR-GN-023） ===== */
const notify = reactive({ inApp: true, sms: true, email: false, digest: true })

function saveNotify() {
  showToast('消息偏好已保存', 'success')
}

/* ===== 登录记录（FR-GN-025） ===== */
const logs = ref<Array<{ id: number; account: string; ip: string; device: string; ok: boolean; time: string }>>([])

onMounted(async () => {
  logs.value = (await fetchOrgLoginLogs()).slice(0, 8)
})

async function onLogout() {
  if (!window.confirm('确定退出登录？')) return
  await auth.logout()
  showToast('已退出登录', 'success')
  router.push('/login')
}
</script>

<template>
  <div class="page profile-page">
    <div class="page-head">
      <h2>个人中心</h2>
      <span class="f-hint">{{ auth.user?.orgName }} · {{ auth.user?.roleName }}</span>
    </div>

    <div class="panel profile-panel">
      <!-- 用户卡片头 -->
      <div class="profile-head">
        <span class="avatar" :style="{ background: hueColor(auth.user?.avatarHue ?? 172) }">
          {{ (auth.user?.name ?? '师').charAt(0) }}
        </span>
        <div class="head-meta">
          <h3>{{ auth.user?.name }}</h3>
          <p class="f-hint">{{ auth.user?.account }} · {{ auth.user?.roleName }} · {{ auth.user?.orgName }}</p>
        </div>
        <button class="btn btn-ghost btn-sm" style="margin-left: auto" @click="onLogout">
          <AppIcon name="logout" :size="14" /> 退出登录
        </button>
      </div>

      <div class="tab-bar">
        <button
          v-for="t in TABS"
          :key="t.key"
          class="tab-btn"
          :class="{ on: tab === t.key }"
          type="button"
          @click="tab = t.key"
        >
          {{ t.label }}
        </button>
      </div>

      <!-- 个人资料 -->
      <div v-if="tab === 'profile'" class="tab-body">
        <div class="detail-grid">
          <div class="detail-item">
            <span class="d-label">姓名</span>
            <span class="d-value">
              <template v-if="editingProfile"><input v-model="profile.name" class="f-input" style="width: 180px" /></template>
              <template v-else>{{ profile.name }}</template>
            </span>
          </div>
          <div class="detail-item">
            <span class="d-label">手机号</span>
            <span class="d-value">{{ profile.phone }}</span>
          </div>
          <div class="detail-item">
            <span class="d-label">邮箱</span>
            <span class="d-value">
              <template v-if="editingProfile"><input v-model="profile.email" class="f-input" style="width: 220px" /></template>
              <template v-else>{{ profile.email }}</template>
            </span>
          </div>
          <div class="detail-item">
            <span class="d-label">角色</span>
            <span class="d-value"><span class="tag tag-blue">{{ auth.user?.roleName }}</span></span>
          </div>
        </div>
        <div class="f-field" style="max-width: 460px">
          <label class="f-label">个人简介</label>
          <textarea v-model="profile.intro" class="f-textarea" rows="3" :disabled="!editingProfile" />
        </div>
        <button v-if="!editingProfile" class="btn btn-primary btn-sm" @click="editingProfile = true">编辑资料</button>
        <div v-else class="op-group">
          <button class="btn btn-ghost btn-sm" @click="editingProfile = false">取消</button>
          <button class="btn btn-primary btn-sm" @click="saveProfile">保存</button>
        </div>
      </div>

      <!-- 账号安全 -->
      <div v-else-if="tab === 'security'" class="tab-body narrow">
        <div class="f-field">
          <label class="f-label">当前密码</label>
          <input v-model="pwd.old" type="password" class="f-input" placeholder="输入当前密码" />
          <p v-if="pwdErrors.old" class="f-err">{{ pwdErrors.old }}</p>
        </div>
        <div class="f-field">
          <label class="f-label">新密码（≥8 位，含字母与数字）</label>
          <input v-model="pwd.first" type="password" class="f-input" placeholder="输入新密码" />
          <p v-if="pwdErrors.first" class="f-err">{{ pwdErrors.first }}</p>
        </div>
        <div class="f-field">
          <label class="f-label">确认新密码</label>
          <input v-model="pwd.second" type="password" class="f-input" placeholder="再次输入新密码" />
          <p v-if="pwdErrors.second" class="f-err">{{ pwdErrors.second }}</p>
        </div>
        <button class="btn btn-primary btn-sm" @click="submitPwd">修改密码</button>
        <div class="security-tips">
          <p class="f-hint"><AppIcon name="shield" :size="13" /> 密码修改后将使其他设备登录失效</p>
        </div>
      </div>

      <!-- 消息偏好 -->
      <div v-else-if="tab === 'notify'" class="tab-body narrow">
        <div class="pref-row">
          <div>
            <p class="pref-title">接收站内通知</p>
            <p class="f-hint">审核待办、协同邀请等即时提醒</p>
          </div>
          <AppSwitch v-model="notify.inApp" />
        </div>
        <div class="pref-row">
          <div>
            <p class="pref-title">短信提醒</p>
            <p class="f-hint">重要待办短信触达（付费通道）</p>
          </div>
          <AppSwitch v-model="notify.sms" />
        </div>
        <div class="pref-row">
          <div>
            <p class="pref-title">邮件提醒</p>
            <p class="f-hint">审核结果等非紧急通知</p>
          </div>
          <AppSwitch v-model="notify.email" />
        </div>
        <div class="pref-row">
          <div>
            <p class="pref-title">每日待办汇总</p>
            <p class="f-hint">每天 18:00 汇总当日待办推送</p>
          </div>
          <AppSwitch v-model="notify.digest" />
        </div>
        <button class="btn btn-primary btn-sm" @click="saveNotify">保存偏好</button>
      </div>

      <!-- 登录记录 -->
      <div v-else class="tab-body">
        <table class="data-table">
          <thead>
            <tr>
              <th>时间</th>
              <th>IP</th>
              <th>设备 / 浏览器</th>
              <th>结果</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in logs" :key="row.id">
              <td>{{ row.time }}</td>
              <td><code class="ip">{{ row.ip }}</code></td>
              <td>{{ row.device }}</td>
              <td>
                <span class="tag" :class="row.ok ? 'tag-green' : 'tag-red'">{{ row.ok ? '成功' : '失败' }}</span>
              </td>
            </tr>
          </tbody>
        </table>
        <p class="f-hint" style="margin-top: 10px">仅展示最近 8 条；完整日志见 机构管理 → 日志管理</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.profile-panel { padding: 18px 20px; }

.profile-head { display: flex; align-items: center; gap: 14px; padding-bottom: 16px; border-bottom: 1px solid var(--border); margin-bottom: 14px; }
.avatar {
  width: 56px; height: 56px; border-radius: 16px; color: #fff;
  font-size: 24px; font-weight: 700; display: flex; align-items: center; justify-content: center;
}
.head-meta h3 { font-size: 17px; }

.tab-bar { display: flex; gap: 4px; margin-bottom: 16px; border-bottom: 1px solid var(--border); }
.tab-btn {
  border: none; background: transparent; padding: 9px 16px;
  font-size: 13.5px; color: var(--sub); border-bottom: 2.5px solid transparent; margin-bottom: -1px;
}
.tab-btn.on { color: var(--brand-deep); font-weight: 600; border-bottom-color: var(--brand); }

.tab-body.narrow { max-width: 480px; }
.security-tips { margin-top: 14px; }
.security-tips .f-hint { display: flex; align-items: center; gap: 5px; }

.pref-row {
  display: flex; align-items: center; justify-content: space-between; gap: 14px;
  border-bottom: 1px dashed var(--border); padding: 12px 0;
}
.pref-title { font-size: 13.5px; font-weight: 600; color: var(--ink); margin-bottom: 3px; }
.tab-body .btn-primary { margin-top: 14px; }

.ip { font-family: 'SF Mono', Menlo, monospace; font-size: 12px; }
</style>
