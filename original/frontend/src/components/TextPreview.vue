<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { basicSetup } from "codemirror";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { HighlightStyle, LanguageDescription, syntaxHighlighting } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { tags } from "@lezer/highlight";
// 语法高亮调色板来自 shared 公共层（唯一实现点），暗色为提亮后的 GitHub Dark 系。
import { dbxSyntaxHighlight } from "../../../shared/frontend/editorTheme";
// 主题样式对象抽到 lib/（纯数据）：activeLine 的透明度契约由单测锁定（#214，
// 选区层 z-index -1 在内容之下，实色 activeLine 会盖住选区）。
import { textPreviewTheme } from "../lib/textPreviewTheme";

const props = defineProps<{
  text: string;
  fileName: string;
  appearance: DbxPluginAppearance;
  editable?: boolean;
}>();

const emit = defineEmits<{
  change: [text: string];
}>();

const host = ref<HTMLElement>();
let view: EditorView | undefined;
let generation = 0;

function previewTheme() {
  return EditorView.theme(
    textPreviewTheme(props.appearance.colors, props.appearance.colorScheme, props.appearance.terminal),
    { dark: props.appearance.colorScheme === "dark" },
  );
}

async function extensions() {
  const language = LanguageDescription.matchFilename(languages, props.fileName);
  const support = language ? await language.load().catch(() => undefined) : undefined;
  return [
    basicSetup,
    // basicSetup 内置 defaultHighlightStyle 是浅底配色，暗色下发暗；此处按宿主
    // 明暗注入 shared 调色板高亮（后声明者优先，内置样式退为 fallback），
    // appearance 变化重建编辑器时随 colorScheme 自然跟随。
    dbxSyntaxHighlight(props.appearance.colorScheme, { HighlightStyle, syntaxHighlighting, tags }) as Extension,
    EditorState.readOnly.of(!props.editable),
    EditorView.editable.of(props.editable === true),
    EditorView.lineWrapping,
    previewTheme(),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) emit("change", update.state.doc.toString());
    }),
    ...(support ? [support] : []),
  ];
}

async function createEditor() {
  const current = ++generation;
  const configured = await extensions();
  if (!host.value || current !== generation) return;
  // Seed the new editor with the live document so edits survive theme or
  // editable-mode re-creations; fall back to the incoming text on first mount.
  const doc = view?.state.doc.toString() ?? props.text;
  view?.destroy();
  view = new EditorView({
    parent: host.value,
    state: EditorState.create({ doc, extensions: configured }),
  });
}

onMounted(createEditor);
watch(() => [props.fileName, props.appearance, props.editable] as const, createEditor, { deep: true });
watch(() => props.text, (text) => {
  if (!view || text === view.state.doc.toString()) return;
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
});
onBeforeUnmount(() => {
  generation += 1;
  view?.destroy();
});
</script>

<template>
  <div ref="host" class="preview-editor" />
</template>
