// 多格式预览解析器（自 files 插件 previewResolver 移植）：按扩展名判定预览
// 渲染车道与编辑能力。分层与 files 一致——文本/代码留在 CodeMirror，图片走
// 原生元素，Office/PDF/媒体/表格/演示文稿等 CodeMirror 无法渲染的格式交给
// 内嵌 file-viewer；未知扩展保留 text/hex 启发式。
//
// 与 files 的差异：
// - 归档（zip/tar.gz 等）没有 files/archiveList，按未知扩展走 text/hex 启发式；
// - textSniff 是本仓库既有模块，未知扩展的二进制判定复用它，不再内联 printable 启发式。

export type PreviewKind = "image" | "text" | "office" | "pdf" | "media" | "unknown";
export type PreviewStrategy = "codemirror" | "image" | "hex" | "file-viewer";
export type PreviewFallbackReason = "unknown-extension" | null;

export interface PreviewResolution {
  /** 归一化的最终扩展名（不含点）；复合归档保留双后缀（tar.gz）。 */
  extension: string;
  /** 按扩展名推断的 MIME；未知扩展为 null。 */
  mime: string | null;
  kind: PreviewKind;
  /** 只有已知文本/代码扩展可编辑。 */
  editable: boolean;
  /** 该文件的渲染车道。 */
  previewStrategy: PreviewStrategy;
  /** 可编辑文本进入编辑态时使用的编辑器。 */
  editorStrategy: "codemirror" | null;
  /** 未知扩展保留 text/hex 启发式而不是 viewer。 */
  fallback: boolean;
  fallbackReason: PreviewFallbackReason;
}

type KnownPreview = {
  kind: Exclude<PreviewKind, "unknown">;
  mime: string;
  editable?: boolean;
  strategy?: Exclude<PreviewStrategy, "codemirror" | "hex">;
};

const IMAGE_MIMES: Record<string, string> = {
  avif: "image/avif",
  bmp: "image/bmp",
  gif: "image/gif",
  ico: "image/x-icon",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  svg: "image/svg+xml",
  webp: "image/webp",
};

/** 浏览器 <img> 解不了的图片格式，交给 file-viewer 自带解码器。 */
const VIEWER_IMAGE_MIMES: Record<string, string> = {
  heic: "image/heic",
  heif: "image/heif",
  jxl: "image/jxl",
  tif: "image/tiff",
  tiff: "image/tiff",
};

