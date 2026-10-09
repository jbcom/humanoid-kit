import { defineConfig, markdown } from "sourcey";

export default defineConfig({
  name: "humanoid-kit",
  siteUrl: "https://jbcom.github.io",
  baseUrl: "/humanoid-kit",
  theme: {
    preset: "default",
    colors: {
      primary: "#1c3a52",
      light: "#377eb7",
      dark: "#0d1b26",
    },
    fonts: {
      sans: "system-ui, sans-serif",
      mono: "ui-monospace, SFMono-Regular, Menlo, monospace",
    },
    layout: {
      sidebar: "17rem",
      toc: "18rem",
      content: "46rem",
    },
    css: ["./brand.css"],
  },
  logo: { light: "./assets/favicon.svg", href: "/humanoid-kit/" },
  favicon: "./assets/favicon.svg",
  repo: "https://github.com/jbcom/humanoid-kit",
  editBranch: "main",
  editBasePath: "docs",
  prettyUrls: "slash",
  navbar: {
    links: [
      { type: "github", href: "https://github.com/jbcom/humanoid-kit" },
      { type: "npm", href: "https://www.npmjs.com/package/humanoid-kit" },
      {
        type: "link",
        label: "Playground",
        href: "https://jbcom.github.io/humanoid-kit/playground/",
      },
    ],
  },
  footer: {
    links: [
      {
        type: "link",
        label: "MIT License",
        href: "https://github.com/jbcom/humanoid-kit/blob/main/LICENSE",
      },
      {
        type: "link",
        label: "Asset notice",
        href: "https://github.com/jbcom/humanoid-kit/blob/main/NOTICE.md",
      },
      {
        type: "link",
        label: "Security",
        href: "https://github.com/jbcom/humanoid-kit/security/policy",
      },
    ],
  },
  navigation: {
    tabs: [
      {
        tab: "Documentation",
        slug: "",
        source: markdown({
          groups: [
            {
              group: "Getting Started",
              pages: ["introduction", "getting-started"],
            },
            {
              group: "Reference",
              pages: ["API", "ARCHITECTURE"],
            },
            {
              group: "Project",
              pages: ["contributing", "release-history"],
            },
          ],
        }),
      },
    ],
  },
});
