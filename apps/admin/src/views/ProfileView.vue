<script setup lang="ts">
/**
 * 个人中心（P-08-01）。四个页签与机构端 ProfileView 保持一致：个人资料 / 账号安全 / 消息偏好 / 登录记录。
 *
 * 与机构端的唯一结构差异在**资料从哪来**：机构端有「演示身份」切换，联系方式跟着身份表走；
 * 管理端账号固定，直接取会话用户（`auth.user`）—— 后者由 `/auth/login` 下发，刷新后仍在缓存里。
 */
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { AppAvatar, AppIcon, AppPageHeader, AppTabs, fileToSquareDataUrl, setAvatarOverride, showToast, appConfirm, updateSessionUser } from '@aiteach/shared'
import type { SessionUser, TabDef } from '@aiteach/shared'
import AppSwitch from '@/components/ui/AppSwitch.vue'
import { useAuthStore } from '@/stores/auth'
import { fetchLoginLogs } from '@/api/platform'

const router = useRouter()
const auth = useAuthStore()

/* 会话用户理论上一定在（路由守卫先 restore 再放行），但真为 null 时不该把
   「undefined · undefined」当说明文字画到页头上 */
const headerDesc = computed(() =>
  auth.user ? `${auth.user.orgName} · ${auth.user.roleName}` : '',
)

type TabKey = 'profile' | 'security' | 'notify' | 'logs'
const TABS: TabDef[] = [
  { key: 'profile', label: '个人资料' },
  { key: 'security', label: '账号安全' },
  { key: 'notify', label: '消息偏好' },
  { key: 'logs', label: '登录记录' },
]
const tab = ref<TabKey>('profile')

/** AppTabs 回传 string，这里收窄回 TabKey */
function switchTab(value: string) {
  tab.value = value as TabKey
}

/* ===== 个人资料 =====
   初值取会话用户；会话用户里没有的（历史缓存、真实后端 VO 未下发）用空串兜底，
   免得页面上出现 `undefined`。 */
const profile = reactive({
  name: auth.user?.name ?? '',
  phone: auth.user?.phone ?? '',
  email: auth.user?.email ?? '',
  intro: auth.user?.intro ?? '',
})
const editingProfile = ref(false)

function saveProfile() {
  if (profile.name.trim().length < 2) {
    showToast('姓名至少 2 个字', 'error')
    return
  }
  const current = auth.user
  if (current) {
    const next: SessionUser = {
      ...current,
      name: profile.name.trim(),
      phone: profile.phone,
      email: profile.email,
      intro: profile.intro,
    }
    auth.user = next
    /* 用 updateSessionUser 而不是 setSession：后者会重写到期时间，
       改一次资料就把 30 分钟固定窗口续满，等于没有有效期（见 shared/api/auth.ts）。 */
    updateSessionUser(next)
  }
  editingProfile.value = false
  showToast('资料已保存', 'success')
}

/* ===== 头像 =====
   一处改动要落三处，否则会出现「换完刷新就变回去」：本地覆盖表（跨登出保留）、
   会话缓存（顶栏/试卷页读它）、Pinia 里的 user（当前页面立即重渲染）。 */
const avatarInput = ref<HTMLInputElement | null>(null)
const avatarBusy = ref(false)

/** 同步三处；`null` 为恢复默认字母头像 */
function applyAvatar(dataUrl: string | null) {
  const current = auth.user
  if (!current) return
  /* 先写覆盖表：它可能因配额不足抛错，那时会话就不该被改掉（否则界面换了、刷新又没了） */
  setAvatarOverride(current.account, dataUrl)
  const next: SessionUser = { ...current, avatar: dataUrl ?? '' }
  auth.user = next
  updateSessionUser(next)
}

async function onAvatarPicked(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  /* 清空 value：同一个文件连选两次也要能再触发 change */
  input.value = ''
  if (!file) return

  avatarBusy.value = true
  try {
    applyAvatar(await fileToSquareDataUrl(file))
    showToast('头像已更新', 'success')
  } catch (error) {
    showToast(error instanceof Error ? error.message : '头像处理失败，请换一张', 'error')
  } finally {
    avatarBusy.value = false
  }
}

async function onAvatarReset() {
  if (!(await appConfirm('恢复默认头像？', { type: 'info' }))) return
  applyAvatar(null)
  showToast('已恢复默认头像', 'success')
}

/* ===== 账号安全 ===== */
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

/* ===== 消息偏好（演示：暂不落库，与机构端一致） ===== */
const notify = reactive({ inApp: true, sms: true, email: false, digest: true })

function saveNotify() {
  showToast('消息偏好已保存', 'success')
}

/* ===== 登录记录 =====
   只取**本人**的流水：平台日志里混着各机构账号（orgadmin_a、teacher_li…），
   在超管的个人中心里列出别人的登录记录是说不通的。 */