const TEXT_MIMES: Record<string, string> = {
  adoc: "text/x-asciidoc",
  astro: "text/plain",
  bat: "application/x-bat",
  bash: "application/x-sh",
  bicep: "text/plain",
  bib: "text/plain",
  c: "text/x-c",
  cc: "text/x-c++",
  cfg: "text/plain",
  cjs: "text/javascript",
  cmake: "text/x-cmake",
  cmd: "application/x-bat",
  conf: "text/plain",
  cpp: "text/x-c++",
  cs: "text/x-csharp",
  css: "text/css",
  dart: "application/dart",
  diff: "text/x-diff",
  drawio: "application/xml",
  eex: "text/plain",
  ejs: "text/plain",
  el: "text/x-elisp",
  elm: "text/plain",
  erb: "text/plain",
  ex: "text/x-elixir",
  exs: "text/x-elixir",
  f: "text/x-fortran",
  f03: "text/x-fortran",
  f08: "text/x-fortran",
  f90: "text/x-fortran",
  f95: "text/x-fortran",
  fish: "application/x-sh",
  fs: "text/x-fsharp",
  fsi: "text/x-fsharp",
  fsx: "text/x-fsharp",
  gemspec: "text/x-ruby",
  glsl: "text/plain",
  go: "text/x-go",
  gradle: "text/x-groovy",
  graphql: "application/graphql",
  groovy: "text/x-groovy",
  gv: "text/x-graphviz",
  h: "text/x-c",
  hbs: "text/x-handlebars-template",
  hlsl: "text/plain",
  hpp: "text/x-c++",
  hs: "text/x-haskell",
  htm: "text/html",
  html: "text/html",
  http: "text/plain",
  hx: "text/x-haxe",
  inc: "text/plain",
  ini: "text/plain",
  java: "text/x-java-source",
  j2: "text/plain",
  jade: "text/x-pug",
  jinja: "text/plain",
  jl: "text/x-julia",
  js: "text/javascript",
  json: "application/json",
  json5: "application/json5",
  jsonc: "application/json",
  jsx: "text/jsx",
  jsp: "text/x-jsp",
  kt: "text/x-kotlin",
  kts: "text/x-kotlin",
  less: "text/less",
  lisp: "text/x-lisp",
  lrc: "text/plain",
  lock: "text/plain",
  log: "text/plain",
  lua: "text/x-lua",
  m: "text/x-objectivec",
  m3u: "text/plain",
  m3u8: "text/plain",
  markdown: "text/markdown",
  md: "text/markdown",
  mdown: "text/markdown",
  mdx: "text/markdown",
  mjs: "text/javascript",
  mk: "text/x-makefile",
  mkd: "text/markdown",
  ml: "text/x-ocaml",
  mli: "text/x-ocaml",
  mm: "text/x-objectivec",
  mts: "text/typescript",
  nim: "text/plain",
  nix: "text/plain",
  pas: "text/x-pascal",
  patch: "text/x-diff",
  php: "application/x-httpd-php",
  pl: "text/x-perl",
  plist: "application/xml",
  pm: "text/x-perl",
  pp: "text/x-puppet",
  prisma: "text/plain",
  properties: "text/x-properties",
  proto: "text/x-protobuf",
  ps1: "application/x-powershell",
  psd1: "application/x-powershell",
  psm1: "application/x-powershell",
  py: "text/x-python",
  pyi: "text/x-python",
  r: "text/x-r",
  rake: "text/x-ruby",
  rb: "text/x-ruby",
  rs: "text/x-rust",
  rst: "text/x-rst",
  sass: "text/x-sass",
  sbt: "text/x-scala",
  scala: "text/x-scala",
  sc: "text/x-scala",
  scss: "text/x-scss",
  service: "text/plain",
  sh: "application/x-sh",
  sml: "text/x-sml",
  sol: "text/plain",
  sql: "application/sql",
  srt: "text/plain",
  styl: "text/x-styl",
  svelte: "text/plain",
  swift: "text/x-swift",
  t: "text/x-perl",
  tf: "text/x-hcl",
  tfvars: "text/x-hcl",
  thrift: "text/plain",
  tmpl: "text/plain",
  toml: "application/toml",
  ts: "text/typescript",
  tsx: "text/tsx",
  twig: "text/x-twig",
  txt: "text/plain",
  v: "text/x-verilog",
  vb: "text/x-vb",
  vbs: "text/x-vbscript",
  vhd: "text/x-vhdl",
  vhdl: "text/x-vhdl",
  vim: "text/x-vim",
  vue: "text/x-vue",
  vtt: "text/vtt",
  wat: "text/plain",
  wxml: "application/xml",
  wxss: "text/css",
  xhtml: "application/xhtml+xml",
  xml: "application/xml",
  xsd: "application/xml",
  xsl: "application/xml",
  xslt: "application/xml",
  yaml: "text/yaml",
  yml: "text/yaml",
  zig: "text/plain",
  zsh: "application/x-sh",
};

/** viewer 渲染比纯文本更好的结构化数据格式。HTML/HTM 留在 CodeMirror：
 * viewer 的 HTML 预览硬编码白色 iframe 底色，无法跟随宿主暗色主题。 */
const VIEWER_TEXT_MIMES: Record<string, string> = {
  csv: "text/csv",
  ipynb: "application/x-ipynb+json",
  tsv: "text/tab-separated-values",
};

const OFFICE_MIMES: Record<string, string> = {
  dbf: "application/x-dbf",
  doc: "application/msword",
  docm: "application/vnd.ms-word.document.macroEnabled.12",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  dot: "application/msword",
  dotm: "application/vnd.ms-word.template.macroEnabled.12",
  dotx: "application/vnd.openxmlformats-officedocument.wordprocessingml.template",
  fods: "application/vnd.oasis.opendocument.spreadsheet",
  ofd: "application/ofd",
  odg: "application/vnd.oasis.opendocument.graphics",
  odp: "application/vnd.oasis.opendocument.presentation",
  ods: "application/vnd.oasis.opendocument.spreadsheet",
  odt: "application/vnd.oasis.opendocument.text",
  pot: "application/vnd.ms-powerpoint",
  potm: "application/vnd.ms-powerpoint.template.macroEnabled.12",
  potx: "application/vnd.openxmlformats-officedocument.presentationml.template",
  pps: "application/vnd.ms-powerpoint",
  ppsx: "application/vnd.openxmlformats-officedocument.presentationml.slideshow",
  ppsm: "application/vnd.ms-powerpoint.slideshow.macroEnabled.12",
  ppt: "application/vnd.ms-powerpoint",
  pptm: "application/vnd.ms-powerpoint.presentation.macroEnabled.12",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  rtf: "application/rtf",
  xla: "application/vnd.ms-excel",
  xlam: "application/vnd.ms-excel.addin.macroEnabled.12",
  xls: "application/vnd.ms-excel",
  xlsb: "application/vnd.ms-excel.sheet.binary.macroEnabled.12",
  xlsm: "application/vnd.ms-excel.sheet.macroEnabled.12",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xlt: "application/vnd.ms-excel",
  xltm: "application/vnd.ms-excel.template.macroEnabled.12",
  xltx: "application/vnd.openxmlformats-officedocument.spreadsheetml.template",
  xmind: "application/vnd.xmind",
};

