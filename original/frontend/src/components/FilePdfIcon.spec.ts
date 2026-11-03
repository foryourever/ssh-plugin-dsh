// @vitest-environment happy-dom
// PDF 专属图标的根节点契约：必须单根，父级 class（ssh-fi-pdf /
// ssh-preview-fileicon）能透传到 svg——否则尺寸不受控会撑满预览弹窗。
import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import FilePdfIcon from "./FilePdfIcon.vue";

describe("FilePdfIcon", () => {
  it("is a single-root svg that forwards class attributes", () => {
    const wrapper = mount(FilePdfIcon, {
      attrs: { class: "ssh-fi-pdf ssh-preview-fileicon" },
    });
    expect(wrapper.element.tagName.toLowerCase()).toBe("svg");
    expect(wrapper.classes()).toContain("ssh-fi-pdf");
    expect(wrapper.classes()).toContain("ssh-preview-fileicon");
  });

  it("carries a defensive intrinsic size", () => {
    const wrapper = mount(FilePdfIcon);
    expect(wrapper.attributes("width")).toBe("16");
    expect(wrapper.attributes("height")).toBe("16");
  });
});
