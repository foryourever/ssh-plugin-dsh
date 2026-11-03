<script setup lang="ts">
// PDF 专属文件图标：文档轮廓 + 底部实心 PDF 标签。lucide 没有 pdf 图标，
// FileText 与 Word 无法区分，这里用固定标签保证列表/预览头部一眼可辨。
// 注意：模板必须保持单一根节点（顶层不要放注释），否则 Vue 视为 fragment，
// class（尺寸/颜色）不会透传到 svg，图标会按默认尺寸撑满预览弹窗。
</script>

<template>
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.7"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <path d="M14 2v6h6" />
    <rect x="5.5" y="12.5" width="13" height="8" rx="1.5" fill="currentColor" stroke="none" />
    <text
      x="12"
      y="18.6"
      text-anchor="middle"
      font-family="ui-sans-serif, system-ui, sans-serif"
      font-size="5.6"
      font-weight="700"
      letter-spacing="0.1"
      fill="var(--background)"
      stroke="none"
    >PDF</text>
  </svg>
</template>
