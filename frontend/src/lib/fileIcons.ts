// 文件行/预览图标：按扩展名给非目录条目选 lucide 图标，未知/无扩展名回退通用文件。
// 移植自 files 插件 `lib/fileIcons.ts`；目录仍由调用方保留 Folder 语义，不走本模块。
import {
  Archive,
  File,
  FileAudio,
  FileCode,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileVideo,
  Presentation,
} from "@lucide/vue";
import FilePdfIcon from "../components/FilePdfIcon.vue";

export type FileIconKind =
  | "image"
  | "word"
  | "excel"
  | "ppt"
  | "pdf"
  | "archive"
  | "code"
  | "audio"
  | "video"
  | "file";

const EXTENSION_KINDS: Record<string, FileIconKind> = {
  avif: "image",
  bmp: "image",
  gif: "image",
  heic: "image",
  heif: "image",
  ico: "image",
  jpeg: "image",
  jpg: "image",
  png: "image",
  svg: "image",
  tif: "image",
  tiff: "image",
  webp: "image",
  doc: "word",
  docm: "word",
  docx: "word",
  odt: "word",
  rtf: "word",
  csv: "excel",
  ods: "excel",
  tsv: "excel",
  xls: "excel",
  xlsb: "excel",
  xlsm: "excel",
  xlsx: "excel",
  key: "ppt",
  odp: "ppt",
  pot: "ppt",
  potx: "ppt",
  pps: "ppt",
  ppt: "ppt",
  pptx: "ppt",
  pdf: "pdf",
  "7z": "archive",
  bz2: "archive",
  gz: "archive",
  rar: "archive",
  tar: "archive",
  tgz: "archive",
  xz: "archive",
  zip: "archive",
  c: "code",
  cpp: "code",
  cs: "code",
  css: "code",
  go: "code",
  h: "code",
  hpp: "code",
  html: "code",
  ini: "code",
  java: "code",
  js: "code",
  json: "code",
  jsx: "code",
  kt: "code",
  mjs: "code",
  php: "code",
  py: "code",
  rb: "code",
  rs: "code",
  scss: "code",
  sh: "code",
  sql: "code",
  swift: "code",
  svelte: "code",
  toml: "code",
  ts: "code",
  tsx: "code",
  vue: "code",
  xml: "code",
  yaml: "code",
  yml: "code",
  aac: "audio",
  flac: "audio",
  m4a: "audio",
  mp3: "audio",
  oga: "audio",
  ogg: "audio",
  opus: "audio",
  wav: "audio",
  avi: "video",
  m4v: "video",
  mkv: "video",
  mov: "video",
  mp4: "video",
  mpeg: "video",
  mpg: "video",
  webm: "video",
  wmv: "video",
};

export function fileIconKind(name: string): FileIconKind {
  const dot = name.lastIndexOf(".");
  // dot === 0 覆盖 .gitignore 这类点文件：整名就是文件名，没有扩展名。
  if (dot <= 0) return "file";
  return EXTENSION_KINDS[name.slice(dot + 1).toLowerCase()] ?? "file";
}

const KIND_ICONS = {
  image: FileImage,
  word: FileText,
  excel: FileSpreadsheet,
  ppt: Presentation,
  pdf: FilePdfIcon,
  archive: Archive,
  code: FileCode,
  audio: FileAudio,
  video: FileVideo,
  file: File,
} as const satisfies Record<FileIconKind, unknown>;

/** 按文件名取图标组件；目录请继续用 Folder，勿走此函数。 */
export function fileIcon(name: string) {
  return KIND_ICONS[fileIconKind(name)];
}

/** media-aware 着色：媒体/代码/归档给主题色，办公文档与未知类型保持中性灰，
 *  避免整列表彩虹化。类名在 style.css 定义，全部引用宿主主题 token。 */
const KIND_ICON_CLASSES: Record<FileIconKind, string> = {
  image: "ssh-fi-image",
  word: "",
  excel: "",
  ppt: "",
  pdf: "ssh-fi-pdf",
  archive: "ssh-fi-archive",
  code: "ssh-fi-code",
  audio: "ssh-fi-audio",
  video: "ssh-fi-video",
  file: "",
};

/** 按文件名取图标的着色类；空串表示保持默认中性色。 */
export function fileIconClass(name: string): string {
  return KIND_ICON_CLASSES[fileIconKind(name)];
}
