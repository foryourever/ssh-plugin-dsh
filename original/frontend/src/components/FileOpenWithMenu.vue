<script setup lang="ts">
// 预览头部「打开方式」下拉：系统默认 + sidecar 探测到的可用编辑器 + 用户
// 自定义编辑器；最后一项进入自定义命令弹窗。选中即交给 App 的
// openInExternalEditor 走既有「下载副本 → watch → 打开」链路，不另开执行原语。
//
// 这里用受控的内联菜单而不是 reka Popover：预览本身已是模态 Dialog，
// 内联菜单能复用宿主右键菜单的层级/键盘语义，也避免 Anchor 不承担触发职责
// 导致「按钮点了没反应」（与 files 插件 PreviewOpenWithMenu 同形）。
import { computed, nextTick, onUnmounted, ref, watch } from "vue";
import { Check, ChevronDown, ExternalLink, Pencil } from "@lucide/vue";
import {
  resolveEditorForFile,
  type EditorConfig,
  type KnownEditor,
  type ResolvedEditor,
} from "../lib/editorRules";

const props = defineProps<{
  fileName: string;
  editors: KnownEditor[];
  editorConfig: EditorConfig;
  /** 本机落盘能力 + 可写门：与 SFTP 右键「打开方式」保持同一门禁。 */
  canOpen: boolean;
  /** 不可用时的悬浮说明（localCanSave=false → 桌面端专属提示）。 */
  disabledHint?: string;
  t: (key: string, values?: Record<string, string | number>) => string;
}>();

const emit = defineEmits<{
  (event: "open", editor: ResolvedEditor): void;
  (event: "custom-command"): void;
  (event: "request-editors"): void;
}>();

const open = ref(false);
const rootEl = ref<HTMLElement>();
const triggerEl = ref<HTMLButtonElement>();
const menuEl = ref<HTMLElement>();

const availableEditors = computed(() => props.editors.filter((editor) => editor.available));
/** 当前文件按关联/默认解析到的编辑器 id（菜单打勾标识；system 为空串）。 */
const mappedEditorId = computed(() => {
  const resolved = resolveEditorForFile(props.fileName, props.editorConfig, props.editors);
  return resolved.kind === "system" ? "" : resolved.editor.id;
});

function setOpen(next: boolean) {
  open.value = next;
  // 展开时惰性拉取编辑器目录（与右键子菜单同一时机，避免启动即探测本机）。
  if (next) emit("request-editors");
}

function toggle() {
  if (!props.canOpen) return;
  setOpen(!open.value);
}

function choose(editor: ResolvedEditor) {
  setOpen(false);
  emit("open", editor);
}

function chooseCustomCommand() {
  setOpen(false);
  emit("custom-command");
}

// 外点关闭：pointerdown 捕获，避免点击落到预览正文后才关。
function onDocumentPointerDown(event: PointerEvent) {
  if (!open.value) return;
  const target = event.target as Node | null;
  if (target && (rootEl.value?.contains(target) || menuEl.value?.contains(target))) return;
  setOpen(false);
}

function onDocumentKeydown(event: KeyboardEvent) {
  if (!open.value || event.key !== "Escape") return;
  // 预览层自身的 Esc 关闭链在 bubble 阶段；菜单开着时先只收菜单。
  event.preventDefault();
  event.stopPropagation();
  setOpen(false);
  triggerEl.value?.focus();
}

function onMenuKeydown(event: KeyboardEvent) {
  if (!open.value) return;
  if (event.key === "Escape") {
    onDocumentKeydown(event);
    return;
  }
  const keys = ["ArrowDown", "ArrowUp", "Home", "End"];
  if (!keys.includes(event.key)) return;
  event.preventDefault();
  const items = Array.from(menuEl.value?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []);
  if (!items.length) return;
  const current = items.indexOf(document.activeElement as HTMLButtonElement);
  const last = items.length - 1;
  let next = 0;
  if (event.key === "End") next = last;
  else if (event.key === "Home") next = 0;
  else if (event.key === "ArrowUp") next = current <= 0 ? last : current - 1;
  else next = current < 0 || current >= last ? 0 : current + 1;
  items[next]?.focus();
}

watch(open, async (isOpen) => {
  if (isOpen) {
    document.addEventListener("pointerdown", onDocumentPointerDown, true);
    document.addEventListener("keydown", onDocumentKeydown, true);
    await nextTick();
    menuEl.value?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
  } else {
    document.removeEventListener("pointerdown", onDocumentPointerDown, true);
    document.removeEventListener("keydown", onDocumentKeydown, true);
  }
});

onUnmounted(() => {
  document.removeEventListener("pointerdown", onDocumentPointerDown, true);
  document.removeEventListener("keydown", onDocumentKeydown, true);
});
</script>

<template>
  <div ref="rootEl" class="ssh-open-with">
    <button
      ref="triggerEl"
      type="button"
      class="ssh-preview-action ssh-open-with-trigger"
      :disabled="!canOpen"
      :title="canOpen ? t('sftpEdit.openWith') : disabledHint"
      :aria-label="t('sftpEdit.openWith')"
      aria-haspopup="menu"
      :aria-expanded="open"
      data-test="preview-open-with"
      @click="toggle"
    >
      <ExternalLink />
      <span class="ssh-open-with-trigger-label">{{ t("sftpEdit.openWith") }}</span>
      <ChevronDown class="ssh-open-with-caret" />
    </button>
    <div
      v-if="open"
      ref="menuEl"
      class="ssh-open-with-menu"
      role="menu"
      data-test="preview-open-with-menu"
      @click.stop
      @keydown="onMenuKeydown"
    >
      <button type="button" class="ssh-open-with-item" role="menuitem" @click="choose({ kind: 'system' })">
        <span class="ssh-open-with-label">{{ t("sftpEdit.systemDefault") }}</span>
        <Check v-if="!mappedEditorId" class="ssh-open-with-check" />
      </button>
      <template v-if="availableEditors.length">
        <hr class="ssh-open-with-sep" />
        <button
          v-for="editor in availableEditors"
          :key="`known-${editor.id}`"
          type="button"
          class="ssh-open-with-item"
          role="menuitem"
          :title="editor.launch.kind === 'exe' ? editor.launch.exe : editor.launch.appId"
          @click="choose({ kind: 'known', editor })"
        >
          <span class="ssh-open-with-label">{{ editor.name }}</span>
          <Check v-if="mappedEditorId === editor.id" class="ssh-open-with-check" />
        </button>
      </template>
      <template v-if="editorConfig.customEditors.length">
        <hr class="ssh-open-with-sep" />
        <button
          v-for="editor in editorConfig.customEditors"
          :key="`custom-${editor.id}`"
          type="button"
          class="ssh-open-with-item"
          role="menuitem"
          :title="editor.command"
          @click="choose({ kind: 'custom', editor })"
        >
          <span class="ssh-open-with-label">{{ editor.name }}</span>
          <Check v-if="mappedEditorId === editor.id" class="ssh-open-with-check" />
        </button>
      </template>
      <hr class="ssh-open-with-sep" />
      <button type="button" class="ssh-open-with-item" role="menuitem" @click="chooseCustomCommand">
        <Pencil />
        <span class="ssh-open-with-label">{{ t("sftpEdit.customCommand") }}</span>
      </button>
    </div>
  </div>
</template>
