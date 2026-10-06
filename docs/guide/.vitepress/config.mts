import { defineConfig } from "vitepress";

// The rider's guide, published under the project site at /agent-motoride/guide/.
// Pages are plain Markdown in docs/guide/, readable on GitHub as they are.
export default defineConfig({
  base: "/agent-motoride/guide/",
  title: "agentMotoride",
  titleTemplate: ":title · agentMotoride guide",
  description: "How to plan, ride and review motorcycle rides with agentMotoride, from the terminal or Claude Code.",
  lang: "en",
  cleanUrls: true,
  lastUpdated: true,
  head: [
    ["link", { rel: "preconnect", href: "https://fonts.googleapis.com" }],
    ["link", { rel: "preconnect", href: "https://fonts.gstatic.com", crossorigin: "" }],
    [
      "link",
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=JetBrains+Mono:wght@400;600&family=Space+Grotesk:wght@400;500;600&display=swap",
      },
    ],
  ],
  // Code panels are dark in both modes, like the site's terminal panel: highlight them for a dark background.
  markdown: { theme: { light: "github-dark", dark: "github-dark" } },
  themeConfig: {
    siteTitle: "agentMotoride · guide",
    nav: [
      { text: "Guide", link: "/getting-started" },
      { text: "Project site", link: "https://bhoudebert.github.io/agent-motoride/" },
    ],
    sidebar: [
      { text: "Start", items: [{ text: "Getting started", link: "/getting-started" }] },
      {
        text: "Before the ride",
        items: [
          { text: "Plan a ride", link: "/plan-a-ride" },
          { text: "Import a route someone shared", link: "/import-a-route" },
        ],
      },
      {
        text: "Ride day",
        items: [{ text: "On the phone and the GPS", link: "/phone-and-gps" }],
      },
      {
        text: "Back home",
        items: [{ text: "Notes and review", link: "/notes-and-review" }],
      },
    ],
    socialLinks: [{ icon: "github", link: "https://github.com/bhoudebert/agent-motoride" }],
    editLink: {
      pattern: "https://github.com/bhoudebert/agent-motoride/edit/main/docs/guide/:path",
      text: "Improve this page",
    },
    search: { provider: "local" },
    outline: { level: [2, 3], label: "On this page" },
    footer: {
      message:
        "A planning aid, not a navigation system. Road data © OpenStreetMap contributors, weather by Open-Meteo.",
      copyright: "MIT licence",
    },
  },
});
