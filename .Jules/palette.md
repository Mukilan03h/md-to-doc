## 2024-05-25 - Icon-only Tab Close Buttons Require Labels
**Learning:** The file tabs in the sidebar use a raw HTML `✕` string inside an icon-only button to close files. Because the button only visually conveys its purpose via this symbol, it completely lacks context for screen readers.
**Action:** Always ensure that any button acting exclusively via visual iconography (such as `✕` or `<svg>`) includes an explicit, descriptive `aria-label` (e.g., `aria-label="Close filename.md"`) and appropriate keyboard focus styling (`focus-visible`).
