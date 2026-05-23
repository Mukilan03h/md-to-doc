## 2025-05-23 - Tab Bar Accessibility & Micro-UX
**Learning:** The custom tab bar implementation relies on raw generic `<button>` elements for closing tabs instead of the provided Radix/UI `Button` component, leading to missing focus states and ARIA labels. Users relying on screen readers wouldn't know which file they are closing, and keyboard users lack a visual focus indicator.
**Action:** Always ensure raw interactive elements used outside of standard form contexts explicitly include keyboard focus visibility (`focus-visible:ring-2`) and screen-reader labels (`aria-label`).
