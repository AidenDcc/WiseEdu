<script setup lang="ts">
/**
 * 「我的文件」文件夹选择弹窗：建卷（平行卷 / AI 组卷 / 协同组卷 / 组卷车）前挑一个落脚目录。
 *
 * 为什么值得单独一个弹窗，而不是继续用下拉：个人试卷一律存「我的文件」，
 * 但目录是树形的，下拉只能把树压成一串「— — 名字」；更要紧的是**选之前看不见里面有什么** ——
 * 名字像「新建文件夹1」的目录有好几个时，光看下拉根本分不清。这里把树、目录里的文件、
 * 以及「就地新建文件夹」放在一起，选位置这件事一次做完。
 *
 * 目录 id 0 是根目录（mock 的 seed 里写死 `{ id: 0, name: '全部文件', parentId: null }`），
 * 根的直接子目录 parentId 也是 0，文件则用 folderId 记（根 = 0）—— 两套字段别混。
 *
 * z-index 默认 130，比 AppModal 的 120 高一档。**宿主浮层比 120 高时必须由调用方把层级传进来**：
 * 组卷工作台里「生成试卷」是 340，那里就传 `zIndex + 10`，不传会被压在下面点不到。
 * **代价是本弹窗与 appConfirm（固定 130）同层**：本弹窗内部不弹确认框，两者也不会同时出现，
 * 所以现在没事；将来若在这里加「确认删除文件夹」，得先把 appConfirm 的层级抬上去。
 */
import { computed, nextTick, onMounted, ref } from 'vue'
import type { ComponentPublicInstance } from 'vue'
import { AppIcon, AppModal, FILE_KIND_COLOR, FILE_KIND_ICON, FILE_KIND_TEXT, showToast } from '@aiteach/shared'
import type { FileFolder, OrgFile } from '@aiteach/shared'
import { fetchFiles, fetchFolders, saveFolder } from '@/api/org'
import { folderPathOf, nextFolderName } from '@/utils/folders'

const props = withDefaults(
  defineProps<{
    /** 已选目录 id；null = 还没选过（调用方据此判必选） */
    modelValue: number | null
    title?: string
    zIndex?: number
    confirmText?: string
    /** 确认后的异步动作（落库 / 出卷）进行中：禁用按钮并阻止点遮罩关闭 */
    busy?: boolean
  }>(),
  { title: '选择存储位置', zIndex: 130, confirmText: '保存', busy: false },
)

const emit = defineEmits<{
  'update:modelValue': [value: number]
  /**
   * 点「保存」：不自行关闭，由调用方决定（它可能还要 await 一次落库再关）。
   * 第二个参数是目录的可读全路径，调用方拿去做提示文案，省得自己再回查一遍目录。
   */
  confirm: [value: number, path: string]
  close: []
}>()

const ROOT_ID = 0

const folders = ref<FileFolder[]>([])
const files = ref<OrgFile[]>([])
const loading = ref(true)
/** 拉取失败时的文案：静默给一棵空树，用户会以为「我的文件」是空的 */
const loadError = ref('')

/** 草稿选中值：点行只改它，点「保存」才 emit —— 中途关掉弹窗等于放弃这次选择 */
const draft = ref(ROOT_ID)

/** 新建文件夹的内联输入；null = 当前没在新建 */
const creating = ref<{ parentId: number; name: string } | null>(null)
const nameInput = ref<HTMLInputElement | null>(null)

/** 深度优先展平（深度不限），depth 驱动缩进；根目录自身也是第一行 */
const tree = computed(() => {
  const rows: Array<{ folder: FileFolder; depth: number }> = []
  const walk = (parentId: number | null, depth: number) => {
    folders.value
      .filter((row) => row.parentId === parentId)
      .forEach((folder) => {
        rows.push({ folder, depth })
        walk(folder.id, depth + 1)
      })
  }
  walk(null, 0)
  return rows
})

/** 只展开当前选中目录的文件：全展开会在目录一多时铺出几十行，反而找不到要选的目录 */
const selectedFiles = computed(() => files.value.filter((row) => row.folderId === draft.value))

function folderById(id: number): FileFolder | undefined {
  return folders.value.find((row) => row.id === id)
}
function folderNameOf(id: number): string {
  return folderById(id)?.name ?? '—'
}
/** 行尾的「N 项」：让人一眼看出哪些目录是空的，不必逐个点开 */
function childCountOf(id: number): number {
  return folders.value.filter((row) => row.parentId === id).length + files.value.filter((row) => row.folderId === id).length
}

