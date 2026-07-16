import { defineConfig } from "vite-plus";
import { oxContent, defineTheme, defaultTheme } from "@ox-content/vite-plugin";
import githubDarkDefault from "shiki/themes/github-dark-default.mjs";
import idrisGrammar from "./syntaxes/idris.tmLanguage.json";
import ipkgGrammar from "./syntaxes/ipkg.tmLanguage.json";
import idrisReplGrammar from "./syntaxes/idris-repl.tmLanguage.json";

// ---------------------------------------------------------------------------
// Locale — the site is built twice: English at "/", Japanese at "/ja/".
// ---------------------------------------------------------------------------

const locale = process.env.DOCS_LOCALE === "ja" ? "ja" : "en";
const isJa = locale === "ja";

// ---------------------------------------------------------------------------
// Table of contents — one definition, two languages.
// ---------------------------------------------------------------------------

interface Chapter {
  slug: string;
  en: string;
  ja: string;
}

interface Part {
  en: string;
  ja: string;
  items: Chapter[];
}

const toc: Part[] = [
  {
    en: "Introduction",
    ja: "はじめに",
    items: [
      { slug: "01-why-functional", en: "Why Functional? Why Idris?", ja: "なぜ関数型?なぜIdris?" },
      { slug: "02-regex-engines", en: "What Is a Regex Engine?", ja: "正規表現エンジンとは" },
      { slug: "03-setup", en: "Setting Up", ja: "環境構築" },
      { slug: "04-idris-crash-course", en: "An Idris Crash Course", ja: "Idris速習" },
      { slug: "05-tdd", en: "TDD and a Tiny Test Harness", ja: "TDDと小さなテストハーネス" },
    ],
  },
  {
    en: "The Core Engine",
    ja: "コアエンジン",
    items: [
      { slug: "06-regex-as-data", en: "A Regex Is Data", ja: "正規表現はデータである" },
      { slug: "07-nullable", en: "nullable: Matching Nothing", ja: "nullable:空文字列とのマッチ" },
      { slug: "08-derivatives", en: "The Derivative", ja: "微分" },
      { slug: "09-matches", en: "matches: The Whole Engine", ja: "matches:エンジン完成" },
    ],
  },
  {
    en: "Making It Practical",
    ja: "実用にする",
    items: [
      { slug: "10-smart-constructors", en: "Smart Constructors", ja: "スマートコンストラクタ" },
      { slug: "11-character-classes", en: "Character Classes", ja: "文字クラス" },
      { slug: "12-sugar", en: "Sugar Is Just Functions", ja: "糖衣構文はただの関数" },
      { slug: "13-parser-combinators", en: "Parser Combinators", ja: "パーサコンビネータ" },
      { slug: "14-pattern-syntax", en: "Parsing Pattern Syntax", ja: "パターン構文をパースする" },
      { slug: "15-public-api", en: "A Public API", ja: "公開API" },
    ],
  },
  {
    en: "Idris Power-Ups",
    ja: "Idrisの真価",
    items: [
      { slug: "16-interfaces", en: "Interfaces and Two Monoids", ja: "インターフェースと2つのモノイド" },
      { slug: "17-pretty-printing", en: "Printing Patterns Back", ja: "パターンを印字し直す" },
      { slug: "18-proofs", en: "Tests Become Theorems", ja: "テストが定理になる" },
      { slug: "19-the-race", en: "The Race: Linear vs Backtracking", ja: "対決:線形時間vsバックトラック" },
      { slug: "20-lexer", en: "Capstone: A Lexer", ja: "総仕上げ:レキサ" },
      { slug: "21-whats-next", en: "What's Next", ja: "この先へ" },
    ],
  },
];

// Chapter numbers come from the file names (01-…, 02-…): showing
// them in the sidebar makes the book's reading order visible at a
// glance, on the site and in the repository alike.
const sidebar = toc.map((part) => ({
  text: part[locale],
  items: part.items.map((ch) => ({
    text: `${ch.slug.slice(0, 2)} · ${ch[locale]}`,
    link: `/${ch.slug}.md`,
  })),
}));

// ---------------------------------------------------------------------------
// Syntax highlighting — a monochrome theme, plus Idris (the Haskell
// TextMate grammar is close enough to lex Idris 2 sources).
// ---------------------------------------------------------------------------