const PDF_MIMES: Record<string, string> = {
  pdf: "application/pdf",
};

const MEDIA_MIMES: Record<string, string> = {
  aac: "audio/aac",
  avi: "video/x-msvideo",
  flac: "audio/flac",
  m4a: "audio/mp4",
  m4v: "video/x-m4v",
  mid: "audio/midi",
  midi: "audio/midi",
  mkv: "video/x-matroska",
  mov: "video/quicktime",
  mp3: "audio/mpeg",
  mp4: "video/mp4",
  oga: "audio/ogg",
  ogg: "audio/ogg",
  opus: "audio/opus",
  wav: "audio/wav",
  weba: "audio/webm",
  webm: "video/webm",
  wma: "audio/x-ms-wma",
  wmv: "video/x-ms-wmv",
};

const KNOWN_PREVIEWS: Record<string, KnownPreview> = {
  ...Object.fromEntries(Object.entries(IMAGE_MIMES).map(([extension, mime]) => [extension, { kind: "image", mime, strategy: "image" as const }])),
  ...Object.fromEntries(Object.entries(VIEWER_IMAGE_MIMES).map(([extension, mime]) => [extension, { kind: "image", mime, strategy: "file-viewer" as const }])),
  ...Object.fromEntries(Object.entries(TEXT_MIMES).map(([extension, mime]) => [extension, { kind: "text", mime, editable: true }])),
  ...Object.fromEntries(Object.entries(VIEWER_TEXT_MIMES).map(([extension, mime]) => [extension, { kind: "text", mime, strategy: "file-viewer" as const }])),
  ...Object.fromEntries(Object.entries(OFFICE_MIMES).map(([extension, mime]) => [extension, { kind: "office", mime, strategy: "file-viewer" as const }])),
  ...Object.fromEntries(Object.entries(PDF_MIMES).map(([extension, mime]) => [extension, { kind: "pdf", mime, strategy: "file-viewer" as const }])),
  ...Object.fromEntries(Object.entries(MEDIA_MIMES).map(([extension, mime]) => [extension, { kind: "media", mime, strategy: "file-viewer" as const }])),
};

export function extensionFor(path: string): string {
  const basename = path.split(/[\\/]/).pop() ?? "";
  const lower = basename.toLowerCase();
  for (const compound of ["tar.gz"]) {
    if (lower.endsWith(`.${compound}`)) return compound;
  }
  const dot = lower.lastIndexOf(".");
  // 开头的点表示 dotfile（如 .env），不是扩展名。
  if (dot <= 0 || dot === lower.length - 1) return "";
  return lower.slice(dot + 1);
}

function unknownPreview(extension: string): PreviewResolution {
  return {
    extension,
    mime: null,
    kind: "unknown",
    editable: false,
    // 未知扩展保留可读性启发式：可读文本按只读文本展示，其余走 hex dump。
    previewStrategy: "hex",
    editorStrategy: null,
    fallback: true,
    fallbackReason: "unknown-extension",
  };
}

/**
 * 把路径解析为渲染与编辑能力，不引入渲染器本体。
 *
 * 文本/代码预览与编辑留在 CodeMirror；图片走原生元素；Office/PDF/媒体/表格
 * 等交给内嵌 file-viewer；未知扩展走 text/hex 启发式。
 */
export function resolvePreview(path: string): PreviewResolution {
  const extension = extensionFor(path);
  const known = KNOWN_PREVIEWS[extension];
  if (!known) return unknownPreview(extension);

  const editable = known.editable === true;
  const strategy: PreviewStrategy = known.strategy ?? (editable ? "codemirror" : "hex");
  return {
    extension,
    mime: known.mime,
    kind: known.kind,
    editable,
    previewStrategy: strategy,
    editorStrategy: editable ? "codemirror" : null,
    fallback: false,
    fallbackReason: null,
  };
}