/** 函数式 ref：输入框在 v-for 里，模板 ref 会被收集成数组，拿不到那个唯一的元素 */
function bindNameInput(el: Element | ComponentPublicInstance | null) {
  nameInput.value = (el as HTMLInputElement | null) ?? null
}

function startCreate() {
  if (creating.value || props.busy) return
  creating.value = { parentId: draft.value, name: nextFolderName(folders.value, draft.value) }
  void nextTick(() => {
    nameInput.value?.focus()
    /* 全选：预填名多半要改，直接打字即可覆盖 */
    nameInput.value?.select()
  })
}

function cancelCreate() {
  creating.value = null
}

async function submitCreate() {
  const form = creating.value
  if (!form) return
  const name = form.name.trim()
  if (!name) {
    showToast('文件夹名称不能为空', 'error')
    return
  }
  try {
    const created = await saveFolder({ name, parentId: form.parentId })
    creating.value = null
    /* 必须重拉：folders 是 mock 的模块级数组，本地 push 与真实状态会漂移 */
    folders.value = await fetchFolders()
    /* 新建完顺手选中它——点「新建文件夹」的下一步八成就是往里存东西 */
    draft.value = created.id
    showToast(`已创建「${created.name}」`, 'success')
  } catch (error) {
    /* 名字撞车、超长等都走这里；输入框留着不关，改完能直接重试 */
    showToast(error instanceof Error ? error.message : '创建文件夹失败', 'error')
  }
}

function confirm() {
  /* creating 也要拦：按钮虽已置灰，但这个守卫是「没建完就不许保存」这条规则的唯一落点 */
  if (props.busy || creating.value) return
  emit('update:modelValue', draft.value)
  emit('confirm', draft.value, folderPathOf(folders.value, draft.value))
}