// A small hand-written TextMate grammar for Idris 2. The Haskell
// grammar was close but not close enough: it does not know `|||`
// doc comments, so it tokenized our (abundant) documentation as
// code. This one understands doc comments, `--` comments, pragmas,
// holes, backtick infix, and the keywords this book actually uses.
// (The alias list must not contain the name itself — shiki treats
// that as a circular alias.)
const idris = {
  ...idrisGrammar,
  name: "idris",
  aliases: ["idris2"],
};

// Package files and REPL transcripts get their own small grammars.
// The REPL grammar highlights the prompt, REPL :commands, and the
// typed expression (by embedding source.idris); output lines stay
// plain, error lines go red.
const ipkg = { ...ipkgGrammar, name: "ipkg" };
const idrisRepl = { ...idrisReplGrammar, name: "idris-repl", aliases: ["repl"] };

// Real syntax colors for code, on a near-black flat background that
// sits quietly inside the otherwise monochrome design.
const codeTheme = githubDarkDefault;

// ---------------------------------------------------------------------------
// Theme — monochrome, flat, quiet. No shadows, no gradients, no serifs.
// ---------------------------------------------------------------------------

const customCss = `
  * { box-shadow: none !important; text-shadow: none !important; }
  /* CJK-Latin spacing comes from the engine, not from manual spaces */
  body { text-autospace: normal; }
  pre, code, kbd, samp { text-autospace: no-autospace; }
  .content a { text-decoration: underline; text-underline-offset: 2px; }
  .content h1, .content h2, .content h3, .content h4, .header-title {
    font-family: "Space Grotesk", "Zen Kaku Gothic New", "IBM Plex Sans JP", system-ui, sans-serif;
    letter-spacing: -0.01em;
  }
  /* the default theme fades code blocks with a top gradient — keep them flat */
  .content pre {
    background: var(--octc-color-code-bg) !important;
  }
  .code-block {
    position: relative;
  }
  .code-copy {
    position: absolute;
    top: 8px;
    right: 8px;
    padding: 2px 8px;
    font-family: var(--octc-font-sans);
    font-size: 12px;
    line-height: 1.6;
    color: #9a9a9a;
    background: transparent;
    border: 1px solid #333333;
    border-radius: 0;
    cursor: pointer;
    opacity: 0;
    transition: opacity 0.15s ease, color 0.15s ease;
  }
  .code-block:hover .code-copy,
  .code-copy:focus-visible { opacity: 1; }
  .code-copy:hover { color: #ededed; border-color: #555555; }
  .content blockquote {
    border-left: none;
    padding-left: 0;
    color: var(--octc-color-text-muted);
  }
  .content blockquote.ox-callout {
    border: 1px solid var(--octc-color-border);
    background: var(--octc-color-bg-alt);
    border-radius: 0;
    padding: 0.875rem 1rem;
    color: var(--octc-color-text);
  }
  .toc-link, .toc-link:hover, .toc-link.active {
    border-left: none;
  }
  /* sidebar: the default active state is a near-invisible tint —
     invert instead: unmistakable in both light and dark, still flat */
  .nav-link.active, .nav-link.active:hover {
    background: var(--octc-color-text);
    color: var(--octc-color-bg);
    font-weight: 600;
  }
  /* separate the book's parts with a quiet horizontal rule */
  .nav-section + .nav-section {
    margin-top: 1.1rem;
    padding-top: 1.1rem;
    border-top: 1px solid var(--octc-color-border);
  }
  .nav-title { margin-bottom: 0.55rem; }
  #lang-switch {
    font-size: 13px;
    color: var(--octc-color-text-muted);
    text-decoration: none;
    padding: 0 8px;
  }
  #lang-switch:hover { color: var(--octc-color-text); }
`;

