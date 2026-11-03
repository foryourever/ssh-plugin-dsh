// @vitest-environment happy-dom
// 「打开方式」下拉：条目集合（系统默认/可用编辑器/自定义编辑器/自定义命令）、
// 选中即 emit、本机能力缺失时禁用。菜单为受控内联层，点击触发器展开。
import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import FileOpenWithMenu from "./FileOpenWithMenu.vue";
import type { EditorConfig, KnownEditor } from "../lib/editorRules";

const editors: KnownEditor[] = [
  {
    id: "vscode",
    name: "VS Code",
    available: true,
    launch: { kind: "exe", exe: "/usr/local/bin/code", args: [] },
    suggestedExtensions: ["rs"],
  },
  {
    id: "sublime",
    name: "Sublime Text",
    available: false,
    launch: { kind: "exe", exe: "/opt/sublime/sublime_text", args: [] },
    suggestedExtensions: [],
  },
];

const editorConfig: EditorConfig = {
  associations: [],
  customEditors: [{ id: "my-editor", name: "My Editor", command: "my-editor {file}" }],
  uploadPolicy: "auto",
};

function mountMenu(overrides: Record<string, unknown> = {}) {
  return mount(FileOpenWithMenu, {
    props: {
      fileName: "main.rs",
      editors,
      editorConfig,
      canOpen: true,
      t: (key: string) => key,
      ...overrides,
    },
  });
}

async function openMenu(overrides: Record<string, unknown> = {}) {
  const wrapper = mountMenu(overrides);
  await wrapper.get("[data-test=preview-open-with]").trigger("click");
  return wrapper;
}

describe("FileOpenWithMenu", () => {
  it("toggles the menu from the trigger button", async () => {
    const wrapper = mountMenu();
    const trigger = wrapper.get("[data-test=preview-open-with]");
    expect(wrapper.find("[data-test=preview-open-with-menu]").exists()).toBe(false);
    await trigger.trigger("click");
    expect(wrapper.find("[data-test=preview-open-with-menu]").exists()).toBe(true);
    expect(trigger.attributes("aria-expanded")).toBe("true");
    await trigger.trigger("click");
    expect(wrapper.find("[data-test=preview-open-with-menu]").exists()).toBe(false);
  });

  it("lists system default, available editors and custom editors, hiding unavailable ones", async () => {
    const wrapper = await openMenu();
    const items = wrapper.findAll(".ssh-open-with-item");
    const text = items.map((item) => item.text());
    expect(text).toContain("sftpEdit.systemDefault");
    expect(text).toContain("VS Code");
    expect(text).toContain("My Editor");
    expect(text).toContain("sftpEdit.customCommand");
    expect(text).not.toContain("Sublime Text");
  });

  it("emits the picked known editor", async () => {
    const wrapper = await openMenu();
    const vscode = wrapper.findAll(".ssh-open-with-item").find((item) => item.text() === "VS Code");
    await vscode!.trigger("click");
    expect(wrapper.emitted("open")).toEqual([[{ kind: "known", editor: editors[0] }]]);
    // 选中后菜单收起。
    expect(wrapper.find("[data-test=preview-open-with-menu]").exists()).toBe(false);
  });

  it("emits the custom command entry", async () => {
    const wrapper = await openMenu();
    const custom = wrapper.findAll(".ssh-open-with-item").find((item) => item.text() === "sftpEdit.customCommand");
    await custom!.trigger("click");
    expect(wrapper.emitted("custom-command")).toHaveLength(1);
  });

  it("disables the trigger when local save capability is missing", async () => {
    const wrapper = mountMenu({ canOpen: false, disabledHint: "sftpEdit.desktopOnly" });
    const trigger = wrapper.get("[data-test=preview-open-with]");
    expect(trigger.attributes("disabled")).toBeDefined();
    expect(trigger.attributes("title")).toBe("sftpEdit.desktopOnly");
    await trigger.trigger("click");
    expect(wrapper.find("[data-test=preview-open-with-menu]").exists()).toBe(false);
  });
});