onMounted(async () => {
  try {
    const [folderRows, fileResult] = await Promise.all([fetchFolders(), fetchFiles()])
    folders.value = folderRows
    files.value = fileResult.list
    /* 回显上一次的选择；目录已被删则退回根目录，别让弹窗开在一个不存在的目录上 */
    draft.value = props.modelValue != null && folderRows.some((row) => row.id === props.modelValue) ? props.modelValue : ROOT_ID
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : '「我的文件」加载失败'
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <!-- 820 而不是 AppModal 默认的 460：目录路径 + 文件名 + 类型三者要在一行里排开，
       窄了就只能靠省略号互相挤，选位置时最需要看清的那截反而看不到 -->
  <AppModal :title="title" :width="820" :z-index="zIndex" :close-on-mask="!busy" @close="emit('close')">
    <slot />

    <div class="fp-bar">
      <!-- 显示 creating.parentId 而不是 draft：新建期间用户仍可点别的目录行，
           这时草稿选中值已经变了，但文件夹还是建在当初那一层，两边不能对不上 -->
      <span class="fp-where">
        新建文件夹将创建在 <b>{{ folderNameOf(creating ? creating.parentId : draft) }}</b>
      </span>
      <button class="btn btn-ghost btn-sm" type="button" :disabled="!!creating || busy" @click="startCreate">
        <AppIcon name="folder-plus" :size="14" /> 新建文件夹
      </button>
    </div>

    <div class="fm-tree">
      <p v-if="loading" class="fp-empty">加载中…</p>
      <p v-else-if="loadError" class="fp-empty is-error">{{ loadError }}</p>
      <p v-else-if="!tree.length" class="fp-empty">「我的文件」下暂无文件夹</p>
      <template v-else>
        <template v-for="{ folder, depth } in tree" :key="folder.id">
          <button
            class="fm-tree-row"
            :class="{ on: draft === folder.id }"
            type="button"
            :style="{ paddingLeft: `${10 + depth * 16}px` }"
            @click="draft = folder.id"
          >
            <AppIcon :name="folder.id === ROOT_ID ? 'layers' : 'folder'" :size="14" />
            <span class="fm-tree-name">{{ folder.name }}</span>
            <span class="fm-tree-count">{{ childCountOf(folder.id) }} 项</span>
          </button>

          <!-- 新建输入框贴在选中目录那一行下面：创建到哪个目录是看得见的 -->
          <div
            v-if="creating && creating.parentId === folder.id"
            class="fm-tree-new"
            :style="{ paddingLeft: `${10 + (depth + 1) * 16}px` }"
          >
            <AppIcon name="folder" :size="14" />
            <!-- Esc 上的 .stop 是必须的：AppModal 在 document 上监听 Esc，
                 不拦住的话在输入框里按 Esc 会把整个选择弹窗一起关掉 -->
            <input
              :ref="bindNameInput"
              v-model="creating.name"
              class="f-input fp-new-input"
              maxlength="30"
              placeholder="文件夹名称"
              @keydown.enter.prevent="submitCreate"
              @keydown.esc.stop.prevent="cancelCreate"
            />
            <button class="fp-icon-btn" type="button" title="创建" @click="submitCreate">
              <AppIcon name="check" :size="14" />
            </button>
            <button class="fp-icon-btn" type="button" title="取消" @click="cancelCreate">
              <AppIcon name="close" :size="14" />
            </button>
          </div>

          <!-- 展示文件：跟着选中目录走，只展开这一个 -->
          <template v-if="draft === folder.id">
            <div
              v-for="file in selectedFiles"
              :key="file.id"
              class="fm-tree-file"
              :style="{ paddingLeft: `${10 + (depth + 1) * 16}px` }"
            >
              <span class="fm-tree-file-ico" :style="FILE_KIND_COLOR[file.kind]">
                <AppIcon :name="FILE_KIND_ICON[file.kind]" :size="12" />
              </span>
              <span class="fm-tree-name">{{ file.name }}</span>
              <span class="fm-tree-count">{{ FILE_KIND_TEXT[file.kind] }}</span>
            </div>
            <p v-if="!selectedFiles.length" class="fm-tree-file is-empty" :style="{ paddingLeft: `${10 + (depth + 1) * 16}px` }">
              该文件夹下暂无文件
            </p>
          </template>
        </template>
      </template>
    </div>

    <p class="f-hint">试卷将保存到所选文件夹，之后可在「我的文件」中继续编辑或移动。</p>

    <template #footer>
      <button class="btn btn-ghost" @click="emit('close')">取消</button>
      <!-- creating 期间禁用「保存」：否则用户以为新目录已经建好了，其实只是输入框还开着，
           卷会静默落进原来的目录 —— 建目录白建，比多按一次 ✓ 难受得多 -->
      <button class="btn btn-primary" :disabled="busy || loading || !!loadError || !!creating" @click="confirm">
        {{ busy ? '保存中…' : confirmText }}
      </button>
    </template>
  </AppModal>
</template>

<style scoped>
.fp-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 8px;
}
.fp-where { font-size: 12.5px; color: var(--sub); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fp-where b { color: var(--ink-2); }

/* 与 FileView「移动 / 复制到」的目录树同款观感：两处都在选目标目录，样式不该各长一样 */
.fm-tree {
  max-height: 320px;
  overflow-y: auto;
  /* 目录层级深时靠 paddingLeft 缩进，超过容器宽度要能横向滚，否则尾部的勾选图标会被裁掉 */
  overflow-x: auto;
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 4px;
}
.fm-tree-row {
  display: flex;
  align-items: center;
  gap: 7px;
  width: 100%;
  border: 0;
  background: transparent;
  border-radius: 8px;
  padding: 7px 10px;
  font-size: 13px;
  color: var(--ink-2);
  text-align: left;
  white-space: nowrap;
}
.fm-tree-row:hover { background: #f4f8f8; }
.fm-tree-row.on { background: var(--brand-soft); color: var(--brand-deep); font-weight: 600; }
.fm-tree-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fm-tree-count { font-size: 12px; color: var(--sub); flex-shrink: 0; }

.fm-tree-new { display: flex; align-items: center; gap: 7px; padding: 4px 10px 4px 0; }
.fp-new-input { height: 30px; font-size: 13px; }
.fp-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  flex-shrink: 0;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: #fff;
  color: var(--ink-2);
}
.fp-icon-btn:hover { border-color: var(--brand); color: var(--brand); }

/* 文件行是纯展示：要选的是文件夹，文件不可点 */
.fm-tree-file {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 5px 10px;
  font-size: 12.5px;
  color: var(--sub);
  white-space: nowrap;
}
.fm-tree-file.is-empty { margin: 0; font-size: 12px; }
.fm-tree-file-ico {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  flex-shrink: 0;
  border-radius: 6px;
}

.fp-empty { margin: 0; padding: 18px 10px; text-align: center; font-size: 13px; color: var(--sub); }
.fp-empty.is-error { color: var(--danger, #d64545); }
</style>