const langSwitchJs = `
  (function () {
    var link = document.getElementById("lang-switch");
    if (!link) return;
    var path = location.pathname;
    link.href = path.indexOf("/ja/") === 0 ? (path.slice(3) || "/") : "/ja" + path;
  })();
  (function () {
    function addCopyButtons() {
      document.querySelectorAll(".content pre").forEach(function (pre) {
        if (pre.parentElement && pre.parentElement.classList.contains("code-block")) return;
        var wrapper = document.createElement("div");
        wrapper.className = "code-block";
        pre.parentNode.insertBefore(wrapper, pre);
        wrapper.appendChild(pre);
        var btn = document.createElement("button");
        btn.className = "code-copy";
        btn.type = "button";
        btn.textContent = "Copy";
        btn.addEventListener("click", function () {
          var code = pre.querySelector("code");
          var text = (code || pre).innerText.replace(/\\n$/, "");
          navigator.clipboard.writeText(text).then(function () {
            btn.textContent = "Copied";
            setTimeout(function () { btn.textContent = "Copy"; }, 1500);
          });
        });
        wrapper.appendChild(btn);
      });
    }
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", addCopyButtons);
    } else {
      addCopyButtons();
    }
  })();
`;

// ---------------------------------------------------------------------------

export default defineConfig({
  base: isJa ? "/ja/" : "/",
  build: {
    outDir: isJa ? "dist/ja" : "dist",
  },
  plugins: [
    oxContent({
      srcDir: isJa ? "content/ja" : "content/en",
      outDir: isJa ? "dist/ja" : "dist",
      base: isJa ? "/ja/" : "/",
      highlight: true,
      highlightTheme: codeTheme,
      highlightLangs: [idris, ipkg, idrisRepl],
      docs: false,
      search: { enabled: true, hotkey: "/" },
      ssg: {
        siteName: "Let's Start Functional",
        siteUrl: "https://lets-start-functional.void.app",
        theme: defineTheme({
          extends: defaultTheme,
          entryPage: { mode: "subtle" },
          // Same stacks as wtrclred.io: IBM Plex Sans JP for body,
          // JetBrains Mono for code, Space Grotesk / Zen Kaku Gothic
          // New for headings (via customCss below).
          fonts: {
            sans: '"IBM Plex Sans JP", "Hiragino Sans", "Yu Gothic Medium", "Yu Gothic", system-ui, sans-serif',
            mono: '"JetBrains Mono", ui-monospace, "SFMono-Regular", "SF Mono", Menlo, Consolas, monospace',
          },
          colors: {
            primary: "#111111",
            primaryHover: "#000000",
            background: "#ffffff",
            backgroundAlt: "#f7f7f7",
            text: "#1a1a1a",
            textMuted: "#6e6e6e",
            border: "#e5e5e5",
            codeBackground: "#0d1117",
            codeText: "#e6edf3",
          },
          darkColors: {
            primary: "#ededed",
            primaryHover: "#ffffff",
            background: "#0a0a0a",
            backgroundAlt: "#121212",
            text: "#ededed",
            textMuted: "#8f8f8f",
            border: "#242424",
            codeBackground: "#0d1117",
            codeText: "#e6edf3",
          },
          layout: {
            maxContentWidth: "760px",
          },
          sidebar,
          footer: {
            message: isJa ? "MITライセンスで公開" : "Released under the MIT License",
            copyright: "© 2026 ubugeeei",
          },
          socialLinks: {
            github: "https://github.com/ubugeeei-prod/lets-start-functional",
          },
          embed: {
            head: [
              `<link rel="icon" type="image/svg+xml" href="${isJa ? "/ja" : ""}/favicon.svg" />`,
              // Fonts, same as wtrclred.io.
              `<link rel="preconnect" href="https://fonts.googleapis.com">`,
              `<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>`,
              `<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+JP:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&family=Space+Grotesk:wght@500;700&family=Zen+Kaku+Gothic+New:wght@400;500;700;900&display=swap" rel="stylesheet">`,
              // og:image must be an absolute URL — relative paths are
              // ignored by most scrapers.
              `<meta property="og:image" content="https://lets-start-functional.void.app/og.png" />`,
              `<meta property="og:image:width" content="1200" />`,
              `<meta property="og:image:height" content="630" />`,
              `<meta name="twitter:image" content="https://lets-start-functional.void.app/og.png" />`,
            ].join("\n"),
            headerAfter: `<a id="lang-switch" href="${isJa ? "/" : "/ja/"}">${isJa ? "English" : "日本語"}</a>`,
          },
          css: customCss,
          js: langSwitchJs,
        }),
      },
    }),
  ],
});