const logs = ref<Array<{ id: number; account: string; ip: string; device: string; ok: boolean; time: string }>>([])

onMounted(async () => {
  const account = auth.user?.account
  const all = await fetchLoginLogs()
  logs.value = (account ? all.filter((row) => row.account === account) : all).slice(0, 8)
})

async function onLogout() {
  if (!(await appConfirm('确定退出登录？', { type: 'info' }))) return
  await auth.logout()
  showToast('已退出登录', 'success')
  router.push('/login')
}
</script>

<template>
  <div class="page">
    <AppPageHeader :desc="headerDesc" />

    <div class="panel profile-panel">
      <!-- 用户卡片头 -->
      <div class="profile-head">
        <!-- 点头像即换（与机构端同一套交互） -->
        <button
          class="avatar-btn"
          type="button"
          title="点击更换头像"
          :disabled="avatarBusy"
          @click="avatarInput?.click()"
        >
          <AppAvatar
            :name="auth.user?.name"
            :hue="auth.user?.avatarHue ?? 232"
            :avatar="auth.user?.avatar"
            :size="56"
            :radius="16"
          />
          <span class="avatar-mask">
            <AppIcon name="image" :size="16" />
            {{ avatarBusy ? '处理中' : '更换' }}
          </span>
        </button>
        <input ref="avatarInput" class="avatar-file" type="file" accept="image/*" @change="onAvatarPicked" />

        <div class="head-meta">
          <h3>{{ auth.user?.name }}</h3>
          <p class="f-hint">{{ auth.user?.account }} · {{ auth.user?.roleName }} · {{ auth.user?.orgName }}</p>
          <button v-if="auth.user?.avatar" class="avatar-reset" type="button" @click="onAvatarReset">
            恢复默认头像
          </button>
        </div>
        <button class="btn btn-ghost btn-sm" style="margin-left: auto" @click="onLogout">
          <AppIcon name="logout" :size="14" /> 退出登录
        </button>
      </div>

      <AppTabs :tabs="TABS" :model-value="tab" @update:model-value="switchTab" />

      <!-- 个人资料 -->
      <div v-if="tab === 'profile'" class="tab-body">
        <div class="detail-grid">
          <div class="detail-item">
            <div class="d-label">姓名</div>
            <div class="d-value">
              <template v-if="editingProfile"><input v-model="profile.name" class="f-input" style="width: 180px" /></template>
              <template v-else>{{ profile.name }}</template>
            </div>
          </div>
          <div class="detail-item">
            <div class="d-label">手机号</div>
            <div class="d-value">{{ profile.phone || '—' }}</div>
          </div>
          <div class="detail-item">
            <div class="d-label">邮箱</div>
            <div class="d-value">
              <template v-if="editingProfile"><input v-model="profile.email" class="f-input" style="width: 220px" /></template>
              <template v-else>{{ profile.email || '—' }}</template>
            </div>
          </div>
          <div class="detail-item">
            <div class="d-label">角色</div>
            <div class="d-value"><span class="tag tag-blue">{{ auth.user?.roleName }}</span></div>
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
            <p class="f-hint">入驻申请、合规抽检等平台待办即时提醒</p>
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
        <div class="data-table-wrap">
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
              <tr v-if="logs.length === 0">
                <td colspan="4" class="empty-hint">暂无登录记录</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p class="f-hint" style="margin-top: 10px">仅展示本人最近 8 条；全部账号日志见 数据审计 → 日志审计</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.profile-panel { padding: 18px 20px; }

.profile-head { display: flex; align-items: center; gap: 14px; padding-bottom: 16px; border-bottom: 1px solid var(--border); margin-bottom: 14px; }
.head-meta h3 { font-size: 17px; }

/* ---- 头像 ---- */
.avatar-btn {
  position: relative; padding: 0; border: none; background: none; cursor: pointer;
  border-radius: 16px; overflow: hidden; line-height: 0; flex-shrink: 0;
}
.avatar-btn:disabled { cursor: default; }
.avatar-mask {
  position: absolute; inset: 0;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px;
  background: rgb(0 0 0 / 45%); color: #fff; font-size: 11px;
  opacity: 0; transition: opacity 0.15s;
}
.avatar-btn:hover .avatar-mask,
.avatar-btn:focus-visible .avatar-mask { opacity: 1; }
/* 隐身上传入口：不用 display:none —— 部分浏览器会因此拒绝 programmatic click */
.avatar-file { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }
.avatar-reset {
  margin-top: 4px; padding: 0; border: none; background: none; cursor: pointer;
  font-size: 12px; color: var(--sub); text-decoration: underline;
}
.avatar-reset:hover { color: var(--ink); }

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
.empty-hint { text-align: center; color: var(--sub); font-size: 12.5px; padding: 18px 0; }
</style>
